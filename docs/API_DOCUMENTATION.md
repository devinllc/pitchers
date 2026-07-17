# Local Business Scraper API Documentation

## Overview

The Local Business Scraper API is a Node.js/Express application that automates lead generation by combining AI-powered search phrase generation with Google Maps data extraction. The system processes user inputs (city + keyword) and streams business data directly to Google Sheets in real-time.

**Now available as SaaS!** The API supports both direct access and API key-based SaaS endpoints with usage tracking, rate limiting, and multiple subscription plans.

## Base URL

```
http://localhost:3000
```

## Authentication

### Direct Access (Original Endpoints)
Original endpoints (`/search-service`, `/status`, etc.) work without authentication for backward compatibility.

### SaaS API Access (New)
SaaS endpoints (`/api/v1/*`) require API key authentication with usage tracking and rate limiting.

**API Key Authentication Methods:**
1. **Authorization Header (Recommended):** `Authorization: Bearer your-api-key`
2. **Custom Header:** `x-api-key: your-api-key`  
3. **Query Parameter:** `?api_key=your-api-key`

**Response Headers:**
- `X-RateLimit-Limit`: Requests per minute limit
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-Usage-Current`: Current monthly usage count
- `X-Usage-Limit`: Monthly usage limit

## SaaS API Key Management

### Create API Key
**POST** `/api-keys/create`

Creates a new API key for a user with specified plan.

**Request Body:**
```json
{
  "userEmail": "user@example.com",
  "planType": "free"
}
```

**Response:**
```json
{
  "success": true,
  "message": "API key created successfully",
  "data": {
    "apiKey": "pk_abc123...",
    "userEmail": "user@example.com",
    "planType": "free",
    "usageLimit": 100,
    "rateLimit": 5,
    "expiresAt": "2024-02-15T10:30:00.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Get Available Plans
**GET** `/api-keys/plans`

Returns all available subscription plans.

**Response:**
```json
{
  "success": true,
  "data": {
    "plans": {
      "free": {
        "name": "Free",
        "usageLimit": 100,
        "rateLimit": 5,
        "price": 0,
        "duration": "30 days",
        "features": ["100 API calls per month", "5 requests per minute", "Basic support"]
      },
      "basic": {
        "name": "Basic",
        "usageLimit": 1000,
        "rateLimit": 20,
        "price": 29,
        "duration": "monthly",
        "features": ["1,000 API calls per month", "20 requests per minute", "Email support"]
      }
    }
  }
}
```

### Get API Key Usage Stats
**GET** `/api-keys/:apiKey/stats`

Returns usage statistics for an API key.

**Response:**
```json
{
  "success": true,
  "data": {
    "apiKey": "pk_abc123...",
    "userEmail": "user@example.com",
    "planType": "free",
    "usage": {
      "current": 45,
      "limit": 100,
      "percentage": 45.0,
      "remaining": 55
    },
    "rateLimit": 5,
    "isActive": true,
    "expiresAt": "2024-02-15T10:30:00.000Z",
    "lastUsedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Update API Key Plan
**PUT** `/api-keys/:apiKey/plan`

Updates the plan for an API key.

**Request Body:**
```json
{
  "planType": "basic"
}
```

### Deactivate API Key
**DELETE** `/api-keys/:apiKey`

Deactivates an API key.

### Get User API Keys
**GET** `/api-keys/user/:userEmail`

Returns all API keys for a user.

## Original Endpoints (No Authentication Required)

### Health Check
**GET** `/health`

Returns system health status and monitoring information.

**Response Example:**
```json
{
  "status": "OK",
  "message": "Local Business Scraper API is running",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "system": {
    "nodeVersion": "v18.17.0",
    "platform": "darwin",
    "memoryUsage": {
      "rss": 45678912,
      "heapTotal": 20971520,
      "heapUsed": 15728640,
      "external": 1048576
    },
    "pid": 12345
  },
  "api": {
    "keysConfigured": {
      "gemini": true,
      "googleMaps": true,
      "googleSheets": true
    },
    "allKeysConfigured": true
  },
  "jobs": {
    "active": 2,
    "total": 10,
    "completed": 7,
    "errors": 1,
    "isProcessing": true
  }
}
```

**Quota Error Response (429):**
```json
{
  "error": "Rate limit exceeded",
  "message": "Daily job quota reached for your plan"
}
```

### Start Lead Generation
**POST** `/search-service`

Initiates a new lead generation job for a specific city and business keyword.

Requires header `X-API-Key`.

**Request Body (extended):**
```json
{
  "city": "Delhi",
  "keyword": "bridal makeup artist",
  "phraseCount": 25,                  // optional: cap number of phrases to process
  "method": "api",                   // optional: execution method
  "scraper": {                        // optional: scraper flags
    "headless": true
  },
  "apiKeys": {                        // optional: per-request overrides
    "gemini": "...",
    "googleMaps": "..."
  },
  "sheets": {                         // optional: per-request Google Sheets overrides
    "spreadsheetId": "...",
    "sheetName": "Leads"
  }
}
```

**Success Response (200):**
```json
{
  "jobId": "job_1642248600000_abc123",
  "status": "started",
  "message": "Lead generation job initiated",
  "city": "Delhi",
  "keyword": "bridal makeup artist"
}
```

**Validation Error Response (400):**
```json
{
  "error": "Validation failed",
  "details": [
    "City is required",
    "Keyword must be at least 2 characters long"
  ],
  "message": "Please provide valid city and keyword parameters",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Get Job Status
**GET** `/status/:jobId`

Returns the status and progress of a specific job.

**Response Example:**
```json
{
  "jobId": "job_1642248600000_abc123",
  "city": "Delhi",
  "keyword": "bridal makeup artist",
  "status": "searching_maps",
  "progress": {
    "totalPhrases": 45,
    "processedPhrases": 12,
    "totalBusinesses": 156,
    "savedBusinesses": 89
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z",
  "error": null
}
```

### Get All Active Jobs
**GET** `/status`

Returns all currently active jobs.

**Response Example:**
```json
{
  "activeJobs": [
    {
      "jobId": "job_1642248600000_abc123",
      "city": "Delhi",
      "keyword": "bridal makeup artist",
      "status": "searching_maps",
      "progress": {
        "totalPhrases": 45,
        "processedPhrases": 12,
        "totalBusinesses": 156,
        "savedBusinesses": 89
      }
    }
  ],
  "totalActiveJobs": 1
}
```

### Get All Jobs
**GET** `/jobs`

Returns all jobs (active and completed).

### API Documentation
**GET** `/api-docs`

Returns comprehensive API documentation with examples.

## SaaS Endpoints (Require API Key Authentication)

All endpoints under `/api/v1/` require API key authentication and provide the same functionality as original endpoints but with usage tracking, rate limiting, and plan enforcement.

### Start Lead Generation (SaaS)
**POST** `/api/v1/search-service`

Same as original `/search-service` but requires API key and tracks usage.

**Headers:**
```
Authorization: Bearer your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "city": "Delhi",
  "keyword": "bridal makeup artist",
  "method": "api",
  "scraper": {
    "headless": true
  }
}
```

**Response:**
```json
{
  "jobId": "job_1642248600000_abc123",
  "status": "started",
  "message": "Lead generation job initiated via API",
  "city": "Delhi",
  "keyword": "bridal makeup artist",
  "method": "api",
  "apiKey": {
    "plan": "free",
    "usageAfterRequest": 46,
    "remainingRequests": 54
  }
}
```

### Get Job Status (SaaS)
**GET** `/api/v1/status/:jobId`

Same as original `/status/:jobId` but includes API key usage info.

### Get Active Jobs (SaaS)
**GET** `/api/v1/status`

Same as original `/status` but includes API key usage info.

### Get All Jobs (SaaS)
**GET** `/api/v1/jobs`

Same as original `/jobs` but includes API key usage info.

### Get Performance Metrics (SaaS)
**GET** `/api/v1/performance`

Same as original `/performance` but includes API key usage info.

### Job Control (SaaS)
**POST** `/api/v1/jobs/:jobId/pause` - Pause job
**POST** `/api/v1/jobs/:jobId/resume` - Resume job  
**POST** `/api/v1/jobs/:jobId/stop` - Stop job

### Debug Job (SaaS)
**GET** `/api/v1/debug/:jobId`

Same as original `/debug/:jobId` but includes API key usage info.

### Manage Integrations

These endpoints persist user-owned API keys and Google Sheets overrides. They require `X-API-Key`.

**POST** `/integrations/keys`

Body:
```json
{
  "gemini": "user_gemini_key_optional",
  "googleMaps": "user_maps_key_optional"
}
```

Response:
```json
{ "success": true }
```

**POST** `/integrations/sheets`

Body:
```json
{
  "spreadsheetId": "sheet_id_optional",
  "sheetName": "Sheet1"
}
```

Response:
```json
{ "success": true }
```

## Input Validation Rules

### City Parameter
- Required field
- Must be a string
- Cannot be empty
- Must be at least 2 characters long
- Must be less than 100 characters long
- Only letters, spaces, hyphens, apostrophes, commas, and periods are allowed

### Keyword Parameter
- Required field
- Must be a string
- Cannot be empty
- Must be at least 2 characters long
- Must be less than 200 characters long
- Only letters, numbers, spaces, hyphens, apostrophes, commas, periods, and ampersands are allowed

## Job Statuses

- `started` - Job has been initiated and is queued for processing
- `generating_phrases` - AI is generating search phrases from city and keyword
- `searching_maps` - Searching Google Maps for businesses using generated phrases
- `extracting_details` - Extracting detailed business information from Google Places
- `completed` - Job completed successfully, all data saved to Google Sheets
- `error` - Job encountered an error and could not complete

## Rate Limiting

All external API calls are rate limited with 2-second delays:
- Google Maps Text Search: 2 seconds between requests
- Google Place Details: 2 seconds between requests
- Gemini AI: 2 seconds between requests

## Data Flow

1. User submits city and keyword via POST /search-service
2. System validates input and creates job
3. Gemini AI generates diverse search phrases
4. Google Maps Text Search API called for each phrase
5. Place IDs extracted from search results
6. Google Place Details API called for each place ID
7. Business data extracted and immediately saved to Google Sheets
8. Process continues until all phrases are processed
9. Job marked as completed

## Error Responses

### Authentication Errors
```json
{
  "error": "Authentication required",
  "message": "API key is required. Include it in Authorization header as 'Bearer your-api-key' or as x-api-key header"
}
```

### Rate Limit Exceeded
```json
{
  "error": "Rate limit exceeded",
  "message": "Rate limit of 5 requests per minute exceeded",
  "rateLimit": {
    "limit": 5,
    "remaining": 0,
    "resetTime": "2024-01-15T10:31:00.000Z"
  }
}
```

### Usage Limit Exceeded
```json
{
  "error": "Usage limit exceeded",
  "message": "Monthly usage limit of 100 requests has been exceeded",
  "usage": {
    "current": 100,
    "limit": 100
  }
}
```

## Example Usage

### Setup API Key System
```bash
# Initialize API key tables
node scripts/setup-api-keys.js
```

### Create API Key
```bash
curl -X POST http://localhost:3000/api-keys/create \
  -H "Content-Type: application/json" \
  -d '{"userEmail": "user@example.com", "planType": "free"}'
```

### Start a new job (Original endpoint)
```bash
curl -X POST http://localhost:3000/search-service \
  -H "Content-Type: application/json" \
  -d '{"city": "Mumbai", "keyword": "restaurant"}'
```

### Start a new job (SaaS endpoint)
```bash
curl -X POST http://localhost:3000/api/v1/search-service \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_your_api_key_here" \
  -d '{"city": "Mumbai", "keyword": "restaurant"}'
```

### Check job status
```bash
curl http://localhost:3000/status/job_1642248600000_abc123
```

### Check job status (SaaS)
```bash
curl http://localhost:3000/api/v1/status/job_1642248600000_abc123 \
  -H "Authorization: Bearer pk_your_api_key_here"
```

### Check API key usage
```bash
curl http://localhost:3000/api-keys/pk_your_api_key_here/stats
```

### Get available plans
```bash
curl http://localhost:3000/api-keys/plans
```

### Check system health
```bash
curl http://localhost:3000/health
```

### Get API documentation
```bash
curl http://localhost:3000/api-docs
```

### Save your integrations
```bash
curl -X POST http://localhost:3000/integrations/keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"gemini":"...","googleMaps":"..."}'

curl -X POST http://localhost:3000/integrations/sheets \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"spreadsheetId":"...","sheetName":"Leads"}'