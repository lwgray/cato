# Kill Switch & Live DAG Updates — Implementation Plan

## Overview

Add a **kill switch** to interrupt in-progress tasks directly from the DAG, plus **real-time live updates** so you can see task state changes as they happen and know exactly when to intervene.

---

## Part 1: New Task Status — `killed`

### 1a. Backend Data Model (`src/core/store.py`)
- Add `"killed"` to the `Task.status` Literal type: `Literal["todo", "in_progress", "done", "blocked", "killed"]`
- Add optional fields to Task:
  - `killed_at: Optional[datetime]` — when the kill was issued
  - `killed_by: Optional[str]` — who/what triggered the kill (e.g. "dashboard_user")
  - `kill_reason: Optional[str]` — optional reason string

### 1b. Metrics (`src/core/store.py`)
- Add `killed_tasks: int` to `Metrics`

### 1c. Aggregator (`src/core/aggregator.py`)
- Count killed tasks in metrics calculation
- Handle `killed` status in progress calculation (killed → progress frozen at time of kill)

### 1d. Backend API (`backend/api.py`)
- **New endpoint: `POST /api/tasks/{task_id}/kill`**
  - Request body: `{ "reason": "optional reason" }`
  - Writes a kill event to Marcus's data store (a `task_killed` record)
  - Invalidates the snapshot cache for the affected project
  - Returns the updated task state
- **New endpoint: `GET /api/tasks/{task_id}/status`** (lightweight, no snapshot needed)
  - Returns just the current status of a single task for quick polling

### 1e. Kill Persistence
- Write kill events to a new `kills.json` file in the Marcus data directory
- Structure: `{ task_id, killed_at, killed_by, reason, project_id }`
- Aggregator reads this file during snapshot creation to apply killed status

---

## Part 2: Live Updates via Server-Sent Events (SSE)

### 2a. Backend SSE Endpoint (`backend/api.py`)
- **New endpoint: `GET /api/stream`** — SSE stream
- Events pushed to clients:
  - `snapshot_updated` — new snapshot version available (with lightweight diff: which task IDs changed status)
  - `task_killed` — immediate notification when a kill is issued
  - `task_status_changed` — when any task transitions state
- Backend polls for changes every **5 seconds** (vs current 60s cache) and pushes diffs
- Each event includes `snapshot_version` so the client knows if it's stale

### 2b. Frontend SSE Client (`dashboard/src/services/dataService.ts`)
- New `connectStream()` function returning an `EventSource`
- Automatically reconnects on disconnect
- Parses SSE events and dispatches to store

### 2c. Zustand Store Updates (`dashboard/src/store/visualizationStore.ts`)
- New state: `isLive: boolean`, `lastEventTime: number`, `connectionStatus: 'connected' | 'disconnected' | 'reconnecting'`
- New action: `connectLiveUpdates()` / `disconnectLiveUpdates()`
- On `snapshot_updated` event → auto-refresh snapshot (only if version is newer)
- On `task_killed` event → immediately update the local task status (optimistic update) before full snapshot refresh
- Replace 60s polling with SSE-driven updates (keep polling as fallback)

---

## Part 3: Kill Switch on DAG

### 3a. Kill Button on Nodes (`dashboard/src/components/NetworkGraphView.tsx`)
- When right-clicking (or long-pressing) an `in_progress` node, show a **context menu** with "Kill Task" option
- Alternatively: add a small **kill icon** (⊘ or ■) that appears on hover over `in_progress` nodes
- Clicking triggers a confirmation dialog: "Kill task '{name}'? This will stop execution and mark dependents as blocked."

### 3b. Kill Button on TaskLifecyclePanel (`dashboard/src/components/TaskLifecyclePanel.tsx`)
- Add a prominent red **"Kill Task"** button in the panel header (only shown for `in_progress` tasks)
- Shows confirmation before executing
- After kill: button changes to "Killed" (disabled) with timestamp

### 3c. Kill Execution Flow (Frontend)
1. User clicks kill → confirmation dialog
2. Optimistic update: task turns `killed` color immediately in DAG
3. `POST /api/tasks/{task_id}/kill` fires
4. SSE broadcasts `task_killed` to all connected clients
5. Full snapshot refresh follows to update dependent task states

### 3d. Visual Treatment for Killed Status
- **Color**: Purple/magenta (`#a855f7`) — distinct from all other statuses
- **Icon**: Skull/stop icon (■) overlaid on killed nodes
- **Border**: Dashed border to indicate interrupted state
- **Animation**: Brief "shatter" or fade-to-purple transition on kill
- **Dependents**: Downstream tasks auto-marked as `blocked` with a "killed upstream" indicator

---

## Part 4: Live DAG Enhancements

### 4a. Real-Time Node Pulsing (`NetworkGraphView.tsx`)
- `in_progress` nodes get a **breathing pulse animation** (CSS `@keyframes`)
- Pulse speed proportional to progress (faster = closer to completion)
- Kill removes the pulse immediately (satisfying visual feedback)

### 4b. Live Progress Rings
- Replace solid circle fill with a **progress ring** (SVG arc) around each node
- Ring fills clockwise as progress increases (0% → 100%)
- Gives immediate visual sense of how far along each task is

### 4c. Status Transition Animations
- When a task changes status (via SSE), animate the color transition (300ms ease)
- When killed: brief red flash → fade to purple
- When completed: brief green glow → settle to green

### 4d. Live Activity Indicator
- Add a **"LIVE" badge** in the top-right of the DAG view when SSE is connected
- Pulsing green dot = connected, gray dot = disconnected
- Show "Last update: Xs ago" next to it

### 4e. Dependency Cascade Visualization
- When a task is killed, briefly animate the dependency edges downstream:
  - Edges from killed task flash red
  - Dependent nodes briefly flash orange before turning to blocked color
  - Gives a visual "ripple effect" showing the kill's impact on the pipeline

---

## Part 5: Legend & Controls Updates

### 5a. Updated Legend (`NetworkGraphView.tsx`)
- Add **Killed** status to legend (purple circle)
- Add **Live indicator** explanation

### 5b. DAG Toolbar
- Add a **"Kill All In-Progress"** emergency button (with double-confirmation) for full pipeline stop
- Add **connection status indicator** (green dot / reconnecting spinner)

---

## File Change Summary

| File | Changes |
|------|---------|
| `src/core/store.py` | Add `killed` status, `killed_at`/`killed_by`/`kill_reason` fields, `killed_tasks` metric |
| `src/core/aggregator.py` | Handle killed status in metrics, load kills.json |
| `backend/api.py` | Add `POST /api/tasks/{task_id}/kill`, `GET /api/stream` SSE endpoint |
| `dashboard/src/services/dataService.ts` | Add `killTask()`, `connectStream()` functions |
| `dashboard/src/store/visualizationStore.ts` | Add live update state/actions, SSE connection management |
| `dashboard/src/components/NetworkGraphView.tsx` | Kill button on nodes, progress rings, pulse animations, killed color |
| `dashboard/src/components/NetworkGraphView.css` | Pulse keyframes, killed styles, live badge |
| `dashboard/src/components/TaskLifecyclePanel.tsx` | Kill button in panel |
| `dashboard/src/components/TaskLifecyclePanel.css` | Kill button styles |
| `dashboard/src/utils/timelineUtils.ts` | Handle `killed` status in `getTaskStateAtTime` |

## Implementation Order

1. **Backend killed status** (store.py + aggregator.py + kills.json) — foundation
2. **Kill API endpoint** (api.py POST) — enables the action
3. **Frontend kill flow** (dataService + store + NetworkGraphView + TaskLifecyclePanel) — UI for triggering kills
4. **SSE streaming** (api.py GET /api/stream + dataService connectStream) — live updates
5. **Visual enhancements** (progress rings, pulse, transition animations, live badge) — polish
6. **Dependency cascade** (downstream blocking + ripple animation) — impact visibility
