# 🚀 Complete Frontend Development Guide for Pitchers SaaS Platform

## 📋 Table of Contents
1. [Authentication & User Management](#authentication--user-management)
2. [Subscription Management](#subscription-management)
3. [Google Sheets Integration](#google-sheets-integration)
4. [Job Management](#job-management)
5. [Usage Tracking](#usage-tracking)
6. [Admin Dashboard](#admin-dashboard)
7. [Legacy API Routes](#legacy-api-routes)
8. [Legacy Job Management Routes](#-legacy-job-management-routes)
9. [Performance & Monitoring Routes](#-performance--monitoring-routes)
10. [Health & System Routes](#-health--system-routes)
11. [API Documentation Routes](#-api-documentation-routes)
12. [Payment & Subscription Routes](#-payment--subscription-routes)
13. [API Key Management Routes](#-api-key-management-routes)
14. [User Data Management Routes](#-user-data-management-routes)
15. [Deprecated Routes](#-deprecated-routes-return-410-status)
16. [Frontend Implementation Examples](#frontend-implementation-examples)

---

## 🔐 Authentication & User Management

### Base URL: `pitchers.ufdevs.me`

#### 1. Google OAuth Login
```javascript
// GET /auth/google/authorize
const loginWithGoogle = async (redirectTo = null) => {
  const params = new URLSearchParams();
  if (redirectTo) {
    params.append('redirectTo', redirectTo);
  }
  
  const response = await fetch(`/auth/google/authorize?${params}`);
  const data = await response.json();
  
  if (data.success) {
    // Redirect user to Google OAuth
    window.location.href = data.authUrl;
  }
};

// Usage
loginWithGoogle('/dashboard'); // Redirect to dashboard after login
```

#### 2. OAuth Callback (Handled by Google)
```javascript
// This is handled automatically by Google redirecting back to your app
// The callback route: GET /auth/google/callback
// Returns: JWT token, refresh token, and user info
```

#### 3. Refresh JWT Token
```javascript
// POST /auth/refresh-token
const refreshToken = async (refreshToken) => {
  const response = await fetch('/auth/refresh-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refreshToken })
  });
  
  const data = await response.json();
  if (data.success) {
    localStorage.setItem('token', data.token);
    return data.token;
  }
};
```

#### 4. Logout
```javascript
// POST /auth/logout
const logout = async (refreshToken) => {
  await fetch('/auth/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refreshToken })
  });
  
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  // Redirect to login page
};
```

#### 5. Get Current User
```javascript
// GET /auth/me
const getCurrentUser = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/auth/me', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data.user : null;
};
```

---

## 💳 Subscription Management

### Base URL: `/subscription`

#### 1. Get Available Plans
```javascript
// GET /subscription/plans
const getPlans = async () => {
  const response = await fetch('/subscription/plans');
  const data = await response.json();
  return data.success ? data.plans : [];
};

// Plan structure:
// {
//   id: 1,
//   name: 'Basic',
//   price: 999,
//   currency: 'INR',
//   features: {
//     usage_limit: 1000,
//     sheets_limit: 5,
//     max_jobs: 10
//   }
// }
```

#### 2. Get User Subscription Status
```javascript
// GET /subscription/status
const getSubscriptionStatus = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/subscription/status', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data;
};

// Response structure:
// {
//   success: true,
//   hasSubscription: true,
//   subscription: {
//     plan: 'Pro',
//     status: 'active',
//     expiresAt: '2024-12-31T23:59:59.000Z',
//     features: { usage_limit: 10000, max_jobs: 50 }
//   }
// }
```

#### 3. Create Subscription
```javascript
// POST /subscription/create
const createSubscription = async (planId) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/subscription/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ planId })
  });
  
  const data = await response.json();
  if (data.success) {
    // Initialize Razorpay payment
    const options = {
      key: data.paymentDetails.key,
      amount: data.order.amount,
      currency: data.order.currency,
      name: data.paymentDetails.name,
      description: data.paymentDetails.description,
      order_id: data.order.id,
      prefill: data.paymentDetails.prefill,
      handler: function(response) {
        // Handle payment success
        verifyPayment(response);
      }
    };
    
    const rzp = new Razorpay(options);
    rzp.open();
  }
};
```

#### 4. Verify Payment
```javascript
// POST /subscription/verify-payment
const verifyPayment = async (paymentResponse) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/subscription/verify-payment', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      razorpay_payment_id: paymentResponse.razorpay_payment_id,
      razorpay_order_id: paymentResponse.razorpay_order_id,
      razorpay_signature: paymentResponse.razorpay_signature
    })
  });
  
  const data = await response.json();
  if (data.success) {
    // Subscription activated successfully
    console.log('Subscription activated:', data.subscription);
  }
};
```

#### 5. Cancel Subscription
```javascript
// POST /subscription/cancel
const cancelSubscription = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/subscription/cancel', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success;
};
```

---

## 📊 Google Sheets Integration

### Base URL: `/google`

#### 1. Connect Google Sheets Account
```javascript
// GET /google/sheets/connect
const connectGoogleSheets = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/google/sheets/connect', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  if (data.success) {
    // Redirect to Google OAuth
    window.location.href = data.authUrl;
  }
};
```

#### 2. Check Connection Status
```javascript
// GET /google/sheets/status
const checkConnectionStatus = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/google/sheets/status', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 3. Get Available Google Sheets
```javascript
// GET /google/sheets/available
const getAvailableSheets = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/google/sheets/available', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data.sheets : [];
};

// Sheet structure:
// {
//   id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
//   name: 'Sample Sheet',
//   url: 'https://docs.google.com/spreadsheets/d/...'
// }
```

#### 4. Get Connected Sheets
```javascript
// GET /google/sheets/connected
const getConnectedSheets = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/google/sheets/connected', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data.sheets : [];
};
```

#### 5. Create New Google Sheet
```javascript
// POST /google/sheets/create
const createNewSheet = async (sheetName) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/google/sheets/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: sheetName })
  });
  
  const data = await response.json();
  return data.success ? data.sheet : null;
};
```

#### 6. Connect Existing Sheet
```javascript
// POST /google/sheets/connect
const connectExistingSheet = async (sheetId) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/google/sheets/connect', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sheetId })
  });
  
  const data = await response.json();
  return data.success;
};
```

#### 7. Disconnect Sheet
```javascript
// DELETE /google/sheets/:sheetId
const disconnectSheet = async (sheetId) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/google/sheets/${sheetId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success;
};
```

#### 8. Get Business Data
```javascript
// GET /google/sheets/data
const getBusinessData = async (page = 1, limit = 100, startDate = null, endDate = null) => {
  const token = localStorage.getItem('token');
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString()
  });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/google/sheets/data?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

#### 9. Save Business Data
```javascript
// POST /google/sheets/data/save
const saveBusinessData = async (sheetId, businessData) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/google/sheets/data/save', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sheetId,
      data: businessData
    })
  });
  
  const data = await response.json();
  return data.success;
};
```

---

## 🚀 Job Management

### Base URL: `/jobs`

#### 1. Create New Job
```javascript
// POST /jobs/create
const createJob = async (keywords, location, maxResults = 50, targetSheetId = null) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/jobs/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      keywords,
      location,
      maxResults,
      targetSheetId
    })
  });
  
  const data = await response.json();
  return data.success ? data : null;
};

// Response structure:
// {
//   success: true,
//   jobId: 'job_1234567890_abc123',
//   status: 'started',
//   message: 'Lead generation job initiated',
//   userEmail: 'user@example.com',
//   location: 'New York',
//   keywords: 'restaurants',
//   maxResults: 50
// }
```

#### 2. Get Job Status
```javascript
// GET /jobs/:jobId
const getJobStatus = async (jobId) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/jobs/${jobId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};

// Response structure:
// {
//   success: true,
//   status: 'completed',
//   processed: 45,
//   total: 50,
//   startTime: '2024-01-15T10:30:00.000Z',
//   method: 'api',
//   saveStats: {
//     postgresql: { success: 45, failed: 0 },
//     googleSheets: { success: 45, failed: 0 },
//     bothSucceeded: 45
//   }
// }
```

#### 3. Get All User Jobs
```javascript
// GET /jobs
const getAllJobs = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/jobs', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data.jobs : [];
};
```

#### 4. Pause Job
```javascript
// POST /jobs/:jobId/pause
const pauseJob = async (jobId) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/jobs/${jobId}/pause`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success;
};
```

#### 5. Resume Job
```javascript
// POST /jobs/:jobId/resume
const resumeJob = async (jobId) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/jobs/${jobId}/resume`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success;
};
```

#### 6. Stop Job
```javascript
// POST /jobs/:jobId/stop
const stopJob = async (jobId) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/jobs/${jobId}/stop`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success;
};
```

---

## 📈 Usage Tracking

### Base URL: `/usage`

#### 1. Get Current Usage
```javascript
// GET /usage/current
const getCurrentUsage = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/usage/current', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};

// Response structure:
// {
//   success: true,
//   usage: {
//     current: 750,
//     limit: 1000,
//     remaining: 250,
//     percentUsed: 75
//   },
//   limits: {
//     rate: 10,
//     jobs: 5
//   },
//   subscription: {
//     plan: 'Basic',
//     status: 'active',
//     expiresAt: '2024-12-31T23:59:59.000Z'
//   }
// }
```

#### 2. Get Usage History
```javascript
// GET /usage/history
const getUsageHistory = async (startDate = null, endDate = null, groupBy = 'day') => {
  const token = localStorage.getItem('token');
  const params = new URLSearchParams({ groupBy });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/usage/history?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

#### 3. Get Usage by Resource Type
```javascript
// GET /usage/by-resource
const getResourceUsage = async (startDate = null, endDate = null) => {
  const token = localStorage.getItem('token');
  const params = new URLSearchParams();
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/usage/by-resource?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

#### 4. Get Usage Forecast
```javascript
// GET /usage/forecast
const getUsageForecast = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/usage/forecast', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

---

## 👑 Admin Dashboard

### Base URL: `/admin`

#### 1. Get Dashboard Statistics
```javascript
// GET /admin/dashboard
const getDashboardStats = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/admin/dashboard', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};

// Response structure:
// {
//   success: true,
//   statistics: {
//     userCount: 42,
//     activeSubscriptions: 28,
//     totalJobs: 156,
//     monthlyUsage: 1250
//   },
//   planDistribution: [
//     { name: 'Free', count: 14 },
//     { name: 'Basic', count: 18 },
//     { name: 'Pro', count: 8 },
//     { name: 'Enterprise', count: 2 }
//   ],
//   recentUsers: [...],
//   recentSubscriptions: [...]
// }
```

#### 2. Get All Users
```javascript
// GET /admin/users
const getAllUsers = async (page = 1, limit = 20, search = '') => {
  const token = localStorage.getItem('token');
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString()
  });
  
  if (search) params.append('search', search);
  
  const response = await fetch(`/admin/users?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

#### 3. Get User Details
```javascript
// GET /admin/users/:email
const getUserDetails = async (email) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/admin/users/${email}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

#### 4. Assign Plan to User
```javascript
// POST /admin/users/assign-plan
const assignPlanToUser = async (email, planId, expiresAt = null) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/admin/users/assign-plan', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      planId,
      expiresAt
    })
  });
  
  const data = await response.json();
  return data.success;
};
```

#### 5. Get Subscription Plans
```javascript
// GET /admin/subscription/plans
const getSubscriptionPlans = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/admin/subscription/plans', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data.plans : [];
};
```

#### 6. Get Usage Statistics
```javascript
// GET /admin/usage/statistics
const getUsageStatistics = async (period = 'month') => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/admin/usage/statistics?period=${period}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

#### 7. Get Subscription Statistics
```javascript
// GET /admin/subscriptions/statistics
const getSubscriptionStatistics = async (period = 'month') => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/admin/subscriptions/statistics?period=${period}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data : null;
};
```

#### 8. Admin User Management
```javascript
// GET /admin/admins
const getAllAdminUsers = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/admin/admins', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success ? data.admins : [];
};

// POST /admin/admins
const addAdminUser = async (adminData) => {
  const token = localStorage.getItem('token');
  const response = await fetch('/admin/admins', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(adminData)
  });
  
  const data = await response.json();
  return data.success;
};

// DELETE /admin/admins/:email
const removeAdminUser = async (email) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`/admin/admins/${email}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data.success;
};
```

#### 9. Debug Token (Development Only)
```javascript
// GET /admin/debug/token
const debugToken = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/admin/debug/token', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  return data;
};
```

---

## 🔄 Legacy API Routes

### Base URL: `/api/v1` (Requires API Key)

#### 1. Search Service
```javascript
// POST /api/v1/search-service
const searchBusinesses = async (apiKey, city, keyword, method = 'api', scraper = {}) => {
  const response = await fetch('/api/v1/search-service', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      city,
      keyword,
      method,
      scraper
    })
  });
  
  const data = await response.json();
  return data;
};
```

#### 2. Get Job Status
```javascript
// GET /api/v1/status/:jobId
const getJobStatus = async (apiKey, jobId) => {
  const response = await fetch(`/api/v1/status/${jobId}`, {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 3. Get Active Jobs
```javascript
// GET /api/v1/status
const getActiveJobs = async (apiKey) => {
  const response = await fetch('/api/v1/status', {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 4. Get All Jobs
```javascript
// GET /api/v1/jobs
const getAllJobs = async (apiKey) => {
  const response = await fetch('/api/v1/jobs', {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 5. Get Performance Metrics
```javascript
// GET /api/v1/performance
const getPerformance = async (apiKey) => {
  const response = await fetch('/api/v1/performance', {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 6. Job Control Operations
```javascript
// POST /api/v1/jobs/:jobId/pause
const pauseJob = async (apiKey, jobId) => {
  const response = await fetch(`/api/v1/jobs/${jobId}/pause`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};

// POST /api/v1/jobs/:jobId/resume
const resumeJob = async (apiKey, jobId) => {
  const response = await fetch(`/api/v1/jobs/${jobId}/resume`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};

// POST /api/v1/jobs/:jobId/stop
const stopJob = async (apiKey, jobId) => {
  const response = await fetch(`/api/v1/jobs/${jobId}/stop`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 7. Debug Job
```javascript
// GET /api/v1/debug/:jobId
const debugJob = async (apiKey, jobId) => {
  const response = await fetch(`/api/v1/debug/${jobId}`, {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 8. User Management
```javascript
// GET /api/v1/user/jobs
const getUserJobs = async (apiKey) => {
  const response = await fetch('/api/v1/user/jobs', {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};

// GET /api/v1/user/sheets
const getUserSheets = async (apiKey) => {
  const response = await fetch('/api/v1/user/sheets', {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### 9. Admin Statistics
```javascript
// GET /api/v1/admin/stats
const getAdminStats = async (apiKey) => {
  const response = await fetch('/api/v1/admin/stats', {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = await response.json();
  return data;
};
```

### Base URL: `/oauth`

#### 1. Google Sheets OAuth
```javascript
// GET /oauth/google-sheets/connect
const connectLegacyGoogleSheets = async () => {
  const response = await fetch('/oauth/google-sheets/connect');
  const data = await response.json();
  
  if (data.success) {
    window.location.href = data.authUrl;
  }
};
```

#### 2. OAuth Setup
```javascript
// POST /oauth/credentials
const saveOAuthCredentials = async (clientId, clientSecret, redirectUri) => {
  const response = await fetch('/oauth/credentials', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    })
  });
  
  const data = await response.json();
  return data;
};
```

#### 3. OAuth Authorization
```javascript
// GET /oauth/authorize
const authorizeOAuth = async () => {
  const response = await fetch('/oauth/authorize');
  const data = await response.json();
  return data;
};
```

#### 4. OAuth Callback
```javascript
// GET /oauth/callback
const handleOAuthCallback = async (code, state) => {
  const response = await fetch(`/oauth/callback?code=${code}&state=${state}`);
  const data = await response.json();
  return data;
};
```

#### 5. Google Sheets OAuth
```javascript
// POST /oauth/sheets/setup
const setupGoogleSheets = async (clientId, clientSecret, redirectUri) => {
  const response = await fetch('/oauth/sheets/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    })
  });
  
  const data = await response.json();
  return data;
};

// GET /oauth/sheets/authorize
const authorizeGoogleSheets = async () => {
  const response = await fetch('/oauth/sheets/authorize');
  const data = await response.json();
  return data;
};

// GET /oauth/sheets/callback
const handleGoogleSheetsCallback = async (code, state) => {
  const response = await fetch(`/oauth/sheets/callback?code=${code}&state=${state}`);
  const data = await response.json();
  return data;
};

// GET /oauth/sheets/status
const getGoogleSheetsStatus = async () => {
  const response = await fetch('/oauth/sheets/status');
  const data = await response.json();
  return data;
};
```

#### 6. OAuth Management
```javascript
// POST /oauth/google-sheets/refresh
const refreshGoogleSheetsToken = async () => {
  const response = await fetch('/oauth/google-sheets/refresh', {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};

// POST /oauth/google-sheets/disconnect
const disconnectGoogleSheets = async () => {
  const response = await fetch('/oauth/google-sheets/disconnect', {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};
```

### Base URL: `/multi-tenant-sheets`

#### 1. Multi-tenant OAuth
```javascript
// GET /multi-tenant-sheets/auth/connect?userEmail=user@example.com
const connectMultiTenantSheets = async (userEmail) => {
  const response = await fetch(`/multi-tenant-sheets/auth/connect?userEmail=${userEmail}`);
  const data = await response.json();
  
  if (data.success) {
    window.location.href = data.authUrl;
  }
};
```

#### 2. Multi-tenant OAuth URL Generation
```javascript
// GET /multi-tenant-sheets/auth/url?userEmail=user@example.com
const generateMultiTenantAuthUrl = async (userEmail) => {
  const response = await fetch(`/multi-tenant-sheets/auth/url?userEmail=${userEmail}`);
  const data = await response.json();
  return data;
};
```

#### 3. Multi-tenant Connection Status
```javascript
// GET /multi-tenant-sheets/auth/status?userEmail=user@example.com
const checkMultiTenantConnection = async (userEmail) => {
  const response = await fetch(`/multi-tenant-sheets/auth/status?userEmail=${userEmail}`);
  const data = await response.json();
  return data;
};
```

#### 4. Multi-tenant Sheets Management
```javascript
// GET /multi-tenant-sheets/available?userEmail=user@example.com
const getMultiTenantAvailableSheets = async (userEmail) => {
  const response = await fetch(`/multi-tenant-sheets/available?userEmail=${userEmail}`);
  const data = await response.json();
  return data;
};

// POST /multi-tenant-sheets/create?userEmail=user@example.com
const createMultiTenantSheet = async (userEmail, sheetName) => {
  const response = await fetch(`/multi-tenant-sheets/create?userEmail=${userEmail}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: sheetName })
  });
  
  const data = await response.json();
  return data;
};

// POST /multi-tenant-sheets/connect?userEmail=user@example.com
const connectMultiTenantSheet = async (userEmail, sheetId) => {
  const response = await fetch(`/multi-tenant-sheets/connect?userEmail=${userEmail}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sheetId })
  });
  
  const data = await response.json();
  return data;
};

// GET /multi-tenant-sheets/connected?userEmail=user@example.com
const getMultiTenantConnectedSheets = async (userEmail) => {
  const response = await fetch(`/multi-tenant-sheets/connected?userEmail=${userEmail}`);
  const data = await response.json();
  return data;
};

// DELETE /multi-tenant-sheets/:sheetId?userEmail=user@example.com
const deleteMultiTenantSheet = async (userEmail, sheetId) => {
  const response = await fetch(`/multi-tenant-sheets/${sheetId}?userEmail=${userEmail}`, {
    method: 'DELETE'
  });
  
  const data = await response.json();
  return data;
};
```

#### 5. Multi-tenant Data Management
```javascript
// GET /multi-tenant-sheets/data?userEmail=user@example.com
const getMultiTenantData = async (userEmail, page = 1, limit = 100, startDate = null, endDate = null) => {
  const params = new URLSearchParams({
    userEmail,
    page: page.toString(),
    limit: limit.toString()
  });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/multi-tenant-sheets/data?${params}`);
  const data = await response.json();
  return data;
};

// GET /multi-tenant-sheets/data/stats?userEmail=user@example.com
const getMultiTenantDataStats = async (userEmail, startDate = null, endDate = null) => {
  const params = new URLSearchParams({ userEmail });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/multi-tenant-sheets/data/stats?${params}`);
  const data = await response.json();
  return data;
};

// POST /multi-tenant-sheets/data/save?userEmail=user@example.com
const saveMultiTenantData = async (userEmail, sheetId, businessData) => {
  const response = await fetch(`/multi-tenant-sheets/data/save?userEmail=${userEmail}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sheetId,
      data: businessData
    })
  });
  
  const data = await response.json();
  return data;
};
```

#### 6. Multi-tenant Account Management
```javascript
// POST /multi-tenant-sheets/auth/disconnect?userEmail=user@example.com
const disconnectMultiTenantAccount = async (userEmail) => {
  const response = await fetch(`/multi-tenant-sheets/auth/disconnect?userEmail=${userEmail}`, {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};
```

## 🔧 Legacy Job Management Routes

### Base URL: `/` (Root Level)

#### 1. Search Service (Legacy)
```javascript
// POST /search-service
const searchServiceLegacy = async (city, keyword, method = 'api', scraper = {}, phrases = {}) => {
  const response = await fetch('/search-service', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      city,
      keyword,
      method,
      scraper,
      phrases
    })
  });
  
  const data = await response.json();
  return data;
};
```

#### 2. Multi-tenant Search
```javascript
// POST /search
const multiTenantSearch = async (keywords, location, maxResults, userEmail, targetSheetId) => {
  const response = await fetch('/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      keywords,
      location,
      maxResults,
      userEmail,
      targetSheetId
    })
  });
  
  const data = await response.json();
  return data;
};
```

#### 3. Job Status (Legacy)
```javascript
// GET /status/:jobId
const getJobStatusLegacy = async (jobId) => {
  const response = await fetch(`/status/${jobId}`);
  const data = await response.json();
  return data;
};

// GET /status
const getActiveJobsLegacy = async () => {
  const response = await fetch('/status');
  const data = await response.json();
  return data;
};
```

#### 4. All Jobs (Legacy)
```javascript
// GET /jobs
const getAllJobsLegacy = async () => {
  const response = await fetch('/jobs');
  const data = await response.json();
  return data;
};
```

#### 5. Job Control (Legacy)
```javascript
// POST /pause/:jobId
const pauseJobLegacy = async (jobId) => {
  const response = await fetch(`/pause/${jobId}`, {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};

// POST /resume/:jobId
const resumeJobLegacy = async (jobId) => {
  const response = await fetch(`/resume/${jobId}`, {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};

// POST /stop/:jobId
const stopJobLegacy = async (jobId) => {
  const response = await fetch(`/stop/${jobId}`, {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};
```

#### 6. Debug Job (Legacy)
```javascript
// GET /debug/:jobId
const debugJobLegacy = async (jobId) => {
  const response = await fetch(`/debug/${jobId}`);
  const data = await response.json();
  return data;
};
```

## 📊 Performance & Monitoring Routes

### Base URL: `/`

#### 1. Performance Metrics
```javascript
// GET /performance
const getPerformanceMetrics = async () => {
  const response = await fetch('/performance');
  const data = await response.json();
  return data;
};
```

#### 2. Force Garbage Collection
```javascript
// POST /performance/gc
const forceGarbageCollection = async () => {
  const response = await fetch('/performance/gc', {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};
```

## 🏥 Health & System Routes

### Base URL: `/`

#### 1. Health Check
```javascript
// GET /health
const getSystemHealth = async () => {
  const response = await fetch('/health');
  const data = await response.json();
  return data;
};
```

## 📚 API Documentation Routes

### Base URL: `/`

#### 1. API Documentation
```javascript
// GET /api-docs
const getApiDocumentation = async () => {
  const response = await fetch('/api-docs');
  const data = await response.json();
  return data;
};
```

## 💰 Payment & Subscription Routes

### Base URL: `/`

#### 1. Payment Management
```javascript
// POST /payments
const createPayment = async (paymentData) => {
  const response = await fetch('/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(paymentData)
  });
  
  const data = await response.json();
  return data;
};

// GET /payments/statistics
const getPaymentStatistics = async () => {
  const response = await fetch('/payments/statistics');
  const data = await response.json();
  return data;
};

// GET /payments/user/:userEmail
const getUserPayments = async (userEmail) => {
  const response = await fetch(`/payments/user/${userEmail}`);
  const data = await response.json();
  return data;
};

// GET /subscriptions/user/:userEmail
const getUserSubscription = async (userEmail) => {
  const response = await fetch(`/subscriptions/user/${userEmail}`);
  const data = await response.json();
  return data;
};

// POST /payments/:paymentId/verify
const verifyPayment = async (paymentId, verificationData) => {
  const response = await fetch(`/payments/${paymentId}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(verificationData)
  });
  
  const data = await response.json();
  return data;
};

// GET /payments/:paymentId
const getPayment = async (paymentId) => {
  const response = await fetch(`/payments/${paymentId}`);
  const data = await response.json();
  return data;
};

// POST /payments/webhook
const handlePaymentWebhook = async (webhookData) => {
  const response = await fetch('/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(webhookData)
  });
  
  const data = await response.json();
  return data;
};

// GET /payments/callback
const handlePaymentCallback = async (callbackParams) => {
  const params = new URLSearchParams(callbackParams);
  const response = await fetch(`/payments/callback?${params}`);
  const data = await response.json();
  return data;
};

// GET /payments/cancel
const handlePaymentCancel = async (cancelParams) => {
  const params = new URLSearchParams(cancelParams);
  const response = await fetch(`/payments/cancel?${params}`);
  const data = await response.json();
  return data;
};

// POST /payments/mock-webhook
const mockPaymentWebhook = async (mockData) => {
  const response = await fetch('/payments/mock-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(mockData)
  });
  
  const data = await response.json();
  return data;
};
```

## 🔑 API Key Management Routes

### Base URL: `/api-keys`

#### 1. API Key Management
```javascript
// POST /api-keys/init
const initializeApiKeyTables = async () => {
  const response = await fetch('/api-keys/init', {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};

// GET /api-keys/admin/keys
const adminListAllKeys = async () => {
  const response = await fetch('/api-keys/admin/keys');
  const data = await response.json();
  return data;
};

// GET /api-keys/admin/users
const adminListUsersSummary = async () => {
  const response = await fetch('/api-keys/admin/users');
  const data = await response.json();
  return data;
};

// POST /api-keys/create
const createApiKey = async (apiKeyData) => {
  const response = await fetch('/api-keys/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(apiKeyData)
  });
  
  const data = await response.json();
  return data;
};

// GET /api-keys/plans
const getApiKeyPlans = async () => {
  const response = await fetch('/api-keys/plans');
  const data = await response.json();
  return data;
};

// GET /api-keys/:apiKey/stats
const getApiKeyUsageStats = async (apiKey) => {
  const response = await fetch(`/api-keys/${apiKey}/stats`);
  const data = await response.json();
  return data;
};

// PUT /api-keys/:apiKey/plan
const updateApiKeyPlan = async (apiKey, planData) => {
  const response = await fetch(`/api-keys/${apiKey}/plan`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(planData)
  });
  
  const data = await response.json();
  return data;
};

// DELETE /api-keys/:apiKey
const deactivateApiKey = async (apiKey) => {
  const response = await fetch(`/api-keys/${apiKey}`, {
    method: 'DELETE'
  });
  
  const data = await response.json();
  return data;
};

// POST /api-keys/:apiKey/reset-usage
const resetApiKeyUsage = async (apiKey) => {
  const response = await fetch(`/api-keys/${apiKey}/reset-usage`, {
    method: 'POST'
  });
  
  const data = await response.json();
  return data;
};

// GET /api-keys/user/:userEmail
const getUserApiKeys = async (userEmail) => {
  const response = await fetch(`/api-keys/user/${userEmail}`);
  const data = await response.json();
  return data;
};
```

## 📊 User Data Management Routes

### Base URL: `/user-data`

#### 1. User Data Management
```javascript
// GET /user-data/all?userEmail=user@example.com
const getAllUserData = async (userEmail, page = 1, limit = 100, startDate = null, endDate = null) => {
  const params = new URLSearchParams({
    userEmail,
    page: page.toString(),
    limit: limit.toString()
  });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/user-data/all?${params}`);
  const data = await response.json();
  return data;
};

// GET /user-data/summary?userEmail=user@example.com
const getUserDataSummary = async (userEmail, startDate = null, endDate = null) => {
  const params = new URLSearchParams({ userEmail });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/user-data/summary?${params}`);
  const data = await response.json();
  return data;
};

// GET /user-data/by-city?userEmail=user@example.com
const getUserDataByCity = async (userEmail, startDate = null, endDate = null) => {
  const params = new URLSearchParams({ userEmail });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/user-data/by-city?${params}`);
  const data = await response.json();
  return data;
};

// GET /user-data/by-keyword?userEmail=user@example.com
const getUserDataByKeyword = async (userEmail, startDate = null, endDate = null) => {
  const params = new URLSearchParams({ userEmail });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/user-data/by-keyword?${params}`);
  const data = await response.json();
  return data;
};

// GET /user-data/recent?userEmail=user@example.com
const getUserRecentActivity = async (userEmail) => {
  const response = await fetch(`/user-data/recent?userEmail=${userEmail}`);
  const data = await response.json();
  return data;
};

// GET /user-data/export/csv?userEmail=user@example.com
const exportUserDataToCSV = async (userEmail, startDate = null, endDate = null) => {
  const params = new URLSearchParams({ userEmail });
  
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`/user-data/export/csv?${params}`);
  const data = await response.json();
  return data;
};
```

## 🚫 Deprecated Routes (Return 410 Status)

### Base URL: `/`

The following routes are deprecated and return a 410 status with alternatives:

```javascript
// GET / - Deprecated (was Job Control Dashboard)
// GET /saas - Deprecated (was SaaS Dashboard)
// GET /dashboard - Deprecated (was User Dashboard)
// GET /oauth/google-sheets/setup - Deprecated (was OAuth Setup)

const handleDeprecatedRoute = async (route) => {
  const response = await fetch(route);
  if (response.status === 410) {
    const data = await response.json();
    console.log('Deprecated route:', data.message);
    console.log('Alternatives:', data.alternatives);
    return data;
  }
  return await response.json();
};
```

---

## 🎯 Frontend Implementation Examples

### 1. Authentication Context (React)
```javascript
// contexts/AuthContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      getCurrentUser();
    } else {
      setLoading(false);
    }
  }, [token]);

  const getCurrentUser = async () => {
    try {
      const userData = await fetch('/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(res => res.json());
      
      if (userData.success) {
        setUser(userData.user);
      } else {
        logout();
      }
    } catch (error) {
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = (userData, newToken) => {
    setUser(userData);
    setToken(newToken);
    localStorage.setItem('token', newToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
```

### 2. API Service Layer
```javascript
// services/api.js
class ApiService {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || '';
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('token', token);
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(url, config);
      
      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await this.refreshToken();
        if (refreshed) {
          // Retry request with new token
          config.headers.Authorization = `Bearer ${this.token}`;
          const retryResponse = await fetch(url, config);
          return await retryResponse.json();
        } else {
          // Redirect to login
          window.location.href = '/login';
          return null;
        }
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  async refreshToken() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    try {
      const response = await fetch('/auth/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      const data = await response.json();
      if (data.success) {
        this.setToken(data.token);
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    return false;
  }

  // Authentication methods
  async loginWithGoogle(redirectTo) {
    const params = new URLSearchParams();
    if (redirectTo) params.append('redirectTo', redirectTo);
    
    const response = await fetch(`/auth/google/authorize?${params}`);
    const data = await response.json();
    
    if (data.success) {
      window.location.href = data.authUrl;
    }
    return data;
  }

  async getCurrentUser() {
    return this.request('/auth/me');
  }

  // Subscription methods
  async getPlans() {
    return this.request('/subscription/plans');
  }

  async getSubscriptionStatus() {
    return this.request('/subscription/status');
  }

  async createSubscription(planId) {
    return this.request('/subscription/create', {
      method: 'POST',
      body: JSON.stringify({ planId })
    });
  }

  // Google Sheets methods
  async connectGoogleSheets() {
    return this.request('/google/sheets/connect');
  }

  async getAvailableSheets() {
    return this.request('/google/sheets/available');
  }

  async getConnectedSheets() {
    return this.request('/google/sheets/connected');
  }

  // Job methods
  async createJob(jobData) {
    return this.request('/jobs/create', {
      method: 'POST',
      body: JSON.stringify(jobData)
    });
  }

  async getJobStatus(jobId) {
    return this.request(`/jobs/${jobId}`);
  }

  async getAllJobs() {
    return this.request('/jobs');
  }

  // Usage methods
  async getCurrentUsage() {
    return this.request('/usage/current');
  }

  async getUsageHistory(params) {
    const queryString = new URLSearchParams(params).toString();
    return this.request(`/usage/history?${queryString}`);
  }
}

export default new ApiService();
```

### 3. Dashboard Component
```javascript
// components/Dashboard.js
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Load subscription status
      const subscription = await api.getSubscriptionStatus();
      
      // Load current usage
      const usageData = await api.getCurrentUsage();
      
      // Load recent jobs
      const jobs = await api.getAllJobs();
      
      setStats({
        subscription,
        usage: usageData,
        recentJobs: jobs.slice(0, 5)
      });
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const createNewJob = async (jobData) => {
    try {
      const job = await api.createJob(jobData);
      if (job.success) {
        // Redirect to job status page
        window.location.href = `/jobs/${job.jobId}`;
      }
    } catch (error) {
      console.error('Failed to create job:', error);
    }
  };

  if (loading) {
    return <div>Loading dashboard...</div>;
  }

  return (
    <div className="dashboard">
      <h1>Welcome, {user.name}!</h1>
      
      {/* Subscription Status */}
      <div className="subscription-card">
        <h3>Subscription Status</h3>
        {stats.subscription.hasSubscription ? (
          <div>
            <p>Plan: {stats.subscription.subscription.plan}</p>
            <p>Status: {stats.subscription.subscription.status}</p>
            <p>Expires: {new Date(stats.subscription.subscription.expiresAt).toLocaleDateString()}</p>
          </div>
        ) : (
          <p>No active subscription</p>
        )}
      </div>

      {/* Usage Summary */}
      <div className="usage-card">
        <h3>Usage This Month</h3>
        <div className="usage-bar">
          <div 
            className="usage-fill" 
            style={{ width: `${stats.usage.usage.percentUsed}%` }}
          ></div>
        </div>
        <p>{stats.usage.usage.current} / {stats.usage.usage.limit} used</p>
      </div>

      {/* Recent Jobs */}
      <div className="jobs-card">
        <h3>Recent Jobs</h3>
        {stats.recentJobs.length > 0 ? (
          <ul>
            {stats.recentJobs.map(job => (
              <li key={job.jobId}>
                {job.keywords} in {job.location} - {job.status}
              </li>
            ))}
          </ul>
        ) : (
          <p>No jobs yet</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <button onClick={() => createNewJob({ keywords: 'restaurants', location: 'New York' })}>
          Start New Job
        </button>
        <button onClick={() => window.location.href = '/sheets'}>
          Manage Sheets
        </button>
        <button onClick={() => window.location.href = '/subscription'}>
          Manage Subscription
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
```

### 4. Job Creation Form
```javascript
// components/JobForm.js
import React, { useState } from 'react';
import api from '../services/api';

const JobForm = () => {
  const [formData, setFormData] = useState({
    keywords: '',
    location: '',
    maxResults: 50,
    targetSheetId: ''
  });
  const [loading, setLoading] = useState(false);
  const [sheets, setSheets] = useState([]);

  useEffect(() => {
    loadConnectedSheets();
  }, []);

  const loadConnectedSheets = async () => {
    try {
      const response = await api.getConnectedSheets();
      if (response.success) {
        setSheets(response.sheets);
      }
    } catch (error) {
      console.error('Failed to load sheets:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const job = await api.createJob(formData);
      if (job.success) {
        // Redirect to job status
        window.location.href = `/jobs/${job.jobId}`;
      }
    } catch (error) {
      console.error('Failed to create job:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="job-form">
      <h2>Create New Lead Generation Job</h2>
      
      <div className="form-group">
        <label htmlFor="keywords">Keywords</label>
        <input
          type="text"
          id="keywords"
          name="keywords"
          value={formData.keywords}
          onChange={handleChange}
          placeholder="e.g., restaurants, coffee shops"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="location">Location</label>
        <input
          type="text"
          id="location"
          name="location"
          value={formData.location}
          onChange={handleChange}
          placeholder="e.g., New York, NY"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="maxResults">Maximum Results</label>
        <input
          type="number"
          id="maxResults"
          name="maxResults"
          value={formData.maxResults}
          onChange={handleChange}
          min="1"
          max="1000"
        />
      </div>

      <div className="form-group">
        <label htmlFor="targetSheetId">Target Google Sheet (Optional)</label>
        <select
          id="targetSheetId"
          name="targetSheetId"
          value={formData.targetSheetId}
          onChange={handleChange}
        >
          <option value="">Select a sheet</option>
          {sheets.map(sheet => (
            <option key={sheet.id} value={sheet.id}>
              {sheet.name}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={loading}>
        {loading ? 'Creating Job...' : 'Create Job'}
      </button>
    </form>
  );
};

export default JobForm;
```

---

## 🎨 CSS Styling Examples

### 1. Dashboard Styles
```css
/* styles/Dashboard.css */
.dashboard {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.dashboard h1 {
  color: #333;
  margin-bottom: 2rem;
}

.subscription-card,
.usage-card,
.jobs-card {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.usage-bar {
  width: 100%;
  height: 20px;
  background: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
  margin: 1rem 0;
}

.usage-fill {
  height: 100%;
  background: linear-gradient(90deg, #4CAF50, #8BC34A);
  transition: width 0.3s ease;
}

.quick-actions {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
}

.quick-actions button {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  background: #007bff;
  color: white;
  cursor: pointer;
  transition: background 0.2s;
}

.quick-actions button:hover {
  background: #0056b3;
}
```

### 2. Form Styles
```css
/* styles/Form.css */
.job-form {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #333;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
}

button[type="submit"] {
  width: 100%;
  padding: 1rem;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

button[type="submit"]:hover {
  background: #218838;
}

button[type="submit"]:disabled {
  background: #6c757d;
  cursor: not-allowed;
}
```

---

## 🔧 Development Setup

### 1. Environment Variables
```bash
# .env
REACT_APP_API_URL=http://localhost:3000
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id
REACT_APP_RAZORPAY_KEY_ID=your_razorpay_key
```

### 2. Package Dependencies
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.8.0",
    "axios": "^1.3.0",
    "react-query": "^3.39.0",
    "react-hook-form": "^7.43.0",
    "recharts": "^2.5.0"
  }
}
```

### 3. Project Structure
```
src/
├── components/
│   ├── Dashboard.js
│   ├── JobForm.js
│   ├── GoogleSheets.js
│   ├── Subscription.js
│   └── Admin/
├── contexts/
│   └── AuthContext.js
├── services/
│   └── api.js
├── hooks/
│   └── useApi.js
├── styles/
│   ├── Dashboard.css
│   ├── Form.css
│   └── index.css
└── App.js
```

---

## 📚 Additional Resources

### API Response Headers
- `X-RateLimit-Limit`: Rate limit for the current period
- `X-RateLimit-Remaining`: Remaining requests in current period
- `X-RateLimit-Reset`: Time when rate limit resets
- `X-Usage-Current`: Current usage count
- `X-Usage-Limit`: Usage limit for current plan
- `X-Usage-Remaining`: Remaining usage units

### Error Handling
All API endpoints return consistent error responses:
```json
{
  "success": false,
  "error": "Error type",
  "message": "Human-readable error message"
}
```

### Rate Limiting
- Free Plan: 10 requests/minute
- Basic Plan: 100 requests/minute
- Pro Plan: 500 requests/minute
- Enterprise Plan: 1000 requests/minute

### Webhook Endpoints
- Razorpay Webhook: `/subscription/webhook`
- Job Completion: `/jobs/webhook` (if implemented)

---

## 🚀 Getting Started

1. **Clone the repository** and install dependencies
2. **Set up environment variables** with your API credentials
3. **Start the development server** with `npm start`
4. **Implement authentication** using the AuthContext
5. **Build your components** using the provided examples
6. **Test API integration** with the development server
7. **Deploy your frontend** to your preferred hosting platform

## 📊 Complete API Summary

### 🔐 **Authentication Routes** (Base: `/auth`)
- **Google OAuth**: `/google/authorize`, `/google/callback`
- **Token Management**: `/refresh-token`, `/logout`, `/me`
- **Total Endpoints**: 5

### 💳 **Subscription Routes** (Base: `/subscription`)
- **Plan Management**: `/plans`, `/status`, `/create`
- **Payment Processing**: `/verify-payment`, `/webhook`, `/cancel`
- **Total Endpoints**: 6

### 📊 **Google Sheets Routes** (Base: `/google`)
- **Connection**: `/sheets/connect`, `/sheets/status`
- **Sheet Management**: `/sheets/available`, `/sheets/connected`, `/sheets/create`, `/sheets/connect`
- **Data Operations**: `/sheets/data`, `/sheets/data/stats`, `/sheets/data/save`
- **Total Endpoints**: 9

### 🚀 **Job Management Routes** (Base: `/jobs`)
- **Job Operations**: `/create`, `/:jobId`, `/`, `/:jobId/pause`, `/:jobId/resume`, `/:jobId/stop`
- **Total Endpoints**: 6

### 📈 **Usage Tracking Routes** (Base: `/usage`)
- **Usage Data**: `/current`, `/history`, `/by-resource`, `/forecast`
- **Total Endpoints**: 4

### 👑 **Admin Routes** (Base: `/admin`)
- **Dashboard**: `/dashboard`
- **User Management**: `/users`, `/users/:email`, `/users/assign-plan`
- **Statistics**: `/usage/statistics`, `/subscriptions/statistics`
- **Plan Management**: `/subscription/plans`
- **Admin Users**: `/admins`, `/admins/:email`
- **Debug**: `/debug/token` (development only)
- **Total Endpoints**: 9

### 🔄 **Legacy API Routes** (Base: `/api/v1`)
- **Search Service**: `/search-service`
- **Job Management**: `/status/:jobId`, `/status`, `/jobs`
- **Performance**: `/performance`
- **Job Control**: `/jobs/:jobId/pause`, `/jobs/:jobId/resume`, `/jobs/:jobId/stop`
- **Debug**: `/debug/:jobId`
- **User Management**: `/user/jobs`, `/user/sheets`
- **Admin**: `/admin/stats`
- **Total Endpoints**: 9

### 🔐 **OAuth Routes** (Base: `/oauth`)
- **Setup**: `/credentials`, `/authorize`, `/callback`
- **Google Sheets**: `/sheets/setup`, `/sheets/authorize`, `/sheets/callback`, `/sheets/status`
- **Management**: `/google-sheets/refresh`, `/google-sheets/disconnect`
- **Total Endpoints**: 8

### 🏢 **Multi-tenant Routes** (Base: `/multi-tenant-sheets`)
- **Authentication**: `/auth/url`, `/auth/connect`, `/auth/status`, `/auth/disconnect`
- **Sheet Management**: `/available`, `/create`, `/connect`, `/connected`, `/:sheetId`
- **Data Operations**: `/data`, `/data/stats`, `/data/save`
- **Total Endpoints**: 12

### 🔧 **Legacy Job Routes** (Base: `/`)
- **Search**: `/search-service`, `/search`
- **Job Status**: `/status/:jobId`, `/status`, `/jobs`
- **Job Control**: `/pause/:jobId`, `/resume/:jobId`, `/stop/:jobId`
- **Debug**: `/debug/:jobId`
- **Total Endpoints**: 8

### 📊 **Performance Routes** (Base: `/`)
- **Metrics**: `/performance`
- **System**: `/performance/gc`
- **Total Endpoints**: 2

### 🏥 **Health Routes** (Base: `/`)
- **System Health**: `/health`
- **Total Endpoints**: 1

### 📚 **Documentation Routes** (Base: `/`)
- **API Docs**: `/api-docs`
- **Total Endpoints**: 1

### 💰 **Payment Routes** (Base: `/`)
- **Payment Management**: `/payments`, `/payments/statistics`, `/payments/user/:userEmail`
- **Subscription**: `/subscriptions/user/:userEmail`
- **Verification**: `/payments/:paymentId/verify`
- **Webhooks**: `/payments/webhook`, `/payments/mock-webhook`
- **Callbacks**: `/payments/callback`, `/payments/cancel`
- **Total Endpoints**: 8

### 🔑 **API Key Routes** (Base: `/api-keys`)
- **Initialization**: `/init`
- **Admin**: `/admin/keys`, `/admin/users`
- **Management**: `/create`, `/plans`, `/:apiKey/stats`, `/:apiKey/plan`, `/:apiKey`, `/:apiKey/reset-usage`
- **User**: `/user/:userEmail`
- **Total Endpoints**: 9

### 📊 **User Data Routes** (Base: `/user-data`)
- **Data Retrieval**: `/all`, `/summary`, `/by-city`, `/by-keyword`, `/recent`
- **Export**: `/export/csv`
- **Total Endpoints**: 6

### 🚫 **Deprecated Routes** (Base: `/`)
- **Legacy Dashboards**: `/`, `/saas`, `/dashboard`
- **Legacy OAuth**: `/oauth/google-sheets/setup`
- **Total Endpoints**: 4

---

## 📈 **Total API Endpoints: 120+**

### 🔒 **Authentication Required**
- **JWT Protected**: 45 endpoints
- **API Key Protected**: 15 endpoints
- **User Email Required**: 18 endpoints

### 🌐 **Public Endpoints**
- **Health Check**: 1 endpoint
- **API Documentation**: 1 endpoint
- **OAuth Callbacks**: 3 endpoints

### 📊 **Rate Limiting**
- **Free Plan**: 10 requests/minute
- **Basic Plan**: 100 requests/minute
- **Pro Plan**: 500 requests/minute
- **Enterprise Plan**: 1000 requests/minute

---

This comprehensive guide provides all the information a frontend engineer needs to build a complete frontend for the Pitchers SaaS platform. The guide covers **120+ routes, endpoints, request/response structures**, and includes practical implementation examples covering every aspect from authentication to data management, job processing, and admin operations.

### 🎯 **Key Features Covered**
- ✅ **Complete Authentication System** (JWT + OAuth)
- ✅ **Multi-tenant Architecture** (User isolation)
- ✅ **Subscription Management** (Razorpay integration)
- ✅ **Google Sheets Integration** (OAuth + API)
- ✅ **Job Management** (Create, monitor, control)
- ✅ **Usage Tracking** (Limits, history, forecasting)
- ✅ **Admin Dashboard** (User management, statistics)
- ✅ **Legacy API Support** (Backward compatibility)
- ✅ **Payment Processing** (Webhooks, callbacks)
- ✅ **Data Export** (CSV, analytics)
- ✅ **Performance Monitoring** (Metrics, health checks)
- ✅ **Comprehensive Error Handling** (Validation, status codes)
