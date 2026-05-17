"""
Regression test for hex project IDs with all-digit 8-char prefixes.

Background
----------
Cato visualizes Marcus projects. Each project has a 32-character hexadecimal
UUID (e.g. ``105199825e1b48a2ba7d58e1ec952147``). Planka, an alternative
kanban backend, instead uses short fully-numeric IDs.

The fast task-loading path (``Aggregator._load_tasks_for_project_fast``)
branches on whether a project looks like a Planka project. The old check
inspected only the first 8 characters of the ID. A hex UUID whose first 8
characters happen to be all decimal digits (``10519982...``) was therefore
misclassified as a numeric Planka ID, routed down a prefix-matching path that
silently dropped every hex task ID, and only a handful of tasks survived.

This test builds a minimal Marcus root whose project UUID starts with 8
digits and asserts every task is loaded.
"""

import json
import sqlite3
from pathlib import Path

import pytest

from cato_src.core.aggregator import Aggregator

# A real-world UUID: first 8 chars "10519982" are all decimal digits.
DIGIT_PREFIX_PROJECT_ID = "105199825e1b48a2ba7d58e1ec952147"


def _make_marcus_root(tmp_path: Path) -> Path:
    """Create a minimal Marcus root with a project whose UUID starts with digits."""
    root = tmp_path / "marcus"
    data_dir = root / "data" / "marcus_state"
    data_dir.mkdir(parents=True)
    (root / "logs" / "conversations").mkdir(parents=True)

    # Project registry: hex board_id, hex project_id (not a Planka project).
    projects = {
        DIGIT_PREFIX_PROJECT_ID: {
            "id": DIGIT_PREFIX_PROJECT_ID,
            "name": "hangman - Main Board",
            "provider": "sqlite",
            "provider_config": {
                "project_id": DIGIT_PREFIX_PROJECT_ID,
                "board_id": "9e4998fa1bdf4b9ab348fcfaa30e698d",
            },
        }
    }
    with open(data_dir / "projects.json", "w") as f:
        json.dump(projects, f)

    # marcus.db with task_metadata rows for the project.
    db_path = root / "data" / "marcus.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE persistence "
        "(collection TEXT, key TEXT, data TEXT, stored_at TEXT)"
    )
    task_ids = [f"{i:02d}aa05b5cabd4a18b4ce7b20a8a0e81b" for i in range(11)]
    for tid in task_ids:
        conn.execute(
            "INSERT INTO persistence VALUES (?, ?, ?, ?)",
            (
                "task_metadata",
                tid,
                json.dumps(
                    {
                        "task_id": tid,
                        "id": tid,
                        "name": f"Task {tid}",
                        "project_id": DIGIT_PREFIX_PROJECT_ID,
                        "dependencies": [],
                    }
                ),
                "2026-05-17T00:00:00",
            ),
        )
    conn.commit()
    conn.close()
    return root


def test_digit_prefixed_hex_project_loads_all_tasks(tmp_path: Path) -> None:
    """All 11 tasks load for a hex project ID whose first 8 chars are digits."""
    root = _make_marcus_root(tmp_path)
    agg = Aggregator(marcus_root=root)

    tasks = agg._load_tasks_for_project_fast(DIGIT_PREFIX_PROJECT_ID, root)

    assert tasks is not None, "fast path unexpectedly fell back to slow path"
    assert len(tasks) == 11, f"expected 11 tasks, got {len(tasks)}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
