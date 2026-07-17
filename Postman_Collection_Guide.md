# 🚀 Pitchers SaaS API - Complete Postman Collection

## 📋 Collection Overview
This Postman collection contains **120+ API endpoints** for testing the complete Pitchers SaaS platform. The collection is organized into logical sections covering all functionality from authentication to admin operations.

## 🔧 Setup Instructions

### 1. Import Collection
1. Open Postman
2. Click "Import" button
3. Select the JSON file or paste the collection JSON
4. The collection will be imported with all folders and requests

### 2. Configure Environment Variables
Create a new environment with these variables:

```json
{
  "baseUrl": "http://localhost:3000",
  "jwtToken": "",
  "refreshToken": "",
  "authCode": "",
  "state": "",
  "sheetId": "",
  "jobId": "",
  "razorpaySignature": "",
  "apiKey": ""
}
```

### 3. Authentication Flow
1. **Start with**: "Google OAuth Authorization"
2. **Follow the OAuth flow** to get tokens
3. **Set the tokens** in environment variables
4. **Test other endpoints** that require authentication

## 📁 Collection Structure

### 🔐 Authentication & User Management (5 endpoints)
- Google OAuth Authorization
- Google OAuth Callback
- Refresh Token
- Logout
- Get Current User

### 💳 Subscription Management (6 endpoints)
- Get All Plans
- Get Subscription Status
- Create Subscription
- Verify Payment
- Razorpay Webhook
- Cancel Subscription

### 📊 Google Sheets Integration (9 endpoints)
- Connect Google Sheets
- Get Connection Status
- Get Available Sheets
- Get Connected Sheets
- Create New Sheet
- Connect Existing Sheet
- Disconnect Sheet
- Get Sheet Data
- Get Sheet Data Stats
- Save Data to Sheet
- Disconnect Google Account

### 🚀 Job Management (6 endpoints)
- Create Job
- Get Job Status
- Get All Jobs
- Pause Job
- Resume Job
- Stop Job

### 📈 Usage Tracking (4 endpoints)
- Get Current Usage
- Get Usage History
- Get Usage by Resource
- Get Usage Forecast

### 👑 Admin Dashboard (10 endpoints)
- Get Dashboard Summary
- Get All Users
- Get User Details
- Assign Plan to User
- Get Usage Statistics
- Get Subscription Statistics
- Get All Plans (Admin)
- Get All Admin Users
- Add Admin User
- Remove Admin User
- Debug Token (Development Only)

## 🔄 Legacy API Routes (9 endpoints)
- Search Service
- Get Job Status
- Get Active Jobs
- Get All Jobs
- Get Performance Metrics
- Job Control Operations (Pause/Resume/Stop)
- Debug Job
- User Management
- Admin Statistics

## 🔐 OAuth Routes (8 endpoints)
- OAuth Setup
- OAuth Authorization
- OAuth Callback
- Google Sheets OAuth
- OAuth Management

## 🏢 Multi-tenant Routes (12 endpoints)
- Multi-tenant Authentication
- Multi-tenant OAuth URL Generation
- Multi-tenant Connection Status
- Multi-tenant Sheets Management
- Multi-tenant Data Management
- Multi-tenant Account Management

## 🔧 Legacy Job Routes (8 endpoints)
- Search Service (Legacy)
- Multi-tenant Search
- Job Status (Legacy)
- All Jobs (Legacy)
- Job Control (Legacy)
- Debug Job (Legacy)

## 📊 Performance & Monitoring Routes (2 endpoints)
- Performance Metrics
- Force Garbage Collection

## 🏥 Health & System Routes (1 endpoint)
- System Health

## 📚 API Documentation Routes (1 endpoint)
- API Documentation

## 💰 Payment Routes (8 endpoints)
- Payment Management
- Payment Statistics
- User Payments
- User Subscriptions
- Payment Verification
- Payment Webhooks
- Payment Callbacks
- Mock Payment Webhook

## 🔑 API Key Routes (9 endpoints)
- API Key Initialization
- Admin API Key Management
- API Key Creation
- API Key Plans
- API Key Usage Stats
- API Key Plan Updates
- API Key Deactivation
- API Key Usage Reset
- User API Keys

## 📊 User Data Routes (6 endpoints)
- All User Data
- User Data Summary
- User Data by City
- User Data by Keyword
- User Recent Activity
- Export User Data to CSV

## 🚫 Deprecated Routes (4 endpoints)
- Legacy Dashboards
- Legacy OAuth Setup

## 🧪 Testing Workflow

### 1. Health Check
```bash
GET {{baseUrl}}/health
```
Verify the server is running and healthy.

### 2. Authentication Flow
```bash
# Step 1: Get OAuth URL
GET {{baseUrl}}/auth/google/authorize

# Step 2: Complete OAuth (browser)
# Step 3: Get tokens from callback

# Step 4: Set tokens in environment
# jwtToken = response.accessToken
# refreshToken = response.refreshToken
```

### 3. Test Protected Endpoints
```bash
# Test with JWT token
GET {{baseUrl}}/auth/me
Authorization: Bearer {{jwtToken}}
```

### 4. Subscription Flow
```bash
# Get available plans
GET {{baseUrl}}/subscription/plans

# Create subscription
POST {{baseUrl}}/subscription/create
{
  "planId": "basic",
  "currency": "INR"
}

# Verify payment (after payment)
POST {{baseUrl}}/subscription/verify-payment
{
  "razorpay_payment_id": "pay_1234567890",
  "razorpay_order_id": "order_1234567890",
  "razorpay_signature": "signature_hash"
}
```

### 5. Google Sheets Integration
```bash
# Connect Google Sheets
GET {{baseUrl}}/google/sheets/connect

# Get available sheets
GET {{baseUrl}}/google/sheets/available

# Create new sheet
POST {{baseUrl}}/google/sheets/create
{
  "name": "Business Leads",
  "description": "Generated business leads"
}
```

### 6. Job Management
```bash
# Create a job
POST {{baseUrl}}/jobs/create
{
  "city": "Delhi",
  "keyword": "bridal makeup artist",
  "method": "api",
  "scraper": {
    "maxResults": 50,
    "headless": true
  }
}

# Monitor job status
GET {{baseUrl}}/jobs/{{jobId}}

# Control job
POST {{baseUrl}}/jobs/{{jobId}}/pause
POST {{baseUrl}}/jobs/{{jobId}}/resume
POST {{baseUrl}}/jobs/{{jobId}}/stop
```

### 7. Usage Tracking
```bash
# Get current usage
GET {{baseUrl}}/usage/current

# Get usage history
GET {{baseUrl}}/usage/history?period=month

# Get usage forecast
GET {{baseUrl}}/usage/forecast
```

### 8. Admin Operations (Admin Token Required)
```bash
# Get dashboard summary
GET {{baseUrl}}/admin/dashboard

# Get all users
GET {{baseUrl}}/admin/users?page=1&limit=20

# Assign plan to user
POST {{baseUrl}}/admin/users/assign-plan
{
  "userEmail": "user@example.com",
  "planId": "pro",
  "duration": 30
}
```

## 🔧 Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `baseUrl` | API base URL | `http://localhost:3000` |
| `jwtToken` | JWT access token | `eyJhbGciOiJIUzI1NiIs...` |
| `refreshToken` | JWT refresh token | `refresh_token_here` |
| `authCode` | OAuth authorization code | `4/0AVMBsJhZ4Dn-qjlO4...` |
| `state` | OAuth state parameter | `{"userEmail":"user@example.com"}` |
| `sheetId` | Google Sheet ID | `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` |
| `jobId` | Job identifier | `job_1642248600000_abc123` |
| `razorpaySignature` | Razorpay webhook signature | `sha256_hash_here` |
| `apiKey` | API key for legacy endpoints | `api_key_here` |

## 🚨 Error Handling

### Common Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Rate Limited
- `500` - Internal Server Error

### Error Response Format
```json
{
  "error": "Error type",
  "message": "Human readable error message",
  "details": ["Validation errors"],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 📊 Rate Limiting

| Plan | Requests/Minute | Description |
|------|----------------|-------------|
| Free | 10 | Basic usage |
| Basic | 100 | Standard usage |
| Pro | 500 | High usage |
| Enterprise | 1000 | Unlimited usage |

## 🔍 Testing Tips

1. **Start with public endpoints** (health check, plans)
2. **Complete authentication flow** before testing protected endpoints
3. **Use environment variables** for dynamic values
4. **Check response headers** for rate limiting info
5. **Test error scenarios** with invalid data
6. **Use the debug endpoint** to verify token payload
7. **Test webhook endpoints** with mock data
8. **Verify pagination** with different page/limit values

## 📝 Notes

- All timestamps are in ISO 8601 format
- All monetary values are in INR (Indian Rupees)
- Google Sheet IDs are required for data operations
- Job IDs are generated automatically and returned in responses
- Admin endpoints require admin/super admin privileges
- Legacy endpoints use API key authentication
- OAuth flows require browser interaction

---

**Total Endpoints: 120+** | **Authentication Methods: 3** | **Rate Limiting: Yes** | **Webhook Support: Yes**

