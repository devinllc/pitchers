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
