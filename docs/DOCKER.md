# Docker Deployment Guide

Cato can be deployed with Docker as part of the Marcus stack or standalone.

## Quick Start with Marcus

The easiest way to run Cato is with the Marcus Docker Compose stack:

```bash
cd /path/to/marcus

# Start Marcus only (default)
docker-compose up

# Start Marcus + Cato visualization
docker-compose --profile viz up
```

Access the dashboard at: **http://localhost:5173**

## Setup Instructions

### 1. Add Cato to Marcus docker-compose.yml

Copy the example configuration to your Marcus repository:

```bash
# From the Cato repository
cp docs/docker-compose.example.yml /path/to/marcus/docker-compose.yml
```

Or manually add the Cato services to your existing `docker-compose.yml`. See [`docker-compose.example.yml`](docker-compose.example.yml) for the complete configuration.

### 2. Verify Directory Structure

Ensure your directories are organized as expected:

```
/your/workspace/
├── marcus/                    # Marcus repository
│   └── docker-compose.yml    # With Cato services added
└── cato/                      # Cato repository
    ├── Dockerfile.backend
    └── Dockerfile.frontend
```

If your structure differs, adjust the `context` paths in docker-compose.yml:

```yaml
cato-backend:
  build:
    context: ../cato  # Path from Marcus repo to Cato repo
```

### 3. Start Services

```bash
cd /path/to/marcus
docker-compose --profile viz up
```

## Architecture

When using Docker, Cato integrates with Marcus through:

1. **Shared Docker Network** (`marcus-network`) - All services can communicate
2. **Shared Data Volume** (`marcus-data`) - Cato reads Marcus execution data
3. **Service Dependencies** - Cato starts after Marcus is ready

```
┌─────────────────────────────────────────────────┐
│              Marcus Docker Network              │
├─────────────┬─────────────┬─────────────────────┤
│  PostgreSQL │   Planka    │      Marcus         │
│   (DB)      │  (Kanban)   │  (Orchestrator)     │
└─────────────┴─────────────┴──────┬──────────────┘
                                   │
                          marcus-data (volume)
                                   │
                    ┌──────────────┴──────────────┐
                    │         Cato Stack          │
                    │  (--profile viz)            │
                    ├─────────────┬───────────────┤
                    │ cato-backend│ cato-frontend │
                    │  (FastAPI)  │    (Nginx)    │
                    │   :4301     │    :5173      │
                    └─────────────┴───────────────┘
```

## Usage Patterns

### 1. Production Deployment (Recommended)

Start the full stack with visualization:

```bash
cd /path/to/marcus
docker-compose --profile viz up -d

# View logs
docker-compose logs -f cato-backend
docker-compose logs -f cato-frontend

# Check status
docker-compose ps
```

**Services:**
- Marcus: http://localhost:4298
- Planka: http://localhost:3333
- Cato Dashboard: http://localhost:5173
- Cato API: http://localhost:4301

### 2. Marcus Only (No Visualization)

```bash
docker-compose up
```

Cato services won't start (they're in the `viz` profile).

### 3. Development Mode (Hybrid)

Run Marcus in Docker, Cato locally for faster iteration:

```bash
# Terminal 1: Start Marcus stack
cd /path/to/marcus
docker-compose up

# Terminal 2: Run Cato locally
cd /path/to/cato
./cato start
```

**Why?** Frontend hot-reload is faster, backend restarts are quicker.

## Docker Commands

### Build Images

```bash
cd /path/to/marcus

# Build only Cato images
docker-compose --profile viz build cato-backend cato-frontend

# Build all images including Marcus
docker-compose --profile viz build
```

### Start Services

```bash
# Start in foreground (see logs)
docker-compose --profile viz up

# Start in background (detached)
docker-compose --profile viz up -d

# Start specific services
docker-compose up cato-backend
```

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: deletes data)
docker-compose down -v

# Stop only Cato services
docker-compose stop cato-backend cato-frontend
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f cato-backend

# Last 100 lines
docker-compose logs --tail=100 cato-frontend
```

### Restart Services

```bash
# Restart specific service
docker-compose restart cato-backend

# Restart all services
docker-compose restart
```

## Configuration

### Environment Variables

Cato backend accepts these environment variables:

```yaml
environment:
  - PYTHONUNBUFFERED=1        # Enable Python logging
  - LOG_LEVEL=INFO            # Set log level
  - MARCUS_DATA_PATH=/app/data # Override data path
```

### Build Arguments

Frontend build-time configuration:

```bash
docker-compose build \
  --build-arg VITE_API_URL=http://localhost:4301 \
  --build-arg VITE_DATA_MODE=live \
  cato-frontend
```

### Port Mapping

Change ports in `docker-compose.yml`:

```yaml
cato-backend:
  ports:
    - "8080:4301"  # Host:Container

cato-frontend:
  ports:
    - "3000:5173"  # Host:Container
```

## Volumes

### Data Volume

Marcus and Cato share the `marcus-data` volume:

```yaml
volumes:
  marcus-data:
    name: marcus-data
```

**Marcus** writes to `/app/data` → **Cato** reads from `/app/data:ro` (read-only)

### Development Volumes

Mount local code for live development:

```yaml
cato-backend:
  volumes:
    - ../cato/backend:/app/backend
    - ../marcus:/marcus  # Local Marcus for development
```

## Networking

All services run on the `marcus-network` bridge network:

```yaml
networks:
  marcus-network:
    driver: bridge
```

**Internal communication:**
- `http://cato-backend:4301` - Backend API
- `http://marcus:4298` - Marcus service
- `http://planka:1337` - Planka API

**External access:**
- `http://localhost:5173` - Cato dashboard
- `http://localhost:4301` - Cato API
- `http://localhost:3333` - Planka UI

## Health Checks

Both Cato services have health checks:

```yaml
cato-backend:
  healthcheck:
    test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:4301/health')"]
    interval: 30s
    timeout: 10s
    retries: 3

cato-frontend:
  healthcheck:
    test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:5173/"]
    interval: 30s
    timeout: 10s
    retries: 3
```

Check health status:

```bash
docker-compose ps
```

## Troubleshooting

### Cato services won't start

**Symptom:** `docker-compose up` doesn't start Cato

**Solution:** Use the `viz` profile:
```bash
docker-compose --profile viz up
```

### Backend can't connect to Marcus data

**Symptom:** "No such file or directory: /app/data"

**Solution:** Ensure Marcus service has the data volume:
```yaml
marcus:
  volumes:
    - marcus-data:/app/data
```

### Frontend can't reach backend

**Symptom:** API requests fail from dashboard

**Check:**
1. Backend is healthy: `docker-compose ps cato-backend`
2. Network connectivity: `docker-compose exec cato-frontend wget -O- http://cato-backend:4301/health`

### Port conflicts

**Symptom:** "port is already allocated"

**Solutions:**
1. Stop conflicting service: `lsof -i :5173`
2. Change port mapping in `docker-compose.yml`
3. Stop local Cato: `./cato stop`

### Images won't build

**Symptom:** Build failures

**Solutions:**
```bash
# Clear Docker cache
docker-compose build --no-cache cato-backend

# Check Dockerfile syntax
docker build -f Dockerfile.backend .

# Ensure Cato directory is at correct path
ls ../cato/Dockerfile.backend
```

## Advanced Usage

### Custom Marcus Image

Use a custom Marcus image with Cato:

```yaml
marcus:
  image: my-custom-marcus:latest
  # or build from local
  build:
    context: .
    dockerfile: Dockerfile
```

### Multi-Environment Setup

Create environment-specific compose files:

**docker-compose.prod.yml:**
```yaml
version: "3.8"

services:
  cato-backend:
    image: ghcr.io/yourusername/cato-backend:latest

  cato-frontend:
    image: ghcr.io/yourusername/cato-frontend:latest
```

Use:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml --profile viz up
```

### Resource Limits

Add resource constraints:

```yaml
cato-backend:
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 512M
      reservations:
        cpus: '0.25'
        memory: 256M
```

## Security Considerations

1. **Data Volume Read-Only:** Cato mounts `marcus-data:ro` (read-only) for safety
2. **Network Isolation:** All services in private `marcus-network`
3. **No Root:** Containers run as non-root users where possible
4. **Security Headers:** Frontend nginx adds security headers

## Performance Optimization

### Frontend Build Optimization

The multi-stage Dockerfile optimizes the frontend:

- **Stage 1 (Builder):** Builds React app (large, slow)
- **Stage 2 (Runtime):** Serves with nginx (tiny, fast)

**Image size:** ~25MB (nginx) vs ~500MB+ (Node)

### Backend Caching

Layer caching speeds up builds:

```dockerfile
# Install dependencies first (cached)
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy code last (changes often)
COPY backend/ .
```

### Nginx Compression

Frontend enables gzip compression:

```nginx
gzip on;
gzip_types text/plain text/css application/javascript;
```

## CI/CD Integration

### Build in CI

```yaml
# .github/workflows/build.yml
- name: Build Cato images
  run: |
    cd marcus
    docker-compose --profile viz build cato-backend cato-frontend
```

### Push to Registry

```bash
# Tag images
docker tag cato-backend:latest ghcr.io/yourusername/cato-backend:latest

# Push
docker push ghcr.io/yourusername/cato-backend:latest
```

## Next Steps

- See [INSTALLATION.md](INSTALLATION.md) for local development setup
- See [QUICKSTART.md](QUICKSTART.md) for CLI usage
- See [DASHBOARD.md](DASHBOARD.md) for features
