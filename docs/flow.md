# 🚀 SaaS Payment Flow Testing Guide

## 📋 Prerequisites
- Node.js server running on `http://localhost:3000`
- PostgreSQL database configured
- Environment variables set up

## 🔧 Server Setup Commands

### Start Server
```bash
# Kill existing processes and start fresh
pkill -f "node.*server.js" && sleep 3 && npm start

# Wait for server to be ready
sleep 8
```

### Check Server Health
```bash
curl -s http://localhost:3000/health | jq .
```

## 💳 Payment System Testing Flow

### 1. Create Payment Order
```bash
curl -s -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "test@example.com",
    "planType": "basic",
    "amount": 999,
    "currency": "INR",
    "prefill": {
      "name": "Test User",
      "contact": "+919999999999"
    }
  }' | jq .
```

### 2. Create Premium Payment Order
```bash
curl -s -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "saas@example.com",
    "planType": "premium",
    "amount": 1999,
    "currency": "INR",
    "prefill": {
      "name": "SaaS User",
      "contact": "+919999999999"
    }
  }' | jq .
```

### 3. Process Payment via Mock Webhook
```bash
# Replace PAYMENT_ID with actual payment ID from step 1 or 2
curl -s -X POST http://localhost:3000/payments/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "pay_1756622753029_y7cdycy",
    "status": "captured",
    "metadata": {
      "razorpay_payment_id": "pay_xxxxxxxxxxxxx"
    }
  }' | jq .
```

### 4. Check Payment Statistics
```bash
curl -s http://localhost:3000/payments/statistics | jq .
```

## 🔑 API Key Management Testing

### 1. Create API Key for Basic Plan
```bash
curl -s -X POST http://localhost:3000/api-keys/create \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "test@example.com",
    "planType": "basic"
  }' | jq .
```

### 2. Create API Key for Pro Plan
```bash
curl -s -X POST http://localhost:3000/api-keys/create \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "saas@example.com",
    "planType": "pro"
  }' | jq .
```

### 3. Get User API Keys
```bash
curl -s http://localhost:3000/api-keys/user/saas@example.com | jq .
```

### 4. Get API Key Statistics
```bash
# Replace API_KEY with actual key from step 2
curl -s http://localhost:3000/api-keys/pk_ff7bec6715c3931ff5d3b5cb40e0983fd847e6561003a543fc9fedd1/stats | jq .
```

## 🚀 SaaS API Testing

### 1. Test API Key Authentication
```bash
# Replace API_KEY with actual key
curl -s -X POST http://localhost:3000/api/v1/search-service \
  -H "Content-Type: application/json" \
  -H "x-api-key: pk_ff7bec6715c3931ff5d3b5cb40e0983fd847e6561003a543fc9fedd1" \
  -d '{
    "city": "Bangalore",
    "keyword": "restaurants",
    "maxResults": 5
  }' | jq .
```

### 2. Test Job Status with API Key
```bash
# Replace JOB_ID with actual job ID from search service
curl -s http://localhost:3000/api/v1/status/JOB_ID \
  -H "x-api-key: pk_ff7bec6715c3931ff5d3b5cb40e0983fd847e6561003a543fc9fedd1" | jq .
```

### 3. Test Job Control with API Key
```bash
# Pause job
curl -s -X POST http://localhost:3000/api/v1/jobs/JOB_ID/pause \
  -H "x-api-key: pk_ff7bec6715c3931ff5d3b5cb40e0983fd847e6561003a543fc9fedd1" | jq .

# Resume job
curl -s -X POST http://localhost:3000/api/v1/jobs/JOB_ID/resume \
  -H "x-api-key: pk_ff7bec6715c3931ff5d3b5cb40e0983fd847e6561003a543fc9fedd1" | jq .

# Stop job
curl -s -X POST http://localhost:3000/api/v1/jobs/JOB_ID/stop \
  -H "x-api-key: pk_ff7bec6715c3931ff5d3b5cb40e0983fd847e6561003a543fc9fedd1" | jq .
```

## 🔍 OAuth Testing

### 1. Initiate OAuth Flow
```bash
curl -s "http://localhost:3000/multi-tenant-sheets/auth/connect?userEmail=saas@example.com&redirect_to=https://pitchers.ufdevs.me/saas" | jq .
```

### 2. Check OAuth Status
```bash
curl -s "http://localhost:3000/multi-tenant-sheets/auth/status?userEmail=saas@example.com" | jq .
```

### 3. Get User Sheets
```bash
curl -s "http://localhost:3000/multi-tenant-sheets/sheets?userEmail=saas@example.com" | jq .
```

## 📊 System Monitoring

### 1. Health Check
```bash
curl -s http://localhost:3000/health | jq .
```

### 2. Performance Metrics
```bash
curl -s http://localhost:3000/performance | jq .
```

### 3. All Jobs Status
```bash
curl -s http://localhost:3000/jobs | jq .
```

### 4. Active Jobs
```bash
curl -s http://localhost:3000/status | jq .
```

## 🧪 Complete End-to-End Test Flow

### Step 1: Server Setup
```bash
pkill -f "node.*server.js" && sleep 3 && npm start
sleep 8
```

### Step 2: Health Check
```bash
curl -s http://localhost:3000/health | jq .
```

### Step 3: Create Payment
```bash
PAYMENT_RESPONSE=$(curl -s -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "e2e@example.com",
    "planType": "pro",
    "amount": 2999,
    "currency": "INR",
    "prefill": {
      "name": "E2E Test User",
      "contact": "+919999999999"
    }
  }')

echo $PAYMENT_RESPONSE | jq .
PAYMENT_ID=$(echo $PAYMENT_RESPONSE | jq -r '.data.payment.paymentId')
echo "Payment ID: $PAYMENT_ID"
```

### Step 4: Process Payment
```bash
curl -s -X POST http://localhost:3000/payments/mock-webhook \
  -H "Content-Type: application/json" \
  -d "{
    \"paymentId\": \"$PAYMENT_ID\",
    \"status\": \"captured\",
    \"metadata\": {
      \"razorpay_payment_id\": \"pay_xxxxxxxxxxxxx\"
    }
  }" | jq .
```

### Step 5: Create API Key
```bash
API_KEY_RESPONSE=$(curl -s -X POST http://localhost:3000/api-keys/create \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "e2e@example.com",
    "planType": "pro"
  }')

echo $API_KEY_RESPONSE | jq .
API_KEY=$(echo $API_KEY_RESPONSE | jq -r '.data.apiKey')
echo "API Key: $API_KEY"
```

### Step 6: Test SaaS API
```bash
curl -s -X POST http://localhost:3000/api/v1/search-service \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "city": "Mumbai",
    "keyword": "hotels",
    "maxResults": 3
  }' | jq .
```

### Step 7: Check Statistics
```bash
echo "Payment Statistics:"
curl -s http://localhost:3000/payments/statistics | jq .

echo "API Key Statistics:"
curl -s http://localhost:3000/api-keys/$API_KEY/stats | jq .
```

## 🐛 Troubleshooting Commands

### Check Database Connection
```bash
curl -s http://localhost:3000/payments/test
```

### Check Server Logs
```bash
# View real-time logs
tail -f logs/app.log

# Check for errors
grep -i error logs/app.log
```

### Test Database Tables
```bash
# Connect to PostgreSQL and check tables
psql $DATABASE_URL -c "\dt"
psql $DATABASE_URL -c "SELECT * FROM payments LIMIT 5;"
psql $DATABASE_URL -c "SELECT * FROM api_keys LIMIT 5;"
```

## 📝 Expected Responses

### Successful Payment Creation
```json
{
  "success": true,
  "message": "Payment order created successfully",
  "data": {
    "payment": {
      "id": 5,
      "paymentId": "pay_1756622753029_y7cdycy",
      "orderId": "order_1756622753029_dj3l03h",
      "status": "pending",
      "amount": "1999.00",
      "currency": "INR",
      "planType": "premium",
      "createdAt": "2025-08-31T01:15:53.405Z"
    },
    "paymentLink": {
      "key": "rzp_test_mock",
      "amount": 199900,
      "currency": "INR",
      "name": "Business Scraper",
      "description": "Lead Generation Service",
      "order_id": "order_1756622753029_dj3l03h",
      "prefill": {
        "name": "SaaS User",
        "email": "saas@example.com",
        "contact": "+919999999999"
      },
      "theme": {
        "color": "#3399cc"
      },
      "callback_url": "https://pitchers.ufdevs.me/api/payments/callback",
      "cancel_url": "https://pitchers.ufdevs.me/api/payments/cancel"
    },
    "orderId": "order_1756622753029_dj3l03h"
  }
}
```

### Successful API Key Creation
```json
{
  "success": true,
  "message": "API key created successfully",
  "data": {
    "apiKey": "pk_ff7bec6715c3931ff5d3b5cb40e0983fd847e6561003a543fc9fedd1",
    "userEmail": "saas@example.com",
    "planType": "pro",
    "usageLimit": 10000,
    "rateLimit": 50,
    "expiresAt": null,
    "createdAt": "2025-08-31T01:16:26.452Z"
  }
}
```

### Payment Statistics
```json
{
  "success": true,
  "statistics": {
    "totalPayments": 5,
    "successfulPayments": 3,
    "failedPayments": 0,
    "totalRevenue": 3997,
    "activeSubscriptions": 2
  }
}
```

## 🎯 Production Checklist

- [ ] Replace mock Razorpay keys with real credentials
- [ ] Set up SSL certificates for HTTPS
- [ ] Configure production database
- [ ] Set up monitoring and logging
- [ ] Test webhook endpoints with real Razorpay
- [ ] Implement email notifications
- [ ] Set up backup and recovery procedures
- [ ] Configure rate limiting for production
- [ ] Test with real payment amounts
- [ ] Set up analytics and reporting

## 📚 Additional Resources

- [Razorpay API Documentation](https://razorpay.com/docs/api/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Express.js Best Practices](https://expressjs.com/en/advanced/best-practices-performance.html)
