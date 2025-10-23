# Docker Setup Guide for Cato + Marcus

This guide walks you through integrating Cato visualization with Marcus using Docker.

## Prerequisites

- Docker installed and running
- Docker Compose installed
- Marcus repository cloned
- Cato repository cloned

## Directory Structure

Your workspace should look like this:

```
/your/workspace/
├── marcus/                    # Marcus repository
│   ├── docker-compose.yml    # To be updated/replaced
│   ├── config/
│   └── ...
└── cato/                      # Cato repository
    ├── Dockerfile.backend
    ├── Dockerfile.frontend
    ├── backend/
    ├── dashboard/
    └── docs/
        └── docker-compose.example.yml
```

**Important**: The paths in `docker-compose.yml` assume Cato is at `../cato` relative to Marcus.

## Installation Steps

### Option 1: Use Example Configuration (Easiest)

If you're starting fresh or want the complete integrated setup:

```bash
# 1. Navigate to Cato docs
cd /path/to/cato/docs

# 2. Copy example to Marcus repository
cp docker-compose.example.yml /path/to/marcus/docker-compose.yml

# 3. Navigate to Marcus
cd /path/to/marcus

# 4. Start with visualization
docker-compose --profile viz up
```

### Option 2: Manual Integration

If you already have a customized Marcus `docker-compose.yml`:

1. **Add the shared volume** to Marcus service:

```yaml
marcus:
  volumes:
    - ./:/app/config
    - ./logs:/app/logs
    - marcus-data:/app/data  # ADD THIS LINE
```

2. **Add Cato services** (copy from `docker-compose.example.yml`):

```yaml
cato-backend:
  build:
    context: ../cato
    dockerfile: Dockerfile.backend
  profiles:
    - viz
  # ... rest of config

cato-frontend:
  build:
    context: ../cato
    dockerfile: Dockerfile.frontend
  profiles:
    - viz
  # ... rest of config
```

3. **Add the volume definition**:

```yaml
volumes:
  marcus-data:
    name: marcus-data
```

## Verification

### 1. Validate Configuration

```bash
cd /path/to/marcus
docker-compose --profile viz config --quiet
```

Should output: "✓ docker-compose.yml is valid"

### 2. Check Services List

```bash
docker-compose --profile viz config --services
```

Should show:
```
postgres
planka
marcus
cato-backend
cato-frontend
```

### 3. Test Dockerfile Paths

```bash
cd /path/to/marcus
ls ../cato/Dockerfile.backend
ls ../cato/Dockerfile.frontend
```

Both should exist. If not, adjust the `context: ../cato` paths in docker-compose.yml.

## First Run

### Build Images (First Time)

```bash
cd /path/to/marcus
docker-compose --profile viz build
```

This downloads base images and builds Cato containers. Takes 5-10 minutes on first run.

### Start Services

```bash
# Start in foreground (see logs)
docker-compose --profile viz up

# Or start in background
docker-compose --profile viz up -d
```

### Check Service Health

```bash
docker-compose ps
```

All services should show "Up" and "healthy" status.

### Access Services

- **Cato Dashboard**: http://localhost:5173
- **Planka Kanban**: http://localhost:3333 (demo/demo)
- **Marcus API**: http://localhost:4298

## Usage Patterns

### Development Workflow

**Option A: Full Docker Stack**
```bash
docker-compose --profile viz up
# Good for: Testing full integration
```

**Option B: Hybrid (Marcus in Docker, Cato local)**
```bash
# Terminal 1: Marcus only
docker-compose up

# Terminal 2: Cato locally (faster hot-reload)
cd /path/to/cato
./cato start
```

### Production Deployment

```bash
# Build production images
docker-compose --profile viz build

# Start in detached mode
docker-compose --profile viz up -d

# View logs
docker-compose logs -f cato-backend
docker-compose logs -f cato-frontend
```

## Troubleshooting

### "cato-backend" service not starting

**Symptom**: Service exits or doesn't start

**Check**:
```bash
docker-compose logs cato-backend
```

**Common fixes**:
1. Ensure Marcus is running: `docker-compose ps marcus`
2. Check data volume exists: `docker volume ls | grep marcus-data`
3. Verify Marcus has created data: `docker-compose exec marcus ls /app/data`

### "cato-frontend" can't reach backend

**Symptom**: Dashboard shows "Failed to fetch" errors

**Check**:
```bash
# Test backend health
curl http://localhost:4301/health

# Check backend logs
docker-compose logs cato-backend

# Test from container network
docker-compose exec cato-frontend wget -O- http://cato-backend:4301/health
```

### Ports already in use

**Symptom**: "port is already allocated"

**Fix**:
```bash
# Check what's using the port
lsof -i :5173
lsof -i :4301

# Stop conflicting services
./cato stop  # If running locally

# Or change ports in docker-compose.yml:
cato-frontend:
  ports:
    - "8080:5173"  # Use 8080 instead of 5173
```

### Wrong directory structure

**Symptom**: "context: ../cato: no such file or directory"

**Fix**: Adjust paths in docker-compose.yml to match your structure:

```yaml
# If Cato is at /Users/you/projects/cato
# and Marcus is at /Users/you/projects/marcus
cato-backend:
  build:
    context: ../cato  # ✓ Correct

# If different structure, adjust:
cato-backend:
  build:
    context: /absolute/path/to/cato
```

### Data not showing in dashboard

**Symptom**: Dashboard loads but shows no tasks/agents

**Possible causes**:
1. Marcus hasn't executed any tasks yet (no data created)
2. Data volume not shared correctly
3. Backend can't access data

**Debug**:
```bash
# Check if Marcus created data
docker-compose exec marcus ls -la /app/data

# Check if backend can see data
docker-compose exec cato-backend ls -la /app/data

# Check backend logs for errors
docker-compose logs cato-backend | grep -i error
```

## Advanced Configuration

### Custom Ports

Edit `docker-compose.yml`:

```yaml
cato-backend:
  ports:
    - "8080:4301"  # Host:Container

cato-frontend:
  ports:
    - "3000:5173"  # Host:Container
```

### Development Mode with Hot Reload

Mount local source code:

```yaml
cato-backend:
  volumes:
    - marcus-data:/app/data:ro
    - /path/to/cato/backend:/app/backend  # Hot reload backend

cato-frontend:
  # For frontend dev, use npm run dev locally instead
  # Docker nginx build doesn't support hot reload
```

### Production Optimizations

```yaml
cato-backend:
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 512M

cato-frontend:
  deploy:
    resources:
      limits:
        cpus: '0.25'
        memory: 128M
```

## Cleanup

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: deletes data)
docker-compose down -v
```

### Remove Images

```bash
# Remove Cato images
docker rmi marcus-cato-backend
docker rmi marcus-cato-frontend

# Remove all unused images
docker image prune -a
```

## Next Steps

- **[DOCKER.md](DOCKER.md)** - Complete Docker reference
- **[INSTALLATION.md](INSTALLATION.md)** - Local development setup
- **[QUICKSTART.md](QUICKSTART.md)** - CLI commands

## Getting Help

If you encounter issues:

1. Check the logs: `docker-compose logs <service>`
2. Verify configuration: `docker-compose config`
3. See [DOCKER.md](DOCKER.md) troubleshooting section
4. Open an issue on GitHub with:
   - Output of `docker-compose config`
   - Output of `docker-compose logs`
   - Your directory structure
