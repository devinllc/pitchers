# 🚀 Implementation Plan: MongoDB + OAuth + API System

## 📋 Project Overview

Transform the current prototype into a production-ready SaaS platform with:
- MongoDB-based user authentication (email/password + Google OAuth)
- API-first architecture with usage limits
- Subscription-based pricing with real-time quota tracking
- Scalable infrastructure ready for 100+ users/day

## 🎯 Phase 1: Core Authentication & Database (Week 1-2)

### 🔧 Technical Setup

#### 1.1 MongoDB Setup
```bash
# Install MongoDB dependencies
npm install mongoose bcryptjs jsonwebtoken passport passport-google-oauth20 passport-jwt

# Environment variables
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/leadscaper
JWT_SECRET=your-super-secret-jwt-key-256-bits
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

#### 1.2 Database Models
Create Mongoose models for:
- ✅ Users (with OAuth support)
- ✅ Jobs (with user association)
- ✅ Businesses (with job association)
- ✅ Usage Analytics (for tracking)

#### 1.3 Authentication System
- ✅ JWT-based authentication
- ✅ Google OAuth integration
- ✅ API key generation and validation
- ✅ Password hashing with bcrypt

### 📊 Database Schema Implementation

```javascript
// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String }, // Optional for OAuth users
  googleId: { type: String, sparse: true },
  
  profile: {
    firstName: String,
    lastName: String,
    avatar: String,
    company: String,
    jobTitle: String
  },
  
  subscription: {
    plan: { type: String, enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
    status: { type: String, enum: ['active', 'cancelled', 'suspended'], default: 'active' },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    stripeCustomerId: String,
    stripeSubscriptionId: String
  },
  
  limits: {
    phrasesPerMonth: { type: Number, default: 20 },
    resultsPerPhrase: { type: Number, default: 15 },
    concurrentJobs: { type: Number, default: 2 },
    apiCallsPerMinute: { type: Number, default: 10 }
  },
  
  usage: {
    currentMonth: String,
    phrasesUsed: { type: Number, default: 0 },
    resultsGenerated: { type: Number, default: 0 },
    apiCallsToday: { type: Number, default: 0 },
    lastResetDate: Date
  },
  
  apiKey: { type: String, unique: true },
  isEmailVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

module.exports = mongoose.model('User', userSchema);
```

### 🔐 Authentication Routes

```javascript
// routes/auth.js
const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

// Generate API key
function generateApiKey() {
  return 'sk_live_' + require('crypto').randomBytes(32).toString('hex');
}

// Register with email/password
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, company } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const user = await User.create({
      email,
      password,
      profile: { firstName, lastName, company },
      apiKey: generateApiKey(),
      limits: getPlanLimits('starter')
    });
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        profile: user.profile,
        subscription: user.subscription,
        limits: user.limits,
        apiKey: user.apiKey
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login with email/password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    user.lastLoginAt = new Date();
    await user.save();
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        profile: user.profile,
        subscription: user.subscription,
        limits: user.limits,
        usage: user.usage
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

## 🎯 Phase 2: API System & Usage Limits (Week 3-4)

### 🔌 API Architecture

#### 2.1 Middleware Implementation
```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// API Key authentication
exports.authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    const user = await User.findOne({ apiKey, isActive: true });
    if (!user) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Check usage limits
exports.checkUsageLimits = (resourceType) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const currentMonth = new Date().toISOString().slice(0, 7);
      
      // Reset usage if new month
      if (user.usage.currentMonth !== currentMonth) {
        user.usage = {
          currentMonth,
          phrasesUsed: 0,
          resultsGenerated: 0,
          apiCallsToday: 0,
          lastResetDate: new Date()
        };
        await user.save();
      }
      
      // Check specific limits
      if (resourceType === 'phrases') {
        const requestedPhrases = req.body.phrasesRequested || 1;
        const available = user.limits.phrasesPerMonth - user.usage.phrasesUsed;
        
        if (requestedPhrases > available) {
          return res.status(429).json({
            error: 'Phrase limit exceeded',
            available,
            requested: requestedPhrases,
            limit: user.limits.phrasesPerMonth
          });
        }
      }
      
      next();
    } catch (error) {
      res.status(500).json({ error: 'Usage check failed' });
    }
  };
};
```

#### 2.2 Job Management API
```javascript
// routes/jobs.js
const express = require('express');
const { authenticateApiKey, checkUsageLimits } = require('../middleware/auth');
const Job = require('../models/Job');
const ProcessingService = require('../services/ProcessingService');
const router = express.Router();

const processingService = new ProcessingService();

// Create job
router.post('/', 
  authenticateApiKey,
  checkUsageLimits('phrases'),
  async (req, res) => {
    try {
      const { city, keyword, phrasesRequested, maxResultsPerPhrase } = req.body;
      
      // Validate limits
      if (maxResultsPerPhrase > req.user.limits.resultsPerPhrase) {
        return res.status(400).json({
          error: 'Results per phrase exceeds limit',
          limit: req.user.limits.resultsPerPhrase,
          requested: maxResultsPerPhrase
        });
      }
      
      // Create job
      const job = await Job.create({
        userId: req.user._id,
        city,
        keyword,
        phrasesRequested,
        maxResultsPerPhrase,
        status: 'queued'
      });
      
      // Start processing
      processingService.processJob(job._id);
      
      res.status(201).json({
        success: true,
        job: {
          id: job._id,
          status: job.status,
          city: job.city,
          keyword: job.keyword,
          phrasesRequested: job.phrasesRequested,
          maxResultsPerPhrase: job.maxResultsPerPhrase,
          createdAt: job.createdAt
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get job status
router.get('/:jobId', authenticateApiKey, async (req, res) => {
  try {
    const job = await Job.findOne({ 
      _id: req.params.jobId, 
      userId: req.user._id 
    });
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json({
      success: true,
      job: {
        id: job._id,
        status: job.status,
        progress: job.progress,
        results: job.results,
        usage: job.usage,
        createdAt: job.createdAt,
        completedAt: job.completedAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### 📊 Usage Tracking System

```javascript
// services/UsageTrackingService.js
const User = require('../models/User');
const UsageAnalytics = require('../models/UsageAnalytics');

class UsageTrackingService {
  async trackUsage(userId, resourceType, quantity = 1) {
    try {
      const user = await User.findById(userId);
      const currentMonth = new Date().toISOString().slice(0, 7);
      
      // Reset if new month
      if (user.usage.currentMonth !== currentMonth) {
        user.usage = {
          currentMonth,
          phrasesUsed: 0,
          resultsGenerated: 0,
          apiCallsToday: 0,
          lastResetDate: new Date()
        };
      }
      
      // Update usage
      switch (resourceType) {
        case 'phrases':
          user.usage.phrasesUsed += quantity;
          break;
        case 'results':
          user.usage.resultsGenerated += quantity;
          break;
        case 'api_calls':
          user.usage.apiCallsToday += quantity;
          break;
      }
      
      await user.save();
      
      // Update analytics
      await this.updateAnalytics(userId, resourceType, quantity);
      
    } catch (error) {
      console.error('Usage tracking error:', error);
    }
  }
  
  async updateAnalytics(userId, resourceType, quantity) {
    const month = new Date().toISOString().slice(0, 7);
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    
    await UsageAnalytics.findOneAndUpdate(
      { userId, month, date },
      {
        $inc: {
          [`dailyUsage.${resourceType}`]: quantity,
          [`monthlyUsage.${resourceType}`]: quantity
        }
      },
      { upsert: true }
    );
  }
}

module.exports = UsageTrackingService;
```

## 🎯 Phase 3: Integration & Testing (Week 5-6)

### 🔄 Processing Service Integration

```javascript
// services/ProcessingService.js (Updated)
const UsageTrackingService = require('./UsageTrackingService');
const Job = require('../models/Job');
const Business = require('../models/Business');

class ProcessingService {
  constructor() {
    this.usageTracker = new UsageTrackingService();
    // ... existing initialization
  }
  
  async processJob(jobId) {
    try {
      const job = await Job.findById(jobId).populate('userId');
      if (!job) throw new Error('Job not found');
      
      // Update job status
      job.status = 'processing';
      await job.save();
      
      // Track phrase usage
      await this.usageTracker.trackUsage(
        job.userId._id, 
        'phrases', 
        job.phrasesRequested
      );
      
      // Generate search phrases
      const phrases = await this.generateSearchPhrases(
        job.city, 
        job.keyword, 
        job.phrasesRequested
      );
      
      job.progress = {
        totalPhrases: phrases.length,
        processedPhrases: 0,
        totalBusinesses: 0,
        savedBusinesses: 0
      };
      await job.save();
      
      // Process each phrase
      const allBusinesses = [];
      for (let i = 0; i < phrases.length; i++) {
        const phrase = phrases[i];
        
        // Check if job was paused/stopped
        const currentJob = await Job.findById(jobId);
        if (currentJob.status !== 'processing') {
          break;
        }
        
        // Search for businesses
        const businesses = await this.searchBusinesses(
          phrase, 
          job.maxResultsPerPhrase
        );
        
        // Save businesses
        for (const businessData of businesses) {
          const business = await Business.create({
            userId: job.userId._id,
            jobId: job._id,
            ...businessData,
            searchPhrase: phrase,
            searchCity: job.city,
            searchKeyword: job.keyword
          });
          allBusinesses.push(business);
        }
        
        // Update progress
        job.progress.processedPhrases = i + 1;
        job.progress.totalBusinesses = allBusinesses.length;
        job.progress.savedBusinesses = allBusinesses.length;
        await job.save();
        
        // Track results
        await this.usageTracker.trackUsage(
          job.userId._id, 
          'results', 
          businesses.length
        );
      }
      
      // Complete job
      job.status = 'completed';
      job.completedAt = new Date();
      job.results = {
        summary: {
          totalFound: allBusinesses.length,
          totalSaved: allBusinesses.length,
          saveSuccessRate: 100,
          processingTime: Date.now() - job.createdAt.getTime()
        }
      };
      await job.save();
      
    } catch (error) {
      // Handle job failure
      await Job.findByIdAndUpdate(jobId, {
        status: 'failed',
        error: error.message
      });
      console.error('Job processing failed:', error);
    }
  }
}

module.exports = ProcessingService;
```

### 🧪 Testing Strategy

#### 3.1 Unit Tests
```javascript
// tests/auth.test.js
const request = require('supertest');
const app = require('../app');
const User = require('../models/User');

describe('Authentication', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });
  
  test('should register new user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe'
      });
    
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.user.email).toBe('test@example.com');
    expect(response.body.token).toBeDefined();
  });
  
  test('should login existing user', async () => {
    // Create user first
    await User.create({
      email: 'test@example.com',
      password: 'password123',
      apiKey: 'sk_live_test123'
    });
    
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.token).toBeDefined();
  });
});
```

#### 3.2 API Tests
```javascript
// tests/jobs.test.js
const request = require('supertest');
const app = require('../app');
const User = require('../models/User');

describe('Jobs API', () => {
  let user, apiKey;
  
  beforeEach(async () => {
    await User.deleteMany({});
    user = await User.create({
      email: 'test@example.com',
      apiKey: 'sk_live_test123',
      limits: {
        phrasesPerMonth: 50,
        resultsPerPhrase: 20,
        concurrentJobs: 2
      }
    });
    apiKey = user.apiKey;
  });
  
  test('should create job with valid API key', async () => {
    const response = await request(app)
      .post('/api/jobs')
      .set('X-API-Key', apiKey)
      .send({
        city: 'pune',
        keyword: 'computer classes',
        phrasesRequested: 10,
        maxResultsPerPhrase: 15
      });
    
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.job.city).toBe('pune');
  });
  
  test('should reject job exceeding limits', async () => {
    const response = await request(app)
      .post('/api/jobs')
      .set('X-API-Key', apiKey)
      .send({
        city: 'pune',
        keyword: 'computer classes',
        phrasesRequested: 100, // Exceeds limit of 50
        maxResultsPerPhrase: 15
      });
    
    expect(response.status).toBe(429);
    expect(response.body.error).toContain('limit exceeded');
  });
});
```

## 📊 Deployment & Infrastructure

### 🚀 Production Deployment

#### Environment Setup
```bash
# Production environment variables
NODE_ENV=production
PORT=3000

# MongoDB
MONGODB_URI=mongodb+srv://prod-user:password@cluster.mongodb.net/leadscaper-prod

# Authentication
JWT_SECRET=your-production-jwt-secret-256-bits
GOOGLE_CLIENT_ID=your-production-google-client-id
GOOGLE_CLIENT_SECRET=your-production-google-client-secret

# API Keys
GEMINI_API_KEY=your-production-gemini-key
GOOGLE_MAPS_API_KEY=your-production-maps-key

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
```

#### Docker Configuration
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

CMD ["npm", "start"]
```

#### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=${MONGODB_URI}
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - redis
    restart: unless-stopped
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped
  
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped
```

## 📈 Success Metrics & Monitoring

### 🎯 Key Performance Indicators

#### Technical Metrics
- **API Response Time**: <500ms average
- **System Uptime**: 99.9%
- **Database Query Time**: <100ms average
- **Job Processing Time**: <30 seconds per phrase
- **Error Rate**: <1%

#### Business Metrics
- **User Registration Rate**: 10+ new users/day
- **API Usage Growth**: 20% month-over-month
- **Customer Retention**: >90% monthly retention
- **Revenue Growth**: 25% month-over-month

### 📊 Monitoring Setup

```javascript
// monitoring/metrics.js
const prometheus = require('prom-client');

// Create metrics
const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code']
});

const jobProcessingDuration = new prometheus.Histogram({
  name: 'job_processing_duration_seconds',
  help: 'Duration of job processing in seconds',
  labelNames: ['status']
});

const activeUsers = new prometheus.Gauge({
  name: 'active_users_total',
  help: 'Total number of active users'
});

// Middleware to track HTTP requests
exports.trackHttpRequest = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
  });
  
  next();
};

// Track job processing
exports.trackJobProcessing = (duration, status) => {
  jobProcessingDuration.labels(status).observe(duration);
};

// Update active users count
exports.updateActiveUsers = async () => {
  const count = await User.countDocuments({ 
    isActive: true,
    lastLoginAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
  });
  activeUsers.set(count);
};
```

## 🎯 Timeline & Milestones

### Week 1-2: Foundation
- ✅ MongoDB setup and models
- ✅ Authentication system (JWT + OAuth)
- ✅ Basic API structure
- ✅ User registration/login

### Week 3-4: API Development
- ✅ Job management API
- ✅ Usage tracking system
- ✅ Rate limiting middleware
- ✅ API documentation

### Week 5-6: Integration & Testing
- ✅ Processing service integration
- ✅ Comprehensive testing
- ✅ Performance optimization
- ✅ Documentation completion

### Week 7-8: Deployment & Launch
- ✅ Production deployment
- ✅ Monitoring setup
- ✅ Load testing
- ✅ Beta user onboarding

## 💰 Budget Allocation

### Development Costs
- **Developer Time**: 8 weeks × $5,000/week = $40,000
- **Infrastructure Setup**: $2,000
- **Third-party Services**: $1,000
- **Testing & QA**: $3,000
- **Total Development**: $46,000

### Monthly Operating Costs (100 users/day)
- **Infrastructure**: $1,336 (serverless) or $844 (EC2)
- **API Costs**: $16,374 (with optimization)
- **Monitoring & Tools**: $240
- **Total Monthly**: $17,950

### Revenue Projections
- **Monthly Revenue**: $12,450 (with optimized pricing)
- **Break-even**: Month 4 (with growth)
- **Profitability**: Month 6+

This implementation plan provides a clear roadmap to transform your prototype into a production-ready SaaS platform with MongoDB authentication, API-based architecture, and usage-based pricing that can scale to serve hundreds of users while maintaining profitability.