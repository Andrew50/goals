# Parallel E2E Testing Setup

This document describes the new parallel E2E testing setup that reduces test execution time from ~3 hours to under 1 hour by running tests across multiple isolated workers.

## Overview

The parallel testing setup solves the following problems:
- **Long test execution times**: Previously ~3 hours, now ~45 minutes with 4 workers
- **Database interference**: Each worker gets its own isolated Neo4j database instance
- **Port conflicts**: Each worker runs on separate ports for frontend, backend, and database
- **State isolation**: No shared state between workers

## Architecture

### Worker Isolation
Each worker gets:
- **Unique ports**: Frontend (3031+N), Backend (5057+N), Database (7688+N)
- **Isolated database**: Separate Neo4j instance with fresh test data
- **Separate Docker network**: No cross-worker communication
- **Independent environment**: Own storage state and test data

### Port Allocation
- **Worker 0**: Frontend 3031, Backend 5057, DB 7688
- **Worker 1**: Frontend 3032, Backend 5058, DB 7689
- **Worker 2**: Frontend 3033, Backend 5059, DB 7690
- **Worker 3**: Frontend 3034, Backend 5060, DB 7691

## Quick Start

### 1. Start Parallel Test Environment
```bash
# Start 4 workers (default)
./start-parallel-test-env.sh

# Or specify number of workers
NUM_WORKERS=6 ./start-parallel-test-env.sh
```

### 2. Run Tests
```bash
# Run tests across all workers
./run-parallel-tests.sh

# Or use npm script
cd frontend
npm run test:e2e:parallel
```

### 3. Cleanup
```bash
./cleanup-parallel-test-env.sh
```

## Detailed Usage

### Environment Setup Script

**`start-parallel-test-env.sh`**
- Creates isolated Docker environments for each worker
- Starts Neo4j databases, backends, and frontends
- Seeds each database with fresh test data
- Performs health checks on all services
- Runs worker setup in parallel for faster startup

### Test Runner Script

**`run-parallel-tests.sh`**
- Validates all workers are ready
- Distributes tests across workers
- Sets worker-specific environment variables
- Runs tests in parallel with isolated outputs
- Collects results from all workers

### Cleanup Script

**`cleanup-parallel-test-env.sh`**
- Stops all Docker containers
- Removes networks and volumes
- Cleans up temporary compose files
- Runs cleanup in parallel for speed

## Configuration

### Environment Variables

- `NUM_WORKERS`: Number of parallel workers (default: 4)
- `BASE_FRONTEND_PORT`: Starting port for frontends (default: 3031)
- `BASE_BACKEND_PORT`: Starting port for backends (default: 5057)
- `BASE_DB_BOLT_PORT`: Starting port for databases (default: 7688)

### Playwright Configuration

The `playwright.config.ts` has been updated to:
- Support multiple workers in CI (`workers: 4`)
- Use worker-specific base URLs
- Handle worker-specific storage states
- Remove the webServer config (handled externally)

## CI/CD Integration

### GitHub Actions

The workflow `.github/workflows/e2e-tests.yml` now:
- Accepts `num_workers` input parameter
- Uses the parallel test environment scripts
- Combines test reports from all workers
- Uploads comprehensive test artifacts
- Has reduced timeout (60 minutes vs default)

### Usage in CI
```yaml
uses: ./.github/workflows/e2e-tests.yml
with:
  num_workers: 4  # Adjust based on runner capacity
```

## Performance Benefits

### Time Reduction
- **Before**: ~3 hours sequential execution
- **After**: ~45 minutes with 4 workers
- **Scaling**: Near-linear improvement with more workers

### Resource Usage
- **Memory**: ~2GB per worker (8GB total for 4 workers)
- **CPU**: Better utilization across cores
- **Network**: Isolated networks prevent interference

## Troubleshooting

### Common Issues

1. **Port conflicts**
   ```bash
   # Check what's using ports
   netstat -tulpn | grep :3031
   
   # Kill processes if needed
   pkill -f "node.*3031"
   ```

2. **Database connection failures**
   ```bash
   # Check database logs for specific worker
   docker compose -f docker-compose.worker-0.yaml logs goals_db_test_worker_0
   ```

3. **Worker not ready**
   ```bash
   # Check all services for a worker
   docker compose -f docker-compose.worker-0.yaml ps
   ```

### Debug Mode

Run tests with debug output:
```bash
cd frontend
npm run test:e2e:parallel:debug
```

View worker-specific logs:
```bash
# Check worker logs
tail -f frontend/test-results-worker-0/output.log
```

## Best Practices

### Test Design
- **Stateless tests**: Don't rely on test execution order
- **Clean slate**: Each test should work with fresh data
- **Idempotent**: Tests should produce same results when re-run
- **Isolated**: No dependencies between test files

### Resource Management
- **Monitor memory**: Each worker uses ~2GB RAM
- **Adjust workers**: Reduce if system becomes unstable
- **Clean regularly**: Run cleanup between test sessions

### Development Workflow
```bash
# Quick development cycle
./start-parallel-test-env.sh
cd frontend
npm run test:e2e:parallel:debug  # See real-time output
./cleanup-parallel-test-env.sh
```

## Monitoring

### Test Results
Each worker generates separate results:
- `frontend/test-results-worker-0/`
- `frontend/test-results-worker-1/`
- etc.

### Combined Reports
The CI system combines all worker reports into:
- `frontend/playwright-report-combined/`

### Performance Metrics
Track these metrics to optimize:
- Total execution time
- Memory usage per worker
- Test distribution across workers
- Failure rates by worker

## Future Improvements

### Auto-scaling
- Detect system resources
- Dynamically adjust worker count
- Load balancing based on test complexity

### Test Distribution
- Intelligent test assignment
- Faster tests on more workers
- Historical performance data

### Enhanced Isolation
- Container-based worker isolation
- Network segmentation
- Resource quotas per worker

## Migration Guide

### From Single Worker
1. Update your CI configuration
2. Use new scripts instead of old docker-compose commands
3. Update test result collection logic
4. Adjust timeouts (can be more aggressive)

### Configuration Changes
```yaml
# Old
workers: process.env.CI ? 1 : undefined

# New  
workers: process.env.CI ? 4 : undefined
```

### Script Usage
```bash
# Old
docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d
cd frontend && npx playwright test

# New
./start-parallel-test-env.sh
./run-parallel-tests.sh
```

## Support

For issues with the parallel testing setup:
1. Check the troubleshooting section above
2. Verify all scripts are executable (`chmod +x *.sh`)
3. Ensure sufficient system resources (8GB+ RAM for 4 workers)
4. Review Docker and network configuration

The parallel setup maintains full compatibility with existing tests while dramatically improving execution speed. 