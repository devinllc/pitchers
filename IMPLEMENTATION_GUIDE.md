# Multi-Channel Leads Automation: Implementation Guide

## 🎯 Overview

This is a comprehensive multi-channel automated outreach system that enables users to:
1. **Acquire leads** from B2B (Google Maps) + B2C sources (LinkedIn, Twitter, Instagram, Facebook, TikTok)
2. **Send campaigns** via **WhatsApp** (QR or Meta API), **Email** (SendGrid + SMTP), and **SMS** (Twilio)
3. **Schedule** delivery with staggered rates to avoid spam filters
4. **Personalize** with templates and variables
5. **Monitor** campaign performance and delivery status

---

## ✅ Completed Implementation (Phases 1-4)

### Phase 1: Database Architecture ✅

**6 New Database Tables:**

1. **leads_campaigns** — Campaign metadata
   - campaign_id, user_email, campaign_name, campaign_type (email|sms|whatsapp)
   - lead_source_id, template_id, total_leads, status (draft|running|paused|completed|failed)
   - config (JSONB), metadata (JSONB)

2. **campaign_templates** — Message templates with variables
   - template_id, user_email, template_name, channel (email|sms|whatsapp)
   - template_text, is_preset (boolean), variables (JSONB array)

3. **campaign_executions** — Individual message delivery tracking
   - execution_id, campaign_id, lead_id, user_email, campaign_type
   - lead_email, lead_phone, lead_name, business_name
   - rendered_message, status (pending|sent|delivered|failed|bounced|read)
   - provider_message_id, retry_count, error_message

4. **leads_sources** — Data source definitions
   - source_id, user_email, source_name, source_type
   - search_query, location, total_leads, extracted_leads, status (pending|extracting|completed|failed)

5. **whatsapp_connections** — WhatsApp authentication
   - user_email (unique), qr_enabled, qr_session_token, qr_connected_phone, qr_connected_at
   - meta_api_enabled, meta_phone_number_id, meta_business_account_id, meta_api_token
   - active_mode ('qr'|'meta_api'|'none'), is_active (boolean)

6. **smtp_connections** — SMTP server configurations
   - connection_id, user_email, provider_name, smtp_host, smtp_port
   - sender_email, sender_name, username, password (encrypted)
   - encryption_type ('TLS'|'SSL'|'NONE')
   - is_default, is_active, daily_limit, daily_sent_count

**Bonus Table:**
- **contact_channel_mapping** — Maps lead contact channels (email, phone, WhatsApp, LinkedIn, Twitter, etc.)

**Files:**
- [LeadsCampaign.js](pitchers/models/LeadsCampaign.js)
- [CampaignTemplate.js](pitchers/models/CampaignTemplate.js)
- [CampaignExecution.js](pitchers/models/CampaignExecution.js)
- [LeadSource.js](pitchers/models/LeadSource.js)
- [WhatsAppConnection.js](pitchers/models/WhatsAppConnection.js)
- [SmtpConnection.js](pitchers/models/SmtpConnection.js)

---

### Phase 2: WhatsApp Integration ✅

**Dual-Mode Support:**

1. **QR-Connected Mode** (Direct WhatsApp Web)
   - User scans QR code on their phone
   - WhatsApp Web automation via Baileys library
   - No business account approval required
   - Free sending (no per-message costs)

2. **Meta API Mode** (Business Account)
   - Configure Meta Business Account credentials
   - Official WhatsApp Business API
   - Higher delivery reliability
   - Requires business verification
   - Cost: $0.00133 per template message

**Services:**
- [whatsappService.js](pitchers/services/whatsappService.js) — Main router (delegates to QR or Meta API)
- [whatsappMetaAPI.js](pitchers/services/whatsappMetaAPI.js) — Meta Business API implementation
- [whatsappQRManager.js](pitchers/services/whatsappQRManager.js) — QR session & Baileys integration

**API Endpoints:**
```
POST /api/v1/whatsapp/generate-qr
  → Initiate QR code for phone connection
  ← Returns sessionToken, expiresIn

POST /api/v1/whatsapp/verify-qr
  Body: {sessionToken, phoneNumber}
  → Verify QR scan, store connection

POST /api/v1/whatsapp/set-meta-credentials
  Body: {phoneNumberId, businessAccountId, apiToken}
  → Configure Meta API (test & verify)

POST /api/v1/whatsapp/set-active-mode
  Body: {mode: 'qr' | 'meta_api'}
  → Switch between modes

POST /api/v1/whatsapp/test-send
  Body: {phoneNumber, message}
  → Send test message via active mode

GET /api/v1/whatsapp/status
  ← Get connection status & active mode

POST /api/v1/whatsapp/disconnect
  ← Disconnect WhatsApp integration

POST /api/v1/whatsapp/refresh-qr
  ← Generate new QR code (re-scan)
```

**Features:**
- ✅ QR code generation & session management
- ✅ Meta API credential verification
- ✅ Mode switching (QR ↔ Meta API)
- ✅ Session token encryption
- ✅ Active session cleanup (24-hour expiry)
- ⏳ Baileys integration (needs implementation)

**File:**
- [whatsappRoutes.js](pitchers/routes/whatsappRoutes.js)

---

### Phase 3: Email Integration ✅

**Multi-Provider Support:**

1. **SendGrid** (Cloud Service)
   - Pre-configured via SENDGRID_API_KEY
   - Unlimited sending
   - Delivery tracking & webhooks
   - Best for high-volume campaigns

2. **SMTP** (Gmail, Custom Servers)
   - User configures own SMTP (Gmail, Azure, etc.)
   - Free tier support (Gmail: 300/day)
   - Per-user connection limits
   - Cost: Free (Gmail) or per-provider pricing

3. **Smart Routing**
   - Try SMTP first (if available & quota remaining)
   - Fallback to SendGrid
   - Per-connection daily limits
   - Automatic quota checking

**Services:**
- [smtpService.js](pitchers/services/smtpService.js) — Nodemailer integration
- [emailProviderRouter.js](pitchers/services/emailProviderRouter.js) — Smart provider selection

**API Endpoints:**
```
POST /api/v1/email/smtp/add
  Body: {providerName, smtpHost, smtpPort, senderEmail, senderName, username, password, encryptionType}
  → Add SMTP connection (test verified)

GET /api/v1/email/smtp/list
  ← Get all user SMTP connections

POST /api/v1/email/smtp/set-default
  Body: {connectionId}
  → Set default SMTP provider

POST /api/v1/email/test-send
  Body: {toEmail, subject, provider, connectionId}
  → Send test email

POST /api/v1/email/send
  Body: {toEmail, subject, htmlContent, provider, connectionId}
  → Send single email

POST /api/v1/email/send-bulk
  Body: {recipients: [{email, subject, htmlContent}], delayMs}
  → Send bulk with rate limiting (1 msg/sec default)

GET /api/v1/email/providers
  ← Get available providers & quota info

POST /api/v1/email/quota
  Body: {connectionId}
  ← Get remaining quota for connection

DELETE /api/v1/email/smtp/:connectionId
  ← Delete SMTP connection
```

**Features:**
- ✅ SMTP connection test & verification
- ✅ Password encryption (AES-256)
- ✅ Daily quota tracking (per connection)
- ✅ Multi-provider smart routing
- ✅ Bulk email with rate limiting
- ✅ Transporter caching (performance)

**File:**
- [emailRoutes.js](pitchers/routes/emailRoutes.js)

**Dependencies Added:**
- `nodemailer ^6.9.7`

---

### Phase 4: SMS Automation ✅

**SMS Provider:**
- **Twilio** (existing integration extended)
- Bulk SMS with staggered delivery
- Automatic retry with exponential backoff
- Rate limiting (configurable: msgs/minute or msgs/hour)

**Services:**
- [smsQueueManager.js](pitchers/services/smsQueueManager.js) — Queue & retry management
- Extends existing [twilioService.js](pitchers/services/twilioService.js)

**API Endpoints:**
```
POST /api/v1/sms/send
  Body: {phoneNumber, message}
  → Send single SMS

POST /api/v1/sms/send-bulk
  Body: {campaignId, recipients: [{phoneNumber, message}], staggerRate, staggerUnit}
  → Queue bulk SMS campaign (staggered delivery)
  - staggerRate: 50 (default, msgs per unit)
  - staggerUnit: 'per_minute' | 'per_hour'

GET /api/v1/sms/queue-stats
  Query: {campaignId (optional)}
  ← Get queue statistics (pending, sent, delivered, failed)

POST /api/v1/sms/retry-failed
  ← Manually trigger retry of failed messages

GET /api/v1/sms/campaign/:campaignId/status
  ← Get campaign delivery stats & rates

GET /api/v1/sms/campaign/:campaignId/executions
  Query: {status (optional)}
  ← Get detailed execution records
```

**Features:**
- ✅ Bulk SMS with queue management
- ✅ Staggered delivery (configurable rate)
- ✅ Automatic retry (3 attempts: 30s, 5m, 30m delays)
- ✅ Delivery status tracking
- ✅ Error tracking & retry logic
- ✅ Background retry cycle (every 5 minutes)

**File:**
- [smsRoutes.js](pitchers/routes/smsRoutes.js)

---

## 📝 Not Yet Implemented (Phases 5-10)

### Phase 5: Campaign Management System

**What's Needed:**
- [campaignController.js](pitchers/controllers/campaignController.js) — Campaign CRUD operations
- [campaignRoutes.js](pitchers/routes/campaignRoutes.js) — Campaign endpoints
- Campaign lifecycle: draft → running → paused → completed
- Multi-channel campaign creation (WhatsApp + Email + SMS in one campaign)

**API Endpoints (to create):**
```
POST /api/v1/campaigns
  → Create new campaign

GET /api/v1/campaigns
  → List user's campaigns

GET /api/v1/campaigns/:campaignId
  → Get campaign details

POST /api/v1/campaigns/:campaignId/start
  → Start campaign delivery

POST /api/v1/campaigns/:campaignId/pause
  → Pause running campaign

POST /api/v1/campaigns/:campaignId/resume
  → Resume paused campaign

DELETE /api/v1/campaigns/:campaignId
  → Archive/delete campaign

GET /api/v1/campaigns/:campaignId/stats
  → Get campaign metrics
```

---

### Phase 6: Message Template System

**What's Needed:**
- [templateService.js](pitchers/services/templateService.js) — Template CRUD & rendering
- Extend [openRouterService.js](pitchers/services/openRouterService.js) — AI template generation
- [templateRoutes.js](pitchers/routes/templateRoutes.js)

**Features:**
- Pre-built templates per channel
- Custom template creation
- Template variables: `{{business_name}}`, `{{contact_person}}`, `{{location}}`
- AI-powered template generation (via OpenRouter)
- 3 style options: professional, casual, aggressive sales

**API Endpoints (to create):**
```
GET /api/v1/templates
  Query: {channel: 'whatsapp'|'email'|'sms', preset: boolean}
  → List templates

POST /api/v1/templates
  → Create custom template

PUT /api/v1/templates/:templateId
  → Update template

DELETE /api/v1/templates/:templateId
  → Delete template

POST /api/v1/templates/ai-generate
  Body: {businessType, tone: 'professional'|'casual'|'aggressive'}
  → Generate 3 AI template options
```

---

### Phase 7: B2C Data Collection

**What's Needed:**
- [b2cLeadCollectionService.js](pitchers/services/b2cLeadCollectionService.js) — Orchestrator
- [linkedinExtractor.js](pitchers/services/linkedinExtractor.js)
- [twitterExtractor.js](pitchers/services/twitterExtractor.js)
- [instagramExtractor.js](pitchers/services/instagramExtractor.js)
- [facebookExtractor.js](pitchers/services/facebookExtractor.js)
- [tiktokExtractor.js](pitchers/services/tiktokExtractor.js)

**Features:**
- Extract professional profiles from LinkedIn
- Extract user profiles from Twitter, Instagram, Facebook, TikTok
- Merge duplicate records (same email/phone from multiple sources)
- Contact channel mapping (which platform for each lead)
- Combine with existing Google Maps B2B data

**Extraction Methods:**
- **LinkedIn**: Official API (requires approval) or Puppeteer
- **Twitter**: Twitter API v2
- **Instagram**: Instagram API or unofficial extraction
- **Facebook**: Graph API (business pages)
- **TikTok**: TikTok Creator API (limited access)

---

### Phase 8: Campaign Execution Worker

**What's Needed:**
- [campaignScheduler.js](pitchers/services/campaignScheduler.js) — Calculate delivery windows
- [campaignExecutionWorker.js](pitchers/services/campaignExecutionWorker.js) — Process & send
- [campaignRetryManager.js](pitchers/services/campaignRetryManager.js) — Handle failures

**Features:**
- Schedule delivery (immediate, delayed start, recurring)
- Stagger delivery rate (e.g., 50 msgs/hour)
- Template variable rendering per lead
- Route to appropriate channel (WhatsApp/Email/SMS)
- Track delivery status
- Automatic retry on failure

---

### Phase 9: Analytics & Webhooks

**What's Needed:**
- [webhookRoutes.js](pitchers/routes/webhookRoutes.js) — Webhook handlers
- Analytics dashboard endpoints

**Webhook Handlers:**
```
POST /webhooks/twilio/sms-status
  → SMS delivery status updates

POST /webhooks/twilio/whatsapp-status
  → WhatsApp delivery status updates

POST /webhooks/sendgrid/bounce
  → Email bounce/delivery events

POST /webhooks/meta/whatsapp-status
  → Meta WhatsApp status updates
```

**Analytics Endpoints:**
```
GET /api/v1/analytics/campaigns
  → Campaign metrics (sent, delivered, failed, bounce rate)

GET /api/v1/analytics/campaigns/:campaignId/timeline
  → Delivery timeline graph

GET /api/v1/analytics/campaigns/:campaignId/channels
  → Per-channel performance

GET /api/v1/analytics/export/:campaignId
  Query: {format: 'csv'|'pdf'}
  → Export campaign report
```

---

### Phase 10: Configuration & Security

**What's Needed:**
- Global configuration toggles
- User settings for preferred providers
- Audit logging
- Compliance checks

**Features:**
- Enable/disable channels globally
- Set default providers (SendGrid vs SMTP, QR vs Meta API)
- Usage limits & quotas per user
- Audit log (who did what, when)
- Unsubscribe links for email/SMS
- CAN-SPAM & GDPR compliance

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Server
```bash
npm run dev  # Development with nodemon
npm start    # Production
```

### 3. Test WhatsApp Integration
```bash
# Generate QR code
curl -X POST http://localhost:3000/api/v1/whatsapp/generate-qr \
  -H "x-user-email: user@example.com" \
  -H "Content-Type: application/json"

# Verify QR scan (after user scans)
curl -X POST http://localhost:3000/api/v1/whatsapp/verify-qr \
  -H "x-user-email: user@example.com" \
  -H "Content-Type: application/json" \
  -d '{"sessionToken": "...", "phoneNumber": "+1234567890"}'
```

### 4. Test Email Integration
```bash
# Add SMTP connection
curl -X POST http://localhost:3000/api/v1/email/smtp/add \
  -H "x-user-email: user@example.com" \
  -H "Content-Type: application/json" \
  -d '{
    "providerName": "Gmail",
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "senderEmail": "sender@gmail.com",
    "senderName": "My App",
    "username": "sender@gmail.com",
    "password": "app-specific-password",
    "encryptionType": "TLS"
  }'

# Send test email
curl -X POST http://localhost:3000/api/v1/email/test-send \
  -H "x-user-email: user@example.com" \
  -H "Content-Type: application/json" \
  -d '{
    "toEmail": "recipient@example.com",
    "subject": "Test Email"
  }'
```

### 5. Test SMS Integration
```bash
# Send bulk SMS
curl -X POST http://localhost:3000/api/v1/sms/send-bulk \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "campaign_123",
    "recipients": [
      {"phoneNumber": "+1234567890", "message": "Hello!"},
      {"phoneNumber": "+0987654321", "message": "Hi there!"}
    ],
    "staggerRate": 50,
    "staggerUnit": "per_minute"
  }'

# Get queue stats
curl http://localhost:3000/api/v1/sms/queue-stats?campaignId=campaign_123
```

---

## 🔐 Security Considerations

### Encryption
- **API Keys & Tokens**: Encrypted with AES-256
- **SMTP Passwords**: Encrypted before storing in database
- **Session Tokens**: Encrypted and stored per-user

### Rate Limiting
- SMS: Configurable (10-1000 msgs/min)
- Email: Per-SMTP daily limit (default: 300)
- WhatsApp: Meta API rate limit (1000 msgs/sec per phone)

### Data Privacy
- User email stored for campaign ownership
- Lead phone/email encrypted in transit
- Audit logging for compliance
- No plain-text secrets in logs

---

## 📊 Architecture Diagram

```
Frontend (Next.js) ← → Backend (Node.js)
                        ↓
                  Route Handlers
                        ↓
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   Campaign        Multi-Channel    Data Collection
   Management      Services
        ↓               ↓               ↓
   Models      ┌─WhatsApp────────────┐  Extractors
   Services    │ ├─QR Manager        │  ├─LinkedIn
   Routes      │ ├─Meta API          │  ├─Twitter
               │ └─Message Sender    │  ├─Instagram
               ├─Email              │  ├─Facebook
               │ ├─SMTP Service     │  ├─TikTok
               │ └─Provider Router   │  └─Google Maps
               └─SMS                │
                 ├─Queue Manager    │
                 └─Retry Manager    │
                        ↓
                  Database (PostgreSQL)
```

---

## 📞 Support & Next Steps

### Immediate TODO
- [ ] Run `npm install` to install nodemailer
- [ ] Test database table creation on startup
- [ ] Test WhatsApp QR generation
- [ ] Test SMTP email sending
- [ ] Test Twilio bulk SMS

### Next Phase (Phase 5+)
1. Create campaign management system
2. Build message template system
3. Implement B2C data extractors
4. Build campaign execution worker
5. Add analytics & webhooks
6. Implement compliance & security

### Integration Notes
- **Baileys Library**: Required for QR mode WhatsApp sending
  ```bash
  npm install @whiskeysockets/baileys
  ```
- **Phone Number Formatting**: Use `libphonenumber-js` for validation
  ```bash
  npm install libphonenumber-js
  ```
- **OpenRouter**: Already integrated, use for AI template generation

---

## 📁 File Structure

```
pitchers/
├── models/
│   ├── LeadsCampaign.js ✅
│   ├── CampaignTemplate.js ✅
│   ├── CampaignExecution.js ✅
│   ├── LeadSource.js ✅
│   ├── WhatsAppConnection.js ✅
│   ├── SmtpConnection.js ✅
│   └── [existing models]
├── services/
│   ├── encryptionService.js ✅
│   ├── whatsappService.js ✅
│   ├── whatsappMetaAPI.js ✅
│   ├── whatsappQRManager.js ✅
│   ├── smtpService.js ✅
│   ├── emailProviderRouter.js ✅
│   ├── smsQueueManager.js ✅
│   └── [existing services]
├── routes/
│   ├── whatsappRoutes.js ✅
│   ├── emailRoutes.js ✅
│   ├── smsRoutes.js ✅
│   └── [existing routes]
├── migrations/
│   └── campaigns-migration.js ✅
├── server.js ✅ [updated]
└── [existing structure]

pitchers-1/ (Next.js Frontend)
├── src/pages/
│   └── integrations/ [to create]
│   └── campaigns/ [to create]
│   └── templates/ [to create]
└── [existing structure]
```

---

**Created: April 28, 2026**
**Status**: Phases 1-4 Complete | Phases 5-10 Ready for Implementation
