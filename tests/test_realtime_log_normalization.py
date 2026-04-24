"""Unit tests for realtime log normalization in Cato's message loader.

realtime_*.jsonl uses {type, source, target, ...} instead of
{conversation_type, from_agent_id, to_agent_id, ...}. The aggregator
must normalize realtime entries so they flow through the same
task_id and agent_id filtering used for conversation logs.
"""

import json
from pathlib import Path

import pytest

from cato_src.core.aggregator import Aggregator


def _make_root(tmp_path: Path) -> Path:
    """Create a minimal Marcus root with empty conversation logs dir."""
    root = tmp_path / "marcus"
    (root / "data" / "marcus_state").mkdir(parents=True)
    (root / "logs" / "conversations").mkdir(parents=True)
    return root


class TestNormalizeRealtimeEntry:
    """Tests for Aggregator._normalize_realtime_entry() static helper."""

    def test_task_assignment_maps_agent_id_to_to_agent(self) -> None:
        """task_assignment must set to_agent_id from agent_id field."""
        entry = {
            "timestamp": "2026-01-01T00:00:00Z",
            "type": "task_assignment",
            "agent_id": "agent_unicorn_1",
            "task_id": "task_abc",
            "task_name": "Build widget",
            "source": "marcus",
            "target": "agent_unicorn_1",
        }
        normalized = Aggregator._normalize_realtime_entry(entry)
        assert normalized["to_agent_id"] == "agent_unicorn_1"
        assert normalized["task_id"] == "task_abc"

    def test_task_request_maps_source_to_from_agent(self) -> None:
        """task_request must set from_agent_id from source field."""
        entry = {
            "timestamp": "2026-01-01T00:00:00Z",
            "type": "task_request",
            "worker_id": "agent_unicorn_2",
            "source": "agent_unicorn_2",
            "target": "marcus",
        }
        normalized = Aggregator._normalize_realtime_entry(entry)
        assert normalized["from_agent_id"] == "agent_unicorn_2"

    def test_task_progress_preserves_task_id(self) -> None:
        """task_progress entries must keep task_id for message-task matching."""
        entry = {
            "timestamp": "2026-01-01T00:00:00Z",
            "type": "task_progress",
            "agent_id": "agent_unicorn_3",
            "task_id": "task_xyz",
            "progress": 0.5,
            "source": "agent_unicorn_3",
            "target": "marcus",
        }
        normalized = Aggregator._normalize_realtime_entry(entry)
        assert normalized["task_id"] == "task_xyz"

    def test_message_type_set_from_type_field(self) -> None:
        """Normalized entry must have message_type copied from type field."""
        entry = {
            "timestamp": "2026-01-01T00:00:00Z",
            "type": "task_assignment",
            "agent_id": "agent_1",
            "task_id": "t1",
            "source": "marcus",
            "target": "agent_1",
        }
        normalized = Aggregator._normalize_realtime_entry(entry)
        assert normalized.get("message_type") == "task_assignment"

    def test_server_startup_not_set_agent_ids(self) -> None:
        """Non-agent events like server_startup must not get fake agent IDs."""
        entry = {
            "timestamp": "2026-01-01T00:00:00Z",
            "type": "server_startup",
            "provider": "sqlite",
        }
        normalized = Aggregator._normalize_realtime_entry(entry)
        assert "from_agent_id" not in normalized or normalized["from_agent_id"] is None
        assert "to_agent_id" not in normalized or normalized["to_agent_id"] is None

    def test_original_fields_preserved(self) -> None:
        """Normalization must not drop original fields from the entry."""
        entry = {
            "timestamp": "2026-01-01T00:00:00Z",
            "type": "task_assignment",
            "agent_id": "agent_unicorn_1",
            "task_id": "task_abc",
            "task_name": "Build widget",
            "priority": "high",
            "source": "marcus",
            "target": "agent_unicorn_1",
        }
        normalized = Aggregator._normalize_realtime_entry(entry)
        assert normalized["task_name"] == "Build widget"
        assert normalized["priority"] == "high"
        assert normalized["timestamp"] == "2026-01-01T00:00:00Z"


class TestRealtimeEntriesInLoadMessages:
    """_load_messages() must include normalized realtime entries."""

    def _write_log(self, logs_dir: Path, filename: str, entries: list) -> None:
        with open(logs_dir / filename, "w") as f:
            for entry in entries:
                f.write(json.dumps(entry) + "\n")

    def test_realtime_entries_included_in_messages(self, tmp_path: Path) -> None:
        """_load_messages() must return entries from realtime_*.jsonl files."""
        root = _make_root(tmp_path)
        logs_dir = root / "logs" / "conversations"

        self._write_log(
            logs_dir,
            "realtime_20260101_000000.jsonl",
            [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "type": "task_assignment",
                    "agent_id": "agent_1",
                    "task_id": "t1",
                    "source": "marcus",
                    "target": "agent_1",
                }
            ],
        )
        agg = Aggregator(marcus_root=root)
        messages = agg._load_messages()
        assert any(m.get("task_id") == "t1" for m in messages)

    def test_realtime_task_assignment_filterable_by_task_id(
        self, tmp_path: Path
    ) -> None:
        """After normalization, task_assignment entries must have task_id."""
        root = _make_root(tmp_path)
        logs_dir = root / "logs" / "conversations"

        self._write_log(
            logs_dir,
            "realtime_20260101_000000.jsonl",
            [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "type": "task_assignment",
                    "agent_id": "agent_unicorn_1",
                    "task_id": "task_abc123",
                    "task_name": "Build widget",
                    "source": "marcus",
                    "target": "agent_unicorn_1",
                }
            ],
        )
        agg = Aggregator(marcus_root=root)
        messages = agg._load_messages()
        task_ids = [m.get("task_id") for m in messages]
        assert "task_abc123" in task_ids

    def test_realtime_entries_have_agent_ids_for_filtering(
        self, tmp_path: Path
    ) -> None:
        """Normalized entries must have from_agent_id or to_agent_id set."""
        root = _make_root(tmp_path)
        logs_dir = root / "logs" / "conversations"

        self._write_log(
            logs_dir,
            "realtime_20260101_000000.jsonl",
            [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "type": "task_assignment",
                    "agent_id": "agent_unicorn_1",
                    "task_id": "t1",
                    "source": "marcus",
                    "target": "agent_unicorn_1",
                }
            ],
        )
        agg = Aggregator(marcus_root=root)
        messages = agg._load_messages()
        assignment = next((m for m in messages if m.get("task_id") == "t1"), None)
        assert assignment is not None
        assert assignment.get("to_agent_id") == "agent_unicorn_1"
