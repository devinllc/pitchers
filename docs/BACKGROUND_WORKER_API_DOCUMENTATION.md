# Background Worker API Documentation

## Overview

The Background Worker API provides a robust, database-persistent job processing system for lead generation. Jobs run in isolated worker threads, enabling concurrent processing with real-time progress tracking and comprehensive job management.

## Key Features

- ✅ **Database Persistence**: All job data is stored in PostgreSQL, not memory
- ✅ **Concurrent Processing**: Multiple jobs can run simultaneously (max 5 concurrent)
- ✅ **Real-time Progress Tracking**: Live updates on job progress and statistics
- ✅ **Worker Thread Isolation**: Jobs run in separate threads to prevent blocking
- ✅ **Comprehensive Job Management**: Create, monitor, cancel, and track jobs
- ✅ **User Security**: Users can only access their own jobs
- ✅ **Automatic Cleanup**: Old completed jobs are automatically cleaned up

## Base URL

```
http://localhost:3000/background-jobs
```

## Authentication

All endpoints require user email authentication via header:

```http
X-User-Email: your-email@example.com
```

## API Endpoints

### 1. Create Job

**POST** `/create`

Creates a new background job and starts processing immediately.

#### Request Body

```json
{
  "city": "mumbai",
  "keyword": "restaurant",
  "method": "web",
  "maxResults": 50,
  "wantEmail": false,
  "emailDeepPaths": false
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `city` | string | ✅ | City name for lead generation |
| `keyword` | string | ✅ | Business keyword to search for |
| `method` | string | ❌ | Processing method: `"web"` or `"api"` (default: `"web"`) |
| `maxResults` | number | ❌ | Maximum number of results (default: 50) |
| `wantEmail` | boolean | ❌ | Whether to extract emails (default: false) |
| `emailDeepPaths` | boolean | ❌ | Whether to do deep email extraction (default: false) |

#### Response

```json
{
  "success": true,
  "jobId": "job_1757778168502_01toou7",
  "status": "started",
  "message": "Lead generation job initiated",
  "city": "mumbai",
  "keyword": "restaurant",
  "userEmail": "rameshnda09@gmail.com",
  "workerStats": {
    "activeWorkers": 1,
    "maxConcurrentJobs": 5,
    "queueLength": 0
  }
}
```

#### Example Request

```bash
curl -X POST "http://localhost:3000/background-jobs/create" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: rameshnda09@gmail.com" \
  -d '{
    "city": "mumbai",
    "keyword": "restaurant",
    "method": "web",
    "maxResults": 50,
    "wantEmail": false
  }'
```

### 2. Get Job Status

**GET** `/{jobId}/status`

Retrieves the current status and progress of a specific job.

#### Response

```json
{
  "success": true,
  "job": {
    "jobId": "job_1757778168502_01toou7",
    "userEmail": "rameshnda09@gmail.com",
    "city": "mumbai",
    "keyword": "restaurant",
    "method": "web",
    "status": "processing",
    "progress": {
      "currentStep": "processing_phrases",
      "totalPhrases": 290,
      "currentPhrase": "Restaurants near me",
      "processedPhrases": 0,
      "phrasesProgress": 0,
      "saveSuccessRate": 0
    },
    "statistics": {
      "errors": [],
      "saveStats": {
        "bothFailed": 0,
        "postgresql": {
          "failed": 0,
          "success": 0
        },
        "googleSheets": {
          "failed": 0,
          "success": 0
        },
        "bothSucceeded": 0,
        "partialSuccess": 0
      },
      "totalErrors": 0
    },
    "createdAt": "2025-09-13T10:12:49.688Z",
    "updatedAt": "2025-09-13T10:13:05.827Z",
    "error": null,
    "duration": 19826519
  },
  "workerStats": {
    "activeWorkers": 1,
    "maxConcurrentJobs": 5,
    "queueLength": 0
  }
}
```

#### Job Status Values

| Status | Description |
|--------|-------------|
| `started` | Job has been created and is initializing |
| `processing` | Job is actively running |
| `completed` | Job finished successfully |
| `failed` | Job encountered an error |
| `cancelled` | Job was cancelled by user |

#### Progress Steps

| Step | Description |
|------|-------------|
| `initializing` | Job is starting up |
| `generating_phrases` | AI is generating search phrases |
| `processing_phrases` | Processing search phrases |
| `processing_businesses` | Extracting business data |
| `completed` | Job finished successfully |

#### Example Request

```bash
curl -X GET "http://localhost:3000/background-jobs/job_1757778168502_01toou7/status" \
  -H "X-User-Email: rameshnda09@gmail.com"
```

### 3. Get Active Jobs

**GET** `/active`

Retrieves all currently active jobs for the authenticated user.

#### Response

```json
{
  "success": true,
  "jobs": [
    {
      "jobId": "job_1757778168502_01toou7",
      "userEmail": "rameshnda09@gmail.com",
      "city": "mumbai",
      "keyword": "restaurant",
      "method": "web",
      "status": "processing",
      "progress": {
        "currentStep": "processing_phrases",
        "totalPhrases": 290,
        "currentPhrase": "Restaurants near me",
        "processedPhrases": 0,
        "phrasesProgress": 0,
        "saveSuccessRate": 0
      },
      "statistics": {
        "errors": [],
        "saveStats": {
          "bothFailed": 0,
          "postgresql": {
            "failed": 0,
            "success": 0
          },
          "googleSheets": {
            "failed": 0,
            "success": 0
          },
          "bothSucceeded": 0,
          "partialSuccess": 0
        },
        "totalErrors": 0
      },
      "createdAt": "2025-09-13T10:12:49.688Z",
      "updatedAt": "2025-09-13T10:13:05.827Z",
      "error": null,
      "duration": 19826519
    }
  ],
  "count": 1,
  "workerStats": {
    "activeWorkers": 1,
    "maxConcurrentJobs": 5,
    "queueLength": 0
  }
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/background-jobs/active" \
  -H "X-User-Email: rameshnda09@gmail.com"
```

### 4. Get Job History

**GET** `/history`

Retrieves job history for the authenticated user with pagination.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Number of jobs to return |
| `offset` | number | 0 | Number of jobs to skip |

#### Response

```json
{
  "success": true,
  "jobs": [
    {
      "jobId": "job_1757778168502_01toou7",
      "userEmail": "rameshnda09@gmail.com",
      "city": "mumbai",
      "keyword": "restaurant",
      "method": "web",
      "status": "processing",
      "progress": {
        "currentStep": "processing_phrases",
        "totalPhrases": 290,
        "currentPhrase": "Restaurants near me",
        "processedPhrases": 0,
        "phrasesProgress": 0,
        "saveSuccessRate": 0
      },
      "statistics": {
        "errors": [],
        "saveStats": {
          "bothFailed": 0,
          "postgresql": {
            "failed": 0,
            "success": 0
          },
          "googleSheets": {
            "failed": 0,
            "success": 0
          },
          "bothSucceeded": 0,
          "partialSuccess": 0
        },
        "totalErrors": 0
      },
      "createdAt": "2025-09-13T10:12:49.688Z",
      "updatedAt": "2025-09-13T10:13:05.827Z",
      "error": null,
      "duration": 19826519
    }
  ],
  "count": 1,
  "pagination": {
    "limit": 50,
    "offset": 0,
    "hasMore": false
  },
  "workerStats": {
    "activeWorkers": 1,
    "maxConcurrentJobs": 5,
    "queueLength": 0
  }
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/background-jobs/history?limit=10&offset=0" \
  -H "X-User-Email: rameshnda09@gmail.com"
```

### 5. Cancel Job

**POST** `/{jobId}/cancel`

Cancels a running job.

#### Response

```json
{
  "success": true,
  "message": "Job cancelled successfully",
  "workerStats": {
    "activeWorkers": 0,
    "maxConcurrentJobs": 5,
    "queueLength": 0
  }
}
```

#### Example Request

```bash
curl -X POST "http://localhost:3000/background-jobs/job_1757778168502_01toou7/cancel" \
  -H "X-User-Email: rameshnda09@gmail.com"
```

### 6. Get Job Statistics

**GET** `/statistics`

Retrieves comprehensive job statistics for the authenticated user.

#### Response

```json
{
  "success": true,
  "statistics": {
    "totalJobs": 230,
    "completedJobs": 0,
    "failedJobs": 36,
    "activeJobs": 193,
    "averageDurationSeconds": 20179.002243472223
  },
  "workerStats": {
    "activeWorkers": 1,
    "maxConcurrentJobs": 5,
    "queueLength": 0
  }
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/background-jobs/statistics" \
  -H "X-User-Email: rameshnda09@gmail.com"
```

### 7. Cleanup Old Jobs (Admin)

**POST** `/cleanup`

Cleans up old completed and failed jobs (admin functionality).

#### Request Body

```json
{
  "daysToKeep": 30
}
```

#### Response

```json
{
  "success": true,
  "message": "Cleaned up 15 old jobs",
  "cleanedCount": 15,
  "workerStats": {
    "activeWorkers": 1,
    "maxConcurrentJobs": 5,
    "queueLength": 0
  }
}
```

#### Example Request

```bash
curl -X POST "http://localhost:3000/background-jobs/cleanup" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: rameshnda09@gmail.com" \
  -d '{"daysToKeep": 30}'
```

## Worker Statistics

The `workerStats` object is included in all responses and provides real-time information about the background worker system:

```json
{
  "workerStats": {
    "activeWorkers": 1,        // Number of currently running worker threads
    "maxConcurrentJobs": 5,    // Maximum concurrent jobs allowed
    "queueLength": 0          // Number of jobs waiting in queue
  }
}
```

## Job Persistence vs Memory

### ✅ Database Persistence (Current Implementation)

- **Job Data**: All job information is stored in PostgreSQL database
- **Progress Tracking**: Real-time progress updates are saved to database
- **Job History**: Complete job history is maintained in database
- **Survivability**: Jobs persist across server restarts
- **Scalability**: Multiple server instances can share job data
- **Reliability**: No data loss if server crashes

### ❌ Memory-Based (Not Used)

- Job data would be lost on server restart
- No persistence across server instances
- Limited scalability
- Risk of data loss

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "success": false,
  "error": "Missing required fields",
  "message": "City and keyword are required"
}
```

#### 403 Forbidden
```json
{
  "success": false,
  "error": "Access denied",
  "message": "You can only view your own jobs"
}
```

#### 404 Not Found
```json
{
  "success": false,
  "error": "Job not found",
  "message": "Job does not exist or has been cleaned up"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Internal server error",
  "message": "An unexpected error occurred",
  "timestamp": "2025-09-13T10:15:30.123Z"
}
```

## Rate Limiting

- **Concurrent Jobs**: Maximum 5 concurrent jobs per system
- **Job Creation**: No rate limit on job creation
- **Status Checks**: No rate limit on status checks

## Best Practices

### 1. Job Monitoring
```bash
# Check job status every 5-10 seconds
while true; do
  curl -X GET "http://localhost:3000/background-jobs/{jobId}/status" \
    -H "X-User-Email: your-email@example.com"
  sleep 5
done
```

### 2. Error Handling
```javascript
// Always check the success field
const response = await fetch('/background-jobs/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Email': 'your-email@example.com'
  },
  body: JSON.stringify({
    city: 'mumbai',
    keyword: 'restaurant'
  })
});

const data = await response.json();
if (!data.success) {
  console.error('Job creation failed:', data.message);
}
```

### 3. Progress Tracking
```javascript
// Monitor job progress
const checkProgress = async (jobId) => {
  const response = await fetch(`/background-jobs/${jobId}/status`, {
    headers: {
      'X-User-Email': 'your-email@example.com'
    }
  });
  
  const data = await response.json();
  const progress = data.job.progress;
  
  console.log(`Progress: ${progress.phrasesProgress}%`);
  console.log(`Current Step: ${progress.currentStep}`);
  console.log(`Processed: ${progress.processedPhrases}/${progress.totalPhrases}`);
  
  if (data.job.status === 'completed') {
    console.log('Job completed successfully!');
  } else if (data.job.status === 'failed') {
    console.error('Job failed:', data.job.error);
  }
};
```

## Testing Examples

### Complete Workflow Test

```bash
#!/bin/bash

# 1. Create a job
echo "Creating job..."
JOB_RESPONSE=$(curl -s -X POST "http://localhost:3000/background-jobs/create" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: rameshnda09@gmail.com" \
  -d '{
    "city": "mumbai",
    "keyword": "cafe",
    "method": "web",
    "maxResults": 5,
    "wantEmail": false
  }')

JOB_ID=$(echo $JOB_RESPONSE | jq -r '.jobId')
echo "Job created: $JOB_ID"

# 2. Monitor progress
echo "Monitoring job progress..."
for i in {1..10}; do
  STATUS_RESPONSE=$(curl -s -X GET "http://localhost:3000/background-jobs/$JOB_ID/status" \
    -H "X-User-Email: rameshnda09@gmail.com")
  
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.job.status')
  STEP=$(echo $STATUS_RESPONSE | jq -r '.job.progress.currentStep')
  PROGRESS=$(echo $STATUS_RESPONSE | jq -r '.job.progress.phrasesProgress')
  
  echo "Status: $STATUS, Step: $STEP, Progress: $PROGRESS%"
  
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  
  sleep 5
done

# 3. Get final statistics
echo "Getting job statistics..."
curl -s -X GET "http://localhost:3000/background-jobs/statistics" \
  -H "X-User-Email: rameshnda09@gmail.com" | jq '.statistics'
```

### Concurrent Jobs Test

```bash
#!/bin/bash

# Create multiple jobs simultaneously
echo "Creating multiple concurrent jobs..."

for i in {1..3}; do
  curl -X POST "http://localhost:3000/background-jobs/create" \
    -H "Content-Type: application/json" \
    -H "X-User-Email: rameshnda09@gmail.com" \
    -d "{
      \"city\": \"mumbai\",
      \"keyword\": \"restaurant$i\",
      \"method\": \"web\",
      \"maxResults\": 3,
      \"wantEmail\": false
    }" &
done

wait
echo "All jobs created!"

# Check active jobs
echo "Active jobs:"
curl -s -X GET "http://localhost:3000/background-jobs/active" \
  -H "X-User-Email: rameshnda09@gmail.com" | jq '.jobs[].jobId'
```

## Integration Examples

### JavaScript/Node.js

```javascript
class BackgroundJobClient {
  constructor(baseUrl, userEmail) {
    this.baseUrl = baseUrl;
    this.userEmail = userEmail;
  }

  async createJob(city, keyword, options = {}) {
    const response = await fetch(`${this.baseUrl}/background-jobs/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': this.userEmail
      },
      body: JSON.stringify({
        city,
        keyword,
        method: 'web',
        maxResults: 50,
        wantEmail: false,
        ...options
      })
    });

    return await response.json();
  }

  async getJobStatus(jobId) {
    const response = await fetch(`${this.baseUrl}/background-jobs/${jobId}/status`, {
      headers: {
        'X-User-Email': this.userEmail
      }
    });

    return await response.json();
  }

  async waitForCompletion(jobId, interval = 5000) {
    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        try {
          const status = await this.getJobStatus(jobId);
          
          if (status.job.status === 'completed') {
            resolve(status);
          } else if (status.job.status === 'failed') {
            reject(new Error(status.job.error || 'Job failed'));
          } else {
            setTimeout(checkStatus, interval);
          }
        } catch (error) {
          reject(error);
        }
      };

      checkStatus();
    });
  }
}

// Usage
const client = new BackgroundJobClient('http://localhost:3000', 'rameshnda09@gmail.com');

async function runJob() {
  try {
    // Create job
    const job = await client.createJob('mumbai', 'restaurant');
    console.log('Job created:', job.jobId);

    // Wait for completion
    const result = await client.waitForCompletion(job.jobId);
    console.log('Job completed:', result.job.progress);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

runJob();
```

### Python

```python
import requests
import time
import json

class BackgroundJobClient:
    def __init__(self, base_url, user_email):
        self.base_url = base_url
        self.user_email = user_email
        self.headers = {
            'X-User-Email': user_email,
            'Content-Type': 'application/json'
        }

    def create_job(self, city, keyword, **options):
        data = {
            'city': city,
            'keyword': keyword,
            'method': 'web',
            'maxResults': 50,
            'wantEmail': False,
            **options
        }
        
        response = requests.post(
            f'{self.base_url}/background-jobs/create',
            headers=self.headers,
            json=data
        )
        
        return response.json()

    def get_job_status(self, job_id):
        response = requests.get(
            f'{self.base_url}/background-jobs/{job_id}/status',
            headers={'X-User-Email': self.user_email}
        )
        
        return response.json()

    def wait_for_completion(self, job_id, interval=5):
        while True:
            status = self.get_job_status(job_id)
            job_status = status['job']['status']
            
            if job_status == 'completed':
                return status
            elif job_status == 'failed':
                raise Exception(f"Job failed: {status['job'].get('error', 'Unknown error')}")
            
            time.sleep(interval)

# Usage
client = BackgroundJobClient('http://localhost:3000', 'rameshnda09@gmail.com')

try:
    # Create job
    job = client.create_job('mumbai', 'restaurant')
    print(f"Job created: {job['jobId']}")

    # Wait for completion
    result = client.wait_for_completion(job['jobId'])
    print(f"Job completed: {result['job']['progress']}")
    
except Exception as e:
    print(f"Error: {e}")
```

## Conclusion

The Background Worker API provides a robust, scalable solution for lead generation with:

- **Database persistence** ensuring no data loss
- **Concurrent processing** for better performance
- **Real-time progress tracking** for better user experience
- **Comprehensive job management** for full control
- **User security** with proper access controls

This system is production-ready and can handle high-volume lead generation workloads efficiently.
