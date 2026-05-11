"""
Integration tests for Cato's ``/api/cost/*`` endpoints.

These tests use FastAPI's TestClient + a tmp SQLite store seeded with
deterministic data. The store dependency is overridden via
``app.dependency_overrides`` so the tests never touch
``~/.marcus/costs.db``.

Tests are skipped if Marcus cost_tracking modules aren't importable.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

try:
    from backend.cost_routes import COST_TRACKING_AVAILABLE
except ImportError:
    COST_TRACKING_AVAILABLE = False

requires_marcus = pytest.mark.skipif(
    not COST_TRACKING_AVAILABLE,
    reason="Marcus cost_tracking modules unavailable",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def store(tmp_path: Path) -> Any:
    """Tmp CostStore seeded with one Anthropic price and a few events."""
    from src.cost_tracking.cost_store import (
        CostStore,
        Experiment,
        ModelPrice,
        TokenEvent,
    )

    s = CostStore(db_path=tmp_path / "costs.db")
    s.record_price(
        ModelPrice(
            model="claude-sonnet-4-6",
            provider="anthropic",
            effective_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
            input_per_million=3.0,
            cache_creation_per_million=3.75,
            cache_read_per_million=0.30,
            output_per_million=15.0,
            source="default",
        )
    )
    s.record_experiment(
        Experiment(
            experiment_id="exp_1",
            project_id="proj_1",
            project_name="hangman",
            started_at=datetime(2026, 5, 10, tzinfo=timezone.utc),
            num_agents=2,
            total_tasks=10,
            completed_tasks=4,
        )
    )
    base = dict(
        experiment_id="exp_1",
        project_id="proj_1",
        provider="anthropic",
        model="claude-sonnet-4-6",
    )
    s.record_event(
        TokenEvent(
            agent_id="planner",
            agent_role="planner",
            operation="parse_prd",
            input_tokens=1000,
            output_tokens=500,
            **base,
        )
    )
    s.record_event(
        TokenEvent(
            agent_id="agent_1",
            agent_role="worker",
            operation="turn",
            task_id="t_1",
            session_id="s_1",
            turn_index=1,
            input_tokens=2000,
            cache_read_tokens=500,
            output_tokens=100,
            **base,
        )
    )
    s.record_event(
        TokenEvent(
            agent_id="agent_1",
            agent_role="worker",
            operation="turn",
            task_id="t_1",
            session_id="s_1",
            turn_index=2,
            input_tokens=300,
            output_tokens=50,
            **base,
        )
    )
    return s


@pytest.fixture
def client(store: Any) -> TestClient:
    """TestClient with store / aggregator dependencies overridden."""
    from src.cost_tracking.cost_aggregator import CostAggregator

    from backend.api import app
    from backend.cost_routes import get_aggregator, get_store

    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_aggregator] = lambda: CostAggregator(store=store)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# /api/cost/experiments
# ---------------------------------------------------------------------------


@requires_marcus
class TestProjectsList:
    """/api/cost/projects — primary entry point for the dashboard."""

    def test_lists_projects_with_totals(self, client: TestClient) -> None:
        """One row per distinct project_id, derived from token_events."""
        resp = client.get("/api/cost/projects")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert body["projects"][0]["project_id"] == "proj_1"
        assert (
            body["projects"][0]["total_tokens"]
            == 1000 + 500 + 2000 + 500 + 100 + 300 + 50
        )

    def test_excludes_unassigned_from_project_list(
        self, store: Any, client: TestClient
    ) -> None:
        """Events in the 'unassigned' bucket do not appear as a project."""
        from src.cost_tracking.cost_store import TokenEvent

        store.record_event(
            TokenEvent(
                experiment_id="unassigned",
                project_id="unassigned",
                agent_id="planner",
                agent_role="planner",
                operation="parse_prd",
                provider="anthropic",
                model="claude-sonnet-4-6",
                input_tokens=10,
                output_tokens=10,
            )
        )
        resp = client.get("/api/cost/projects")
        ids = {p["project_id"] for p in resp.json()["projects"]}
        assert "unassigned" not in ids


@requires_marcus
class TestUnassignedTotals:
    """/api/cost/projects/unassigned — gap visibility."""

    def test_returns_zeros_when_empty(self, client: TestClient) -> None:
        """No unassigned events → zero totals (200, not 404)."""
        resp = client.get("/api/cost/projects/unassigned")
        assert resp.status_code == 200
        body = resp.json()
        assert body["events"] == 0
        assert body["total_cost_usd"] == 0.0

    def test_sums_unassigned_events(self, store: Any, client: TestClient) -> None:
        """An event tagged 'unassigned' shows up in the totals."""
        from src.cost_tracking.cost_store import TokenEvent

        store.record_event(
            TokenEvent(
                experiment_id="unassigned",
                project_id="unassigned",
                agent_id="planner",
                agent_role="planner",
                operation="parse_prd",
                provider="anthropic",
                model="claude-sonnet-4-6",
                input_tokens=1_000_000,
                output_tokens=0,
            )
        )
        resp = client.get("/api/cost/projects/unassigned")
        body = resp.json()
        assert body["events"] == 1
        # 1M input * $3/M = $3
        assert body["total_cost_usd"] == pytest.approx(3.0, rel=1e-6)


@requires_marcus
class TestExperimentsList:
    def test_lists_experiments(self, client: TestClient) -> None:
        """Endpoint returns the seeded experiment with totals."""
        resp = client.get("/api/cost/experiments")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert body["experiments"][0]["experiment_id"] == "exp_1"
        assert (
            body["experiments"][0]["total_tokens"]
            == 1000 + 500 + 2000 + 500 + 100 + 300 + 50
        )

    def test_filter_by_project(self, client: TestClient) -> None:
        """Unknown project returns empty list, not 404."""
        resp = client.get("/api/cost/experiments?project_id=nope")
        assert resp.status_code == 200
        assert resp.json()["count"] == 0


@requires_marcus
class TestExperimentSummary:
    def test_returns_full_breakdown(self, client: TestClient) -> None:
        """Endpoint returns the same shape as CostAggregator.experiment_summary."""
        resp = client.get("/api/cost/experiments/exp_1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["experiment_id"] == "exp_1"
        assert {
            "summary",
            "by_role",
            "by_agent",
            "by_task",
            "by_operation",
            "by_model",
        } <= set(body.keys())

    def test_unknown_returns_404(self, client: TestClient) -> None:
        """Missing experiment_id yields a 404."""
        resp = client.get("/api/cost/experiments/nope")
        assert resp.status_code == 404


@requires_marcus
class TestProjectSummary:
    def test_returns_project_totals(self, client: TestClient) -> None:
        """Project endpoint returns totals + experiments list."""
        resp = client.get("/api/cost/projects/proj_1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["project_id"] == "proj_1"
        assert body["totals"]["events"] == 3
        assert len(body["experiments"]) == 1


@requires_marcus
class TestSessionTurns:
    def test_returns_ordered_turns(self, client: TestClient) -> None:
        """Per-session turn trajectory is ordered by turn_index."""
        resp = client.get("/api/cost/sessions/s_1/turns")
        assert resp.status_code == 200
        turns = resp.json()["turns"]
        assert [t["turn_index"] for t in turns] == [1, 2]


# ---------------------------------------------------------------------------
# /api/cost/prices  (GET + POST)
# ---------------------------------------------------------------------------


@requires_marcus
class TestPrices:
    def test_get_current_prices(self, client: TestClient) -> None:
        """GET /prices returns the latest row per (model, provider)."""
        resp = client.get("/api/cost/prices")
        assert resp.status_code == 200
        prices = resp.json()["prices"]
        assert any(p["model"] == "claude-sonnet-4-6" for p in prices)

    def test_post_inserts_new_price_version(self, client: TestClient) -> None:
        """POST /prices inserts a versioned row that wins for new events."""
        new = {
            "model": "claude-sonnet-4-6",
            "provider": "anthropic",
            "effective_from": "2026-06-01T00:00:00+00:00",
            "input_per_million": 2.5,
            "output_per_million": 14.0,
            "cache_creation_per_million": 3.0,
            "cache_read_per_million": 0.25,
            "source": "cato_user",
        }
        resp = client.post("/api/cost/prices", json=new)
        assert resp.status_code == 200

        # New row should appear in /prices/history
        resp2 = client.get("/api/cost/prices/history?model=claude-sonnet-4-6")
        assert resp2.status_code == 200
        rows = resp2.json()["prices"]
        assert any(r["source"] == "cato_user" for r in rows)

    def test_duplicate_post_returns_409(self, client: TestClient) -> None:
        """Re-POSTing the same (model, provider, effective_from) returns 409."""
        new = {
            "model": "x",
            "provider": "y",
            "effective_from": "2026-06-02T00:00:00+00:00",
            "input_per_million": 1.0,
            "output_per_million": 1.0,
            "source": "cato_user",
        }
        first = client.post("/api/cost/prices", json=new)
        assert first.status_code == 200
        dup = client.post("/api/cost/prices", json=new)
        assert dup.status_code == 409


# ---------------------------------------------------------------------------
# /api/cost/export
# ---------------------------------------------------------------------------


@requires_marcus
class TestExport:
    def test_csv_export(self, client: TestClient) -> None:
        """CSV export returns all events for an experiment."""
        resp = client.get("/api/cost/export/exp_1")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        rows = resp.text.strip().split("\n")
        # Header + 3 events
        assert len(rows) == 4
        assert "agent_id" in rows[0]
