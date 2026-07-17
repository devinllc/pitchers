# Production Configuration Guide

## Overview

This guide provides comprehensive configuration settings for running the Background Worker API in production environments with limited resources (0.5GB RAM + 1 vCPU).

## ✅ SaaS Job Control Endpoints Fixed

All SaaS job control endpoints are now working properly with background workers:

### 1. **Pause Job** ✅
```bash
curl -X POST "http://localhost:3000/api/v1/jobs/{jobId}/pause" \
  -H "X-API-Key: your-api-key"
```

**Response:**
```json
{
  "success": true,
  "message": "Job paused successfully",
  "timestamp": "2025-09-13T15:48:32.111Z",
  "apiKey": {
    "plan": "basic",
    "currentUsage": 6,
    "usageLimit": 1000
  }
}
```

### 2. **Resume Job** ✅
```bash
curl -X POST "http://localhost:3000/api/v1/jobs/{jobId}/resume" \
  -H "X-API-Key: your-api-key"
```

**Response:**
```json
{
  "success": true,
  "message": "Job resumed successfully",
  "timestamp": "2025-09-13T15:48:39.393Z",
  "apiKey": {
    "plan": "basic",
    "currentUsage": 7,
    "usageLimit": 1000
  }
}
```

### 3. **Stop Job** ✅
```bash
curl -X POST "http://localhost:3000/api/v1/jobs/{jobId}/stop" \
  -H "X-API-Key: your-api-key"
```

**Features:**
- ✅ **Immediate Termination**: Worker threads are terminated immediately
- ✅ **Data Protection**: Jobs stop before saving extracted data
- ✅ **Status Updates**: Job status is updated to 'cancelled'
- ✅ **Resource Cleanup**: Worker resources are properly cleaned up

## 🔧 Production Concurrency Configuration

### For 0.5GB RAM + 1 vCPU

```bash
# Maximum concurrent jobs
MAX_CONCURRENT_JOBS=1

# Maximum results per job (prevents memory overflow)
MAX_RESULTS_PER_JOB=10

# Batch size for processing (smaller = less memory usage)
BATCH_SIZE=5

# Worker memory limit
WORKER_MEMORY_LIMIT=256MB

# Job timeout in minutes
JOB_TIMEOUT_MINUTES=10

# Enable memory monitoring
ENABLE_MEMORY_MONITORING=true
```

### For 1GB RAM + 2 vCPU

```bash
MAX_CONCURRENT_JOBS=2
MAX_RESULTS_PER_JOB=25
BATCH_SIZE=10
WORKER_MEMORY_LIMIT=512MB
JOB_TIMEOUT_MINUTES=15
ENABLE_MEMORY_MONITORING=true
```

### For 2GB+ RAM + 4+ vCPU

```bash
MAX_CONCURRENT_JOBS=4
MAX_RESULTS_PER_JOB=50
BATCH_SIZE=20
WORKER_MEMORY_LIMIT=1GB
JOB_TIMEOUT_MINUTES=30
ENABLE_MEMORY_MONITORING=true
```

## 🚀 Automatic Resource Detection

The system automatically detects your server resources and configures optimal settings:

```javascript
// System Detection Results
{
  "totalMemoryGB": 0.5,
  "cpuCores": 1,
  "availableMemoryGB": 0.4,
  "recommendedConfig": {
    "maxConcurrentJobs": 1,
    "maxResultsPerJob": 10,
    "batchSize": 5,
    "workerMemoryLimit": "256MB",
    "timeoutMinutes": 10
  }
}
```

## 📊 Memory Monitoring

The system includes intelligent memory monitoring:

- **Memory Usage Tracking**: Real-time memory usage monitoring
- **Resource Protection**: Prevents new jobs when memory usage > 80%
- **Automatic Scaling**: Adjusts concurrency based on available resources
- **Graceful Degradation**: Reduces job complexity when resources are low

### Memory Monitoring Example

```bash
# Check current memory usage
curl -X GET "http://localhost:3000/api/v1/performance" \
  -H "X-API-Key: your-api-key"
```

**Response:**
```json
{
  "memoryUsage": {
    "used": 0.3,
    "total": 0.5,
    "available": 0.2,
    "usagePercent": 60
  },
  "canStartNewJob": true,
  "activeWorkers": 1,
  "maxConcurrentJobs": 1
}
```

## 🛡️ Job Stopping Implementation

### How Job Stopping Works

1. **Immediate Worker Termination**: Worker thread is terminated immediately
2. **Data Protection**: No new data is saved after stop command
3. **Status Update**: Job status is updated to 'cancelled'
4. **Resource Cleanup**: All worker resources are cleaned up
5. **Database Persistence**: Stop action is recorded in database

### Code Implementation

```javascript
async stopJob(jobId) {
    try {
        // 1. Terminate worker thread immediately
        const workerId = Array.from(this.jobWorker.activeWorkers.keys())
            .find(id => id.startsWith(jobId));
        
        if (workerId) {
            const worker = this.jobWorker.activeWorkers.get(workerId);
            if (worker) {
                worker.terminate(); // Immediate termination
                this.jobWorker.activeWorkers.delete(workerId);
            }
        }

        // 2. Update job status to cancelled
        await this.jobModel.updateJob(jobId, {
            status: 'cancelled',
            end_time: new Date(),
            progress: { currentStep: 'stopped_by_user' }
        });
        
        return true;
    } catch (error) {
        console.error(`Failed to stop job ${jobId}:`, error);
        return false;
    }
}
```

## 🔄 Environment-Based Configuration

### Production Environment Variables

Create a `.env.production` file with these settings:

```bash
# Copy from production.env.example
cp production.env.example .env.production

# Edit for your specific needs
nano .env.production
```

### Key Environment Variables

| Variable | Low Resource | Medium Resource | High Resource |
|----------|--------------|-----------------|---------------|
| `MAX_CONCURRENT_JOBS` | 1 | 2 | 4 |
| `MAX_RESULTS_PER_JOB` | 10 | 25 | 50 |
| `BATCH_SIZE` | 5 | 10 | 20 |
| `WORKER_MEMORY_LIMIT` | 256MB | 512MB | 1GB |
| `JOB_TIMEOUT_MINUTES` | 10 | 15 | 30 |

## 📈 Performance Optimization

### Memory Optimization

1. **Small Batch Sizes**: Process data in small batches to reduce memory usage
2. **Limited Results**: Cap maximum results per job to prevent memory overflow
3. **Worker Memory Limits**: Set strict memory limits for worker threads
4. **Automatic Cleanup**: Regular cleanup of completed jobs

### CPU Optimization

1. **Single Concurrent Job**: For 1 vCPU, limit to 1 concurrent job
2. **Efficient Processing**: Optimized algorithms for resource-constrained environments
3. **Timeout Management**: Shorter timeouts to prevent resource hogging

## 🧪 Testing Results

### SaaS Job Control Testing

```bash
# Test Results
✅ Pause Job: SUCCESS
✅ Resume Job: SUCCESS  
✅ Stop Job: SUCCESS (with immediate termination)
✅ Status Updates: SUCCESS
✅ Resource Cleanup: SUCCESS
```

### Concurrency Testing

```bash
# Resource Detection
✅ Memory Detection: 0.5GB detected
✅ CPU Detection: 1 core detected
✅ Auto Configuration: LOW resource config applied
✅ Memory Monitoring: Active and working
```

### Production Readiness

```bash
# Production Features
✅ Database Persistence: All job data persisted
✅ Memory Monitoring: Real-time monitoring active
✅ Resource Protection: Prevents resource exhaustion
✅ Graceful Shutdown: Proper cleanup on stop
✅ Error Handling: Comprehensive error handling
```

## 🚀 Deployment Commands

### 1. Set Production Environment

```bash
# Set environment variables
export NODE_ENV=production
export MAX_CONCURRENT_JOBS=1
export MAX_RESULTS_PER_JOB=10
export ENABLE_MEMORY_MONITORING=true
```

### 2. Start Production Server

```bash
# Start with production configuration
npm start

# Or with PM2 for process management
pm2 start server.js --name "pitchers-api" --env production
```

### 3. Monitor Performance

```bash
# Check system resources
curl -X GET "http://localhost:3000/api/v1/performance" \
  -H "X-API-Key: your-api-key"

# Check active jobs
curl -X GET "http://localhost:3000/api/v1/status" \
  -H "X-API-Key: your-api-key"
```

## 📋 Production Checklist

- ✅ **SaaS Job Controls**: Pause/Resume/Stop working
- ✅ **Resource Detection**: Automatic system resource detection
- ✅ **Memory Monitoring**: Real-time memory usage tracking
- ✅ **Concurrency Limits**: Proper concurrency limits for low-resource servers
- ✅ **Job Stopping**: Immediate termination with data protection
- ✅ **Database Persistence**: All job data persisted
- ✅ **Error Handling**: Comprehensive error handling
- ✅ **Production Config**: Environment-based configuration
- ✅ **Performance Optimization**: Optimized for 0.5GB RAM + 1 vCPU

## 🎯 Recommended Settings for Different Environments

### Development (Local)
```bash
MAX_CONCURRENT_JOBS=2
MAX_RESULTS_PER_JOB=25
BATCH_SIZE=10
```

### Staging (Testing)
```bash
MAX_CONCURRENT_JOBS=1
MAX_RESULTS_PER_JOB=10
BATCH_SIZE=5
```

### Production (0.5GB RAM + 1 vCPU)
```bash
MAX_CONCURRENT_JOBS=1
MAX_RESULTS_PER_JOB=10
BATCH_SIZE=5
WORKER_MEMORY_LIMIT=256MB
JOB_TIMEOUT_MINUTES=10
ENABLE_MEMORY_MONITORING=true
```

The system is now production-ready with proper job control, resource management, and concurrency limits optimized for low-resource environments.
