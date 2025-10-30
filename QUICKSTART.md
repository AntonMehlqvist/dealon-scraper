# Quick Start Guide

## Installation

```bash
npm install
```

## Start Redis

```bash
# Using Docker (recommended)
docker run -d -p 6379:6379 redis:7-alpine

# Or locally
brew install redis  # macOS
redis-server        # Start Redis
```

## Running the Application

### Queue Mode (Default)

Start the application with automatic job scheduling and worker:

```bash
npm run build
npm start
```

This will:
- ✅ Upsert recurring import schedules for all categories
- ✅ Start the worker to process jobs
- ✅ Run daily at 2 AM automatically
- ✅ Listen on port 8080 for health checks

### CLI Mode (Direct Execution)

For testing or one-off imports, bypass the queue:

```bash
# Build first
npm run build

# Run a single site
npm run cli -- --site elgiganten

# Run multiple sites
npm run cli -- --sites apotea,elgiganten

# With options
npm run cli -- --site apotea --mode full --limit 100

# List available sites
npm run cli -- --list
```

### Category Imports

```bash
npm run start-all        # All categories
npm run start-pharmacy   # Pharmacy sites only
npm run start-electronics # Electronics sites only
```

## Available NPM Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Main entry point (queue mode) |
| `npm run cli` | Direct CLI execution |
| `npm run dev` | Build and start in one command |
| `npm run worker` | Run worker only (standalone) |
| `npm run scheduler` | Configure recurring jobs only |
| `npm run help` | Show CLI help |

## Environment Variables

Add to `.env`:

```bash
# Redis (optional, defaults shown)
REDIS_HOST=localhost
REDIS_PORT=6379

# Import settings
RUN_MODE=delta          # full, delta, or refresh
PRODUCTS_LIMIT=0        # 0 = no limit
OUT_DIR_BASE=out

# Database
DB_PATH=state/data.sqlite

# Health check
HEALTH_PORT=8080
```

See `.example.env` for all available options.

## Architecture

```
npm start (Main Entry):
  └─> src/index.ts
      ├─> Upserts recurring jobs
      ├─> Starts worker
      └─> Processes jobs via queue

npm run cli (Direct):
  └─> src/cli.ts
      └─> Runs import directly (no queue)
```

## Monitoring

```bash
# Health check
curl http://localhost:8080/healthz

# Redis queue status
redis-cli KEYS bull:import-jobs:*

# Check logs
tail -f logs/app.log
```

## Troubleshooting

### Application won't start

1. Check Redis is running: `redis-cli ping`
2. Verify environment variables in `.env`
3. Check logs for errors

### Jobs not processing

1. Verify jobs are scheduled: `npm run scheduler`
2. Check worker is running: Look for "Application is ready"
3. Check health endpoint: `curl http://localhost:8080/healthz`

### Import errors

1. Check site configuration in `src/sites/`
2. Verify network connectivity
3. Review logs for specific error messages

## Next Steps

- Read `QUEUE_SETUP.md` for detailed documentation
- Customize schedules with `npm run scheduler`
- Scale horizontally with PM2 or Docker

