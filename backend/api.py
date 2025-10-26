"""
FastAPI backend for Cato Visualization Dashboard.

Provides unified snapshot API endpoint to serve Marcus data to the dashboard frontend.
Supports CORS for local development and production deployment.
"""

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Literal, Optional

# Ensure we import from the local Cato src directory, not elsewhere
cato_root = Path(__file__).parent.parent
if str(cato_root) not in sys.path:
    sys.path.insert(0, str(cato_root))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from src.core.aggregator import Aggregator

logger = logging.getLogger(__name__)

# Load Marcus data path from config
config_path = Path(__file__).parent.parent / "config.json"
try:
    with open(config_path, "r") as f:
        config = json.load(f)
        marcus_data_path = config.get("marcus_data_path")
        if marcus_data_path:
            marcus_root = Path(marcus_data_path).parent
            logger.info(f"Using Marcus data path from config: {marcus_root}")
        else:
            marcus_root = None
            logger.info("No Marcus data path in config, using auto-detection")
except Exception as e:
    logger.warning(f"Could not load config.json: {e}, using auto-detection")
    marcus_root = None

# Initialize FastAPI app
app = FastAPI(
    title="Cato API",
    description="Backend API for Cato - Marcus parallelization visualization dashboard",
    version="2.0.0",
)

# Configure CORS - allow all localhost origins in development
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize aggregator for snapshot API
aggregator = Aggregator(marcus_root=marcus_root)

# Simple in-memory cache for snapshots (60s TTL for better performance)
snapshot_cache: Dict[str, tuple[Dict[str, Any], datetime]] = {}
CACHE_TTL_SECONDS = 60  # Increased from 30s to reduce cold loads


def prewarm_recent_projects() -> None:
    """
    Pre-warm cache for projects created in the last 7 days.

    This runs in the background on startup to make recent projects load instantly.
    """
    try:
        logger.info("Starting cache pre-warming for recent projects...")
        projects_data = aggregator._load_projects()
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=7)

        recent_projects = []
        for p in projects_data:
            if "id" not in p or "created_at" not in p:
                continue

            try:
                created_at = datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)

                if created_at >= cutoff:
                    recent_projects.append(p)
            except (ValueError, AttributeError):
                continue

        logger.info(f"Found {len(recent_projects)} projects created in last 7 days")

        # Pre-warm cache for each recent project
        for p in recent_projects:
            project_id = p.get("id", "")
            try:
                # Create snapshot and cache it
                snapshot = aggregator.create_snapshot(
                    project_id=project_id,
                    view_mode="subtasks",
                    timeline_scale_exponent=0.4,
                )
                snapshot_dict = snapshot.to_dict()

                # Cache with default view settings
                cache_key = f"{project_id}_subtasks_0.4"
                snapshot_cache[cache_key] = (snapshot_dict, now)

                logger.info(f"Pre-warmed cache for project: {p.get('name', project_id)[:40]}")
            except Exception as e:
                logger.warning(f"Failed to pre-warm project {project_id}: {e}")

        logger.info(f"Cache pre-warming complete: {len(recent_projects)} projects cached")
    except Exception as e:
        logger.error(f"Error pre-warming cache: {e}", exc_info=True)


def background_cache_refresh() -> None:
    """
    Background task to refresh cache for active projects.

    Runs every 45 seconds to keep cache warm before 60s TTL expires.
    """
    import time

    # Wait 10 seconds for initial pre-warming to complete
    time.sleep(10)

    while True:
        try:
            # Refresh cache for projects that are in cache and accessed recently
            now = datetime.now(timezone.utc)
            cache_keys_to_refresh = []

            for cache_key, (snapshot_dict, cache_time) in list(snapshot_cache.items()):
                age = (now - cache_time).total_seconds()
                # Refresh if cache is 45+ seconds old (before 60s expiry)
                if 45 <= age < CACHE_TTL_SECONDS:
                    cache_keys_to_refresh.append(cache_key)

            if cache_keys_to_refresh:
                logger.info(f"Background refresh: refreshing {len(cache_keys_to_refresh)} cached snapshots")

                for cache_key in cache_keys_to_refresh:
                    try:
                        # Parse cache key: "{project_id}_subtasks_0.4"
                        parts = cache_key.rsplit("_", 2)
                        if len(parts) == 3:
                            project_id = parts[0]
                            view_mode = parts[1]
                            timeline_exp = float(parts[2])

                            # Refresh snapshot
                            snapshot = aggregator.create_snapshot(
                                project_id=project_id if project_id else None,
                                view_mode=view_mode,  # type: ignore[arg-type]
                                timeline_scale_exponent=timeline_exp,
                            )
                            snapshot_dict = snapshot.to_dict()
                            snapshot_cache[cache_key] = (snapshot_dict, now)

                            logger.debug(f"Refreshed cache for: {cache_key}")
                    except Exception as e:
                        logger.warning(f"Failed to refresh cache for {cache_key}: {e}")

            # Sleep for 15 seconds before next check
            time.sleep(15)

        except Exception as e:
            logger.error(f"Error in background cache refresh: {e}", exc_info=True)
            time.sleep(15)


@app.on_event("startup")
async def startup_event() -> None:
    """Run background tasks on startup."""
    import threading

    # Pre-warm cache in background thread to not block startup
    prewarm_thread = threading.Thread(target=prewarm_recent_projects, daemon=True)
    prewarm_thread.start()
    logger.info("Started background cache pre-warming")

    # Start background cache refresh
    refresh_thread = threading.Thread(target=background_cache_refresh, daemon=True)
    refresh_thread.start()
    logger.info("Started background cache refresh")


@app.get("/")  # type: ignore[misc]
async def root() -> Dict[str, Any]:
    """
    Root endpoint with API information.

    Returns
    -------
    dict
        API information and status
    """
    return {
        "name": "Cato API",
        "version": "2.0.0",
        "status": "running",
        "endpoints": {
            "/api/snapshot": "Get unified denormalized snapshot",
            "/api/projects": "Get list of all projects",
            "/health": "Health check",
        },
    }


@app.get("/health")  # type: ignore[misc]
async def health() -> Dict[str, str]:
    """
    Health check endpoint.

    Returns
    -------
    dict
        Health status
    """
    return {"status": "healthy"}


@app.get("/api/projects")  # type: ignore[misc]
async def get_projects() -> Dict[str, Any]:
    """
    Get list of projects that have tasks.

    Only returns projects with at least one task to avoid showing empty projects.

    Returns
    -------
    dict
        List of projects with metadata, filtered to only include projects with tasks
    """
    try:
        logger.info("Loading projects list")
        projects_data = aggregator._load_projects()

        # Filter out projects with zero tasks
        projects_with_tasks = []
        for p in projects_data:
            if "id" not in p:
                continue

            project_id = p.get("id", "")
            # Load tasks for this project to check if it has any
            project_tasks = aggregator._load_tasks(project_id=project_id)
            task_count = len(project_tasks)

            # Only include projects that have at least 1 task
            if task_count > 0:
                projects_with_tasks.append({
                    "id": project_id,
                    "name": p.get("name", project_id),
                    "created_at": p.get("created_at", ""),
                    "last_used": p.get("last_used"),
                    "description": p.get("description", ""),
                    "task_count": task_count,  # Include count for debugging
                })

        logger.info(f"Filtered to {len(projects_with_tasks)}/{len(projects_data)} projects with tasks")

        # Sort projects by most recent first (last_used, then created_at)
        def get_sort_key(project: Dict[str, Any]) -> str:
            # Use last_used if available, otherwise created_at
            return project.get("last_used") or project.get("created_at", "")

        projects_with_tasks.sort(key=get_sort_key, reverse=True)
        logger.info("Sorted projects by most recent first")

        return {"projects": projects_with_tasks}
    except Exception as e:
        logger.error(f"Error loading projects: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error loading projects: {str(e)}")


@app.get("/api/snapshot")  # type: ignore[misc]
async def get_snapshot(
    project_id: Optional[str] = Query(None, description="Project ID to filter by"),
    view: Literal["subtasks", "parents", "all"] = Query(
        "subtasks", description="View mode: 'subtasks', 'parents', or 'all'"
    ),
    timeline_scale_exponent: float = Query(
        0.4, description="Power scale exponent for timeline (default 0.4)"
    ),
    use_cache: bool = Query(True, description="Use cached snapshot if available"),
) -> Dict[str, Any]:
    """
    Get unified denormalized snapshot.

    This endpoint replaces the multi-layer transformation pipeline with a single
    aggregation that returns all data pre-joined and pre-calculated.

    Parameters
    ----------
    project_id : Optional[str]
        Specific project to snapshot (None = all projects)
    view : str
        View mode: 'subtasks' (default), 'parents', or 'all'
    timeline_scale_exponent : float
        Power scale exponent for timeline transformation (default 0.4)
    use_cache : bool
        Whether to use cached snapshot if available (default True)

    Returns
    -------
    dict
        Complete denormalized snapshot with:
        - snapshot_id: Unique snapshot identifier
        - snapshot_version: Version number
        - timestamp: When snapshot was created
        - project_id: Filtered project (or None for all)
        - project_name: Project name
        - view_mode: Active view mode
        - tasks: List of denormalized tasks with embedded relationships
        - agents: List of agents with pre-calculated metrics
        - messages: List of messages with embedded context
        - timeline_events: List of events with embedded context
        - metrics: Pre-calculated project metrics
        - start_time: Timeline start
        - end_time: Timeline end
        - duration_minutes: Total duration
        - task_dependency_graph: Pre-built dependency graph
        - agent_communication_graph: Pre-built communication graph
    """
    try:
        # Create cache key
        cache_key = f"{project_id or 'all'}_{view}_{timeline_scale_exponent}"

        # Check cache
        if use_cache and cache_key in snapshot_cache:
            cached_snapshot, cache_time = snapshot_cache[cache_key]
            age = (datetime.now(timezone.utc) - cache_time).total_seconds()

            if age < CACHE_TTL_SECONDS:
                logger.info(f"Returning cached snapshot (age: {age:.1f}s): {cache_key}")
                return cached_snapshot

        # Create new snapshot
        logger.info(f"Creating new snapshot: {cache_key}")
        snapshot = aggregator.create_snapshot(
            project_id=project_id,
            view_mode=view,
            timeline_scale_exponent=timeline_scale_exponent,
        )

        # Convert to dict for JSON serialization
        snapshot_dict = snapshot.to_dict()

        # Cache the result
        snapshot_cache[cache_key] = (snapshot_dict, datetime.now(timezone.utc))

        # Clean up old cache entries (simple cleanup)
        if len(snapshot_cache) > 100:
            # Remove oldest 50% of entries
            sorted_keys = sorted(
                snapshot_cache.keys(),
                key=lambda k: snapshot_cache[k][1],
            )
            for key in sorted_keys[: len(sorted_keys) // 2]:
                del snapshot_cache[key]

        return snapshot_dict

    except Exception as e:
        logger.error(f"Error creating snapshot: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error creating snapshot: {str(e)}"
        )


if __name__ == "__main__":
    import json
    import os
    import uvicorn

    # Load port from config.json
    config_path = os.path.join(os.path.dirname(__file__), "..", "config.json")
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
            port = config.get("backend", {}).get("port", 4301)
    except Exception as e:
        logger.warning(f"Could not load config.json, using default port 4301: {e}")
        port = 4301

    logger.info(f"Starting Cato API on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")  # nosec B104
