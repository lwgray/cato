# Kill Switch — Hard Kill Implementation Plan

## Overview

Add a **hard kill switch** that sends SIGTERM to the actual agent process, killing it dead. This is the real kill — the agent process is gone, and we get to see Marcus's recovery mechanism kick in (reassignment, respawn, etc.).

### Architecture Reality

- Marcus agents are **Claude Code sessions** running in separate terminals
- They connect to Marcus's MCP server at `:4298` via HTTP
- `register_agent` currently accepts: `agent_id`, `name`, `role`, `skills`
- **Marcus does NOT track PIDs** — agents are external processes, not children
- Agent state is **in-memory only** in the Marcus server (not persisted to `marcus.db`)

### The Fix: PID Registration

Marcus needs to know the PID to kill it. The agent must **post its PID on registration**.

---

## Part 1: Marcus-Side Changes

> These changes go in the **Marcus repo** (`lwgray/marcus`).

### 1a. Agent Registration with PID (`src/marcus_mcp/tools/agent.py`)

**`register_agent` gets a new `pid` parameter:**
```python
# Current: register_agent(agent_id, name, role, skills)
# New:     register_agent(agent_id, name, role, skills, pid)
```

- `pid: int` — the OS process ID of the agent
- Stored in `state.agent_status[agent_id].pid`
- Add `pid: Optional[int]` field to `WorkerStatus` dataclass
- Optional for backwards compat (old agents without PID still work, just can't be hard-killed)

### 1b. New MCP Tool: `kill_agent` (`src/marcus_mcp/tools/agent.py`)

```python
def kill_agent(agent_id: str, reason: str = "") -> dict:
    """Hard kill — SIGTERM the agent process."""
    agent = state.agent_status.get(agent_id)
    if not agent:
        return {"error": "Agent not found"}
    if not agent.pid:
        return {"error": "No PID registered — agent cannot be hard-killed"}

    # 1. Unassign all tasks from this agent
    for task_id in list(agent.current_tasks):
        unassign_task(task_id)  # resets to TODO

    # 2. SIGTERM the process
    import os, signal
    try:
        os.kill(agent.pid, signal.SIGTERM)
    except ProcessLookupError:
        return {"status": "already_dead", "message": "Process not found — agent already exited"}

    # 3. Mark agent as killed in state
    agent.status = "killed"
    agent.killed_at = datetime.utcnow()
    agent.kill_reason = reason

    return {
        "status": "killed",
        "agent_id": agent_id,
        "pid": agent.pid,
        "tasks_unassigned": list(agent.current_tasks),
        "message": f"SIGTERM sent to PID {agent.pid}"
    }
```

### 1c. New MCP Tool: `kill_task` (`src/marcus_mcp/tools/task.py`)

Kills the specific agent working on a task:
```python
def kill_task(task_id: str, reason: str = "") -> dict:
    """Kill the agent working on this task via SIGTERM."""
    # Find which agent owns this task
    assignment = state.agent_tasks.get(task_id)
    if not assignment:
        return {"error": "Task not assigned to any agent"}

    agent_id = assignment.agent_id
    # Delegate to kill_agent
    return kill_agent(agent_id, reason=reason or f"Task {task_id} killed from dashboard")
```

### 1d. Agent Prompt Update (`prompts/Agent_prompt.md`)

Add to registration instructions:
```
When calling register_agent, you MUST include your process ID (PID).
Use the appropriate method for your runtime to get your PID.
Example: register_agent(agent_id="agent-1", name="Builder", role="developer", skills=["python"], pid=12345)
```

### 1e. Expose Kill via MCP HTTP Endpoint

Marcus's MCP server needs to register `kill_agent` and `kill_task` as callable tools so Cato can invoke them via HTTP at `http://localhost:4298/mcp`.

---

## Part 2: Cato Backend — Kill Proxy

### 2a. Marcus MCP Client (`backend/marcus_client.py` — new file)

Simple HTTP client that calls Marcus's MCP tools:

```python
class MarcusClient:
    def __init__(self, mcp_url: str):
        self.mcp_url = mcp_url  # "http://localhost:4298/mcp"

    async def kill_task(self, task_id: str, reason: str = "") -> dict:
        """Call Marcus kill_task tool — SIGTERMs the agent working on this task."""
        return await self._call_tool("kill_task", {"task_id": task_id, "reason": reason})

    async def kill_agent(self, agent_id: str, reason: str = "") -> dict:
        """Call Marcus kill_agent tool — SIGTERMs the agent process."""
        return await self._call_tool("kill_agent", {"agent_id": agent_id, "reason": reason})

    async def _call_tool(self, tool_name: str, arguments: dict) -> dict:
        """Send MCP tool call to Marcus server."""
        # POST to MCP endpoint with tool invocation
        # Handle connection errors (Marcus might be down)
```

### 2b. Kill API Endpoints (`backend/api.py`)

```
POST /api/tasks/{task_id}/kill    →  marcus_client.kill_task(task_id, reason)
POST /api/agents/{agent_id}/kill  →  marcus_client.kill_agent(agent_id, reason)
POST /api/kill-all                →  kill_task for every in_progress task
```

Each endpoint:
1. Calls Marcus MCP
2. Invalidates Cato's snapshot cache
3. Returns result (killed, already_dead, error, no PID)

### 2c. Config Update (`config.json`)
```json
{
  "marcus_mcp_url": "http://localhost:4298/mcp"
}
```

---

## Part 3: Cato Data Model — `killed` Status

### 3a. Store (`src/core/store.py`)
- Add `"killed"` to Task status literal
- Add `killed_at`, `killed_by`, `kill_reason` optional fields
- Add `killed_tasks: int` to Metrics

### 3b. Aggregator (`src/core/aggregator.py`)
- Detect killed tasks (unassigned tasks that were previously in_progress with a kill event)
- Count in metrics
- Freeze progress at kill time

### 3c. Timeline Utils (`dashboard/src/utils/timelineUtils.ts`)
- Handle `killed` in `getTaskStateAtTime`

---

## Part 4: Live Updates via SSE

### 4a. Backend SSE (`backend/api.py`)
- `GET /api/stream` — Server-Sent Events endpoint
- Events: `task_killed`, `snapshot_updated`, `task_status_changed`
- Polls every 5s, pushes diffs

### 4b. Frontend SSE Client (`dashboard/src/services/dataService.ts`)
- `connectStream()` → `EventSource`, auto-reconnect
- `killTask(taskId, reason)` → POST
- `killAgent(agentId)` → POST
- `killAll()` → POST

### 4c. Store (`dashboard/src/store/visualizationStore.ts`)
- `isLive`, `connectionStatus`, `lastEventTime`
- SSE-driven updates replace 60s polling (polling as fallback)
- Optimistic kill updates

---

## Part 5: Kill Switch UI on DAG

### 5a. Kill on Nodes (`NetworkGraphView.tsx`)
- Hover `in_progress` node → kill icon (■) appears
- Click → confirmation: "Kill task '{name}'? This will SIGTERM the agent (PID {pid}) and unassign the task."
- Shows: agent name, PID, downstream impact

### 5b. Kill in TaskLifecyclePanel (`TaskLifecyclePanel.tsx`)
- Red "Kill Task" button for `in_progress` tasks
- Shows agent name + PID
- After kill: "Killed at {time} — PID {pid} terminated"

### 5c. Kill Flow
1. User clicks kill → confirmation dialog (shows PID + agent)
2. Optimistic update: node turns purple immediately
3. `POST /api/tasks/{task_id}/kill` → Cato → Marcus MCP `kill_task`
4. Marcus calls `os.kill(pid, SIGTERM)` + unassigns task
5. Agent process dies
6. **Marcus recovery kicks in**: task goes back to TODO, available for next `request_next_task` by another agent (or same agent if respawned)
7. SSE broadcasts `task_killed`
8. Dashboard shows the full lifecycle: in_progress → killed → (optionally) TODO → reassigned

### 5d. Visual Treatment
- **Color**: Purple (`#a855f7`)
- **Border**: Dashed
- **Icon**: Stop square (■)
- **Animation**: Red flash → purple
- **Dependents**: Auto-blocked with "upstream killed"

---

## Part 6: Live DAG Visual Enhancements

### 6a. Pulse on Active Nodes
- `in_progress` nodes pulse (CSS keyframes)
- Kill removes pulse instantly

### 6b. Progress Rings
- SVG arc around nodes showing % complete

### 6c. Transition Animations
- 300ms color transitions
- Kill: red flash → purple
- Complete: green glow → green

### 6d. Live Badge
- "LIVE" top-right, green pulse = connected
- "Last update: Xs ago"

### 6e. Dependency Cascade
- Kill ripple: edges flash red → dependents flash orange → settle blocked

---

## Part 7: Legend & Controls

### 7a. Legend
- Add Killed (purple) + Live indicator

### 7b. Toolbar
- "Kill All In-Progress" (double-confirm)
- Connection status

---

## What We Get to Observe

The hard kill is interesting because after SIGTERM:
1. **Agent dies immediately** — process gone
2. **Marcus detects stale assignment** — via lease expiry or next health check
3. **Task returns to TODO** — `unassign_task` already handled this
4. **Recovery mechanism fires** — another agent (or respawned agent) calls `request_next_task` and picks it up
5. **Cato shows the full story** — in_progress → killed → TODO → in_progress (new agent)

This tests Marcus's resilience and makes the kill feel **real** in the dashboard.

---

## File Change Summary

| File | Repo | Changes |
|------|------|---------|
| `src/marcus_mcp/tools/agent.py` | Marcus | Add `pid` to registration, add `kill_agent` tool |
| `src/marcus_mcp/tools/task.py` | Marcus | Add `kill_task` tool |
| `prompts/Agent_prompt.md` | Marcus | Add PID registration instruction |
| `config.json` | Cato | Add `marcus_mcp_url` |
| `backend/marcus_client.py` | Cato | **New** — MCP client for Marcus |
| `backend/api.py` | Cato | Kill endpoints + SSE stream |
| `src/core/store.py` | Cato | `killed` status + fields + metric |
| `src/core/aggregator.py` | Cato | Handle killed status |
| `dashboard/src/services/dataService.ts` | Cato | Kill + stream functions |
| `dashboard/src/store/visualizationStore.ts` | Cato | Live state + kill actions |
| `dashboard/src/components/NetworkGraphView.tsx` | Cato | Kill button, pulse, rings, killed color |
| `dashboard/src/components/NetworkGraphView.css` | Cato | Kill styles, pulse keyframes |
| `dashboard/src/components/TaskLifecyclePanel.tsx` | Cato | Kill button in panel |
| `dashboard/src/components/TaskLifecyclePanel.css` | Cato | Kill button styles |
| `dashboard/src/utils/timelineUtils.ts` | Cato | Handle `killed` status |

## Implementation Order

1. **Marcus: PID in `register_agent`** — foundation, agents report their PID
2. **Marcus: `kill_task` + `kill_agent` MCP tools** — the actual SIGTERM mechanism
3. **Marcus: Agent prompt update** — agents send PID on registration
4. **Cato: MCP client + kill proxy API** — Cato can call Marcus to kill
5. **Cato: `killed` status in data model** — store + aggregator + timeline
6. **Cato: Frontend kill UI** — buttons on DAG + lifecycle panel
7. **Cato: SSE streaming** — live updates
8. **Cato: Visual polish** — pulse, rings, transitions, live badge, cascade
