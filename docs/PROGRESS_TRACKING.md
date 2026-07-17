# Progress Tracking Implementation

This document describes the progress tracking and status updates functionality implemented for the Local Business Scraper.

## Overview

The progress tracking system provides real-time monitoring of lead generation jobs with the following capabilities:

- **Job Tracking**: Each job gets a unique ID and comprehensive progress tracking
- **Real-time Updates**: Live progress updates showing current phrase and records saved
- **Status Endpoints**: REST API endpoints to check processing progress
- **Error Tracking**: Detailed error logging and reporting
- **Statistics**: Comprehensive save statistics and performance metrics

## Components

### 1. JobManager (`services/jobManager.js`)

The JobManager handles all job tracking functionality:

- **Job Creation**: Creates unique job IDs and initializes tracking
- **Progress Updates**: Updates job progress in real-time
- **Status Retrieval**: Provides current job status and statistics
- **Error Handling**: Tracks and logs errors for each job
- **Real-time Logging**: Logs progress updates showing current phrase and records saved

### 2. ProcessingService Integration

The ProcessingService has been updated to integrate with JobManager:

- **Job Lifecycle**: Creates, updates, and completes jobs
- **Progress Tracking**: Updates progress at each processing step
- **Error Reporting**: Reports errors to the job tracking system
- **Statistics**: Updates save statistics and business counts

### 3. API Endpoints

New REST API endpoints for job monitoring:

#### GET /health
Enhanced health check with system status:
```json
{
  "status": "OK",
  "message": "Local Business Scraper API is running",
  "activeJobs": 2,
  "isProcessing": true
}
```

#### GET /status/:jobId
Get specific job status:
```json
{
  "jobId": "job_1754201644432_3sklaml",
  "city": "Delhi",
  "keyword": "bridal makeup artist",
  "status": "processing_phrases",
  "progress": {
    "totalPhrases": 10,
    "processedPhrases": 3,
    "currentPhrase": "Connaught Place bridal makeup",
    "totalBusinesses": 15,
    "savedBusinesses": 12,
    "currentStep": "processing_businesses",
    "phrasesProgress": 30,
    "saveSuccessRate": 80
  },
  "statistics": {
    "saveStats": {
      "postgresql": { "success": 10, "failed": 2 },
      "googleSheets": { "success": 8, "failed": 4 },
      "bothSucceeded": 6,
      "bothFailed": 1,
      "partialSuccess": 5
    },
    "totalErrors": 3
  },
  "createdAt": "2025-08-03T06:14:04.432Z",
  "updatedAt": "2025-08-03T06:14:07.441Z",
  "duration": 45000
}
```

#### GET /status
Get all active jobs:
```json
{
  "activeJobs": [
    {
      "jobId": "job_123",
      "city": "Delhi",
      "status": "processing_phrases",
      "progress": { ... }
    }
  ],
  "totalActiveJobs": 1
}
```

#### GET /jobs
Get all jobs (active and completed):
```json
{
  "jobs": [
    {
      "jobId": "job_123",
      "status": "completed",
      "progress": { ... }
    },
    {
      "jobId": "job_124",
      "status": "processing_phrases",
      "progress": { ... }
    }
  ],
  "totalJobs": 2
}
```

## Real-time Progress Logging

The system provides detailed real-time logging showing:

### Current Processing Status
```
🔄 Job job_123 Progress: [PROCESSING_PHRASES] Processing: "Connaught Place bridal makeup" | Phrases: 3/10 (30%) | Businesses: 12/15 saved (80%) | Errors: 2
```

### Save Statistics
```
📊 Save Stats - PostgreSQL: 10✓/2✗ | Google Sheets: 8✓/4✗ | Both: 6 | Partial: 5
```

### Job Lifecycle Events
```
📋 Job created: job_123 for city: Delhi, keyword: bridal makeup artist
✅ Job completed: job_123
❌ Job failed: job_124 - API quota exceeded
```

## Job Status Flow

1. **started** - Job created and queued
2. **generating_phrases** - AI generating search phrases
3. **processing_phrases** - Processing search phrases sequentially
4. **processing_businesses** - Extracting business details
5. **completed** - Job finished successfully
6. **error** - Job failed with error

## Progress Tracking Features

### Current Step Tracking
- `initializing` - Job setup
- `input_validated` - Input validation complete
- `generating_phrases` - AI phrase generation
- `phrases_generated` - Phrases ready for processing
- `processing_phrases` - Processing search phrases
- `processing_businesses` - Extracting business details
- `completed` - Job finished
- `failed` - Job failed

### Real-time Metrics
- **Phrases Progress**: Current phrase being processed and completion percentage
- **Business Counts**: Total businesses found vs. successfully saved
- **Save Success Rate**: Percentage of businesses successfully saved
- **Error Count**: Number of errors encountered
- **Duration**: Time elapsed since job start

### Detailed Statistics
- **PostgreSQL Save Stats**: Success/failure counts for database saves
- **Google Sheets Save Stats**: Success/failure counts for sheet saves
- **Combined Stats**: Both succeeded, both failed, partial success counts
- **Error Log**: Detailed error information with timestamps

## Usage Examples

### Starting a Job and Monitoring Progress

1. **Start a job**:
```bash
curl -X POST http://localhost:3000/search-service \
  -H "Content-Type: application/json" \
  -d '{"city": "Delhi", "keyword": "bridal makeup artist"}'
```

Response:
```json
{
  "jobId": "job_1754201644432_3sklaml",
  "status": "started",
  "message": "Lead generation job initiated",
  "city": "Delhi",
  "keyword": "bridal makeup artist"
}
```

2. **Monitor progress**:
```bash
curl http://localhost:3000/status/job_1754201644432_3sklaml
```

3. **Check all active jobs**:
```bash
curl http://localhost:3000/status
```

### Error Handling

The system tracks errors at multiple levels:

- **API Errors**: Google Maps/Sheets API failures
- **Processing Errors**: Business data extraction issues
- **Save Errors**: Database/sheet save failures
- **System Errors**: Unexpected application errors

Each error includes:
- **Step**: Which processing step failed
- **Context**: Relevant context (phrase, business name, etc.)
- **Error Message**: Detailed error description
- **Timestamp**: When the error occurred

## Testing

### Unit Tests
Run the progress tracking test:
```bash
node test-progress-tracking.js
```

### API Tests
Test the status endpoints:
```bash
node test-api-endpoints.js
```

## Requirements Fulfilled

This implementation fulfills the following requirements:

### Requirement 7.5
- ✅ Real-time progress updates showing current phrase being processed
- ✅ Total records saved counter
- ✅ Job tracking with unique IDs

### Requirement 6.2
- ✅ Comprehensive error logging and tracking
- ✅ Processing statistics and performance metrics
- ✅ Real-time status updates and monitoring

## Performance Considerations

- **Memory Efficient**: Jobs are stored in memory with automatic cleanup
- **Non-blocking**: Progress updates don't block processing
- **Scalable**: Can handle multiple concurrent jobs
- **Cleanup**: Automatic cleanup of old completed jobs (keeps last 100)

## Future Enhancements

Potential improvements for production use:

1. **Persistent Storage**: Store job data in database instead of memory
2. **WebSocket Support**: Real-time progress updates via WebSocket
3. **Job Queuing**: Advanced job queue management
4. **Metrics Dashboard**: Web-based monitoring dashboard
5. **Alerts**: Email/SMS notifications for job completion/failures