# Local Business Scraper API - Comprehensive Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Setup & Installation](#setup--installation)
3. [Authentication & Security](#authentication--security)
4. [API Documentation](#api-documentation)
5. [Error Handling](#error-handling)
6. [Database Schema & Models](#database-schema--models)
7. [Deployment & Production](#deployment--production)
8. [Changelog & Versioning](#changelog--versioning)
9. [Appendix](#appendix)

---

## Project Overview

### Purpose
The Local Business Scraper API is a sophisticated lead generation system that combines AI-powered search phrase generation with Google Maps data extraction to generate comprehensive business leads for local markets. The system is designed for multi-tenant SaaS operations with robust API key management, rate limiting, and performance monitoring.

### Tech Stack
- **Backend Framework**: Node.js with Express.js
- **Architecture Pattern**: MVC (Model-View-Controller)
- **Database**: PostgreSQL with connection pooling
- **Authentication**: API Key-based with OAuth2 for Google services
- **External APIs**: Google Maps API, Gemini AI API, Google Sheets API
- **Web Scraping**: Puppeteer for browser automation
- **Performance**: Streaming processing, batch operations, memory management
- **Deployment**: Render, Vercel, or traditional hosting

### High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client Apps   │    │   API Gateway    │    │   Processing    │
│                 │    │   (Express.js)   │    │    Service      │
│ - Web Dashboard │◄──►│                  │◄──►│                 │
│ - Mobile Apps   │    │ - Rate Limiting  │    │ - Job Manager   │
│ - API Clients   │    │ - Auth Middleware│    │ - AI Services   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   Data Layer     │
                       │                  │
                       │ - PostgreSQL     │
                       │ - Google Sheets  │
                       │ - OAuth Store    │
                       └──────────────────┘
```

### Core Workflow
1. **Input Validation**: City and keyword validation with sanitization
2. **AI Generation**: Gemini AI creates diverse search phrases
3. **Maps Search**: Google Maps API searches for businesses
4. **Data Extraction**: Detailed business information extraction
5. **Batch Processing**: Efficient data saving to multiple destinations
6. **Progress Tracking**: Real-time job status and performance metrics

---

## Setup & Installation

### Prerequisites
- **Node.js**: Version 18.17.0 or higher
- **npm**: Version 8.0.0 or higher
- **PostgreSQL**: Version 12.0 or higher
- **Chrome/Chromium**: For Puppeteer web scraping operations

### Environment Variables

Create a `.env` file in the root directory:

   ```bash
# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/database_name
# OR individual settings:
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password
DB_SSL=true

# API Keys
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Google Sheets Configuration
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEETS_OAUTH_JSON={"type":"service_account",...}

# Optional Configuration
NODE_ENV=production
PORT=3000
DEBUG_DB=false
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

### Step-by-Step Setup

#### 1. Clone and Install Dependencies
   ```bash
git clone <repository-url>
cd pitchers
   npm install
   ```

#### 2. Database Setup
```bash
# Create database tables
npm run create:db

# Setup initial data
npm run setup:db
```

#### 3. OAuth Setup
```bash
# Automated OAuth setup
npm run setup:oauth

# Manual OAuth setup (if automated fails)
npm run setup:oauth:manual
```

#### 4. API Key Setup
```bash
# Setup API key system
npm run setup:api-keys
```

#### 5. Test Connections
   ```bash
# Verify all services are working
npm run test:connections
   ```

#### 6. Start the Server
   ```bash
# Development mode
   npm run dev

# Production mode
npm start
   ```

---

## Authentication & Security

### Authentication Methods

#### 1. API Key Authentication (Primary)
- **Format**: `Bearer your-api-key` or `x-api-key: your-api-key`
- **Generation**: Cryptographically secure random generation
- **Prefix**: `pk_` (public key)
- **Length**: 64 characters

#### 2. OAuth2 for Google Services
- **Scopes**: Google Sheets, Google Maps
- **Flow**: Authorization Code with Refresh Token
- **Storage**: Database-backed OAuth store

### Security Features

#### Rate Limiting
- **Per API Key**: Configurable per minute limits
- **Plan-based Limits**:
  - Free: 5 requests/minute
  - Basic: 20 requests/minute
  - Pro: 100 requests/minute
  - Enterprise: 500 requests/minute

#### Input Validation & Sanitization
- **City Validation**: 2-100 characters, alphanumeric + special chars
- **Keyword Validation**: 2-200 characters, alphanumeric + special chars
- **SQL Injection Prevention**: Parameterized queries
- **XSS Prevention**: Input sanitization and output encoding

---

## API Documentation

### Base URL
```
Production: https://your-domain.com
Development: http://localhost:3000
```

### Authentication Headers
```http
Authorization: Bearer pk_your_api_key_here
# OR
x-api-key: pk_your_api_key_here
```

### Core Endpoints

#### Health & Monitoring

##### GET /health
System health check with comprehensive monitoring data.

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
    }
  },
  "api": {
    "keysConfigured": {
      "gemini": true,
      "googleMaps": true,
      "googleSheets": true
    }
  },
  "jobs": {
    "active": 2,
    "total": 10,
    "completed": 7,
    "errors": 1
  }
}
```

#### Lead Generation (SaaS API)

##### POST /api/v1/search-service
Start a new lead generation job (requires API key authentication).

**Request Body:**
```json
{
  "city": "Delhi",
  "keyword": "bridal makeup artist",
  "method": "api",
  "scraper": {
    "maxResults": 100,
    "maxScrollPages": 5,
    "headless": true,
    "wantWebsite": true,
    "wantEmail": true,
    "emailDeepPaths": false
  }
}
```

**Response Example:**
```json
{
  "jobId": "saas_user_1642248600000_abc123",
  "status": "started",
  "message": "Lead generation job initiated via SaaS API",
  "user": {
    "email": "user@example.com",
    "plan": "pro",
    "usage": {
      "current": 45,
      "limit": 1000
    }
  }
}
```

#### Job Management

##### GET /api/v1/status/:jobId
Get the status and progress of a specific job.

**Response Example:**
```json
{
  "success": true,
  "status": "searching_maps",
  "processed": 89,
  "total": 156,
  "progress": {
    "totalPhrases": 45,
    "processedPhrases": 12,
    "totalBusinesses": 156,
    "savedBusinesses": 89
  }
}
```

##### GET /api/v1/jobs
Get all jobs (active and completed).

**Response Example:**
```json
{
  "jobs": [
    {
      "jobId": "saas_user_1642248600000_abc123",
      "city": "Delhi",
      "keyword": "bridal makeup artist",
      "status": "completed",
      "progress": {
        "totalPhrases": 45,
        "processedPhrases": 45,
        "totalBusinesses": 234,
        "savedBusinesses": 234
      }
    }
  ],
  "totalJobs": 1
}
```

#### Job Control

##### POST /api/v1/jobs/:jobId/pause
Pause a currently running job.

##### POST /api/v1/jobs/:jobId/resume
Resume a paused job.

##### POST /api/v1/jobs/:jobId/stop
Stop a running or paused job.

#### Performance Monitoring

##### GET /api/v1/performance
Get detailed performance metrics and monitoring data.

**Response Example:**
```json
{
  "performance": {
    "apiCalls": {
      "gemini": { "count": 10, "avgResponseTime": 1500, "errors": 0 },
      "googleMapsSearch": { "count": 45, "avgResponseTime": 800, "errors": 2 },
      "googlePlaceDetails": { "count": 234, "avgResponseTime": 600, "errors": 5 },
      "googleSheets": { "count": 229, "avgResponseTime": 400, "errors": 3 }
    },
    "processing": {
      "jobsCompleted": 5,
      "avgJobDuration": 45000,
      "saveSuccessRate": 95
    },
    "memoryUsageMB": { "current": 85, "peak": 120 }
  }
}
```

#### API Key Management

##### POST /api-keys/create
Create a new API key (no authentication required).

**Request Body:**
```json
{
  "userEmail": "user@example.com",
  "planType": "pro"
}
```

**Response Example:**
```json
{
  "success": true,
  "apiKey": "pk_abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
    "planType": "pro",
  "usageLimit": 1000,
  "rateLimit": 20
}
```

##### GET /api-keys/plans
Get available subscription plans.

**Response Example:**
```json
{
    "plans": {
      "free": {
      "name": "Free",
        "usageLimit": 100,
        "rateLimit": 5,
      "expiresIn": "30 days",
      "price": "$0/month"
    },
    "basic": {
      "name": "Basic",
      "usageLimit": 1000,
      "rateLimit": 20,
      "expiresIn": "Never",
      "price": "$29/month"
      },
      "pro": {
      "name": "Pro",
        "usageLimit": 10000,
      "rateLimit": 100,
      "expiresIn": "Never",
      "price": "$99/month"
    }
  }
}
```

##### GET /api-keys/:apiKey/stats
Get API key usage statistics.

**Response Example:**
```json
{
  "success": true,
  "apiKey": "pk_abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
  "userEmail": "user@example.com",
  "planType": "pro",
  "usage": {
    "current": 45,
    "limit": 1000,
    "remaining": 955,
    "percentage": 4.5
  },
  "rateLimit": {
    "limit": 20,
    "current": 3,
    "remaining": 17,
    "resetTime": "2024-01-15T10:35:00.000Z"
  }
}
```

### Job Status Values

| Status | Description |
|--------|-------------|
| `started` | Job has been initiated and is queued for processing |
| `generating_phrases` | AI is generating search phrases from city and keyword |
| `searching_maps` | Searching Google Maps for businesses using generated phrases |
| `extracting_details` | Extracting detailed business information from Google Places |
| `completed` | Job completed successfully, all data saved |
| `paused` | Job has been paused by user request |
| `stopped` | Job has been stopped by user request |
| `error` | Job encountered an error and could not complete |

---

## Error Handling

### Standard Error Response Format

All API endpoints return errors in a consistent format:

```json
{
  "error": "Error type identifier",
  "message": "Human-readable error description",
  "details": ["Array of specific validation errors"],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Common HTTP Status Codes

| Status Code | Description | Common Causes |
|-------------|-------------|---------------|
| `200` | Success | Request completed successfully |
| `201` | Created | Resource created successfully |
| `400` | Bad Request | Invalid input parameters or validation errors |
| `401` | Unauthorized | Missing or invalid API key |
| `403` | Forbidden | Insufficient permissions or plan limits |
| `404` | Not Found | Resource or endpoint not found |
| `429` | Too Many Requests | Rate limit or usage limit exceeded |
| `500` | Internal Server Error | Server-side processing error |

### Error Types

#### Authentication Errors
```json
{
  "error": "Authentication required",
  "message": "API key is required. Include it in Authorization header as 'Bearer your-api-key' or as x-api-key header"
}
```

#### Validation Errors
```json
{
  "error": "Validation failed",
  "details": [
    "City is required",
    "Keyword must be at least 2 characters long"
  ],
  "message": "Please provide valid city and keyword parameters"
}
```

#### Rate Limit Errors
```json
{
  "error": "Rate limit exceeded",
  "message": "Rate limit of 20 requests per minute exceeded",
  "rateLimit": {
    "limit": 20,
    "remaining": 0,
    "resetTime": "2024-01-15T10:35:00.000Z"
  }
}
```

---

## Database Schema & Models

### Core Tables

#### 1. API Keys Table (`api_keys`)

```sql
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    plan_type VARCHAR(50) NOT NULL DEFAULT 'free',
    usage_limit INTEGER NOT NULL DEFAULT 100,
    usage_count INTEGER NOT NULL DEFAULT 0,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 10,
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP
);
```

#### 2. Businesses Table (`businesses`)

```sql
CREATE TABLE businesses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    website VARCHAR(500),
    rating DECIMAL(2,1),
    review_count INTEGER,
    place_id VARCHAR(255) UNIQUE,
    city VARCHAR(100),
    keyword VARCHAR(100),
    search_phrase VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 3. User Google Sheets Table (`user_google_sheets`)

```sql
CREATE TABLE user_google_sheets (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    sheet_id VARCHAR(255) NOT NULL,
    sheet_name VARCHAR(255) NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Model Classes

#### ApiKey Model
```javascript
class ApiKey {
    // Core methods
    async createApiKey(userEmail, planType)
    async validateApiKey(apiKey)
    async incrementUsage(apiKey)
    async updatePlan(apiKey, newPlanType)
    async deactivateApiKey(apiKey)
    
    // Utility methods
    generateApiKey()
    getPlanLimits(planType)
    isExpired(apiKey)
}
```

#### Database Service
```javascript
class DatabaseService {
    // Connection management
    async connect()
    async disconnect()
    
    // Table operations
    async createBusinessesTable()
    async createApiKeysTable()
    async createUserGoogleSheetsTable()
    
    // Business data operations
    async saveBusiness(businessData)
    async getBusinessesByCity(city, keyword)
    async updateBusiness(placeId, updates)
}
```

---

## Deployment & Production

### Production Environment Setup

#### 1. Environment Configuration
```bash
# Production environment variables
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://username:password@host:port/database
GEMINI_API_KEY=your_production_key
GOOGLE_MAPS_API_KEY=your_production_key
GOOGLE_SHEETS_OAUTH_JSON=your_production_credentials
```

#### 2. Process Management

**PM2 Configuration (`ecosystem.config.js`):**
```javascript
module.exports = {
  apps: [{
    name: 'local-business-scraper',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    max_memory_restart: '1G',
    node_args: '--expose-gc --max-old-space-size=1024'
  }]
};
```

**Start with PM2:**
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### 3. Docker Deployment

**Dockerfile:**
```dockerfile
FROM node:18-alpine

# Install Chrome dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Chrome environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

### Logging & Monitoring

#### 1. Performance Monitoring
```javascript
// Custom performance monitoring
class PerformanceMonitor {
    trackApiCall(service, operation, duration, success) {
        // Track API response times and success rates
    }
    
    trackMemoryUsage() {
        // Monitor memory usage and trigger GC if needed
    }
    
    generateMetrics() {
        // Generate comprehensive performance metrics
    }
}
```

#### 2. Health Checks
```javascript
// Enhanced health check endpoint
app.get('/health', async (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        database: await checkDatabaseConnection(),
        externalServices: await checkExternalServices()
    };
    
    res.json(health);
});
```

---

## Changelog & Versioning

### Versioning Strategy

The API follows **Semantic Versioning (SemVer)**:
- **MAJOR.MINOR.PATCH**
- **MAJOR**: Breaking changes (incompatible API changes)
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Current Version: 1.0.0

### Release Notes Format

#### Version 1.0.0 (2024-01-15)
**Major Features:**
- Initial release of Local Business Scraper API
- AI-powered search phrase generation using Gemini
- Google Maps integration for business data extraction
- Multi-tenant SaaS architecture with API key management
- Real-time job monitoring and progress tracking
- Comprehensive performance monitoring and metrics

**Technical Features:**
- Express.js backend with MVC architecture
- PostgreSQL database with connection pooling
- OAuth2 integration for Google services
- Puppeteer-based web scraping capabilities
- Rate limiting and usage tracking
- Batch processing for Google Sheets

---

## Appendix

### Glossary of Key Terms

| Term | Definition |
|------|------------|
| **API Key** | Unique identifier for authenticating API requests |
| **Job** | A lead generation task for a specific city and keyword |
| **Search Phrase** | AI-generated combination of business keyword and location |
| **Place ID** | Google's unique identifier for a business location |
| **Batch Processing** | Grouping multiple operations for efficiency |
| **Rate Limiting** | Controlling request frequency per user |
| **Usage Limit** | Monthly maximum number of API requests |
| **Multi-tenant** | Architecture supporting multiple users with isolated data |

### API Response Time Benchmarks

| Operation | Average Response Time | 95th Percentile |
|-----------|----------------------|------------------|
| Health Check | 50ms | 100ms |
| Job Creation | 200ms | 500ms |
| Status Check | 100ms | 250ms |
| Lead Generation | 30-300 seconds | 600 seconds |
| Performance Metrics | 150ms | 300ms |

### Rate Limit Reference

| Plan | Requests/Minute | Monthly Limit | Concurrent Jobs |
|------|----------------|---------------|-----------------|
| Free | 5 | 100 | 1 |
| Basic | 20 | 1,000 | 3 |
| Pro | 100 | 10,000 | 10 |
| Enterprise | 500 | 100,000 | Unlimited |

### Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Application environment |
| `PORT` | No | `3000` | Server port |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `GEMINI_API_KEY` | Yes | - | Gemini AI API key |
| `GOOGLE_MAPS_API_KEY` | Yes | - | Google Maps API key |
| `GOOGLE_SHEETS_OAUTH_JSON` | Yes | - | Google Sheets credentials |

### Support & Contact

For technical support, API questions, or feature requests:

- **Documentation**: [API Documentation URL]
- **GitHub Issues**: [Repository Issues Page]
- **Email Support**: support@yourcompany.com
- **Developer Portal**: [Developer Portal URL]

---

*This documentation is maintained by the Local Business Scraper API development team. Last updated: January 2024.*
