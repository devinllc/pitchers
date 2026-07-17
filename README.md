# Pitchers API - Production-Ready SaaS Backend

A scalable, multi-tenant backend for lead generation and business data management with Google Sheets integration.

## Overview

This backend implements a production-ready SaaS architecture with:

- JWT-based authentication via Google OAuth
- Subscription management with Razorpay
- Usage tracking and limits
- Google Sheets integration
- Job management for lead generation

## API Documentation

### Authentication Flow

All protected endpoints require JWT authentication. The authentication flow is as follows:

1. User initiates Google OAuth flow via `/auth/google/authorize`
2. After successful OAuth, user receives JWT token and refresh token
3. JWT token must be included in all protected API requests as Bearer token
4. When token expires, use `/auth/refresh-token` to get a new one

### Flexible Data Extraction

The system now supports intelligent, flexible data extraction that adapts to user requirements:

#### Scraper Object Structure
```json
{
  "scraper": {
    // Existing parameters
    "maxResults": 50,           // Max businesses per phrase (1-500)
    "maxScrollPages": 10,       // Max pages to scroll (0-50)
    "headless": true,           // Browser headless mode
    "wantWebsite": false,       // Extract website URLs
    "wantEmail": false,         // Extract email addresses
    "emailDeepPaths": false,    // Deep email extraction
    
    // New flexible parameters
    "targetDataCount": 1000,    // Total businesses to extract (1-10000)
    "maxPhrases": 10,           // Limit Gemini phrases (1-100)
    "pageRange": {              // Pagination control
      "start": 1,               // Start page (1-50)
      "end": 5                  // End page (1-50)
    }
  }
}
```

#### Key Features

1. **Target Data Count**: Extract a specific number of businesses regardless of phrase count
   - Continues processing phrases until target is reached
   - Automatically adjusts `maxResults` per phrase based on remaining target
   - Typically requires 2-5 phrases for 1000 businesses

2. **Phrase Limits**: Limit Gemini AI phrase generation to save tokens
   - Controls how many phrases Gemini generates
   - Saves API tokens and processing time
   - Useful when you know specific phrase count will be sufficient

3. **Page Range Control**: Control pagination for specific page ranges
   - Start from specific page numbers
   - Useful for avoiding duplicate data from previous searches
   - Automatically extends page range for high `maxResults`

#### Example Usage

```bash
# Extract 1000 businesses (continues until target reached)
curl -X POST "http://localhost:3000/api/v1/search" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "city": "Mumbai",
    "keyword": "restaurants",
    "method": "web",
    "scraper": {
      "targetDataCount": 1000
    }
  }'

# Limit to 5 phrases (saves Gemini tokens)
curl -X POST "http://localhost:3000/api/v1/search" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "city": "Delhi",
    "keyword": "hotels",
    "method": "web",
    "scraper": {
      "maxPhrases": 5
    }
  }'

# Page range 5-10 (avoid duplicates)
curl -X POST "http://localhost:3000/api/v1/search" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "city": "Bangalore",
    "keyword": "cafes",
    "method": "web",
    "scraper": {
      "pageRange": {
        "start": 5,
        "end": 10
      }
    }
  }'
```

### API Categories

#### 1. Authentication (`/auth`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/auth/google/authorize` | GET | Initiate Google OAuth flow | None |
| `/auth/google/callback` | GET | OAuth callback handler | None |
| `/auth/refresh-token` | POST | Refresh JWT token | None (requires refresh token) |
| `/auth/logout` | POST | Revoke refresh token | None (requires refresh token) |
| `/auth/me` | GET | Get current user info | JWT |

#### 2. Subscription Management (`/subscription`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/subscription/plans` | GET | Get available subscription plans | None |
| `/subscription/status` | GET | Get user's current subscription | JWT |
| `/subscription/create` | POST | Create a new subscription | JWT |
| `/subscription/verify-payment` | POST | Verify payment and activate subscription | JWT |
| `/subscription/webhook` | POST | Razorpay webhook handler | None (Razorpay signature) |
| `/subscription/cancel` | POST | Cancel subscription | JWT |#### 3. Google Integration (`/google`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/google/sheets/connect` | GET | Connect Google Sheets account | JWT |
| `/google/sheets/status` | GET | Check connection status | JWT |
| `/google/sheets/available` | GET | Get available Google Sheets | JWT + Subscription |
| `/google/sheets/connected` | GET | Get connected Google Sheets | JWT + Subscription |
| `/google/sheets/create` | POST | Create new Google Sheet | JWT + Subscription |
| `/google/sheets/connect` | POST | Connect existing Google Sheet | JWT + Subscription |
| `/google/sheets/:sheetId` | DELETE | Disconnect Google Sheet | JWT + Subscription |
| `/google/sheets/data` | GET | Get business data from sheets | JWT + Subscription |
| `/google/sheets/data/stats` | GET | Get business data statistics | JWT + Subscription |
| `/google/sheets/data/save` | POST | Save business data to sheet | JWT + Subscription |
| `/google/sheets/disconnect` | POST | Disconnect Google account | JWT |

#### 4. Job Management (`/jobs`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/jobs/create` | POST | Create a new job | JWT + Subscription |
| `/jobs/:jobId` | GET | Get job status | JWT + Subscription |
| `/jobs` | GET | Get all user jobs | JWT + Subscription |
| `/jobs/:jobId/pause` | POST | Pause a job | JWT + Subscription |
| `/jobs/:jobId/resume` | POST | Resume a job | JWT + Subscription |
| `/jobs/:jobId/stop` | POST | Stop a job | JWT + Subscription |

#### 5. Usage Tracking (`/usage`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/usage/current` | GET | Get current usage | JWT |
| `/usage/history` | GET | Get usage history | JWT |
| `/usage/by-resource` | GET | Get usage by resource type | JWT |
| `/usage/forecast` | GET | Get usage forecast | JWT |
## Frontend Integration Guide

### 1. Authentication

```javascript
// Initiate Google OAuth
async function loginWithGoogle() {
  const response = await fetch('/auth/google/authorize');
  const data = await response.json();
  
  // Redirect user to Google OAuth page
  window.location.href = data.authUrl;
}

// Handle OAuth callback
async function handleOAuthCallback(code, state) {
  // The callback will return JWT token directly
  // Store token in localStorage or secure cookie
  localStorage.setItem('token', data.token);
  localStorage.setItem('refreshToken', data.refreshToken);
}

// Add token to all API requests
function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// Refresh token when expired
async function refreshToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  const response = await fetch('/auth/refresh-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  const data = await response.json();
  localStorage.setItem('token', data.token);
}
```

### 2. Subscription Management

```javascript
// Get available plans
async function getPlans() {
  const response = await fetch('/subscription/plans');
  return await response.json();
}

// Create subscription
async function createSubscription(planId) {
  const response = await fetch('/subscription/create', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ planId })
  });
  const data = await response.json();
  
  // Initialize Razorpay
  const options = {
    key: data.paymentDetails.key,
    amount: data.order.amount,
    currency: data.order.currency,
    name: data.paymentDetails.name,
    description: data.paymentDetails.description,
    order_id: data.order.id,
    prefill: {
      email: data.paymentDetails.prefill.email
    },
    handler: function(response) {
      // Verify payment
      verifyPayment(response);
    }
  };
  
  const razorpay = new Razorpay(options);
  razorpay.open();
}

// Verify payment
async function verifyPayment(response) {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = response;
  
  const verifyResponse = await fetch('/subscription/verify-payment', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    })
  });
  
  return await verifyResponse.json();
}
```
### 3. Google Sheets Integration

```javascript
// Connect Google Sheets
async function connectGoogleSheets() {
  const response = await fetch('/google/sheets/connect', {
    headers: getAuthHeaders()
  });
  const data = await response.json();
  
  // Redirect user to Google OAuth page
  window.location.href = data.authUrl;
}

// Get connected sheets
async function getConnectedSheets() {
  const response = await fetch('/google/sheets/connected', {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// Create new sheet
async function createSheet(sheetName) {
  const response = await fetch('/google/sheets/create', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ sheetName })
  });
  return await response.json();
}
```

### 4. Job Management

```javascript
// Create a job
async function createJob(keywords, location, maxResults, targetSheetId) {
  const response = await fetch('/jobs/create', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      keywords,
      location,
      maxResults,
      targetSheetId
    })
  });
  return await response.json();
}

// Get job status
async function getJobStatus(jobId) {
  const response = await fetch(`/jobs/${jobId}`, {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// Get all jobs
async function getAllJobs() {
  const response = await fetch('/jobs', {
    headers: getAuthHeaders()
  });
  return await response.json();
}
```

### 5. Usage Tracking

```javascript
// Get current usage
async function getCurrentUsage() {
  const response = await fetch('/usage/current', {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// Get usage history
async function getUsageHistory(startDate, endDate, groupBy = 'day') {
  const params = new URLSearchParams({
    startDate,
    endDate,
    groupBy
  });
  
  const response = await fetch(`/usage/history?${params}`, {
    headers: getAuthHeaders()
  });
  return await response.json();
}
```
## System Flow

1. **User Authentication**
   - User logs in via Google OAuth
   - Backend issues JWT token
   - Frontend stores token and includes it in all requests

2. **Subscription Management**
   - User selects plan
   - Backend creates Razorpay order
   - Frontend opens Razorpay checkout
   - User completes payment
   - Razorpay sends webhook to backend
   - Backend verifies payment and activates subscription

3. **Google Sheets Integration**
   - User connects Google account
   - Backend stores OAuth credentials
   - User selects or creates Google Sheet for data storage

4. **Job Creation and Execution**
   - User creates job with location, keywords, etc.
   - Backend checks subscription status and usage limits
   - Backend executes job and tracks progress
   - Results are saved to database and Google Sheet

5. **Usage Tracking**
   - Backend tracks all API usage
   - Usage is checked against subscription limits
   - User can view usage statistics and forecast

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Human-readable error message",
  "code": "error_code"
}
```

Common error codes:

- `authentication_required`: User is not authenticated
- `token_expired`: JWT token has expired
- `invalid_token`: JWT token is invalid
- `no_subscription`: User has no active subscription
- `inactive_subscription`: User's subscription is not active
- `subscription_expired`: User's subscription has expired
- `usage_limit_exceeded`: User has exceeded usage limit
- `rate_limit_exceeded`: User has exceeded rate limit
- `job_limit_exceeded`: User has reached maximum concurrent jobs

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables (see `.env.example`)
4. Run the server: `npm start`

## Environment Variables

Create a `.env` file with the following variables:

```
# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRY=24h
REFRESH_TOKEN_EXPIRY=30d

# Database
DATABASE_URL=postgres://user:password@localhost:5432/database

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Google APIs
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
GEMINI_API_KEY=your-gemini-api-key

# Razorpay
RAZORPAY_KEY_ID=your-razorpay-key-id
RAZORPAY_KEY_SECRET=your-razorpay-key-secret
RAZORPAY_WEBHOOK_SECRET=your-razorpay-webhook-secret
```

## Production Deployment

For production deployment, ensure:

1. Set `NODE_ENV=production`
2. Use a strong `JWT_SECRET`
3. Set up proper SSL/TLS
4. Configure database connection pooling
5. Set up monitoring and logging

## Support

For any questions or issues, please contact the development team.
admins:
Email: admin@example.com
Password: admin123





vramesh@Rameshs-MacBook-Pro pitchers % git reset --hard 9c8d1ab9547dc457b5d45eb380c835e258ee3380
HEAD is now at 9c8d1ab sheeht
vramesh@Rameshs-MacBook-Pro pitchers % 
 *  History restored 

vramesh@Rameshs-MacBook-Pro pitchers % 
 *  History restored 

vramesh@Rameshs-MacBook-Pro pitchers % git push 
Enumerating objects: 10, done.
Counting objects: 100% (10/10), done.
Delta compression using up to 12 threads
Compressing objects: 100% (6/6), done.
Writing objects: 100% (6/6), 1.44 KiB | 1.44 MiB/s, done.
Total 6 (delta 4), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (4/4), completed with 4 local objects.
To https://github.com/devinllc/pitchers.git
   34a35dd..14c3a4a  main -> main
vramesh@Rameshs-MacBook-Pro pitchers % 
 *  History restored 

vramesh@Rameshs-MacBook-Pro pitchers % git stash
Saved working directory and index state WIP on main: c93c9e2 CRITICAL FIX: Pass searchPhrases array to _processSinglePhrase method
vramesh@Rameshs-MacBook-Pro pitchers % 


AQEDAVxij1oBNiQHAAABnq2daFgAAAGe0ansWE0Ar-l0Abk2AMfHLM85PEC23CU0Qf0DCwSjjNkbK0w5SOqpTnehF-pG1zrJ-hC82byyZEWUpPx3B9ZY3I5NiQAy04JJ0952vfftBz7Q9JHWBSwoJ-Fd

🤖 AI PR Agent & Auto-Poster (LinkedIn)
Autonomous daily brand posting and organic growth engine

[LinkedIn] Post editor element not found after trying all selectors.