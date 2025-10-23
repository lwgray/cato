# Cato - Marcus Visualization Dashboard

Multi-agent parallelization visualization dashboard for Marcus.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Overview

Cato provides real-time visualization of Marcus multi-agent systems, helping you understand:
- Task dependencies and execution flow
- Agent assignments and workload distribution
- Inter-agent communication patterns
- System-wide metrics and performance

## Features

- **Network Graph**: Interactive task dependency visualization
- **Agent Swim Lanes**: Timeline view of agent task execution
- **Conversation View**: Agent-to-agent message flow analysis
- **Metrics Panel**: Real-time system statistics
- **Timeline Playback**: Scrub through execution history
- **Project Filtering**: View specific projects or all projects
- **Auto-refresh**: Configurable live data updates

## Quick Start

### Docker (Recommended)

The easiest way to run Cato with Marcus:

```bash
cd /path/to/marcus

# Start Marcus + Cato visualization
docker-compose --profile viz up
```

Access the dashboard at: **http://localhost:5173**

See [Docker Guide](docs/DOCKER.md) for complete Docker documentation.

### Local Development

```bash
# 1. Install Marcus (required dependency)
pip install -e /path/to/marcus

# 2. Install Cato dependencies
cd cato
pip install -r backend/requirements.txt
cd dashboard && npm install && cd ..

# 3. Configure Cato
# Edit config.json to point to your Marcus data directory

# 4. Start Cato
./cato start
```

## Documentation

- **[Docker Setup Guide](docs/DOCKER_SETUP.md)** - Step-by-step Docker integration
- **[Docker Reference](docs/DOCKER.md)** - Complete Docker documentation
- **[Installation Guide](docs/INSTALLATION.md)** - Local installation for development
- **[Quick Reference](docs/QUICKSTART.md)** - Commands and basic usage
- **[Dashboard Guide](docs/DASHBOARD.md)** - Features and architecture

## CLI Commands

```bash
./cato start      # Start both backend and frontend
./cato stop       # Stop all services
./cato restart    # Restart services
./cato status     # Check service status
./cato logs       # View logs (backend, frontend, or both)
./cato help       # Show all commands
```

## Configuration

Edit `config.json`:

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

All ports and paths are centrally managed through this file.

## Architecture

```
cato/
├── cato                  # CLI tool for managing services
├── config.json           # Centralized configuration
├── pyproject.toml        # Python package definition
├── backend/              # FastAPI backend
│   ├── api.py           # REST API serving Marcus data
│   └── requirements.txt # Backend dependencies (includes Marcus)
├── dashboard/           # React + TypeScript frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── services/    # API clients
│   │   └── store/       # Zustand state management
│   └── package.json     # Frontend dependencies
└── docs/                # Documentation
    ├── INSTALLATION.md
    ├── QUICKSTART.md
    └── DASHBOARD.md
```

## Requirements

- **Python**: 3.11+
- **Node.js**: 18+
- **Marcus**: Latest version (installed separately)

## Development Setup

1. **Clone Marcus**:
   ```bash
   git clone https://github.com/yourusername/marcus.git
   cd marcus
   ```

2. **Install Marcus in editable mode** (changes tracked automatically):
   ```bash
   pip install -e .
   ```

3. **Clone and setup Cato**:
   ```bash
   git clone https://github.com/yourusername/cato.git
   cd cato
   pip install -r backend/requirements.txt
   cd dashboard && npm install && cd ..
   ```

4. **Configure and run**:
   ```bash
   # Edit config.json to point to Marcus data
   ./cato start
   ```

## API Endpoints

- `GET /` - API information
- `GET /health` - Health check
- `GET /api/projects` - List all projects
- `GET /api/snapshot` - Get unified visualization snapshot
  - Query params: `project_id`, `view`, `timeline_scale_exponent`, `use_cache`

Full API documentation: http://localhost:4301/docs

## Troubleshooting

### Backend won't start
```bash
./cato restart
tail -f /tmp/cato-backend.log
```

### Port already in use
```bash
./cato stop
lsof -i :4301  # Check what's using the port
./cato start
```

### Frontend can't connect
```bash
# Check backend health
curl http://localhost:4301/health

# Verify configuration
./cato status
```

See [Installation Guide](docs/INSTALLATION.md) for more troubleshooting.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Related Projects

- **[Marcus](https://github.com/yourusername/marcus)** - Multi-Agent Resource Coordination and Understanding System

## Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/cato/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/cato/discussions)

---

Built with ❤️ for the Marcus multi-agent ecosystem
