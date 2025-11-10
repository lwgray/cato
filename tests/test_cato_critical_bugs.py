"""
Critical bug tests for Cato visualization.

Tests for three critical bugs reported:
1. No tasks shown if project has no subtasks
2. No tasks shown unless at least one is completed
3. Task ordering is wrong (unit tests at top instead of logical order)
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from src.core.aggregator import Aggregator


@pytest.fixture
def mock_persistence_dir(tmp_path):
    """Create mock Marcus persistence directory with test data."""
    persistence_dir = tmp_path / "data" / "marcus_state"
    persistence_dir.mkdir(parents=True)

    # Create projects.json
    projects_data = {
        "test_project_123": {
            "id": "test_project_123",
            "name": "Test Project",
            "provider": "planka",
            "provider_config": {
                "project_id": "1234567890123456789",
                "board_id": "1234567890123456800"
            },
            "created_at": "2025-11-09T10:00:00Z",
        }
    }
    with open(persistence_dir / "projects.json", "w") as f:
        json.dump(projects_data, f)

    return persistence_dir


@pytest.fixture
def tasks_no_subtasks():
    """Tasks for a project with NO subtasks (all top-level tasks)."""
    return {
        "subtasks": {
            "1234567890123456801": {
                "id": "1234567890123456801",
                "name": "Design Authentication",
                "type": "design",
                "parent_task_id": None,  # No parent!
                "status": "completed",
                "created_at": "2025-11-09T10:00:00Z",
                "updated_at": "2025-11-09T11:00:00Z",
            },
            "1234567890123456802": {
                "id": "1234567890123456802",
                "name": "Implement Login",
                "parent_task_id": None,  # No parent!
                "status": "completed",
                "created_at": "2025-11-09T10:01:00Z",
                "updated_at": "2025-11-09T12:00:00Z",
            },
            "1234567890123456803": {
                "id": "1234567890123456803",
                "name": "Write Tests",
                "parent_task_id": None,  # No parent!
                "status": "completed",
                "created_at": "2025-11-09T10:02:00Z",
                "updated_at": "2025-11-09T13:00:00Z",
            },
        }
    }


@pytest.fixture
def tasks_with_subtasks():
    """Tasks for a project WITH subtasks (parent-child hierarchy)."""
    return {
        "subtasks": {
            "1234567890123456801": {
                "id": "1234567890123456801",
                "name": "Backend Epic",
                "parent_task_id": None,
                "status": "in-progress",
                "created_at": "2025-11-09T10:00:00Z",
            },
            "1234567890123456802": {
                "id": "1234567890123456802",
                "name": "Create API",
                "parent_task_id": "1234567890123456801",  # Child of epic
                "status": "pending",
                "created_at": "2025-11-09T10:01:00Z",
            },
            "1234567890123456803": {
                "id": "1234567890123456803",
                "name": "Write Tests",
                "parent_task_id": "1234567890123456801",  # Child of epic
                "status": "pending",
                "created_at": "2025-11-09T10:02:00Z",
            },
        }
    }


class TestBug1_NoTasksWithoutSubtasks:
    """Bug #1: No tasks shown if project has no subtasks."""

    def test_project_with_no_subtasks_shows_all_tasks(
        self, tmp_path, mock_persistence_dir, tasks_no_subtasks
    ):
        """
        Test that projects with NO subtasks (all top-level) show all tasks.

        Bug: Currently returns empty list because _load_tasks filters by parent_task_id
        Expected: All 3 tasks should be loaded and visible
        """
        # Write subtasks file
        with open(mock_persistence_dir / "subtasks.json", "w") as f:
            json.dump(tasks_no_subtasks, f)

        # Initialize aggregator with mock data
        aggregator = Aggregator(marcus_root=tmp_path)

        # Load tasks for project
        loaded_tasks = aggregator._load_tasks(project_id="test_project_123")

        # Should load ALL 3 tasks even though none have parent_task_id
        assert len(loaded_tasks) == 3, \
            f"Expected 3 tasks, got {len(loaded_tasks)}. " \
            f"Bug: Tasks without parent_task_id are being filtered out!"

        task_names = {t["name"] for t in loaded_tasks}
        assert "Design Authentication" in task_names
        assert "Implement Login" in task_names
        assert "Write Tests" in task_names

    def test_bundled_design_tasks_loaded(
        self, tmp_path, mock_persistence_dir
    ):
        """
        Test that bundled design tasks (no parent) are loaded.

        Bundled design tasks from Marcus advanced PRD parser have:
        - parent_task_id = None
        - type = "design"
        - domain_name = "Authentication" (etc.)
        """
        design_tasks = {
            "subtasks": {
                "1234567890123456801": {
                    "id": "1234567890123456801",
                    "name": "Design Authentication",
                    "type": "design",
                    "domain_name": "Authentication",
                    "parent_task_id": None,  # Bundled design has no parent!
                    "status": "pending",
                },
            }
        }

        with open(mock_persistence_dir / "subtasks.json", "w") as f:
            json.dump(design_tasks, f)

        aggregator = Aggregator(marcus_root=tmp_path)
        loaded_tasks = aggregator._load_tasks(project_id="test_project_123")

        assert len(loaded_tasks) == 1, \
            "Bundled design task should be loaded"
        assert loaded_tasks[0]["name"] == "Design Authentication"


class TestBug2_NoTasksUnlessCompleted:
    """Bug #2: No tasks shown unless at least one is completed."""

    def test_all_pending_tasks_are_shown(
        self, tmp_path, mock_persistence_dir, tasks_no_subtasks
    ):
        """
        Test that tasks are shown even if NONE are completed.

        Bug: Possibly filtering out tasks based on status
        Expected: All tasks visible regardless of completion status
        """
        # All tasks are 'pending' - none completed, no updated_at
        for task in tasks_no_subtasks["subtasks"].values():
            task["status"] = "pending"
            # Remove updated_at to simulate truly pending tasks
            if "updated_at" in task:
                del task["updated_at"]

        with open(mock_persistence_dir / "subtasks.json", "w") as f:
            json.dump(tasks_no_subtasks, f)

        aggregator = Aggregator(marcus_root=tmp_path)

        # Create full snapshot (this goes through entire pipeline)
        snapshot = aggregator.create_snapshot(
            project_id="test_project_123",
            view_mode="subtasks"
        )

        assert len(snapshot.tasks) > 0, \
            "Tasks should be visible even when none are completed!"

    def test_in_progress_tasks_are_shown(
        self, tmp_path, mock_persistence_dir, tasks_no_subtasks
    ):
        """Test that in-progress tasks are shown."""
        for task in tasks_no_subtasks["subtasks"].values():
            task["status"] = "in-progress"
            # Remove updated_at to simulate truly in-progress tasks
            if "updated_at" in task:
                del task["updated_at"]

        with open(mock_persistence_dir / "subtasks.json", "w") as f:
            json.dump(tasks_no_subtasks, f)

        aggregator = Aggregator(marcus_root=tmp_path)
        snapshot = aggregator.create_snapshot(
            project_id="test_project_123",
            view_mode="subtasks"
        )

        assert len(snapshot.tasks) > 0, \
            "In-progress tasks should be visible!"


class TestBug3_WrongTaskOrdering:
    """Bug #3: Task ordering is wrong (unit tests at top instead of logical order)."""

    def test_tasks_ordered_by_dependency_chain(
        self, tmp_path, mock_persistence_dir
    ):
        """
        Test that tasks are ordered by dependency chain, not randomly.

        Expected order:
        1. Design tasks (no dependencies)
        2. Implementation tasks (depend on design)
        3. Test tasks (depend on implementation)

        Bug: Tests appearing at top of graph
        """
        ordered_tasks = {
            "subtasks": {
                "1234567890123456801": {
                    "id": "1234567890123456801",
                    "name": "Design Auth",
                    "parent_task_id": None,
                    "dependency_ids": [],
                    "status": "completed",
                    "created_at": "2025-11-09T10:00:00Z",
                },
                "1234567890123456802": {
                    "id": "1234567890123456802",
                    "name": "Implement Login",
                    "parent_task_id": None,
                    "dependency_ids": ["1234567890123456801"],  # Depends on design
                    "status": "in-progress",
                    "created_at": "2025-11-09T10:01:00Z",
                },
                "1234567890123456803": {
                    "id": "1234567890123456803",
                    "name": "Test Login",
                    "parent_task_id": None,
                    "dependency_ids": ["1234567890123456802"],  # Depends on implementation
                    "status": "pending",
                    "created_at": "2025-11-09T10:02:00Z",
                },
            }
        }

        with open(mock_persistence_dir / "subtasks.json", "w") as f:
            json.dump(ordered_tasks, f)

        aggregator = Aggregator(marcus_root=tmp_path)
        snapshot = aggregator.create_snapshot(
            project_id="test_project_123",
            view_mode="subtasks"
        )

        # Check that tasks exist
        assert len(snapshot.tasks) == 3

        # TODO: Add ordering assertions once we understand how Cato determines order
        # This may be in the graph rendering logic, not the aggregator
        # For now, just verify all tasks are present

        task_names = {t.name for t in snapshot.tasks}
        assert "Design Auth" in task_names
        assert "Implement Login" in task_names
        assert "Test Login" in task_names

    def test_dependency_graph_respects_task_types(
        self, tmp_path, mock_persistence_dir
    ):
        """
        Test that dependency graph respects task types.

        Design tasks should come before implementation.
        Implementation should come before tests.
        """
        # This test may need to check the actual graph structure
        # in snapshot.task_dependency_graph
        pytest.skip("Need to understand graph structure first")
