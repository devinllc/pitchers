# 🔐 MongoDB Authentication & User Management System

## 📊 Database Schema Design

### 🏢 Users Collection
```javascript
// users collection
{
  _id: ObjectId("..."),
  email: "user@example.com",
  password: "$2b$12$...", // bcrypt hashed (only for email/password auth)
  
  // OAuth fields
  googleId: "google_oauth_id", // for Google OAuth
  githubId: "github_oauth_id", // for GitHub OAuth (optional)
  
  // Profile information
  profile: {
    firstName: "John",
    lastName: "Doe",
    avatar: "https://...",
    company: "Acme Corp",
    jobTitle: "Sales Manager"
  },
  
  // Subscription & limits
  subscription: {
    plan: "starter", // starter, professional, enterprise
    status: "active", // active, cancelled, suspended
    currentPeriodStart: ISODate("2024-01-01"),
    currentPeriodEnd: ISODate("2024-02-01"),
    stripeCustomerId: "cus_...",
    stripeSubscriptionId: "sub_..."
  },
  
  // Usage limits based on plan
  limits: {
    phrasesPerMonth: 50, // how many phrases user can generate
    resultsPerPhrase: 20, // max businesses per phrase
    concurrentJobs: 2,
    apiCallsPerMinute: 10
  },
  
  // Current usage tracking
  usage: {
    currentMonth: "2024-01",
    phrasesUsed: 15,
    resultsGenerated: 300,
    apiCallsToday: 45,
    lastResetDate: ISODate("2024-01-01")
  },
  
  // API access
  apiKey: "sk_live_...", // user's API key
  apiKeyCreatedAt: ISODate("2024-01-01"),
  
  // Account status
  isEmailVerified: true,
  isActive: true,
  lastLoginAt: ISODate("2024-01-15"),
  
  // Timestamps
  createdAt: ISODate("2024-01-01"),
  updatedAt: ISODate("2024-01-15")
}
```

### 📋 Jobs Collection
```javascript
// jobs collection
{
  _id: ObjectId("..."),
  userId: ObjectId("..."), // reference to users collection
  
  // Job details
  city: "pune",
  keyword: "computer classes",
  phrasesRequested: 25, // user can choose within their limit
  maxResultsPerPhrase: 15, // user can choose within their limit
  
  // Job status
  status: "processing", // queued, processing, completed, failed, paused, stopped
  progress: {
    totalPhrases: 25,
    processedPhrases: 8,
    totalBusinesses: 156,
    savedBusinesses: 156,
    currentPhrase: "Computer Classes in Aundh",
    estimatedTimeRemaining: 1200 // seconds
  },
  
  // Results
  results: {
    businesses: [], // array of business objects
    summary: {
      totalFound: 156,
      totalSaved: 156,
      saveSuccessRate: 100,
      processingTime: 1800 // seconds
    }
  },
  
  // Usage tracking
  usage: {
    phrasesGenerated: 25,
    businessesExtracted: 156,
    apiCallsMade: {
      gemini: 1,
      googleMaps: 75,
      googlePlaces: 156
    }
  },
  
  // Timestamps
  createdAt: ISODate("2024-01-15"),
  updatedAt: ISODate("2024-01-15"),
  completedAt: ISODate("2024-01-15")
}
```

### 🏪 Businesses Collection
```javascript
// businesses collection
{
  _id: ObjectId("..."),
  userId: ObjectId("..."), // reference to users collection
  jobId: ObjectId("..."), // reference to jobs collection
  
  // Business data
  name: "IT Perfect Computer Institute",
  phone: "090964 05333",
  address: "Kakade Plaza, Main Road, Near karvengar...",
  website: "https://...",
  email: "info@itperfect.com", // if available
  
  // Google Maps data
  placeId: "ChIJD-uUCdy_wjsRthW8dYdqXro",
  rating: 4.2,
  totalReviews: 45,
  openingHours: ["Monday: 9:00 AM – 8:00 PM", ...],
  
  // Search context
  searchPhrase: "Computer Classes in Aundh",
  searchCity: "pune",
  searchKeyword: "computer classes",
  
  // Timestamps
  createdAt: ISODate("2024-01-15")
}
```

### 📊 Usage Analytics Collection
```javascript
// usage_analytics collection
{
  _id: ObjectId("..."),
  userId: ObjectId("..."),
  
  // Time period
  month: "2024-01",
  date: ISODate("2024-01-15"),
  
  // Daily usage
  dailyUsage: {
    phrasesGenerated: 5,
    businessesExtracted: 100,
    apiCalls: {
      gemini: 1,
      googleMaps: 15,
      googlePlaces: 100
    },
    processingTime: 600 // seconds
  },
  
  // Cumulative monthly usage
  monthlyUsage: {
    phrasesGenerated: 45,
    businessesExtracted: 900,
    apiCalls: {
      gemini: 9,
      googleMaps: 135,
      googlePlaces: 900
    },
    totalProcessingTime: 5400 // seconds
  }
}
```

## 🔐 Authentication Implementation

### 1. **JWT + OAuth Setup**
```javascript
// auth/authService.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

class AuthService {
  constructor() {
    this.setupPassport();
  }
  
  // Setup Passport strategies
  setupPassport() {
    // Google OAuth Strategy
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback"
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists
        let user = await User.findOne({ googleId: profile.id });
        
        if (user) {
          return done(null, user);
        }
        
        // Check if user exists with same email
        user = await User.findOne({ email: profile.emails[0].value });
        
        if (user) {
          // Link Google account to existing user
          user.googleId = profile.id;
          await user.save();
          return done(null, user);
        }
        
        // Create new user
        user = await User.create({
          googleId: profile.id,
          email: profile.emails[0].value,
          profile: {
            firstName: profile.name.givenName,
            lastName: profile.name.familyName,
            avatar: profile.photos[0].value
          },
          subscription: {
            plan: 'starter',
            status: 'active'
          },
          limits: this.getPlanLimits('starter'),
          apiKey: this.generateApiKey(),
          isEmailVerified: true
        });
        
        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }));
  }
  
  // Email/Password Registration
  async registerWithEmail(email, password, profile = {}) {
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new Error('User already exists with this email');
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const user = await User.create({
      email,
      password: hashedPassword,
      profile,
      subscription: {
        plan: 'starter',
        status: 'active'
      },
      limits: this.getPlanLimits('starter'),
      apiKey: this.generateApiKey(),
      isEmailVerified: false
    });
    
    // Send verification email
    await this.sendVerificationEmail(user);
    
    return user;
  }
  
  // Email/Password Login
  async loginWithEmail(email, password) {
    const user = await User.findOne({ email });
    if (!user || !user.password) {
      throw new Error('Invalid credentials');
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }
    
    if (!user.isEmailVerified) {
      throw new Error('Please verify your email before logging in');
    }
    
    // Update last login
    user.lastLoginAt = new Date();
    await user.save();
    
    return user;
  }
  
  // Generate JWT token
  generateToken(user) {
    return jwt.sign(
      { 
        userId: user._id,
        email: user.email,
        plan: user.subscription.plan
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
  }
  
  // Generate API key
  generateApiKey() {
    const prefix = 'sk_live_';
    const randomString = require('crypto').randomBytes(32).toString('hex');
    return prefix + randomString;
  }
  
  // Get plan limits
  getPlanLimits(plan) {
    const limits = {
      starter: {
        phrasesPerMonth: 50,
        resultsPerPhrase: 20,
        concurrentJobs: 2,
        apiCallsPerMinute: 10
      },
      professional: {
        phrasesPerMonth: 200,
        resultsPerPhrase: 50,
        concurrentJobs: 10,
        apiCallsPerMinute: 50
      },
      enterprise: {
        phrasesPerMonth: 1000,
        resultsPerPhrase: 100,
        concurrentJobs: -1, // unlimited
        apiCallsPerMinute: 200
      }
    };
    
    return limits[plan] || limits.starter;
  }
}

module.exports = AuthService;
```

### 2. **Authentication Middleware**
```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

class AuthMiddleware {
  // JWT Authentication
  static async authenticate(req, res, next) {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ 
          error: 'Authentication required',
          message: 'Please provide a valid JWT token'
        });
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (!user || !user.isActive) {
        return res.status(401).json({ 
          error: 'Invalid token',
          message: 'User not found or inactive'
        });
      }
      
      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: error.message
      });
    }
  }
  
  // API Key Authentication
  static async authenticateApiKey(req, res, next) {
    try {
      const apiKey = req.headers['x-api-key'];
      
      if (!apiKey) {
        return res.status(401).json({ 
          error: 'API key required',
          message: 'Please provide a valid API key in x-api-key header'
        });
      }
      
      const user = await User.findOne({ apiKey, isActive: true });
      
      if (!user) {
        return res.status(401).json({ 
          error: 'Invalid API key',
          message: 'API key not found or user inactive'
        });
      }
      
      req.user = user;
      next();
    } catch (error) {
      return res.status(500).json({ 
        error: 'Authentication error',
        message: error.message
      });
    }
  }
  
  // Check subscription status
  static checkSubscription(req, res, next) {
    if (req.user.subscription.status !== 'active') {
      return res.status(403).json({
        error: 'Subscription inactive',
        message: 'Please activate your subscription to continue',
        subscriptionStatus: req.user.subscription.status
      });
    }
    next();
  }
  
  // Check usage limits
  static async checkUsageLimits(resourceType) {
    return async (req, res, next) => {
      try {
        const user = req.user;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        
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
        switch (resourceType) {
          case 'phrases':
            if (user.usage.phrasesUsed >= user.limits.phrasesPerMonth) {
              return res.status(429).json({
                error: 'Phrase limit exceeded',
                message: `You have reached your monthly limit of ${user.limits.phrasesPerMonth} phrases`,
                usage: user.usage,
                limits: user.limits
              });
            }
            break;
            
          case 'jobs':
            const activeJobs = await Job.countDocuments({ 
              userId: user._id, 
              status: { $in: ['queued', 'processing'] }
            });
            
            if (user.limits.concurrentJobs !== -1 && activeJobs >= user.limits.concurrentJobs) {
              return res.status(429).json({
                error: 'Concurrent job limit exceeded',
                message: `You can only run ${user.limits.concurrentJobs} jobs simultaneously`,
                activeJobs,
                limit: user.limits.concurrentJobs
              });
            }
            break;
        }
        
        next();
      } catch (error) {
        return res.status(500).json({ 
          error: 'Usage check failed',
          message: error.message
        });
      }
    };
  }
}

module.exports = AuthMiddleware;
```

## 🔌 API Endpoints

### 1. **Authentication Routes**
```javascript
// routes/auth.js
const express = require('express');
const passport = require('passport');
const AuthService = require('../services/AuthService');
const router = express.Router();

const authService = new AuthService();

// Email/Password Registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, company } = req.body;
    
    const user = await authService.registerWithEmail(email, password, {
      firstName,
      lastName,
      company
    });
    
    const token = authService.generateToken(user);
    
    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
      token,
      user: {
        id: user._id,
        email: user.email,
        profile: user.profile,
        subscription: user.subscription,
        limits: user.limits
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Email/Password Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await authService.loginWithEmail(email, password);
    const token = authService.generateToken(user);
    
    res.json({
      success: true,
      message: 'Login successful',
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
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

// Google OAuth
router.get('/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    const token = authService.generateToken(req.user);
    
    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
  }
);

// Get current user
router.get('/me', AuthMiddleware.authenticate, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      profile: req.user.profile,
      subscription: req.user.subscription,
      limits: req.user.limits,
      usage: req.user.usage,
      apiKey: req.user.apiKey
    }
  });
});

module.exports = router;
```

### 2. **Job Management API**
```javascript
// routes/jobs.js
const express = require('express');
const AuthMiddleware = require('../middleware/auth');
const JobService = require('../services/JobService');
const router = express.Router();

const jobService = new JobService();

// Create new job
router.post('/', 
  AuthMiddleware.authenticateApiKey,
  AuthMiddleware.checkSubscription,
  AuthMiddleware.checkUsageLimits('jobs'),
  AuthMiddleware.checkUsageLimits('phrases'),
  async (req, res) => {
    try {
      const { city, keyword, phrasesRequested, maxResultsPerPhrase } = req.body;
      
      // Validate user limits
      if (phrasesRequested > req.user.limits.phrasesPerMonth - req.user.usage.phrasesUsed) {
        return res.status(400).json({
          error: 'Insufficient phrase quota',
          available: req.user.limits.phrasesPerMonth - req.user.usage.phrasesUsed,
          requested: phrasesRequested
        });
      }
      
      if (maxResultsPerPhrase > req.user.limits.resultsPerPhrase) {
        return res.status(400).json({
          error: 'Results per phrase exceeds limit',
          limit: req.user.limits.resultsPerPhrase,
          requested: maxResultsPerPhrase
        });
      }
      
      const job = await jobService.createJob(req.user._id, {
        city,
        keyword,
        phrasesRequested,
        maxResultsPerPhrase
      });
      
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
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get job status
router.get('/:jobId', 
  AuthMiddleware.authenticateApiKey,
  async (req, res) => {
    try {
      const job = await jobService.getJob(req.params.jobId, req.user._id);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
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
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get user's jobs
router.get('/', 
  AuthMiddleware.authenticateApiKey,
  async (req, res) => {
    try {
      const { page = 1, limit = 10, status } = req.query;
      
      const jobs = await jobService.getUserJobs(req.user._id, {
        page: parseInt(page),
        limit: parseInt(limit),
        status
      });
      
      res.json({
        success: true,
        jobs: jobs.data,
        pagination: {
          page: jobs.page,
          limit: jobs.limit,
          total: jobs.total,
          pages: jobs.pages
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Pause job
router.post('/:jobId/pause', 
  AuthMiddleware.authenticateApiKey,
  async (req, res) => {
    try {
      const job = await jobService.pauseJob(req.params.jobId, req.user._id);
      
      res.json({
        success: true,
        message: 'Job paused successfully',
        job: {
          id: job._id,
          status: job.status
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Resume job
router.post('/:jobId/resume', 
  AuthMiddleware.authenticateApiKey,
  async (req, res) => {
    try {
      const job = await jobService.resumeJob(req.params.jobId, req.user._id);
      
      res.json({
        success: true,
        message: 'Job resumed successfully',
        job: {
          id: job._id,
          status: job.status
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Stop job
router.post('/:jobId/stop', 
  AuthMiddleware.authenticateApiKey,
  async (req, res) => {
    try {
      const job = await jobService.stopJob(req.params.jobId, req.user._id);
      
      res.json({
        success: true,
        message: 'Job stopped successfully',
        job: {
          id: job._id,
          status: job.status
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

module.exports = router;
```

## 📊 Usage Tracking & Limits

### 1. **Usage Tracking Service**
```javascript
// services/UsageTrackingService.js
const User = require('../models/User');
const UsageAnalytics = require('../models/UsageAnalytics');

class UsageTrackingService {
  async trackUsage(userId, resourceType, quantity = 1, metadata = {}) {
    try {
      const user = await User.findById(userId);
      const currentMonth = new Date().toISOString().slice(0, 7);
      const today = new Date().toISOString().slice(0, 10);
      
      // Update user usage
      if (user.usage.currentMonth !== currentMonth) {
        user.usage = {
          currentMonth,
          phrasesUsed: 0,
          resultsGenerated: 0,
          apiCallsToday: 0,
          lastResetDate: new Date()
        };
      }
      
      // Track specific resource usage
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
      await this.updateAnalytics(userId, resourceType, quantity, metadata);
      
    } catch (error) {
      console.error('Usage tracking error:', error);
    }
  }
  
  async updateAnalytics(userId, resourceType, quantity, metadata) {
    const month = new Date().toISOString().slice(0, 7);
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    
    const analytics = await UsageAnalytics.findOneAndUpdate(
      { userId, month, date },
      {
        $inc: {
          [`dailyUsage.${resourceType}`]: quantity,
          [`monthlyUsage.${resourceType}`]: quantity
        },
        $set: {
          [`metadata.${resourceType}`]: metadata
        }
      },
      { upsert: true, new: true }
    );
    
    return analytics;
  }
  
  async getUserUsage(userId, month = null) {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    
    const analytics = await UsageAnalytics.find({
      userId,
      month: targetMonth
    }).sort({ date: 1 });
    
    return analytics;
  }
  
  async checkLimits(userId, resourceType, requestedQuantity = 1) {
    const user = await User.findById(userId);
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
    
    // Check limits
    switch (resourceType) {
      case 'phrases':
        const availablePhrases = user.limits.phrasesPerMonth - user.usage.phrasesUsed;
        if (requestedQuantity > availablePhrases) {
          throw new Error(`Insufficient phrase quota. Available: ${availablePhrases}, Requested: ${requestedQuantity}`);
        }
        break;
        
      case 'concurrent_jobs':
        // This would be checked separately in job creation
        break;
        
      case 'api_calls':
        if (user.usage.apiCallsToday >= user.limits.apiCallsPerMinute * 60 * 24) {
          throw new Error('Daily API call limit exceeded');
        }
        break;
    }
    
    return true;
  }
}

module.exports = UsageTrackingService;
```

## 🎯 Plan Limits Configuration

### Subscription Plans
```javascript
// config/plans.js
const SUBSCRIPTION_PLANS = {
  starter: {
    name: 'Starter',
    price: 29, // USD per month
    limits: {
      phrasesPerMonth: 50,
      resultsPerPhrase: 20,
      concurrentJobs: 2,
      apiCallsPerMinute: 10,
      dataExports: 5, // per month
      supportLevel: 'email'
    },
    features: [
      'Up to 50 search phrases per month',
      'Up to 20 results per phrase',
      '2 concurrent jobs',
      'CSV & Google Sheets export',
      'Email support'
    ]
  },
  
  professional: {
    name: 'Professional',
    price: 99, // USD per month
    limits: {
      phrasesPerMonth: 200,
      resultsPerPhrase: 50,
      concurrentJobs: 10,
      apiCallsPerMinute: 50,
      dataExports: 25, // per month
      supportLevel: 'priority'
    },
    features: [
      'Up to 200 search phrases per month',
      'Up to 50 results per phrase',
      '10 concurrent jobs',
      'All export formats',
      'API access',
      'Priority support',
      'Advanced filtering'
    ]
  },
  
  enterprise: {
    name: 'Enterprise',
    price: 299, // USD per month
    limits: {
      phrasesPerMonth: 1000,
      resultsPerPhrase: 100,
      concurrentJobs: -1, // unlimited
      apiCallsPerMinute: 200,
      dataExports: -1, // unlimited
      supportLevel: 'dedicated'
    },
    features: [
      'Up to 1000 search phrases per month',
      'Up to 100 results per phrase',
      'Unlimited concurrent jobs',
      'All export formats',
      'Full API access',
      'Dedicated support',
      'Custom integrations',
      'White-label options',
      'SLA guarantee'
    ]
  }
};

module.exports = SUBSCRIPTION_PLANS;
```

This MongoDB-based authentication system provides:

1. **Flexible Authentication**: Email/password + Google OAuth
2. **Usage Limits**: Configurable per plan with real-time tracking
3. **API-First Design**: Clean REST API for all operations
4. **Scalable Architecture**: MongoDB collections optimized for growth
5. **User Control**: Users can choose phrase count and results within limits

Next, I'll create the cost analysis documentation.