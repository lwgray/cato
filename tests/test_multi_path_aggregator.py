"""Unit tests for multi-path Aggregator support.

Verifies that Aggregator can load projects from multiple marcus_roots
simultaneously (for parallel experiments) while keeping backward compat
with the single marcus_root constructor.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from cato_src.core.aggregator import Aggregator


def _make_marcus_root(tmp_path: Path, suffix: str) -> Path:
    """Create a minimal Marcus-like root with projects.json."""
    root = tmp_path / f"marcus_{suffix}"
    data_dir = root / "data" / "marcus_state"
    data_dir.mkdir(parents=True)
    logs_dir = root / "logs" / "conversations"
    logs_dir.mkdir(parents=True)
    return root


def _write_projects(root: Path, projects: dict[str, Any]) -> None:
    """Write projects.json to the persistence_dir of a marcus root."""
    projects_file = root / "data" / "marcus_state" / "projects.json"
    with open(projects_file, "w") as f:
        json.dump(projects, f)


@pytest.fixture
def two_marcus_roots(tmp_path: Path) -> tuple[Path, Path]:
    """Create two independent Marcus roots with distinct projects."""
    root_a = _make_marcus_root(tmp_path, "a")
    root_b = _make_marcus_root(tmp_path, "b")

    _write_projects(
        root_a,
        {
            "proj_a1": {
                "id": "proj_a1",
                "name": "Alpha One",
                "created_at": "2026-01-01",
            },
            "proj_a2": {
                "id": "proj_a2",
                "name": "Alpha Two",
                "created_at": "2026-01-02",
            },
        },
    )
    _write_projects(
        root_b,
        {
            "proj_b1": {
                "id": "proj_b1",
                "name": "Beta One",
                "created_at": "2026-01-03",
            },
        },
    )
    return root_a, root_b


class TestMultiRootInit:
    """Aggregator accepts both singular and plural root forms."""

    def test_single_root_backward_compat(self, tmp_path: Path) -> None:
        """Old-style marcus_root= kwarg still works."""
        root = _make_marcus_root(tmp_path, "single")
        agg = Aggregator(marcus_root=root)
        assert agg.marcus_root == root

    def test_plural_roots_accepted(self, two_marcus_roots: tuple[Path, Path]) -> None:
        """New marcus_roots= list is accepted without error."""
        root_a, root_b = two_marcus_roots
        agg = Aggregator(marcus_roots=[root_a, root_b])
        assert agg.marcus_roots == [root_a, root_b]

    def test_plural_roots_sets_primary(
        self, two_marcus_roots: tuple[Path, Path]
    ) -> None:
        """First entry in marcus_roots becomes marcus_root for backward compat."""
        root_a, root_b = two_marcus_roots
        agg = Aggregator(marcus_roots=[root_a, root_b])
        assert agg.marcus_root == root_a

    def test_single_root_wrapped_in_list(self, tmp_path: Path) -> None:
        """Single marcus_root is also available as marcus_roots[0]."""
        root = _make_marcus_root(tmp_path, "wrap")
        agg = Aggregator(marcus_root=root)
        assert agg.marcus_roots == [root]


class TestMultiRootProjectLoading:
    """_load_projects() merges from all roots."""

    def test_loads_projects_from_all_roots(
        self, two_marcus_roots: tuple[Path, Path]
    ) -> None:
        """All projects from all roots appear in _load_projects() result."""
        root_a, root_b = two_marcus_roots
        agg = Aggregator(marcus_roots=[root_a, root_b])
        projects = agg._load_projects()
        ids = {p["id"] for p in projects}
        assert ids == {"proj_a1", "proj_a2", "proj_b1"}

    def test_total_count_is_sum_of_all_roots(
        self, two_marcus_roots: tuple[Path, Path]
    ) -> None:
        """Project count equals sum across all roots (2 + 1 = 3)."""
        root_a, root_b = two_marcus_roots
        agg = Aggregator(marcus_roots=[root_a, root_b])
        projects = agg._load_projects()
        assert len(projects) == 3

    def test_project_root_map_populated(
        self, two_marcus_roots: tuple[Path, Path]
    ) -> None:
        """_project_root maps each project_id to its source root."""
        root_a, root_b = two_marcus_roots
        agg = Aggregator(marcus_roots=[root_a, root_b])
        agg._load_projects()
        assert agg._project_root["proj_a1"] == root_a
        assert agg._project_root["proj_a2"] == root_a
        assert agg._project_root["proj_b1"] == root_b

    def test_missing_projects_file_in_one_root_skipped(self, tmp_path: Path) -> None:
        """A root with no projects.json is silently skipped; others still load."""
        good_root = _make_marcus_root(tmp_path, "good")
        empty_root = _make_marcus_root(tmp_path, "empty")
        # No projects.json in empty_root
        _write_projects(
            good_root,
            {
                "proj_good": {
                    "id": "proj_good",
                    "name": "Good",
                    "created_at": "2026-01-01",
                }
            },
        )
        agg = Aggregator(marcus_roots=[good_root, empty_root])
        projects = agg._load_projects()
        assert len(projects) == 1
        assert projects[0]["id"] == "proj_good"

    def test_single_root_still_loads_normally(self, tmp_path: Path) -> None:
        """Single-root mode loads as before."""
        root = _make_marcus_root(tmp_path, "solo")
        _write_projects(
            root,
            {
                "solo_proj": {
                    "id": "solo_proj",
                    "name": "Solo",
                    "created_at": "2026-01-01",
                }
            },
        )
        agg = Aggregator(marcus_root=root)
        projects = agg._load_projects()
        assert len(projects) == 1
        assert projects[0]["id"] == "solo_proj"
