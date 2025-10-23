# Cato Installation Guide

## Overview

Cato is a visualization dashboard for Marcus multi-agent systems. It requires Marcus to be installed as a dependency.

## Requirements

- Python 3.11 or higher
- Node.js 18 or higher (for frontend)
- npm or yarn

## Installation Methods

### Method 1: Development Setup (Recommended for Contributors)

If you're actively developing Marcus or want Cato to track Marcus changes:

1. **Clone or have access to Marcus repository**:
   ```bash
   # If you don't have Marcus yet
   git clone https://github.com/yourusername/marcus.git
   cd marcus
   ```

2. **Install Marcus in editable mode**:
   ```bash
   cd /path/to/marcus
   pip install -e .
   ```

   This makes Marcus available as a Python package while allowing you to edit Marcus code and see changes immediately.

3. **Clone Cato**:
   ```bash
   git clone https://github.com/yourusername/cato.git
   cd cato
   ```

4. **Install Cato dependencies**:
   ```bash
   # Backend dependencies
   pip install -r backend/requirements.txt

   # Frontend dependencies
   cd dashboard
   npm install
   cd ..
   ```

5. **Configure Cato**:
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

6. **Start Cato**:
   ```bash
   ./cato start
   ```

### Method 2: Standalone Installation (For Users)

If you just want to use Cato without modifying Marcus:

1. **Install Marcus from git**:
   ```bash
   pip install git+https://github.com/yourusername/marcus.git
   ```

   Or if Marcus is published to PyPI:
   ```bash
   pip install marcus
   ```

2. **Clone Cato**:
   ```bash
   git clone https://github.com/yourusername/cato.git
   cd cato
   ```

3. **Install dependencies**:
   ```bash
   # Backend
   pip install -r backend/requirements.txt

   # Frontend
   cd dashboard && npm install && cd ..
   ```

4. **Configure**:
   Edit `config.json` to point to your Marcus data directory.

5. **Start**:
   ```bash
   ./cato start
   ```

## Verification

After installation, verify everything works:

1. **Check backend**:
   ```bash
   curl http://localhost:4301/health
   ```

   Should return: `{"status":"healthy"}`

2. **Check frontend**:
   Open http://localhost:5173 in your browser

3. **Check Cato CLI**:
   ```bash
   ./cato status
   ```

## Troubleshooting

### Marcus not found

If you see `ModuleNotFoundError: No module named 'src'`:

1. Verify Marcus is installed:
   ```bash
   pip show marcus
   ```

2. Reinstall Marcus:
   ```bash
   pip install -e /path/to/marcus
   ```

### Port conflicts

If ports 4301 or 5173 are in use:

1. Edit `config.json` to change ports
2. Restart: `./cato restart`

### Frontend can't connect to backend

1. Check backend is running: `./cato status`
2. Verify `.env` file in dashboard/ has correct `VITE_API_URL`
3. Check `config.json` for correct ports
4. Restart: `./cato restart`

## Next Steps

- See [QUICKSTART.md](QUICKSTART.md) for usage guide
- See [DASHBOARD.md](DASHBOARD.md) for features and architecture

## Uninstallation

```bash
# Stop services
./cato stop

# Uninstall Python packages
pip uninstall cato marcus

# Remove Cato directory
cd .. && rm -rf cato
```
