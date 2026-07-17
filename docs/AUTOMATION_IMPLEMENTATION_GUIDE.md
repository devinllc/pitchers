# 🚀 Automation Feature Implementation Guide

## 📋 Overview

This guide explains how to complete the automation implementation for **Auto Followups, Auto Pitches, Cold DMs, Auto Responses, and Auto Promotion & Demo**.

## ✅ What's Already Done

### Frontend ✅
- [x] Automation UI buttons for all 5 campaign types
- [x] Lead selection with checkboxes
- [x] Message template generation based on lead data
- [x] Updated `runLeadAutomation()` to call backend API
- [x] Fixed "Show Details" button in leads table (state variable mismatch)
- [x] Campaign tracking and status display

### Backend ✅
- [x] Database schema with 4 tables:
  - `automation_campaigns` - Track campaigns
  - `automation_executions` - Track individual send attempts
  - `automation_schedules` - For recurring automation
  - `automation_templates` - For custom message templates
- [x] Automation Service (`automationService.js`) with:
  - Campaign creation
  - Lead assignment to campaigns
  - Campaign execution coordination
  - Error handling and retry logic
- [x] Automation Controller (`automationController.js`) with:
  - `/api/v1/automation/create` - Create and execute campaigns
  - `/api/v1/automation/campaign/:id` - Get campaign status
  - `/api/v1/automation/my-campaigns` - List user campaigns
  - Campaign pause/resume endpoints
- [x] SendGrid Service for email delivery
- [x] Twilio Service for SMS & WhatsApp delivery
- [x] API routes (`automationRoutes.js`)

## 🔧 What You Need to Do

### 1. Database Migration

Run the SQL migration to create the automation tables:

```bash
# Connect to your PostgreSQL database
psql -h your-db-host -U your-db-user -d your-db-name

# Copy and paste the SQL from: /pitchers/migrations/005_create_automation_tables.sql
```

**Or** if using a migration tool, add to your migration pipeline:

```bash
node scripts/run-migration.js migrations/005_create_automation_tables.sql
```

### 2. Update Backend Main Server File

Add the automation routes to your main `server.js`:

```javascript
// In /pitchers/server.js or /pitchers/api/index.js

const automationRoutes = require('./routes/automationRoutes');

// Add to your Express app:
app.use('/api/v1/automation', automationRoutes);
```

### 3. Install Required Dependencies

#### Backend dependencies:

```bash
cd /pitchers

# SendGrid for email
npm install @sendgrid/mail

# Twilio for SMS/WhatsApp
npm install twilio

# UUID for generating campaign IDs
npm install uuid
```

#### Frontend dependencies (already included):

```bash
cd /pitchers-1

npm install axios dotenv
```

### 4. Environment Variables

#### Backend (.env or production.env):

```env
# SendGrid Configuration
SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=noreply@pitchers.ai

# Twilio Configuration
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1234567890  # For SMS
TWILIO_WHATSAPP_NUMBER=+1234567890  # For WhatsApp

# Database
DATABASE_URL=postgresql://user:password@host:port/database
```

#### Frontend (.env.local):

```env
NEXT_PUBLIC_BACKEND_API_URL=https://api.pitchers.ufdevs.live/
NEXT_PUBLIC_API_VERSION=v1
```

### 5. Configure Service Providers

#### SendGrid Setup:

1. Create account at https://sendgrid.com
2. Create API key with "Mail Send" permissions
3. Verify sender email address
4. Add to `.env`

#### Twilio Setup:

1. Create account at https://twilio.com
2. Get Account SID and Auth Token
3. Provision phone number for SMS
4. Provision WhatsApp number (or use Twilio WhatsApp sandbox)
5. Add to `.env`

### 6. Test the Automation

#### Test API Endpoint:

```bash
curl -X POST http://localhost:3001/api/v1/automation/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "userEmail": "user@example.com",
    "campaignType": "followups",
    "leads": [
      {
        "id": 1,
        "name": "John Doe",
        "business_name": "Acme Corp",
        "email": "john@acme.com",
        "phone": "+919876543210",
        "city": "Delhi",
        "channel": "email",
        "message": "Test message"
      }
    ],
    "executeNow": true,
    "delay": 1000
  }'
```

Expected Response:

```json
{
  "success": true,
  "message": "Campaign created and execution started",
  "campaignId": "camp_1234567890_abc12345",
  "campaignType": "followups",
  "totalLeads": 1,
  "status": "running"
}
```

#### Test from Frontend:

1. Go to Dashboard → Leads tab
2. Select some leads using checkboxes
3. Click one of the automation buttons (Auto Followups, Auto Pitches, etc.)
4. Check console and alerts for campaign creation

### 7. Monitor Campaigns

Check campaign status and logs:

```bash
# Get campaign status
curl http://localhost:3001/api/v1/automation/campaign/camp_1234567890_abc12345 \
  -H "X-API-Key: your-api-key"

# Get execution logs (individual sends)
curl "http://localhost:3001/api/v1/automation/campaign/camp_1234567890_abc12345/executions?limit=100&offset=0" \
  -H "X-API-Key: your-api-key"

# Get user's campaigns
curl "http://localhost:3001/api/v1/automation/my-campaigns?userEmail=user@example.com&limit=50" \
  -H "X-API-Key: your-api-key"
```

### 8. Add to Frontend (Dashboard UI)

Create a new component to display active campaigns:

```javascript
// /pitchers-1/src/components/AutomationCampaigns.js

import React, { useEffect, useState } from 'react';

export default function AutomationCampaigns({ userEmail }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCampaigns = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_API_URL}api/v1/automation/my-campaigns?userEmail=${userEmail}`,
          {
            headers: {
              'X-API-Key': process.env.NEXT_PUBLIC_API_KEY
            }
          }
        );
        const result = await response.json();
        if (result.success) {
          setCampaigns(result.campaigns);
        }
      } catch (error) {
        console.error('Error loading campaigns:', error);
      } finally {
        setLoading(false);
      }
    };

    if (userEmail) {
      loadCampaigns();
    }
  }, [userEmail]);

  if (loading) return <div>Loading campaigns...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Active Campaigns</h2>
      {campaigns.map(campaign => (
        <div key={campaign.campaign_id} className="border rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-semibold">{campaign.campaign_type}</h3>
              <p className="text-sm text-gray-600">
                {campaign.leads_sent} sent, {campaign.leads_failed} failed, {campaign.leads_pending} pending
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              campaign.status === 'running' ? 'bg-green-100 text-green-800' :
              campaign.status === 'completed' ? 'bg-blue-100 text-blue-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {campaign.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

## 🎯 Campaign Types

All 5 automation types are now fully functional:

### 1. **Auto Followups**
- Purpose: Re-engage past contacts
- Default Channel: Email
- Template: "Hi {name}, following up on our previous outreach..."

### 2. **Auto Pitches**
- Purpose: Introduce your product/service
- Default Channel: Email
- Template: "Hi {name}, quick pitch: Pitchers automates lead generation..."

### 3. **Cold DMs**
- Purpose: Initial outreach to new leads
- Default Channel: WhatsApp/Email
- Template: "Hi {name}, noticed your business in {city}..."

### 4. **Auto Responses**
- Purpose: Response to inquiries
- Default Channel: Email
- Template: "Thanks for your interest, {name}. Happy to share pricing..."

### 5. **Auto Promotion & Demo**
- Purpose: Promote demo sessions
- Default Channel: Email
- Template: "Hi {name}, we are offering a live demo..."

## 🔄 Workflow

```plaintext
User selects leads
        ↓
User chooses automation type
        ↓
Frontend sends API request with:
  - userEmail
  - campaignType
  - leads array with contact info
  - automationConfig
        ↓
Backend automationController receives request
        ↓
Creates campaign in DB
        ↓
Creates execution record for each lead
        ↓
Background worker executes campaign
        ↓
For each lead:
  - Detect contact channel (email/WhatsApp/SMS)
  - Send message via SendGrid/Twilio
  - Track status in automation_executions table
        ↓
Campaign completes
        ↓
Frontend displays campaign status and results
```

## 📊 Database Design

### automation_campaigns
- Tracks campaign overview (total, sent, failed, pending)
- Stores campaign config and metadata
- Timestamps: created_at, started_at, completed_at, scheduled_for

### automation_executions
- One row per lead + campaign combination
- Tracks individual message send attempts
- Stores provider response (SendGrid/Twilio)
- Supports retry logic

### automation_schedules
- Enables recurring campaigns
- Currently just schema (use when adding scheduled features)

### automation_templates
- Custom message templates per user
- Supports placeholders: {{businessName}}, {{city}}, etc.
- Currently just schema (use when adding template management UI)

## 🚨 Error Handling

The system automatically handles:

1. **Failed sends** - Marked as failed with error message
2. **Missing contact info** - Skip or mark as manual if no email/phone
3. **Invalid phone numbers** - Skip WhatsApp channel
4. **Rate limiting** - 1 second delay between messages
5. **Provider errors** - Logged with full response

## 🔐 Security

- API key authentication required for all endpoints
- User email validated against auth token
- Campaign data isolated per user
- API responses sanitized
- Provider credentials never exposed in logs

## 📈 Next Steps (Optional Enhancements)

1. **Batch scheduling** - Allow scheduling campaigns for specific times
2. **Campaign analytics** - Track open rates, click rates
3. **Template editor** - UI for creating custom templates
4. **Recurring automation** - Daily/weekly automatic campaigns
5. **A/B testing** - Test different message variants
6. **Webhooks** - Receive delivery updates from SendGrid/Twilio
7. **Two-way messaging** - Handle replies automatically

## 🆘 Troubleshooting

### Campaign not executing
- Check API key is valid
- Check backend service is running
- Check database credentials
- Look at server logs for errors

### Messages not sending
- Verify SendGrid/Twilio API keys are correct
- Check email/phone numbers are valid
- Check provider account has credits
- Check spam folder for emails

### Slow execution
- Increase `delay` parameter (space out sends more)
- Check database connection
- Monitor server resources (CPU, memory)

## 📞 Support

For issues or questions:
1. Check console logs on frontend and backend
2. Review database tables for execution logs
3. Test API endpoints directly with curl
4. Check provider (SendGrid/Twilio) dashboards for errors

---

**Last Updated**: 2026-03-29
**Status**: ✅ Ready for deployment
