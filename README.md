<h1 align="center">Cato</h1>

<p align="center">
  <strong>See what your agents are doing. In real time.</strong>
</p>

<p align="center">
  <a href="#get-started"><img src="https://img.shields.io/badge/Get_Started-5_min-blue?style=for-the-badge" alt="Get Started"></a>
  <a href="#see-it-work"><img src="https://img.shields.io/badge/See_It_Work-Demo-green?style=for-the-badge" alt="See It Work"></a>
  <a href="#views"><img src="https://img.shields.io/badge/Views-5_Modes-purple?style=for-the-badge" alt="Views"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/Changelog-View-orange?style=for-the-badge" alt="Changelog"></a>
</p>

<p align="center">
  <a href="https://github.com/lwgray/cato"><img src="https://img.shields.io/github/stars/lwgray/cato?style=social" alt="GitHub Stars"></a>
  <img src="https://img.shields.io/badge/version-0.2.1-blue.svg" alt="Version 0.2.1">
  <img src="https://img.shields.io/badge/python-3.11+-blue?logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/node-18+-green?logo=node.js&logoColor=white" alt="Node.js 18+">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

## The Companion Dashboard for Marcus

[Marcus](https://github.com/lwgray/marcus) coordinates agents through a shared board.
Cato lets you **watch it happen**.

When Marcus breaks your project into tasks, assigns agents, and manages
dependencies — Cato gives you a live window into every piece of that
coordination. Task flow, agent workload, communication patterns, and the
full audit trail.

> *Named after Cato the Elder, advisor and observer of Roman governance.
> Marcus acts. Cato watches.*

---

## See It Work

Five visualization modes, each showing a different dimension of multi-agent coordination:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Header: Project Selector  │  Network │ Swim │ Board │ Conv │ Health│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                    Active Visualization View                        │
│                                                                     │
│         (Network Graph / Swim Lanes / Board / Conversation)         │
│                                                                     │
├──────────────────────────────────────┬──────────────────────────────┤
│                                      │   Metrics Panel              │
│                                      │   - Tasks: 12 total, 8 done │
│                                      │   - Agents: 3 active         │
│                                      │   - Parallelization: 2.4x    │
│                                      │   - Peak parallel: 3 tasks   │
├──────────────────────────────────────┴──────────────────────────────┤
│  ◀  ▶  ⏸   Timeline Playback   ████████░░░░░░  75%   Speed: 2x    │
└─────────────────────────────────────────────────────────────────────┘
```

<!-- TODO: Add screenshot/gif of Cato dashboard in action -->

---

## Views

### Network Graph
Interactive D3.js dependency visualization. See how tasks connect, which
ones block progress, and where bottlenecks form. Zombie tasks (in-progress
without an agent) and bottleneck nodes (3+ dependents) are highlighted
automatically.

### Agent Swim Lanes
Timeline view of what each agent is doing and when. Tasks are grouped by
assigned agent on a logarithmic time scale, making both short and long
tasks visible. Watch parallel execution unfold.

### Board View
Kanban-style columns — **Todo**, **In Progress**, **Done**, **Blocked**.
The same board Marcus coordinates through, rendered live with progress
tracking.

### Conversation View
Every message between agents and tasks — filterable by agent, task, or
event type. Search across content, detect duplicates, and follow message
threads. This is your audit trail.

### Health Check Dashboard
System health at a glance. Service status, performance metrics, and error
tracking across the Marcus + Cato stack.

---

## Get Started

**Prerequisites:**
- [Marcus](https://github.com/lwgray/marcus) installed and running
- Python 3.11+
- Node.js 18+

### Option A: Docker (Recommended)

```bash
cd /path/to/marcus

# Start Marcus infrastructure + Cato visualization
docker-compose --profile viz up
```

Access the dashboard at **http://localhost:5173**.

See [Docker Guide](docs/DOCKER.md) for details.

### Option B: Local Install

#### Step 1: Install

```bash
git clone https://github.com/lwgray/cato.git
cd cato
pip install -e .
cd dashboard && npm install && cd ..
```

#### Step 2: Configure

Edit `config.json` to point to your Marcus data directory:

```json
{
  "backend": {
    "host": "localhost",
    "port": 4301
  },
  "frontend": {
    "port": 5173
  },
  "marcus_data_path": "/path/to/marcus/data"
}
```

Cato auto-detects Marcus in sibling directories (`../marcus`) and
`~/dev/marcus` if no path is configured.

#### Step 3: Start

```bash
./cato start
```

Open **http://localhost:5173**.

---

## CLI Commands

```bash
./cato start      # Start backend + frontend
./cato stop       # Stop all services
./cato restart    # Restart services
./cato status     # Check service status
./cato logs       # View logs (backend, frontend, or both)
./cato help       # Show all commands
```

---

## How It Connects to Marcus

```
+-------------------+
|      Marcus        |  Orchestrator: tasks, agents, board state
+--------+----------+
         |
         |  Reads from:
         |  - data/marcus_state/projects.json
         |  - data/marcus_state/subtasks.json
         |  - logs/conversations/
         |  - logs/agent_events/
         |
+--------v----------+
|   Cato Backend     |  FastAPI (port 4301)
|   Aggregator       |  Loads, denormalizes, caches snapshots
+--------+----------+
         |
         |  REST API
         |
+--------v----------+
|  Cato Dashboard    |  React + D3.js + Zustand (port 5173)
|  5 visualization   |  Real-time rendering with
|  modes             |  timeline playback
+-------------------+
```

**Data flows one way:** Marcus writes state, Cato reads and visualizes it.
No coupling, no callbacks, no shared process.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, Uvicorn, Pydantic 2 |
| **Frontend** | React 18, TypeScript, Vite |
| **Visualization** | D3.js, Mermaid |
| **State** | Zustand |
| **Animation** | Framer Motion |
| **Testing** | pytest, Vitest |
| **Infrastructure** | Docker, Nginx (production) |

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/projects` | List all projects with task counts |
| `GET /api/snapshot` | Unified visualization snapshot (supports `project_id`, `view`, `timeline_scale_exponent`, `use_cache`) |
| `GET /api/export` | Export snapshot as CSV/ZIP |
| `GET /api/tasks/{id}/conversation` | Task conversation history |
| `GET /api/artifacts/{id}/content` | Artifact content |
| `GET /api/historical/projects` | Completed project history |
| `GET /api/historical/projects/{id}/analysis` | Post-project analysis |

Full interactive docs: **http://localhost:4301/docs**

---

## Milestones

| Version | Date | Highlights |
|---------|------|------------|
| **0.2.0** | 2026-03-16 | Board view, health check dashboard, historical analysis API, artifact preview, export functionality, CI/CD with pre-commit hooks |
| **0.1.1** | 2026-03-09 | Decisions/artifacts support, data export, project filtering with fuzzy matching, live-only mode (removed mock data) |
| **0.1.0** | 2026-03-01 | Initial release — network graph, swim lanes, conversation view, metrics panel, timeline playback, Docker integration |

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

---

## Development Setup

```bash
# Clone both repos
git clone https://github.com/lwgray/marcus.git
git clone https://github.com/lwgray/cato.git

# Install Marcus
cd marcus && pip install -e . && cd ..

# Install Cato
cd cato
pip install -e ".[dev]"
cd dashboard && npm install && cd ..

# Run tests
pytest
cd dashboard && npm test && cd ..

# Start development
./cato start
```

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| Backend won't start | `./cato restart` then check `tail -f /tmp/cato-backend.log` |
| Port already in use | `./cato stop && lsof -i :4301` to find the blocking process |
| Frontend can't connect | `curl http://localhost:4301/health` to verify backend is running |
| No projects showing | Verify `marcus_data_path` in `config.json` points to a valid Marcus data directory |
| Stale data | Check auto-refresh is enabled; snapshots cache for 60 seconds |

See [Installation Guide](docs/INSTALLATION.md) for more.

---

## Documentation

- **[Docker Setup Guide](docs/DOCKER_SETUP.md)** — Step-by-step Docker integration
- **[Docker Reference](docs/DOCKER.md)** — Complete Docker documentation
- **[Installation Guide](docs/INSTALLATION.md)** — Local installation for development
- **[Quick Reference](docs/QUICKSTART.md)** — Commands and basic usage
- **[Dashboard Guide](docs/DASHBOARD.md)** — Features and architecture

---

## Contributing

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/cato.git
cd cato
pip install -e ".[dev]"
cd dashboard && npm install && cd ..
pytest
```

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push and open a Pull Request

---

## Community

- [GitHub Issues](https://github.com/lwgray/cato/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/lwgray/cato/discussions) — ideas and questions
- [Marcus Discord](https://discord.com/channels/1409498120739487859/1409498121456848907) — real-time help

---

## Related Projects

- **[Marcus](https://github.com/lwgray/marcus)** — Multi-agent coordination through shared board state

---

## License

MIT License — see [LICENSE](LICENSE) for details.
