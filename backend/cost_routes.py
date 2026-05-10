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
import logging
import os
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
# Request models
# ---------------------------------------------------------------------------


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
    """Project rollup + list of experiment summaries."""
    return {
        "project_id": project_id,
        "totals": aggregator.project_totals(project_id),
        "experiments": aggregator.list_experiments(project_id=project_id),
    }


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
