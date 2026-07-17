# Container Deployment Fix Guide

## Problem: SIGTERM Error in Container

The error you encountered:
```
npm error command failed
npm error signal SIGTERM
npm error command sh -c node --expose-gc --max-old-space-size=512 server.js
```

## Root Cause

1. **Memory Limit Too Low**: `--max-old-space-size=512` (512MB) is insufficient for:
   - Background worker threads
   - Puppeteer + Chrome instances
   - Multiple concurrent jobs
   - Database connections

2. **Missing Environment Variables**: Container didn't have proper concurrency configuration

## Solution Applied

### 1. Updated Memory Configuration

**Before:**
```json
"start": "node --expose-gc --max-old-space-size=512 server.js"
```

**After:**
```json
"start": "node --expose-gc server.js"
```

### 2. Added Production Environment Variables

**render.yaml:**
```yaml
envVars:
  - key: MAX_CONCURRENT_JOBS
    value: "1"
  - key: JOB_TIMEOUT_MINUTES
    value: "30"
  - key: ENABLE_MEMORY_MONITORING
    value: "true"
```

### 3. Added Production Start Script

```json
"start:production": "node --expose-gc server.js"
```

## Memory Requirements

| Component | Memory Usage |
|-----------|-------------|
| Node.js Base | ~100MB |
| Express Server | ~50MB |
| Database Connections | ~20MB |
| Background Workers | ~200MB each |
| Puppeteer + Chrome | ~300MB each |
| **Total (1 job)** | ~670MB |
| **Total (2 jobs)** | ~970MB |

## Recommended Settings

### For Any RAM Container:
```bash
MAX_CONCURRENT_JOBS=1  # Adjust based on your needs
# No memory limits - let Node.js handle it automatically
```

## Deployment Checklist

- [ ] No artificial memory limits (Node.js default)
- [ ] MAX_CONCURRENT_JOBS configured
- [ ] Environment variables set in container
- [ ] Health check endpoint working
- [ ] Database connection tested
- [ ] Background workers tested

## Testing Locally

```bash
# Test with default Node.js memory management
node --expose-gc server.js

# Test background workers
curl -X POST "http://localhost:3000/api/v1/search-service" \
  -H "X-API-Key: your-api-key" \
  -d '{"city": "test", "keyword": "test"}'
```

## Monitoring

Watch for these signs of memory issues:
- SIGTERM errors
- Container restarts
- Slow response times
- High memory usage in logs

## Next Steps

1. Deploy with updated configuration
2. Monitor memory usage
3. Adjust MAX_CONCURRENT_JOBS based on performance
4. Set up proper logging and monitoring
