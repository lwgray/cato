# Kill Switch & Live DAG Updates — Implementation Plan

## Overview

Add a **kill switch** that actually stops the Marcus agent working on a task, directly from the DAG. Plus **real-time live updates** so you can see task state changes as they happen and know exactly when to intervene.

### Key Insight: Marcus Has No Kill Mechanism

Marcus agents run as autonomous Claude Code sessions in separate terminals. Marcus's MCP server exposes these tools for task management:
- `request_next_task` — agent gets assigned work
- `report_task_progress` — agent reports %, status changes
- `report_blocker` — agent flags obstacles
- `unassign_task` — **manually breaks a stuck assignment, resets task to TODO**

**There is no `kill_task` or `deregister_agent` tool.** The `unassign_task` tool is the closest thing — it clears the assignment from `state.agent_tasks`, removes from persistent storage, deletes active leases, and resets the Kanban card to TODO. But it doesn't stop the agent process itself.

### The Real Kill = Two Actions

A true kill switch must:
1. **Call Marcus's `unassign_task`** via MCP — breaks the assignment so Marcus stops routing context to that task
2. **Signal the agent process to stop** — the agent is a Claude Code session running in a terminal. Without termination, it will just call `request_next_task` again and get new work (or retry the same task)

For (2), Marcus agents are Claude Code subprocesses. The kill options are:
- **Option A**: Send `SIGTERM`/`SIGINT` to the agent process (requires knowing the PID)
- **Option B**: Add a new `cancel_task` MCP tool to Marcus that sets a "poisoned" flag — when the agent next calls `report_task_progress` or `request_next_task`, Marcus responds with a "you've been terminated" signal and the agent's prompt instructs it to exit
- **Option C**: Use both — unassign + soft poison flag for graceful stop, with hard SIGTERM as fallback

**Recommended: Option B (soft kill via MCP) + Option A fallback (hard kill via PID)**

---

## Part 1: Marcus-Side Changes (MCP Server)

> These changes go in the **Marcus repo**, not Cato. Cato calls them via HTTP.

### 1a. New MCP Tool: `cancel_task` (Marcus: `src/marcus_mcp/tools/task.py`)
- Calls `unassign_task` internally (breaks assignment, resets to TODO)
- Sets a **cancellation flag** in Marcus state: `state.cancelled_tasks[task_id] = { reason, cancelled_at, cancelled_by }`
- Next time the agent calls ANY MCP tool (`report_task_progress`, `request_next_task`), Marcus checks the flag and returns: `{ "status": "terminated", "message": "Task was cancelled by dashboard operator", "action": "exit" }`
- The agent's system prompt should instruct it to **exit immediately** when it receives a `terminated` response

### 1b. New MCP Tool: `kill_agent` (Marcus: `src/marcus_mcp/tools/agent.py`)
- Harder kill — unassigns ALL tasks from a specific agent
- Marks agent as `deregistered` in state
- If PID tracking is available, sends SIGTERM to the process

### 1c. Agent Prompt Update (Marcus: `prompts/Agent_prompt.md`)
- Add instruction: "If any MCP tool returns `status: terminated`, stop ALL work immediately and exit. Do not request another task."

---

## Part 2: Cato Backend — Kill Proxy API

### 2a. Cato Calls Marcus MCP (`backend/api.py`)

Cato's backend acts as a **proxy** to Marcus's MCP server:

- **New endpoint: `POST /api/tasks/{task_id}/kill`**
  - Calls Marcus MCP at `http://localhost:4298/mcp` with tool `cancel_task`
  - Request body: `{ "reason": "optional reason" }`
  - Marcus unassigns + poisons the task
  - Cato invalidates its snapshot cache
  - Returns result to dashboard

- **New endpoint: `POST /api/agents/{agent_id}/kill`**
  - Calls Marcus MCP with tool `kill_agent`
  - Kills all tasks for that agent
  - Returns result

- **New endpoint: `POST /api/kill-all`**
  - Emergency stop — calls `cancel_task` for every `in_progress` task
  - Nuclear option with double-confirmation on frontend

### 2b. MCP Client in Cato (`backend/marcus_client.py` — new file)
- Simple HTTP client that talks to Marcus's MCP server at `localhost:4298`
- Methods: `cancel_task(task_id, reason)`, `kill_agent(agent_id)`, `get_task_status(task_id)`
- Handles connection errors gracefully (Marcus might be down)
- Config: MCP endpoint URL from `config.json`

### 2c. Config Update (`config.json`)
```json
{
  "marcus_mcp_url": "http://localhost:4298/mcp"
}
```

---

## Part 3: Cato Data Model — `killed` Status

### 3a. Backend Data Model (`src/core/store.py`)
- Add `"killed"` to Task status: `Literal["todo", "in_progress", "done", "blocked", "killed"]`
- Add fields:
  - `killed_at: Optional[datetime]`
  - `killed_by: Optional[str]`
  - `kill_reason: Optional[str]`

### 3b. Metrics (`src/core/store.py`)
- Add `killed_tasks: int` to `Metrics`

### 3c. Aggregator (`src/core/aggregator.py`)
- Map Marcus's cancelled/unassigned tasks to `killed` status
- Count killed tasks in metrics
- Freeze progress at time of kill

### 3d. Timeline Utils (`dashboard/src/utils/timelineUtils.ts`)
- Handle `killed` status in `getTaskStateAtTime` — show as killed from kill time forward

---

## Part 4: Live Updates via Server-Sent Events (SSE)

### 4a. Backend SSE Endpoint (`backend/api.py`)
- **New endpoint: `GET /api/stream`** — SSE stream
- Events:
  - `snapshot_updated` — new snapshot version available (with changed task IDs)
  - `task_killed` — immediate notification when a kill is issued
  - `task_status_changed` — any task state transition
- Polls Marcus for changes every **5 seconds** and pushes diffs
- Each event includes `snapshot_version`

### 4b. Frontend SSE Client (`dashboard/src/services/dataService.ts`)
- `connectStream()` → returns `EventSource`, auto-reconnects
- `killTask(taskId, reason)` → `POST /api/tasks/{task_id}/kill`
- `killAgent(agentId)` → `POST /api/agents/{agent_id}/kill`
- `killAll()` → `POST /api/kill-all`

### 4c. Store Updates (`dashboard/src/store/visualizationStore.ts`)
- New state: `isLive`, `connectionStatus`, `lastEventTime`
- `connectLiveUpdates()` / `disconnectLiveUpdates()`
- On `task_killed` → optimistic update before full refresh
- Replace 60s polling with SSE (keep polling as fallback)

---

## Part 5: Kill Switch on DAG

### 5a. Kill Button on Nodes (`NetworkGraphView.tsx`)
- Hover over `in_progress` node → small kill icon (■ stop square) appears
- Click → confirmation: "Kill task '{name}'? This will unassign the agent and stop execution."
- Confirmation shows what will happen: task killed, agent freed, dependents blocked

### 5b. Kill Button in TaskLifecyclePanel (`TaskLifecyclePanel.tsx`)
- Red "Kill Task" button (only for `in_progress` tasks)
- Shows agent name that will be affected
- After kill: shows "Killed at {time}" with reason

### 5c. Kill Execution Flow
1. User clicks kill → confirmation dialog
2. Optimistic update: node turns purple immediately
3. `POST /api/tasks/{task_id}/kill` → Cato backend → Marcus MCP `cancel_task`
4. Marcus unassigns agent + sets poison flag
5. Agent receives "terminated" on next MCP call → exits
6. SSE broadcasts `task_killed` to all dashboard clients
7. Full snapshot refresh updates dependent task states

### 5d. Visual Treatment for `killed` Status
- **Color**: Purple (`#a855f7`) — distinct from all other statuses
- **Border**: Dashed to indicate interrupted
- **Icon**: Stop square (■) overlaid
- **Animation**: Red flash → fade to purple on kill
- **Dependents**: Auto-blocked with "upstream killed" indicator

---

## Part 6: Live DAG Visual Enhancements

### 6a. Pulse Animation on Active Nodes
- `in_progress` nodes pulse (CSS `@keyframes` breathing glow)
- Kill removes pulse immediately

### 6b. Progress Rings
- SVG arc around each node showing 0→100% completion
- Immediate visual sense of how far along each task is

### 6c. Status Transition Animations
- 300ms color transitions on status changes
- Killed: red flash → purple settle
- Completed: green glow → green settle

### 6d. Live Badge
- "LIVE" indicator top-right of DAG view
- Green pulsing dot = connected, gray = disconnected
- "Last update: Xs ago"

### 6e. Dependency Cascade Animation
- On kill: edges from killed task flash red → dependents flash orange → settle to blocked
- Visual ripple showing kill impact through the pipeline

---

## Part 7: Legend & Controls

### 7a. Updated Legend
- Add Killed status (purple)
- Add Live indicator explanation

### 7b. DAG Toolbar
- "Kill All In-Progress" emergency button (double-confirmation)
- Connection status indicator

---

## File Change Summary

| File | Changes |
|------|---------|
| **Marcus repo** (separate) | |
| `src/marcus_mcp/tools/task.py` | Add `cancel_task` tool with poison flag |
| `src/marcus_mcp/tools/agent.py` | Add `kill_agent` tool |
| `prompts/Agent_prompt.md` | Add "exit on terminated" instruction |
| **Cato repo** | |
| `config.json` | Add `marcus_mcp_url` |
| `backend/marcus_client.py` | **New** — MCP client to call Marcus |
| `backend/api.py` | Add kill endpoints, SSE stream, MCP proxy |
| `src/core/store.py` | Add `killed` status + fields, killed metric |
| `src/core/aggregator.py` | Handle killed status in metrics + snapshots |
| `dashboard/src/services/dataService.ts` | Add `killTask()`, `killAgent()`, `killAll()`, `connectStream()` |
| `dashboard/src/store/visualizationStore.ts` | Add live update state, kill actions, SSE management |
| `dashboard/src/components/NetworkGraphView.tsx` | Kill button on nodes, progress rings, pulse, killed color |
| `dashboard/src/components/NetworkGraphView.css` | Pulse keyframes, killed styles, live badge |
| `dashboard/src/components/TaskLifecyclePanel.tsx` | Kill button in panel |
| `dashboard/src/components/TaskLifecyclePanel.css` | Kill button styles |
| `dashboard/src/utils/timelineUtils.ts` | Handle `killed` in `getTaskStateAtTime` |

## Implementation Order

1. **Marcus: `cancel_task` MCP tool** — the actual kill mechanism
2. **Marcus: Agent prompt update** — agents obey termination signals
3. **Cato: MCP client + kill proxy API** — Cato can call Marcus
4. **Cato: `killed` status in data model** — store + aggregator + timeline
5. **Cato: Frontend kill UI** — buttons on DAG nodes + lifecycle panel
6. **Cato: SSE streaming** — live updates replace polling
7. **Cato: Visual polish** — progress rings, pulse, transitions, live badge
8. **Cato: Dependency cascade** — downstream blocking + ripple animation
