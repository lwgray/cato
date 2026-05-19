"""Marcus root directory discovery for Cato.

Single source of truth for locating the Marcus installation so Cato is
usable on any machine — no developer-specific absolute paths are baked
into the code.

Configuration is layered: ``config.json`` holds shared settings (ports,
cutoff date) and is committed; ``config.local.json`` holds the
machine-specific Marcus path and is gitignored. The ``cato`` CLI writes
``config.local.json`` after prompting the user on first start.

Marcus-root resolution order (first match wins):

1. ``MARCUS_ROOT`` environment variable.
2. ``marcus_data_path`` / ``marcus_data_paths`` from the merged config
   (``config.local.json`` overrides ``config.json``).
3. Auto-detection of well-known locations: Marcus checked out as a
   sibling of Cato, or ``~/dev/marcus``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

# cato_src/core/marcus_paths.py -> parents[2] is the Cato project root.
_CATO_ROOT = Path(__file__).resolve().parents[2]
_CONFIG_PATH = _CATO_ROOT / "config.json"
_LOCAL_CONFIG_PATH = _CATO_ROOT / "config.local.json"


def _read_json(path: Path) -> Dict[str, Any]:
    """Return a parsed JSON object, or an empty dict if absent/invalid."""
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def load_merged_config() -> Dict[str, Any]:
    """Load ``config.json`` overlaid with ``config.local.json``.

    ``config.local.json`` is gitignored and holds machine-specific
    settings (the Marcus path); its keys win over the committed
    ``config.json``.
    """
    config = _read_json(_CONFIG_PATH)
    config.update(_read_json(_LOCAL_CONFIG_PATH))
    return config


def _config_marcus_root() -> Optional[Path]:
    """Marcus root derived from the merged config, or None if unconfigured.

    The config stores the Marcus *data* directory (``marcus_data_path``);
    the Marcus root is its parent.
    """
    config = load_merged_config()
    multi = config.get("marcus_data_paths")
    data_path = multi[0] if multi else config.get("marcus_data_path")
    if not data_path:
        return None
    return Path(data_path).expanduser().parent


def discover_marcus_root(marker: str = "src") -> Optional[Path]:
    """Locate the Marcus root directory.

    Parameters
    ----------
    marker:
        Relative path that must exist under a candidate for it to be
        accepted (e.g. ``"src/analysis"`` or ``"src/cost_tracking"``).
        Lets callers require the specific Marcus subpackage they import.

    Returns
    -------
    Optional[Path]
        The first candidate containing ``marker``, or None if none match.
    """
    candidates: list[Path] = []

    env_root = os.environ.get("MARCUS_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser())

    config_root = _config_marcus_root()
    if config_root:
        candidates.append(config_root)

    # Auto-detection fallbacks — no machine-specific absolute paths.
    candidates.append(_CATO_ROOT.parent / "marcus")  # sibling of Cato
    candidates.append(Path.home() / "dev" / "marcus")

    for candidate in candidates:
        if (candidate / marker).exists():
            return candidate
    return None
