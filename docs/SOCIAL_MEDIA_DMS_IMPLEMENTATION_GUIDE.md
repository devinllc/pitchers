# 📱 Social Media DM & Communication Dashboard Implementation Guide

## Overview

This guide covers the complete implementation of the **Automated Communication Dashboard** that allows you to:
- ✅ Send cold DMs across all major social media platforms
- ✅ Monitor all automated communications in one place
- ✅ Track delivery, open rates, and engagement across channels
- ✅ Manage followups, pitches, and responses automatically

---

## 🎯 What's New

### Frontend Components
- **Automation Communications Dashboard** (`/automation-communications`)
  - Real-time metrics for all campaigns
  - Platform performance breakdown (Facebook, Instagram, LinkedIn, Twitter)
  - KPI cards showing success rates and engagement
  - Communication history with filters and sorting
  - Auto-refresh capabilities

### Backend Services
- **SocialMediaDMService** - Multi-platform DM sending
- **SocialMedia Controller** - API endpoints for platform management
- **Database Enhancements** - Social media communication tracking

### Supported Platforms
1. **Facebook** - Messenger DMs
2. **Instagram** - Direct Messages
3. **LinkedIn** - Professional messages
4. **Twitter/X** - Direct Messages

### Supported Channels (All)
- Email (SendGrid)
- SMS/WhatsApp (Twilio)
- Facebook Messenger
- Instagram DMs
- LinkedIn Messages
- Twitter DMs

---

## ⚙️ Configuration

### 1. Environment Variables

Add these to your `.env` file:

```bash
# Social Media API Credentials
FACEBOOK_PAGE_ACCESS_TOKEN=your_facebook_page_token_here
INSTAGRAM_BUSINESS_ACCOUNT_TOKEN=your_instagram_business_token_here
LINKEDIN_API_TOKEN=your_linkedin_api_token_here
TWITTER_API_TOKEN=your_twitter_bearer_token_here

# Existing integrations
SENDGRID_API_KEY=your_sendgrid_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
```

### 2. Getting Platform Tokens

#### Facebook Messenger Token
1. Go to [Facebook Developers](https://developers.facebook.com)
2. Create/select your app
3. Navigate to "Messenger" → "Settings"
4. Generate a Page Access Token
5. Copy to `FACEBOOK_PAGE_ACCESS_TOKEN`

#### Instagram Business Token
1. Link your Instagram business account to Facebook
2. Go to Instagram Graph API settings
3. Generate Instagram Business Account Token
4. Copy to `INSTAGRAM_BUSINESS_ACCOUNT_TOKEN`

#### LinkedIn API Token
1. Go to [LinkedIn Developers](https://www.linkedin.com/developers)
2. Create an app with "Marketing Developer Platform" access
3. Generate access token with "openid", "profile", "email", "w_member_social" scopes
4. Copy to `LINKEDIN_API_TOKEN`

#### Twitter/X Credentials
1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal)
2. Create an app with Elevated access
3. Generate Bearer Token
4. Copy to `TWITTER_API_TOKEN`

### 3. Database Migration

Run the migration to add social media tables:

```bash
# In pitchers directory
psql -U your_user -d your_db -f migrations/006_add_social_media_communications.sql
```

OR use your migration tool:

```bash
npm run migrate
```

The migration creates:
- `social_media_communications` table - Tracks all DMs sent
- `communication_metrics` view - Aggregated stats
- `platform_communication_summary` view - Platform breakdown
- Necessary indexes for performance

### 4. Register Routes

In your main `server.js` or route dispatcher:

```javascript
// Add to your route registration
const socialMediaRoutes = require('./routes/socialMediaRoutes');

// Mount routes
app.use('/api/v1/social-media', socialMediaRoutes);

// Make sure auth middleware is applied
app.use(socialMediaRoutes); // Already has auth middleware built-in
```

---

## 🚀 API Endpoints

### Send Cold DMs

**Endpoint:** `POST /api/v1/social-media/send-dm`

**Request:**
```json
{
  "userEmail": "user@example.com",
  "platforms": ["facebook", "instagram", "linkedin"],
  "leads": [
    {
      "id": 123,
      "name": "John Doe",
      "business_name": "Acme Corp",
      "facebook_handle": "john.doe",
      "instagram_handle": "johndoe",
      "instagram_id": "1234567890",
      "linkedin_id": "ACoAA123456789",
      "linkedin_url": "https://linkedin.com/in/johndoe"
    }
  ],
  "message": "Hey John! 👋 I found your profile and think you'd be a great fit for our new product launch. Check this out: [link]",
  "mediaUrl": "https://example.com/product-image.jpg"
}
```

**Response:**
```json
{
  "success": true,
  "campaign": {
    "campaignId": "camp_social_1234567890_abc12345",
    "timestamp": "2026-03-29T10:00:00Z",
    "platforms": {
      "facebook": {
        "platform": "facebook",
        "totalSent": 45,
        "successCount": 44,
        "failureCount": 1,
        "successRate": "97.78%"
      },
      "instagram": {
        "platform": "instagram",
        "totalSent": 45,
        "successCount": 45,
        "failureCount": 0,
        "successRate": "100.00%"
      },
      "linkedin": {
        "platform": "linkedin",
        "totalSent": 30,
        "successCount": 28,
        "failureCount": 2,
        "successRate": "93.33%"
      }
    },
    "summaryStats": {
      "totalMessages": 120,
      "successCount": 117,
      "failureCount": 3,
      "platformStats": {
        "facebook": { "sent": 44, "failed": 1, "successRate": "97.78%" },
        "instagram": { "sent": 45, "failed": 0, "successRate": "100.00%" },
        "linkedin": { "sent": 28, "failed": 2, "successRate": "93.33%" }
      }
    }
  }
}
```

### Get All Communications

**Endpoint:** `GET /api/v1/social-media/communications`

**Query Parameters:**
- `campaignType` - 'followups', 'pitches', 'coldDms_social', 'responses'
- `status` - 'sent', 'delivered', 'opened', 'replied', 'failed'
- `limit` - default 100
- `offset` - default 0

**Response:**
```json
{
  "success": true,
  "communications": [
    {
      "campaign_id": "camp_social_123...",
      "campaign_type": "coldDms_social",
      "total_messages": 120,
      "sent": 115,
      "delivered": 110,
      "opened": 45,
      "replied": 12,
      "failed": 5,
      "last_activity": "2026-03-29T10:15:30Z",
      "platforms": ["facebook", "instagram", "linkedin"]
    }
  ]
}
```

### Get Platform Stats

**Endpoint:** `GET /api/v1/social-media/communications/by-platform`

**Response:**
```json
{
  "success": true,
  "platforms": [
    {
      "platform": "facebook",
      "total_messages": 450,
      "successful": 438,
      "failed": 12,
      "replied": 45,
      "success_rate": "97.33",
      "last_activity": "2026-03-29T10:15:30Z"
    },
    {
      "platform": "instagram",
      "total_messages": 500,
      "successful": 500,
      "failed": 0,
      "replied": 78,
      "success_rate": "100.00",
      "last_activity": "2026-03-29T10:14:20Z"
    }
  ]
}
```

### Get Available Platforms

**Endpoint:** `GET /api/v1/social-media/platforms`

**Response:**
```json
{
  "success": true,
  "availablePlatforms": ["facebook", "instagram", "linkedin", "twitter"],
  "allChannels": {
    "email": true,
    "sms": true,
    "whatsapp": true,
    "facebook": true,
    "instagram": true,
    "linkedin": true,
    "twitter": true
  }
}
```

### Get Dashboard Metrics

**Endpoint:** `GET /api/v1/social-media/dashboard-metrics`

**Response:**
```json
{
  "success": true,
  "metrics": {
    "overview": {
      "total_campaigns": 15,
      "total_leads_targeted": 2500,
      "total_messages_sent": 2415,
      "total_messages_failed": 85,
      "completed_campaigns": 12,
      "active_campaigns": 3
    },
    "channels": [
      {
        "campaign_type": "coldDms_social",
        "messages": 1500,
        "sent": 1450,
        "opened": 380,
        "failed": 50
      }
    ],
    "platforms": [
      {
        "platform": "instagram",
        "messages": 500,
        "sent": 500,
        "replied": 78,
        "failed": 0
      }
    ],
    "recentActivity": [...]
  }
}
```

### Test Platform Connection

**Endpoint:** `POST /api/v1/social-media/test-platform`

**Request:**
```json
{
  "platform": "facebook",
  "testRecipientId": "1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "provider": "facebook",
    "messageId": "mid.1234567890",
    "status": "sent",
    "timestamp": "2026-03-29T10:00:00Z"
  }
}
```

---

## 💡 Usage Examples

### Example 1: Send Cold DMs to Multiple Leads

```javascript
// In your frontend
const sendColdDMs = async () => {
  const response = await fetch('/api/v1/social-media/send-dm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userEmail: 'user@example.com',
      platforms: ['facebook', 'instagram', 'linkedin'],
      leads: [
        {
          id: 1,
          name: 'Alice Johnson',
          facebook_handle: 'alice.j',
          instagram_handle: 'alicejohnson',
          linkedin_id: 'ACoAAA123456'
        },
        {
          id: 2,
          name: 'Bob Smith',
          facebook_handle: 'bob.smith',
          instagram_handle: 'bobsmith85',
          linkedin_id: 'ACoAAA789012'
        }
      ],
      message: '🎉 Hi! We just launched an amazing new feature that could help your business. Would love to show you a quick 5-min demo! 👉',
      mediaUrl: null
    })
  });

  const data = await response.json();
  console.log('Campaign created:', data.campaign.campaignId);
  console.log('Facebook: ', data.campaign.platforms.facebook.successRate);
  console.log('Instagram:', data.campaign.platforms.instagram.successRate);
  console.log('LinkedIn: ', data.campaign.platforms.linkedin.successRate);
};
```

### Example 2: Monitor Communications Dashboard

```javascript
// Page component - automatically loads and refreshes metrics
// Visit: http://localhost:3000/automation-communications

// Features:
// - See all campaigns with real-time metrics
// - Filter by campaign type, status, or platform
// - View platform-specific performance
// - Enable auto-refresh (every 30 seconds)
// - Export reports
```

### Example 3: Check Platform Availability

```javascript
const checkPlatforms = async () => {
  const response = await fetch('/api/v1/social-media/platforms');
  const data = await response.json();
  
  console.log('Available platforms:', data.availablePlatforms);
  // Output: ["facebook", "instagram", "linkedin", "twitter"]
  
  // Check which channels are ready
  Object.entries(data.allChannels).forEach(([channel, available]) => {
    console.log(`${channel}: ${available ? '✅' : '❌'}`);
  });
};
```

### Example 4: Extract Platform Handles from Leads

```javascript
// When importing leads from Google Maps or other sources
// Make sure to include social media links/handles

const enrichLeadWithSocialHandles = (lead) => {
  return {
    ...lead,
    // From Google Maps business profile
    facebook_handle: lead.socialProfiles?.facebook || null,
    instagram_handle: lead.socialProfiles?.instagram || null,
    linkedin_id: lead.socialProfiles?.linkedin || null,
    twitter_handle: lead.socialProfiles?.twitter || null,
  };
};
```

---

## 📊 Dashboard Features

### Real-Time Metrics
- **Total Campaigns**: Count of all automation campaigns
- **Messages Sent**: Total successfully delivered messages
- **Failed Messages**: Messages that failed to send
- **Active Campaigns**: Currently running campaigns
- **Success Rate**: Percentage of successful sends

### Platform Breakdown
- Individual platform performance cards
- Success rates per platform
- Reply counts
- Real-time status indicators

### Filtering Options
- Filter by campaign type (followups, pitches, cold DMs, etc.)
- Filter by status (sent, delivered, opened, replied, failed)
- Clear all filters quickly

### Auto-Refresh
- Toggle auto-refresh on/off
- Adjustable refresh intervals
- Manual refresh button
- Real-time data updates

### Communication History
- Sortable table of all communications
- Campaign ID, type, and statistics
- Last activity timestamps
- Platform indicators

---

## 🔧 Troubleshooting

### Issue: "No configured platforms available"

**Solution:**
1. Check environment variables are set correctly
2. Verify API tokens are valid and not expired
3. Test with `/api/v1/social-media/test-platform` endpoint
4. Check CloudWatch/server logs for authentication errors

### Issue: Some leads don't get DMs sent

**Solution:**
1. Verify leads have social media handles in the right fields:
   - `facebook_handle`, `instagram_handle`, `linkedin_id`, `twitter_handle`
2. Check if handles are valid for the platform
3. Review error messages in response for specific issues
4. Check platform rate limits (may need to increase delays)

### Issue: High failure rate on LinkedIn

**Solution:**
1. LinkedIn's API is stricter - verify URN format: `urn:li:person:{ID}`
2. Ensure user has permission to send messages to recipients
3. Check LinkedIn API quota limits
4. Consider using `linkedin_url` and extracting ID instead

### Issue: Instagram DMs not sending

**Solution:**
1. Verify Instagram Business Account is linked to Facebook
2. Check if recipient follows the sender's account
3. Instagram may require messaging to 24-hour window
4. Ensure `INSTAGRAM_BUSINESS_ACCOUNT_TOKEN` has correct scopes

---

## 📈 Best Practices

### Message Timing
- Send Facebook/Instagram DMs during 6-9 PM (when users check)
- Send LinkedIn messages during 9-11 AM (business hours)
- Send Twitter DMs anytime (platform habit varies)

### Message Content
- Keep messages under 160 characters for optimal display
- Use emojis for better engagement (but not overcapitalization)
- Include clear call-to-action
- Personalize with recipient name when possible

### Rate Limiting
- Default: 1 second delay between sends
- Recommended: 2-3 seconds for large campaigns (1000+ leads)
- Monitor platform limits to avoid being flagged as spam

### Lead Quality
- Verify social media handles before sending
- Remove invalid/inactive handles
- Test with small batch before large campaigns
- Monitor reply rates and adjust messaging

---

## 🔐 Security Considerations

### API Token Management
- Store tokens in `.env` file (never commit)
- Rotate tokens monthly
- Use separate apps for dev/production environments
- Audit API usage regularly

### Database Security
- Social media communications are logged to database
- Implement data retention policies (delete after 90 days)
- Encrypt sensitive fields if required
- Use database encryption at rest

### Rate Limiting
- Social media platforms throttle requests
- Service includes built-in delays but platform limits apply
- Monitor for rate limit errors
- Implement exponential backoff for retries

---

## 📝 Next Steps

1. ✅ Configure all environment variables
2. ✅ Run database migration (006_add_social_media_communications.sql)
3. ✅ Register routes in server.js
4. ✅ Test each platform with test endpoint
5. ✅ Start with small test campaign (10-20 leads)
6. ✅ Monitor dashboard for metrics
7. ✅ Gradually scale to larger campaigns
8. ✅ Optimize messaging based on engagement metrics

---

**Version:** 1.0  
**Last Updated:** March 29, 2026  
**Status:** Production Ready
