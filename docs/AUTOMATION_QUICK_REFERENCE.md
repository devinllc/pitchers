# ⚡ Automation Quick Reference & Debugging Guide

## 🚀 Quick Start (5 Minutes)

### 1. Database Setup
```bash
cd /pitchers
psql -h db.example.com -U postgres -d defaultdb < migrations/005_create_automation_tables.sql
```

### 2. Environment Setup
```bash
cd /pitchers
cat >> .env << EOF
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=noreply@pitchers.ai
TWILIO_ACCOUNT_SID=AC123
TWILIO_AUTH_TOKEN=token123
TWILIO_PHONE_NUMBER=+11234567890
EOF
```

### 3. Dependencies
```bash
npm install @sendgrid/mail twilio uuid
```

### 4. Add Routes to Server
```javascript
// In server.js or api/index.js
const automationRoutes = require('./routes/automationRoutes');
app.use('/api/v1/automation', automationRoutes);
```

### 5. Test It
```bash
curl -X POST http://localhost:3001/api/v1/automation/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "userEmail": "test@example.com",
    "campaignType": "followups",
    "leads": [{
      "id": 1,
      "name": "John",
      "email": "john@example.com",
      "phone": "+919876543210",
      "city": "Delhi",
      "channel": "email",
      "message": "Hi John!"
    }],
    "executeNow": true
  }'
```

---

## 🔍 Debugging Checklist

### Campaign Not Creating

```sql
-- Check if tables exist
\dt automation_*

-- Check recent attempts
SELECT * FROM automation_campaigns ORDER BY created_at DESC LIMIT 5;

-- Check for errors
SELECT error_message FROM automation_executions 
WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10;
```

### Messages Not Sending

```sql
-- Check execution status
SELECT * FROM automation_executions 
WHERE campaign_id = 'camp_YOUR_ID' 
ORDER BY created_at DESC;

-- Check for specific lead
SELECT * FROM automation_executions 
WHERE lead_id = 123 
ORDER BY created_at DESC;

-- Check error details
SELECT lead_id, status, error_message, provider_response 
FROM automation_executions 
WHERE campaign_id = 'camp_YOUR_ID' AND status = 'failed';
```

### API Returns 401/403

```bash
# Check API key is valid and included
curl -H "X-API-Key: YOUR_KEY" http://localhost:3001/api/v1/automation/campaign/test

# Check API key exists in auth middleware
grep "X-API-Key" controllers/automationController.js
```

### SendGrid Not Connected

```javascript
// Test SendGrid connection
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

sgMail.send({
  to: 'test@example.com',
  from: 'noreply@pitchers.ai',
  subject: 'Test',
  html: '<p>Test email</p>'
}).then(() => console.log('✅ SendGrid works'))
  .catch(err => console.error('❌', err.message));
```

### Twilio Not Connected

```javascript
// Test Twilio connection
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

client.messages.create({
  body: 'Test message',
  from: process.env.TWILIO_PHONE_NUMBER,
  to: '+919876543210'
}).then(msg => console.log('✅ Twilio works:', msg.sid))
  .catch(err => console.error('❌', err.message));
```

---

## 📊 Database Schema Quick View

### automation_campaigns
```sql
campaign_id (PK)      -- Unique campaign identifier
user_email            -- Who created it
campaign_type         -- 'followups', 'pitches', etc.
status                -- 'draft', 'running', 'completed', 'failed'
total_leads           -- How many leads targeted
leads_sent            -- Count of successful sends
leads_failed          -- Count of failed sends
leads_pending         -- Count still pending
created_at            -- When created
started_at            -- When execution started
completed_at          -- When execution finished
config                -- JSONB with automation settings
```

### automation_executions
```sql
execution_id (PK)     -- Unique execution record
campaign_id (FK)      -- Links to campaign
lead_id               -- Which lead was sent to
campaign_type         -- Type of campaign
contact_channel       -- 'email', 'whatsapp', 'sms'
status                -- 'pending', 'sent', 'failed', 'bounced'
lead_email            -- Email address (if email channel)
lead_phone            -- Phone number (if SMS/WhatsApp)
message_sent          -- The actual message sent
error_message         -- If status='failed'
provider_response     -- JSON response from SendGrid/Twilio
sent_at               -- When message was sent
created_at            -- When record created
```

---

## 🔗 File Locations Reference

| What | Where |
|------|-------|
| Database schema | `/pitchers/migrations/005_create_automation_tables.sql` |
| Automation service | `/pitchers/services/automationService.js` |
| SendGrid service | `/pitchers/services/sendGridService.js` |
| Twilio service | `/pitchers/services/twilioService.js` |
| API controller | `/pitchers/controllers/automationController.js` |
| API routes | `/pitchers/routes/automationRoutes.js` |
| Frontend code | `/pitchers-1/src/app/dashboard-unified/page.js` |
| Full guide | `/pitchers/docs/AUTOMATION_IMPLEMENTATION_GUIDE.md` |
| This guide | `/pitchers/docs/AUTOMATION_QUICK_REFERENCE.md` |

---

## 💻 Common Commands

### View Campaign Status in CLI
```bash
curl -s http://localhost:3001/api/v1/automation/campaign/camp_1234567 \
  -H "X-API-Key: YOUR_KEY" | jq .
```

### List User's Campaigns
```bash
curl -s "http://localhost:3001/api/v1/automation/my-campaigns?userEmail=user@example.com" \
  -H "X-API-Key: YOUR_KEY" | jq '.campaigns[] | {campaign_id, status, leads_sent}'
```

### Get Delivery Logs for Campaign
```bash
curl -s "http://localhost:3001/api/v1/automation/campaign/camp_1234567/executions?limit=10" \
  -H "X-API-Key: YOUR_KEY" | jq '.executions[] | {lead_id, status, lead_email}'
```

### Pause Campaign
```bash
curl -X POST http://localhost:3001/api/v1/automation/campaign/camp_1234567/pause \
  -H "X-API-Key: YOUR_KEY"
```

### Resume Campaign
```bash
curl -X POST http://localhost:3001/api/v1/automation/campaign/camp_1234567/resume \
  -H "X-API-Key: YOUR_KEY"
```

---

## 🧪 Manual Test Scenarios

### Scenario 1: Send Email Campaign
```bash
curl -X POST http://localhost:3001/api/v1/automation/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "userEmail": "user@example.com",
    "campaignType": "followups",
    "leads": [{
      "id": 1,
      "name": "Raj",
      "business_name": "Tech Corp",
      "email": "raj@techcorp.com",
      "phone": "+919876543210",
      "city": "Bangalore",
      "channel": "email",
      "message": "Hi Raj! Following up..."
    }],
    "executeNow": true,
    "delay": 1000
  }'
```

### Scenario 2: Send WhatsApp Campaign
```bash
curl -X POST http://localhost:3001/api/v1/automation/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "userEmail": "user@example.com",
    "campaignType": "coldDms",
    "leads": [{
      "id": 1,
      "name": "Priya",
      "business_name": "Marketing Plus",
      "email": "priya@marketing.com",
      "phone": "+919876543210",
      "city": "Mumbai",
      "channel": "whatsapp",
      "message": "Hi Priya! Check out Pitchers..."
    }],
    "executeNow": true
  }'
```

### Scenario 3: Bulk Campaign (Multiple Leads)
```bash
curl -X POST http://localhost:3001/api/v1/automation/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "userEmail": "user@example.com",
    "campaignType": "pitches",
    "leads": [
      {"id": 1, "name": "Lead 1", "email": "lead1@example.com", "phone": "+919876543210", "city": "Delhi", "channel": "email", "message": "Pitch 1"},
      {"id": 2, "name": "Lead 2", "email": "lead2@example.com", "phone": "+919876543211", "city": "Bangalore", "channel": "email", "message": "Pitch 2"},
      {"id": 3, "name": "Lead 3", "email": "lead3@example.com", "phone": "+919876543212", "city": "Mumbai", "channel": "email", "message": "Pitch 3"}
    ],
    "executeNow": true,
    "delay": 2000
  }'
```

---

## 🐛 Logging & Monitoring

### Backend Console Logs to Watch For

```
✅ Campaign created: camp_123456  -- Success
🚀 Starting campaign execution: camp_123456  -- Execution started
✅ Email sent to user@example.com (Message ID: xxx)  -- Email success
❌ Failed to send email to bad@example.com: xxx  -- Email failed
✅ Campaign completed: 45 sent, 2 failed  -- Campaign done
```

### Database Query to Monitor Progress

```sql
-- Real-time campaign progress
SELECT 
  c.campaign_id,
  c.campaign_type,
  c.total_leads,
  COUNT(CASE WHEN e.status = 'sent' THEN 1 END) as sent,
  COUNT(CASE WHEN e.status = 'failed' THEN 1 END) as failed,
  COUNT(CASE WHEN e.status = 'pending' THEN 1 END) as pending,
  c.status,
  c.started_at,
  NOW() - c.started_at as duration
FROM automation_campaigns c
LEFT JOIN automation_executions e ON c.campaign_id = e.campaign_id
WHERE c.created_at > NOW() - INTERVAL '24 hours'
GROUP BY c.campaign_id, c.campaign_type, c.total_leads, c.status, c.started_at
ORDER BY c.created_at DESC;
```

---

## 🆘 Common Error Messages & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `Missing X-API-Key header` | No authentication | Add `-H "X-API-Key: YOUR_KEY"` to curl |
| `SENDGRID_API_KEY not configured` | Environment variable missing | Set `SENDGRID_API_KEY=xxx` in .env |
| `Twilio service not configured` | Missing Twilio credentials | Set TWILIO_ACCOUNT_SID, AUTH_TOKEN |
| `Campaign not found` | Invalid campaign ID | Check campaign_id format (camp_xxx) |
| `No valid contact channel` | Lead missing email & phone | Add email or phone to lead object |
| `duplicate key value violates unique constraint` | Campaign ID collision | Regenerate with new UUID |
| `Connection timeout` | Database unreachable | Check DATABASE_URL, test connection |

---

## 📈 Performance Tips

1. **Use pagination** when retrieving large campaign lists
   ```bash
   ?limit=50&offset=0
   ```

2. **Increase delay between sends** to avoid provider rate limits
   ```javascript
   delay: 2000 // 2 seconds between each message
   ```

3. **Test with small batch first** before scaling
   ```javascript
   leads: leads.slice(0, 5) // Test with 5 leads first
   ```

4. **Monitor provider dashboards** for bounce rates
   - SendGrid: sendgrid.com/dashboard
   - Twilio: twilio.com/console

---

## 🔐 Security Reminders

- ✅ Always use API key authentication
- ✅ Never expose API keys in code
- ✅ Use HTTPS for all API calls
- ✅ Validate user email before creating campaign
- ✅ Sanitize message content before sending
- ✅ Rate limit API endpoints (add middleware)
- ✅ Log all campaign executions for audit trail

---

**Last Updated**: 2026-03-29  
**Version**: 1.0
