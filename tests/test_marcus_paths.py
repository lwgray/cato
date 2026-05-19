"""Unit tests for Marcus-root discovery and layered config.

Covers ``cato_src/core/marcus_paths.py``: the ``config.local.json``
overlay on ``config.json`` and the ``discover_marcus_root`` resolution
order (MARCUS_ROOT env var → merged config → auto-detection).
"""

import json
from pathlib import Path
from typing import Any

import pytest

from cato_src.core import marcus_paths


@pytest.fixture
def isolated_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Point marcus_paths at a tmp Cato root with tmp config files.

    Returns the fake Cato root (``tmp_path/cato``); ``config.json`` /
    ``config.local.json`` live inside it. The root is nested under the
    per-test ``tmp_path`` so the sibling-of-Cato auto-detection probes
    ``tmp_path/marcus`` — a location no other test can pollute.
    """
    cato_root = tmp_path / "cato"
    cato_root.mkdir()
    monkeypatch.setattr(marcus_paths, "_CATO_ROOT", cato_root)
    monkeypatch.setattr(marcus_paths, "_CONFIG_PATH", cato_root / "config.json")
    monkeypatch.setattr(
        marcus_paths, "_LOCAL_CONFIG_PATH", cato_root / "config.local.json"
    )
    # Redirect $HOME so the real ~/dev/marcus can't satisfy auto-detection.
    monkeypatch.setattr(marcus_paths.Path, "home", staticmethod(lambda: tmp_path))
    return cato_root


def _write(path: Path, data: Any) -> None:
    with open(path, "w") as f:
        json.dump(data, f)


def _make_marcus_root(base: Path, name: str, marker: str = "src/analysis") -> Path:
    """Create a fake Marcus tree at base/name with the given marker path."""
    root = base / name
    (root / marker).mkdir(parents=True)
    (root / "data").mkdir()
    return root


# ---------------------------------------------------------------------------
# load_merged_config
# ---------------------------------------------------------------------------


def test_merged_config_empty_when_no_files(isolated_config: Path) -> None:
    """Missing config files yield an empty dict, not an error."""
    assert marcus_paths.load_merged_config() == {}


def test_merged_config_reads_config_json(isolated_config: Path) -> None:
    """config.json is loaded when config.local.json is absent."""
    _write(isolated_config / "config.json", {"marcus_data_path": "/a/data"})
    assert marcus_paths.load_merged_config()["marcus_data_path"] == "/a/data"


def test_local_config_overrides_config_json(isolated_config: Path) -> None:
    """config.local.json keys win over config.json keys."""
    _write(
        isolated_config / "config.json",
        {"marcus_data_path": "/shared/data", "history_cutoff_date": "2026-01-01"},
    )
    _write(
        isolated_config / "config.local.json",
        {"marcus_data_path": "/local/data"},
    )
    merged = marcus_paths.load_merged_config()
    # Overridden by the local file...
    assert merged["marcus_data_path"] == "/local/data"
    # ...but shared keys from config.json survive.
    assert merged["history_cutoff_date"] == "2026-01-01"


def test_merged_config_tolerates_invalid_json(isolated_config: Path) -> None:
    """Malformed config files are ignored rather than crashing."""
    (isolated_config / "config.json").write_text("{not json")
    assert marcus_paths.load_merged_config() == {}


# ---------------------------------------------------------------------------
# discover_marcus_root
# ---------------------------------------------------------------------------


def test_discover_from_config_local(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """config.local.json's marcus_data_path resolves to its parent root."""
    monkeypatch.delenv("MARCUS_ROOT", raising=False)
    root = _make_marcus_root(isolated_config, "marcus_install")
    _write(
        isolated_config / "config.local.json",
        {"marcus_data_path": str(root / "data")},
    )
    assert marcus_paths.discover_marcus_root("src/analysis") == root


def test_env_var_overrides_config(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """MARCUS_ROOT takes precedence over the configured path."""
    config_root = _make_marcus_root(isolated_config, "configured")
    env_root = _make_marcus_root(isolated_config, "from_env")
    _write(
        isolated_config / "config.local.json",
        {"marcus_data_path": str(config_root / "data")},
    )
    monkeypatch.setenv("MARCUS_ROOT", str(env_root))
    assert marcus_paths.discover_marcus_root("src/analysis") == env_root


def test_marcus_data_paths_plural_resolves_first(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """marcus_data_paths (plural) resolves to the parent of its first entry."""
    monkeypatch.delenv("MARCUS_ROOT", raising=False)
    root = _make_marcus_root(isolated_config, "primary")
    _write(
        isolated_config / "config.local.json",
        {
            "marcus_data_paths": [
                str(root / "data"),
                str(isolated_config / "second" / "data"),
            ]
        },
    )
    assert marcus_paths.discover_marcus_root("src/analysis") == root


def test_marker_must_exist(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A configured root missing the requested marker is rejected."""
    monkeypatch.delenv("MARCUS_ROOT", raising=False)
    # Has src/analysis but not src/cost_tracking.
    root = _make_marcus_root(isolated_config, "marcus", marker="src/analysis")
    _write(
        isolated_config / "config.local.json",
        {"marcus_data_path": str(root / "data")},
    )
    assert marcus_paths.discover_marcus_root("src/analysis") == root
    assert marcus_paths.discover_marcus_root("src/cost_tracking") is None


def test_auto_detect_sibling_of_cato(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no env var or config, a Marcus sibling of Cato is found."""
    monkeypatch.delenv("MARCUS_ROOT", raising=False)
    # _CATO_ROOT is isolated_config; its sibling "marcus" should be detected.
    root = _make_marcus_root(isolated_config.parent, "marcus")
    assert marcus_paths.discover_marcus_root("src/analysis") == root


def test_discover_returns_none_when_nothing_found(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Returns None when Marcus cannot be located anywhere.

    No MARCUS_ROOT, no config, no sibling, and $HOME is redirected by
    the fixture so the real ~/dev/marcus cannot be found.
    """
    monkeypatch.delenv("MARCUS_ROOT", raising=False)
    assert marcus_paths.discover_marcus_root("src/analysis") is None
