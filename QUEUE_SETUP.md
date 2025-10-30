# BullMQ Queue Setup Guide

This project now supports two execution modes:

1. **Queue Mode (Default)** - Run via BullMQ with automatic scheduling and worker processing
2. **CLI Mode** - Bypass queue and run imports directly from command line

## Quick Start

### Prerequisites

You need Redis running for the BullMQ worker:

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or install locally
brew install redis  # macOS
# redis-server      # Start Redis
```

### Environment Variables

Add to your `.env`:

```bash
# Redis configuration (optional, defaults shown)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=  # Optional

# Existing environment variables still apply
RUN_MODE=delta
PRODUCTS_LIMIT=0
OUT_DIR_BASE=out
# ... etc
```

## Usage

### 1. Queue Mode (Default - Recommended)

The main entry point automatically sets up recurring jobs and starts the worker:

```bash
# Build and start the application
npm run build && npm start

# Or in one command
npm run dev
```

This will:
- Automatically upsert recurring job schedules for all categories
- Start the worker to process jobs
- Listen on port 8080 for health checks

#### Manual Scheduling (Optional)

If you need to customize schedules, you can run the scheduler separately:

```bash
npm run scheduler
```

This schedules daily imports at 2 AM for all categories:
- `pharmacy` - All pharmacy sites
- `electronics` - All electronics sites  
- `all` - All sites

Customize the schedule:

```bash
# Schedule only pharmacy category
npm run scheduler -- --category pharmacy

# Use custom cron pattern (e.g., daily at midnight)
npm run scheduler -- --cron "0 0 * * *"

# Change run mode
npm run scheduler -- --mode full

# Combine options
npm run scheduler -- --category electronics --cron "0 3 * * *" --mode delta
```

### 2. CLI Mode (Direct Execution)

Bypass the queue and run imports directly:

```bash
# Single site
npm run build && npm run cli -- --site elgiganten

# Multiple sites
npm run build && npm run cli -- --sites apotea,elgiganten

# With options
npm run cli -- --site elgiganten --mode full --limit 100
```

This bypasses the BullMQ queue entirely and runs the import directly.

#### One-Time Jobs

Schedule a one-time job programmatically:

```typescript
import { createImportQueue, scheduleOneTimeImport } from './core/services/queue';

const queue = createImportQueue();

// Run specific sites
await scheduleOneTimeImport(queue, {
  siteKeys: ['apotea', 'elgiganten'],
  runMode: 'delta',
});

// Run a category
await scheduleOneTimeImport(queue, {
  category: 'pharmacy',
  runMode: 'full',
  productsLimit: 1000,
});
```

## Architecture

### Components

1. **`src/index.ts`** (Main Entry Point)
   - Primary application entry point
   - Automatically upserts recurring jobs
   - Starts the worker to process jobs
   - Health check endpoint on port 8080

2. **`src/core/services/import-service.ts`**
   - Core import orchestration logic
   - Can be called from CLI or worker
   - Handles site scheduling and chunking

3. **`src/core/services/queue.ts`**
   - BullMQ queue configuration
   - Job scheduling utilities
   - Redis connection setup

4. **`src/worker.ts`**
   - Standalone worker process (if run separately)
   - Processes jobs from queue
   - Health check endpoint on port 8081

5. **`src/cli.ts`**
   - Direct CLI execution bypassing the queue
   - Useful for testing and development

6. **`src/scheduler.ts`**
   - Manual scheduler configuration
   - CLI for customizing schedules
   - Lists current scheduled jobs

### How It Works

```
Queue Mode (npm start):
┌──────────────────────────────────────┐
│     src/index.ts (Main Entry)        │
│  - Upserts recurring jobs            │
│  - Starts worker                     │
└─────────────────┬────────────────────┘
                  ▼
       ┌──────────────────────────┐
       │   BullMQ Queue (Redis)   │
       └────────┬─────────────────┘
                │
                ▼
       ┌──────────────────────────┐
       │     Worker Process       │
       └────────┬─────────────────┘
                ▼
       ┌──────────────────────────┐
       │   Import Service         │
       │   (runImport function)   │
       └────────┬─────────────────┘
                ▼
       ┌──────────────────────────┐
       │   Sites (Adapters)       │
       │   - Pharmacy             │
       │   - Electronics          │
       └──────────────────────────┘

CLI Mode (npm run cli):
┌─────────────────────┐
│   src/cli.ts        │
│  Bypasses queue     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Import Service     │ (Direct execution)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Sites (Adapters)   │
└─────────────────────┘
```

## Monitoring

### Health Checks

Both CLI and worker expose health check endpoints:

- CLI: `http://localhost:8080/healthz`
- Worker: `http://localhost:8081/healthz`

### Redis Commands

Inspect the queue from Redis CLI:

```bash
redis-cli

# List all keys
KEYS *

# Get job count
LLEN bull:import-jobs:waiting
LLEN bull:import-jobs:active
LLEN bull:import-jobs:completed
LLEN bull:import-jobs:failed

# Get repeatable jobs
KEYS bull:import-jobs:*repeat*

# Monitor queue activity
MONITOR
```

### Bull Board (Optional)

For a better UI, install Bull Board:

```bash
npm install @bull-board/express @bull-board/api
```

Then create a dashboard:

```typescript
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { createImportQueue } from './core/services/queue';

const serverAdapter = new ExpressAdapter();
const queue = createImportQueue();

createBullBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

serverAdapter.setBasePath('/admin/queues');
app.use('/admin/queues', serverAdapter.getRouter());
```

## Deployment

### Production Setup

#### Single Application (Recommended)

The main entry point handles everything:

```bash
npm run build
npm start
```

#### Multiple Workers for Parallelism

Scale horizontally by running multiple instances:

```bash
npm install -g pm2

# Start multiple application instances
pm2 start dist/index.js -i 3 --name import-app

# Monitor
pm2 monit
```

#### Legacy Separate Processes

If you prefer separate processes:

```bash
# Start multiple workers
pm2 start dist/worker.js -i 3 --name import-workers

# Schedule jobs (run once)
pm2 start dist/scheduler.js --name scheduler --no-autorestart
```

### Docker Compose

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  
  app:
    build: .
    command: npm start
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
    deploy:
      replicas: 3  # Scale to multiple instances
```

## Migration from CLI to Queue

Your existing scripts continue to work. The queue system is additive:

- ✅ CLI mode still available via `npm run cli`
- ✅ Same import logic shared between CLI and queue modes
- ✅ Queue mode is now the default (`npm start`)
- ✅ Automatic recurring job scheduling
- ✅ Built-in worker processing
- ✅ Health checks and monitoring

## Troubleshooting

### Application not processing jobs

1. Check Redis is running: `redis-cli ping` (should return PONG)
2. Check application is connected: Look for "Application is ready and listening for jobs"
3. Verify jobs are scheduled: `redis-cli KEYS bull:import-jobs:*`
4. Check health endpoint: `curl http://localhost:8080/healthz`

### Jobs failing

Check worker logs for error details. Failed jobs are kept for 7 days with retry backoff.

### Jobs not scheduled

Run scheduler again: `npm run scheduler`. Check output for errors.

### Stale jobs

Remove all jobs: `redis-cli FLUSHALL` (⚠️ deletes all data)

Remove specific repeatable jobs: Use `npm run scheduler` and look for "Total scheduled jobs" count.

