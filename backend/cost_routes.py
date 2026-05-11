"""
Cato cost-tracking API routes.

Exposes ``/api/cost/*`` endpoints backed by Marcus's :class:`CostStore`
and :class:`CostAggregator` (see Marcus issue #409). Cato runs as a
sidecar to Marcus and imports the cost-tracking modules directly,
following the same pattern used by the historical analysis endpoints
in ``backend/api.py``.

Endpoints
---------
- ``GET  /api/cost/experiments`` — list experiments with totals
- ``GET  /api/cost/experiments/{exp_id}`` — full per-experiment breakdown
- ``GET  /api/cost/projects/{project_id}`` — project rollup + experiments
- ``GET  /api/cost/sessions/{session_id}/turns`` — per-turn trajectory
- ``GET  /api/cost/prices`` — current pricing table (latest per model)
- ``POST /api/cost/prices`` — insert a new price row (versioned by ``effective_from``)
- ``GET  /api/cost/export/{exp_id}`` — CSV export of all events
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Marcus module discovery
# ---------------------------------------------------------------------------

COST_TRACKING_AVAILABLE = False
CostStore: Any = None
CostAggregator: Any = None
ModelPrice: Any = None

try:
    import sys

    # Mirror the historical-mode discovery in backend/api.py: search a few
    # well-known Marcus locations and add its root to sys.path.
    _possible_roots = [
        Path(__file__).parent.parent.parent / "marcus",  # sibling
        Path.home() / "dev" / "marcus",
        Path("/Users/lwgray/dev/marcus"),
    ]
    _marcus_root: Optional[Path] = None
    for _root in _possible_roots:
        if (_root / "src" / "cost_tracking").exists():
            _marcus_root = _root
            break
    if _marcus_root is not None:
        if str(_marcus_root) not in sys.path:
            sys.path.insert(0, str(_marcus_root))
        from src.cost_tracking.cost_aggregator import (  # type: ignore[no-redef]
            CostAggregator,
        )
        from src.cost_tracking.cost_store import (  # type: ignore[no-redef]
            CostStore,
            ModelPrice,
        )

        COST_TRACKING_AVAILABLE = True
        logger.info("Cato cost-tracking enabled (Marcus at %s)", _marcus_root)
    else:
        logger.warning("Marcus cost_tracking modules not found; /api/cost/* disabled")
except Exception as exc:  # pragma: no cover - logged, fallback to disabled
    logger.error("Could not import Marcus cost_tracking: %s", exc)


# ---------------------------------------------------------------------------
# Store provider (FastAPI dependency, overridable in tests)
# ---------------------------------------------------------------------------


def _default_db_path() -> Path:
    """Return the default cost DB path Marcus uses (``~/.marcus/costs.db``).

    Override with the ``MARCUS_COST_DB`` env var in tests / non-default
    deployments.
    """
    return Path(
        os.environ.get("MARCUS_COST_DB", str(Path.home() / ".marcus" / "costs.db"))
    )


def get_store() -> Any:
    """Yield a :class:`CostStore` instance (FastAPI dependency).

    Tests override this via ``app.dependency_overrides`` to point at a
    tmp database.

    Raises
    ------
    HTTPException
        503 if Marcus's cost_tracking modules are not importable.
    """
    if not COST_TRACKING_AVAILABLE or CostStore is None:
        raise HTTPException(
            status_code=503,
            detail="Marcus cost_tracking modules are not available",
        )
    return CostStore(db_path=_default_db_path())


def get_aggregator(store: Any = Depends(get_store)) -> Any:
    """Yield a :class:`CostAggregator` (FastAPI dependency)."""
    return CostAggregator(store=store)


# ---------------------------------------------------------------------------
# Project-name resolution
# ---------------------------------------------------------------------------
#
# Marcus's main code path never calls ``start_experiment``, so the
# ``experiments`` table is usually empty and we can't get a human-
# readable project_name from there. Instead we read Marcus's project
# registry directly — ``data/marcus_state/projects.json`` — which is
# the same source Cato's regular projects panel uses
# (``aggregator._load_projects()`` in cato_src/core/aggregator.py).
#
# Cached with a 30s TTL: the file is small but reading it on every
# dashboard tick is wasteful, and 30s matches the dashboard's poll
# interval so the cache effectively no-ops repeat requests within a
# poll.

_PROJECT_NAMES_CACHE: Dict[str, str] = {}
_PROJECT_NAMES_CACHE_AT: float = 0.0
_PROJECT_NAMES_TTL_SEC = 30.0


def _load_project_names() -> Dict[str, str]:
    """Map ``project_id`` → ``name`` from Marcus's project registry.

    Reads ``<marcus_root>/data/marcus_state/projects.json`` (the same
    file Marcus's :class:`ProjectRegistry` writes). Returns an empty
    dict on any read failure — the dashboard then falls back to a
    truncated project_id in the picker, which is the pre-existing
    behavior.

    Cached for ``_PROJECT_NAMES_TTL_SEC`` to keep poll loops cheap.
    """
    global _PROJECT_NAMES_CACHE, _PROJECT_NAMES_CACHE_AT

    now = time.monotonic()
    if (
        _PROJECT_NAMES_CACHE
        and (now - _PROJECT_NAMES_CACHE_AT) < _PROJECT_NAMES_TTL_SEC
    ):
        return _PROJECT_NAMES_CACHE

    if _marcus_root is None:
        return {}

    projects_file = _marcus_root / "data" / "marcus_state" / "projects.json"
    if not projects_file.exists():
        return {}

    try:
        with projects_file.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        logger.debug("projects.json unreadable: %s", exc)
        return {}

    out: Dict[str, str] = {}
    for key, value in raw.items():
        # projects.json is a dict keyed by project_id with a sentinel
        # 'active_project' entry. Skip non-dict values and unkeyed rows.
        if key == "active_project" or not isinstance(value, dict):
            continue
        pid = value.get("id")
        name = value.get("name")
        if pid and name:
            # Marcus normalizes project_id to dashless hex at the write
            # path now (see canonical_project_id in cost_recorder.py), so
            # all new token_events rows match the second key below. We
            # index both variants anyway:
            #   - dashless covers new writes + legacy .hex auto-discovery
            #   - dashed covers the projects.json key itself (some Cato
            #     code paths look it up by registry id directly)
            # Cheap defense-in-depth against drift.
            out[pid] = name
            out[pid.replace("-", "")] = name

    _PROJECT_NAMES_CACHE = out
    _PROJECT_NAMES_CACHE_AT = now
    return out


def clear_project_names_cache() -> None:
    """Drop the project-name cache. Used by tests."""
    global _PROJECT_NAMES_CACHE, _PROJECT_NAMES_CACHE_AT
    _PROJECT_NAMES_CACHE = {}
    _PROJECT_NAMES_CACHE_AT = 0.0


def _enrich_project_names(rows: list) -> list:
    """Overlay registry names on cost rows when no MLflow name exists.

    Mutates each row in-place: if ``project_name`` is None / missing,
    fill it from the registry. Otherwise leave it (an MLflow run with
    an explicit project_name wins because it was set by the user).
    """
    names = _load_project_names()
    for row in rows:
        if not row.get("project_name") and row.get("project_id") in names:
            row["project_name"] = names[row["project_id"]]
    return rows


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ProjectBudgetRequest(BaseModel):
    """Payload for ``PUT /api/cost/projects/{id}/budget``.

    Sending ``budget_usd <= 0`` removes the cap (Marcus side deletes
    the row); the dashboard then reverts to the "no budget set" hint.
    """

    budget_usd: float = Field(
        ...,
        description="USD ceiling. <= 0 clears the cap.",
    )
    note: Optional[str] = Field(
        None,
        description="Free-text annotation (e.g., 'PoC cap', 'Q2 budget').",
    )


class PriceCreateRequest(BaseModel):
    """Payload for POST /api/cost/prices.

    Mirrors :class:`src.cost_tracking.cost_store.ModelPrice`. Pricing is
    versioned: send a new ``effective_from`` to update a model's rate
    without rewriting historical events.
    """

    model: str = Field(..., description="Model identifier (e.g. 'claude-sonnet-4-6')")
    provider: str = Field(..., description="Provider tag ('anthropic', 'openai', etc.)")
    effective_from: Optional[datetime] = Field(
        None,
        description="UTC datetime this price became active. Defaults to now.",
    )
    input_per_million: float = Field(..., ge=0)
    output_per_million: float = Field(..., ge=0)
    cache_creation_per_million: Optional[float] = Field(None, ge=0)
    cache_read_per_million: Optional[float] = Field(None, ge=0)
    source: str = Field(
        "cato_user",
        description="Origin tag — 'cato_user' for UI edits, 'contract' for "
        "negotiated rates, 'default' is reserved for seed data.",
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


router = APIRouter(prefix="/api/cost", tags=["cost"])


@router.post("/ingest")  # type: ignore[misc]
def trigger_ingest(
    store: Any = Depends(get_store),
) -> Dict[str, Any]:
    """Sweep ``~/.claude/projects/`` and ingest any new worker session events.

    Marcus's :class:`WorkerJSONLIngester` is idempotent (UUID-dedupes
    per process) so calling this on every dashboard load is safe.
    Returns a small summary so the UI can show "X new events ingested
    from Y files" if it wants.
    """
    from backend.cost_ingest import run_ingest

    return run_ingest(store)


@router.get("/projects")  # type: ignore[misc]
def list_projects(
    limit: int = Query(100, ge=1, le=1000),
    aggregator: Any = Depends(get_aggregator),
) -> Dict[str, Any]:
    """List every project that has cost activity, sorted by spend desc.

    Project is Marcus's primary identity (GH-388 + spawn_agents.py), so
    this is the dashboard's main entry point. Each row carries event
    count, experiment count, agent count, tokens, cost, and first/last
    activity timestamps. Excludes the ``'unassigned'`` bucket — surfaced
    separately via ``/api/cost/projects/unassigned``.

    Parameters
    ----------
    limit : int
        Cap at 1000. Default 100.
    """
    rows = aggregator.list_projects(limit=limit)
    _enrich_project_names(rows)
    return {"projects": rows, "count": len(rows)}


@router.get("/projects/unassigned")  # type: ignore[misc]
def unassigned_totals(
    aggregator: Any = Depends(get_aggregator),
) -> Dict[str, Any]:
    """Cost of LLM calls Marcus made without an active PlannerContext.

    Surfaces the "no project resolved" bucket as a first-class panel so
    the gap is observable rather than silent. A high number here means
    a code path is making LLM calls outside the MCP request lifecycle
    (or a project-creation tool ran without a target project_id).
    """
    totals: Dict[str, Any] = aggregator.unassigned_totals()
    return totals


@router.get("/experiments")  # type: ignore[misc]
def list_experiments(
    project_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    aggregator: Any = Depends(get_aggregator),
) -> Dict[str, Any]:
    """List experiments with token + cost totals attached.

    Parameters
    ----------
    project_id : str, optional
        Restrict to one project.
    limit : int
        Cap at 1000. Default 100.
    """
    rows = aggregator.list_experiments(project_id=project_id, limit=limit)
    return {"experiments": rows, "count": len(rows)}


@router.get("/experiments/{experiment_id}")  # type: ignore[misc]
def experiment_summary(
    experiment_id: str,
    aggregator: Any = Depends(get_aggregator),
) -> Dict[str, Any]:
    """Full per-experiment breakdown (summary + by_role / agent / task / etc.).

    Returns the exact dict shape documented in Marcus #409. Cato's
    frontend renders the result without further transformation.

    Raises
    ------
    HTTPException
        404 if the experiment does not exist.
    """
    summary: Optional[Dict[str, Any]] = aggregator.experiment_summary(experiment_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="experiment not found")
    return summary


@router.get("/projects/{project_id}")  # type: ignore[misc]
def project_summary(
    project_id: str,
    aggregator: Any = Depends(get_aggregator),
) -> Dict[str, Any]:
    """Project rollup + list of experiment summaries.

    Legacy thin shape kept for backwards compatibility with the old
    project picker; the project-first dashboard tabs use
    ``/projects/{id}/summary`` for the full per-project breakdown.
    """
    names = _load_project_names()
    return {
        "project_id": project_id,
        "project_name": names.get(project_id),
        "totals": aggregator.project_totals(project_id),
        "experiments": aggregator.list_experiments(project_id=project_id),
    }


@router.get("/projects/{project_id}/budget")  # type: ignore[misc]
def get_project_budget(
    project_id: str,
    store: Any = Depends(get_store),
) -> Dict[str, Any]:
    """Return the budget cap set for a project, or null if none.

    Surfaced to the dashboard's Budget tab so it can render
    spend-vs-cap when a ceiling is set, falling back to spend-only
    when not.
    """
    row = store.get_project_budget(project_id)
    return {"project_id": project_id, "budget": row}


@router.put("/projects/{project_id}/budget")  # type: ignore[misc]
def put_project_budget(
    project_id: str,
    payload: ProjectBudgetRequest,
    store: Any = Depends(get_store),
) -> Dict[str, Any]:
    """Set or clear a project's budget cap.

    Idempotent upsert on Marcus's side; the cap survives Cato
    restarts because it's persisted to costs.db. Passing
    ``budget_usd <= 0`` clears the cap (deletes the row).
    """
    store.set_project_budget(
        project_id=project_id,
        budget_usd=payload.budget_usd,
        note=payload.note,
    )
    row = store.get_project_budget(project_id)
    return {"project_id": project_id, "budget": row}


@router.get("/projects/{project_id}/summary")  # type: ignore[misc]
def project_full_summary(
    project_id: str,
    aggregator: Any = Depends(get_aggregator),
) -> Dict[str, Any]:
    """Full per-project breakdown — drives Real-time/Historical/Budget tabs.

    Same shape as ``/experiments/{id}`` (summary + by_role / by_agent /
    by_task / by_operation / by_model) but scoped to project_id, the
    only universal identity in Marcus's coordination model (#503).
    Project-name is overlaid from Marcus's project registry (same
    source the regular projects panel uses).

    Raises
    ------
    HTTPException
        404 if the project has no token events.
    """
    summary: Optional[Dict[str, Any]] = aggregator.project_summary(project_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="project not found")
    names = _load_project_names()
    summary["project_name"] = names.get(project_id)
    return summary


@router.get("/sessions/{session_id}/turns")  # type: ignore[misc]
def session_turns(
    session_id: str,
    aggregator: Any = Depends(get_aggregator),
) -> Dict[str, Any]:
    """Per-turn cost trajectory for one Claude Code session."""
    turns = aggregator.session_turns(session_id)
    return {"session_id": session_id, "turns": turns}


# -- pricing endpoints -------------------------------------------------------


@router.get("/prices")  # type: ignore[misc]
def list_current_prices(
    store: Any = Depends(get_store),
) -> Dict[str, Any]:
    """Return the latest price per (model, provider) — what's currently in effect."""
    rows = list(store.conn.execute("""
            SELECT model, provider, effective_from,
                   input_per_million, output_per_million,
                   cache_creation_per_million, cache_read_per_million, source
            FROM model_prices p1
            WHERE effective_from = (
                SELECT MAX(effective_from) FROM model_prices p2
                WHERE p2.model = p1.model AND p2.provider = p1.provider
            )
            ORDER BY model, provider
            """))
    cols = [
        "model",
        "provider",
        "effective_from",
        "input_per_million",
        "output_per_million",
        "cache_creation_per_million",
        "cache_read_per_million",
        "source",
    ]
    return {"prices": [dict(zip(cols, r)) for r in rows]}


@router.get("/prices/history")  # type: ignore[misc]
def list_price_history(
    model: Optional[str] = Query(None),
    store: Any = Depends(get_store),
) -> Dict[str, Any]:
    """Full price history, optionally filtered to a single ``model``."""
    if model:
        rows = list(
            store.conn.execute(
                "SELECT model, provider, effective_from, input_per_million, "
                "output_per_million, cache_creation_per_million, "
                "cache_read_per_million, source FROM model_prices "
                "WHERE model = ? ORDER BY effective_from DESC",
                (model,),
            )
        )
    else:
        rows = list(
            store.conn.execute(
                "SELECT model, provider, effective_from, input_per_million, "
                "output_per_million, cache_creation_per_million, "
                "cache_read_per_million, source FROM model_prices "
                "ORDER BY model, effective_from DESC"
            )
        )
    cols = [
        "model",
        "provider",
        "effective_from",
        "input_per_million",
        "output_per_million",
        "cache_creation_per_million",
        "cache_read_per_million",
        "source",
    ]
    return {"prices": [dict(zip(cols, r)) for r in rows]}


@router.post("/prices")  # type: ignore[misc]
def create_price(
    payload: PriceCreateRequest,
    store: Any = Depends(get_store),
) -> Dict[str, Any]:
    """Insert a new ``model_prices`` row, versioned by ``effective_from``.

    A duplicate ``(model, provider, effective_from)`` returns 409.
    """
    if ModelPrice is None:  # pragma: no cover - guarded by get_store
        raise HTTPException(status_code=503, detail="cost_tracking unavailable")
    effective = payload.effective_from or datetime.now(timezone.utc)
    price = ModelPrice(
        model=payload.model,
        provider=payload.provider,
        effective_from=effective,
        input_per_million=payload.input_per_million,
        output_per_million=payload.output_per_million,
        cache_creation_per_million=payload.cache_creation_per_million,
        cache_read_per_million=payload.cache_read_per_million,
        source=payload.source,
    )
    try:
        store.record_price(price)
    except Exception as exc:
        # IntegrityError raised by sqlite3 on duplicate PK.
        if (
            "UNIQUE" in str(exc)
            or "PRIMARY KEY" in str(exc)
            or "constraint" in str(exc).lower()
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "price with that (model, provider, effective_from) "
                    "already exists"
                ),
            )
        raise
    return {"status": "ok", "effective_from": effective.isoformat()}


# -- export ------------------------------------------------------------------


@router.get("/export/{experiment_id}")  # type: ignore[misc]
def export_experiment_csv(
    experiment_id: str,
    store: Any = Depends(get_store),
) -> StreamingResponse:
    """CSV export of every ``token_events`` row for one experiment."""
    cursor = store.conn.execute(
        """
        SELECT event_id, timestamp, agent_id, agent_role, operation,
               task_id, session_id, turn_index, provider, model,
               input_tokens, cache_creation_tokens, cache_read_tokens,
               output_tokens, total_tokens, cost_usd, request_id, status
        FROM v_event_cost
        WHERE experiment_id = ?
        ORDER BY timestamp, event_id
        """,
        (experiment_id,),
    )
    headers = [d[0] for d in cursor.description]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for row in cursor:
        writer.writerow(row)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": (f'attachment; filename="cost_{experiment_id}.csv"')
        },
    )
