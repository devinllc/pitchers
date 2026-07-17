# 🚀 Production Implementation Guide

## 🔥 Critical Issues to Fix Immediately

### 1. **Authentication & Security** (Priority: CRITICAL)

#### Current Risk: 🚨 SEVERE
- Anyone can start/stop jobs
- No user isolation
- API keys exposed

#### Implementation:

```javascript
// auth/middleware.js
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

class AuthMiddleware {
  static authenticate(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  
  static rateLimitByUser() {
    return rateLimit({
      keyGenerator: (req) => req.user?.id || req.ip,
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each user to 100 requests per windowMs
      message: 'Too many requests from this user'
    });
  }
}

// Usage in server.js
app.use('/jobs', AuthMiddleware.authenticate, AuthMiddleware.rateLimitByUser());
```

### 2. **Multi-tenant Data Isolation** (Priority: CRITICAL)

#### Current Risk: 🚨 SEVERE
- All users share same data
- No privacy protection
- GDPR violations

#### Implementation:

```javascript
// models/TenantAwareModel.js
class TenantAwareModel {
  constructor(tableName) {
    this.tableName = tableName;
  }
  
  async findByTenant(tenantId, conditions = {}) {
    const query = `
      SELECT * FROM ${this.tableName} 
      WHERE tenant_id = $1 
      ${Object.keys(conditions).map((key, i) => `AND ${key} = $${i + 2}`).join(' ')}
    `;
    
    const values = [tenantId, ...Object.values(conditions)];
    return await db.query(query, values);
  }
  
  async createForTenant(tenantId, data) {
    const columns = ['tenant_id', ...Object.keys(data)];
    const values = [tenantId, ...Object.values(data)];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const query = `
      INSERT INTO ${this.tableName} (${columns.join(', ')}) 
      VALUES (${placeholders}) 
      RETURNING *
    `;
    
    return await db.query(query, values);
  }
}

// Usage
const jobsModel = new TenantAwareModel('jobs');
const userJobs = await jobsModel.findByTenant(req.user.tenantId, { user_id: req.user.id });
```

### 3. **Persistent Job Storage** (Priority: HIGH)

#### Current Risk: 🟡 HIGH
- Jobs lost on restart
- No job history
- Cannot scale horizontally

#### Implementation:

```javascript
// services/JobQueueService.js
const Bull = require('bull');
const Redis = require('redis');

class JobQueueService {
  constructor() {
    this.redis = Redis.createClient(process.env.REDIS_URL);
    this.jobQueue = new Bull('lead-generation', process.env.REDIS_URL);
    this.setupProcessors();
  }
  
  async createJob(tenantId, userId, jobData) {
    const job = await this.jobQueue.add('process-leads', {
      tenantId,
      userId,
      ...jobData
    }, {
      attempts: 3,
      backoff: 'exponential',
      removeOnComplete: 100,
      removeOnFail: 50
    });
    
    // Store job metadata in database
    await db.query(
      'INSERT INTO jobs (id, tenant_id, user_id, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [job.id, tenantId, userId, 'queued']
    );
    
    return job;
  }
  
  setupProcessors() {
    this.jobQueue.process('process-leads', 5, async (job) => {
      const { tenantId, userId, city, keyword } = job.data;
      
      // Update job status
      await this.updateJobStatus(job.id, 'processing');
      
      try {
        // Process the job
        const result = await this.processLeadGeneration(tenantId, userId, city, keyword, job);
        
        await this.updateJobStatus(job.id, 'completed', result);
        return result;
      } catch (error) {
        await this.updateJobStatus(job.id, 'failed', { error: error.message });
        throw error;
      }
    });
  }
  
  async pauseJob(jobId) {
    const job = await this.jobQueue.getJob(jobId);
    if (job) {
      await job.pause();
      await this.updateJobStatus(jobId, 'paused');
    }
  }
  
  async resumeJob(jobId) {
    const job = await this.jobQueue.getJob(jobId);
    if (job) {
      await job.resume();
      await this.updateJobStatus(jobId, 'processing');
    }
  }
}
```

### 4. **Usage Tracking & Billing** (Priority: HIGH)

#### Current Risk: 🟡 HIGH
- No revenue model
- Cannot track costs
- No usage limits

#### Implementation:

```javascript
// services/BillingService.js
class BillingService {
  async trackUsage(tenantId, userId, resourceType, quantity, metadata = {}) {
    await db.query(`
      INSERT INTO usage_events (
        tenant_id, user_id, resource_type, quantity, metadata, timestamp
      ) VALUES ($1, $2, $3, $4, $5, NOW())
    `, [tenantId, userId, resourceType, quantity, JSON.stringify(metadata)]);
    
    // Check if user exceeded their quota
    await this.checkQuotaLimits(tenantId, userId, resourceType);
  }
  
  async checkQuotaLimits(tenantId, userId, resourceType) {
    const subscription = await this.getSubscription(tenantId);
    const currentUsage = await this.getCurrentMonthUsage(tenantId, resourceType);
    
    if (currentUsage >= subscription.limits[resourceType]) {
      throw new Error(`Quota exceeded for ${resourceType}. Upgrade your plan to continue.`);
    }
  }
  
  async generateInvoice(tenantId, month, year) {
    const usage = await db.query(`
      SELECT resource_type, SUM(quantity) as total
      FROM usage_events 
      WHERE tenant_id = $1 
        AND EXTRACT(MONTH FROM timestamp) = $2 
        AND EXTRACT(YEAR FROM timestamp) = $3
      GROUP BY resource_type
    `, [tenantId, month, year]);
    
    return this.calculateBill(usage.rows);
  }
}

// Usage in processing service
class ProcessingService {
  async processLeadGeneration(tenantId, userId, city, keyword) {
    // Track API usage
    await this.billingService.trackUsage(tenantId, userId, 'api_calls', 1);
    
    // Process...
    const businesses = await this.extractBusinesses();
    
    // Track businesses extracted
    await this.billingService.trackUsage(tenantId, userId, 'businesses_extracted', businesses.length);
    
    return businesses;
  }
}
```

## 🏗️ Database Schema for Production

```sql
-- Multi-tenant schema
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'starter',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  city VARCHAR(255) NOT NULL,
  keyword VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  progress JSONB DEFAULT '{}',
  results JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  address TEXT,
  website VARCHAR(500),
  place_id VARCHAR(255),
  search_phrase VARCHAR(255),
  rating DECIMAL(2,1),
  total_reviews INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  plan VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  limits JSONB NOT NULL DEFAULT '{}',
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  stripe_subscription_id VARCHAR(255),
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_jobs_tenant_user ON jobs(tenant_id, user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_businesses_tenant_job ON businesses(tenant_id, job_id);
CREATE INDEX idx_usage_events_tenant_timestamp ON usage_events(tenant_id, timestamp);
```

## 🔧 Environment Configuration

```bash
# .env.production
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379

# Authentication
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=7d

# API Keys (encrypted in production)
GEMINI_API_KEY=encrypted:your-gemini-key
GOOGLE_MAPS_API_KEY=encrypted:your-maps-key

# Billing
STRIPE_SECRET_KEY=sk_live_your-stripe-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
NEW_RELIC_LICENSE_KEY=your-newrelic-key

# Email
SENDGRID_API_KEY=your-sendgrid-key
FROM_EMAIL=noreply@yourdomain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# Job Processing
MAX_CONCURRENT_JOBS=10
JOB_TIMEOUT_MS=3600000  # 1 hour
```

## 📊 Monitoring & Alerting

```javascript
// monitoring/metrics.js
const prometheus = require('prom-client');

class MetricsService {
  constructor() {
    this.register = new prometheus.Registry();
    
    // Custom metrics
    this.jobsTotal = new prometheus.Counter({
      name: 'jobs_total',
      help: 'Total number of jobs processed',
      labelNames: ['tenant_id', 'status']
    });
    
    this.apiCallsTotal = new prometheus.Counter({
      name: 'api_calls_total',
      help: 'Total number of API calls',
      labelNames: ['api_name', 'status']
    });
    
    this.jobDuration = new prometheus.Histogram({
      name: 'job_duration_seconds',
      help: 'Job processing duration',
      labelNames: ['tenant_id'],
      buckets: [1, 5, 15, 50, 100, 500]
    });
    
    this.register.registerMetric(this.jobsTotal);
    this.register.registerMetric(this.apiCallsTotal);
    this.register.registerMetric(this.jobDuration);
  }
  
  recordJobCompletion(tenantId, status, duration) {
    this.jobsTotal.inc({ tenant_id: tenantId, status });
    this.jobDuration.observe({ tenant_id: tenantId }, duration);
  }
  
  recordApiCall(apiName, status) {
    this.apiCallsTotal.inc({ api_name: apiName, status });
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {}
  };
  
  try {
    // Check database
    await db.query('SELECT 1');
    health.services.database = 'healthy';
  } catch (error) {
    health.services.database = 'unhealthy';
    health.status = 'unhealthy';
  }
  
  try {
    // Check Redis
    await redis.ping();
    health.services.redis = 'healthy';
  } catch (error) {
    health.services.redis = 'unhealthy';
    health.status = 'unhealthy';
  }
  
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

## 🚀 Deployment Strategy

### Docker Configuration

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

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

CMD ["npm", "start"]
```

### Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lead-scraper-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: lead-scraper-api
  template:
    metadata:
      labels:
        app: lead-scraper-api
    spec:
      containers:
      - name: api
        image: your-registry/lead-scraper:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

## 💰 Pricing Implementation

```javascript
// services/PricingService.js
class PricingService {
  static PLANS = {
    starter: {
      name: 'Starter',
      price: 49,
      limits: {
        businesses_per_month: 1000,
        concurrent_jobs: 2,
        api_calls_per_minute: 10
      }
    },
    professional: {
      name: 'Professional', 
      price: 149,
      limits: {
        businesses_per_month: 10000,
        concurrent_jobs: 10,
        api_calls_per_minute: 50
      }
    },
    enterprise: {
      name: 'Enterprise',
      price: 499,
      limits: {
        businesses_per_month: 100000,
        concurrent_jobs: -1, // unlimited
        api_calls_per_minute: 200
      }
    }
  };
  
  static calculateOverageCharges(usage, plan) {
    const planLimits = this.PLANS[plan].limits;
    let overage = 0;
    
    if (usage.businesses_extracted > planLimits.businesses_per_month) {
      const excess = usage.businesses_extracted - planLimits.businesses_per_month;
      overage += excess * 0.05; // $0.05 per excess business
    }
    
    return overage;
  }
}
```

This implementation guide provides the critical foundation needed to transform your prototype into a production-ready SaaS platform. Focus on implementing these core features first before adding advanced functionality.