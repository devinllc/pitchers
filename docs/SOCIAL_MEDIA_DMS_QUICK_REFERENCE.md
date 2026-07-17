# 🚀 Social Media DMs Quick Start Guide

## 30-Second Overview

You now have:
1. ✅ **Unified Dashboard** to see all messages, followups, and DMs
2. ✅ **Social Media DM Support** for Facebook, Instagram, LinkedIn, Twitter
3. ✅ **Real-time Tracking** of delivery, opens, and replies
4. ✅ **Multi-platform Campaigns** to blast leads across all channels at once

---

## 📱 Supported Channels

```
Channel         Status    Best For
────────────────────────────────────────────────
Email           ✅ Ready  B2B, Professional
SMS/WhatsApp    ✅ Ready  B2B, Urgent messages
Facebook        🔲 Setup  B2C, Local businesses
Instagram       🔲 Setup  B2C, E-commerce, Lifestyle
LinkedIn        🔲 Setup  B2B, Professional services
Twitter/X       🔲 Setup  B2C, Tech audiences

Legend: ✅ = Ready to use  🔲 = Needs API setup
```

---

## ⚙️ 5-Minute Setup

### Step 1: Add Environment Variables
```bash
# In .env file
FACEBOOK_PAGE_ACCESS_TOKEN=your_token
INSTAGRAM_BUSINESS_ACCOUNT_TOKEN=your_token
LINKEDIN_API_TOKEN=your_token
TWITTER_API_TOKEN=your_token
```

### Step 2: Run Database Migration
```bash
psql -U user -d database -f migrations/006_add_social_media_communications.sql
```

### Step 3: Register Routes
In `server.js`:
```javascript
const socialMediaRoutes = require('./routes/socialMediaRoutes');
app.use('/api/v1/social-media', socialMediaRoutes);
```

### Step 4: Verify with Test
```bash
curl -X POST http://localhost:3000/api/v1/social-media/test-platform \
  -H "Content-Type: application/json" \
  -d '{"platform":"facebook","testRecipientId":"123456"}'
```

**Expected Response:**
```json
{"success":true,"result":{"provider":"facebook","status":"sent"}}
```

### Step 5: Open Dashboard
Visit: `http://localhost:3000/automation-communications`

---

## 💬 Sending Cold DMs

### Via API

```bash
curl -X POST http://localhost:3000/api/v1/social-media/send-dm \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail":"user@example.com",
    "platforms":["facebook","instagram","linkedin"],
    "leads":[
      {
        "id":1,
        "name":"John Doe",
        "facebook_handle":"john.doe",
        "instagram_handle":"johndoe",
        "linkedin_id":"ACoAA123456"
      }
    ],
    "message":"Hey John! Check out our new service 👉"
  }'
```

### Response Example

```json
{
  "success": true,
  "campaign": {
    "campaignId": "camp_social_1711753200000_a1b2c3d4",
    "summaryStats": {
      "totalMessages": 3,
      "successCount": 3,
      "failureCount": 0,
      "platformStats": {
        "facebook": {"sent":1,"failed":0,"successRate":"100%"},
        "instagram": {"sent":1,"failed":0,"successRate":"100%"},
        "linkedin": {"sent":1,"failed":0,"successRate":"100%"}
      }
    }
  }
}
```

---

## 📊 Dashboard Walkthrough

### 1. **KPI Cards** (Top Row)
- Total Campaigns: How many automation campaigns you've run
- Messages Sent: Total successful sends across all channels
- Failed Messages: Messages that didn't deliver
- Active Campaigns: Currently running campaigns
- Success Rate: Percentage of messages successfully delivered

### 2. **Platform Performance** (Second Section)
Shows for each platform:
- Total messages sent
- Successful sends ✅
- Failed sends ❌
- Success rate %
- Number of replies 💬

### 3. **Filters**
- Filter by campaign type (followups, pitches, cold DMs, responses)
- Filter by status (sent, delivered, opened, replied, failed)
- Clear filters to reset

### 4. **Communication History** (Table)
Every campaign you've sent listed with:
- Campaign ID (for tracking)
- Campaign type
- Total messages sent
- Delivery metrics
- Last activity timestamp

### 5. **Quick Actions** (Bottom)
- Send New Campaign
- Export Report
- View Analytics

---

## 📋 Lead Format Required

When sending DMs, ensure leads have these fields:

```javascript
{
  "id": 123,                                    // Unique ID
  "name": "John Doe",                          // Person's name
  "business_name": "Acme Corp",                // Company name (optional)
  
  // Social Media Handles (at least 1 required)
  "facebook_handle": "john.doe",               // Facebook username
  "instagram_handle": "johndoe",               // Instagram username
  "instagram_id": "1234567890",                // Instagram user ID (alternative)
  "linkedin_id": "ACoAA123456789",             // LinkedIn URN
  "linkedin_url": "https://linkedin.com/in/", // LinkedIn profile URL
  "twitter_handle": "@johndoe",                // Twitter username
  "twitter_id": "1234567890"                   // Twitter user ID (alternative)
}
```

---

## 🎯 Campaign Examples

### Example 1: Product Launch Campaign
```javascript
{
  "platforms": ["facebook", "instagram"],
  "message": "🎉 We just launched something amazing! Limited early access for the next 100 people. Get instant 40% off → [link]",
  "mediaUrl": "https://example.com/product-image.jpg"
}
```

### Example 2: B2B Cold Pitch
```javascript
{
  "platforms": ["linkedin"],
  "message": "Hi [Name], I noticed you're in [Industry]. We've helped 50+ similar companies increase revenue by 30%. Would love to chat for 15 mins?"
}
```

### Example 3: Service Provider Recruitment
```javascript
{
  "platforms": ["facebook", "instagram", "whatsapp"],
  "message": "Earn ₹50K-₹2L/month working on your own terms. Join 10K+ providers already making serious income. Interested? 👇"
}
```

### Example 4: Multi-Platform Blast
```javascript
{
  "platforms": ["facebook", "instagram", "linkedin", "twitter"],
  "message": "Your limited-time offer expires in 24 hours! Don't miss out on [benefit]. Act now 👉",
  "mediaUrl": "https://example.com/offer-banner.jpg"
}
```

---

## 📈 Tracking & Metrics

### What Gets Tracked
- ✅ Message delivery (sent to platform API)
- ✅ Delivery confirmation (platform acknowledged)
- ✅ Opens/reads (if platform supports)
- ✅ Replies (if user responds)
- ✅ Failures (bounces, invalid handles, etc.)
- ✅ Engagement metrics per platform

### Viewing Metrics
1. Dashboard shows real-time stats
2. Filter by platform to see breakdown
3. View individual campaign details
4. Export reports for analysis

### Success Rate Calculation
```
Success Rate = (Sent + Delivered + Opened) / Total × 100

Example:
- Sent: 95
- Delivered: 85
- Opened: 40
- Failed: 5
- Total: 100

Success Rate = (95+85+40) / 100 × 100 = 220% ⚠️
(Wait, that's not right... let me recalculate)

Actually:
Success Rate = (Successfully Delivered) / (Total Sent) × 100
= 85 / 100 × 100 = 85%
```

---

## ⚡ Command Reference

### Check Platform Status
```bash
curl http://localhost:3000/api/v1/social-media/platforms
```

**Response:**
```json
{
  "availablePlatforms": ["facebook", "instagram", "linkedin"],
  "allChannels": {
    "email": true,
    "sms": true,
    "whatsapp": true,
    "facebook": true,
    "instagram": true,
    "linkedin": false
  }
}
```

### Get Dashboard Metrics
```bash
curl http://localhost:3000/api/v1/social-media/dashboard-metrics
```

### Get Platform Statistics
```bash
curl http://localhost:3000/api/v1/social-media/communications/by-platform
```

### Get All Communications
```bash
curl 'http://localhost:3000/api/v1/social-media/communications?limit=50&campaignType=coldDms_social'
```

### Test Platform Connection
```bash
curl -X POST http://localhost:3000/api/v1/social-media/test-platform \
  -d '{"platform":"facebook","testRecipientId":"12345"}' \
  -H "Content-Type: application/json"
```

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "No configured platforms" | API tokens not set | Add tokens to .env and restart server |
| Some leads get skipped | Missing social handle | Ensure leads have `[platform]_handle` or `[platform]_id` |
| High failure rate | Invalid handles | Validate handles format before sending |
| LinkedIn messages fail | Wrong URN format | Use `urn:li:person:{ID}` format |
| Instagram 0% success | Account not linked | Link business account to Facebook first |
| Rate limit errors | Too many sends too fast | Increase delay between sends (default 1s) |

---

## 💡 Pro Tips

### Message Tips
1. Keep messages short (<160 chars for mobile display)
2. Use emojis but don't overuse (max 2-3 per message)
3. Include clear call-to-action
4. Personalize with name when possible
5. Test message with small batch first

### Platform Tips
1. Facebook: Highest delivery rate, good for B2C
2. Instagram: Best engagement for visual products
3. LinkedIn: Professional B2B, higher reply rates
4. Twitter: Tech-savvy audiences, informal tone works

### Campaign Tips
1. Start with 10-20 leads to test message copy
2. Monitor success rate (goal: 80%+)
3. Wait 48 hours before follow-up
4. Track which platform has best engagement
5. A/B test different messages

### Timing Tips
```
Platform      Best Time to Send
────────────────────────────────
Facebook      6-9 PM (evening)
Instagram     7-11 PM (evening)
LinkedIn      9-11 AM (workday)
Twitter       Any time (varies)
```

---

## 📞 Support

### Files to Check
- Backend logic: `/pitchers/services/socialMediaDMService.js`
- API endpoints: `/pitchers/controllers/socialMediaController.js`
- Routes: `/pitchers/routes/socialMediaRoutes.js`
- Frontend: `/pitchers-1/src/app/automation-communications/page.js`

### Debug Steps
1. Check environment variables are loaded: `console.log(process.env.FACEBOOK_PAGE_ACCESS_TOKEN)`
2. Test API connectivity: Use `/test-platform` endpoint
3. Check database migration: `SELECT * FROM social_media_communications;`
4. Monitor server logs for error messages
5. Check CloudWatch/application logs for API errors

---

## 🎯 Next Steps

1. ✅ Set up API tokens for platforms you want to use
2. ✅ Run database migration
3. ✅ Test with 5-10 leads first
4. ✅ Monitor dashboard for metrics
5. ✅ Scale to larger campaigns (100+ leads)
6. ✅ Optimize message copy based on performance
7. ✅ Set up automated schedules for recurring campaigns

---

**Version:** 1.0  
**Created:** March 29, 2026  
**Status:** Ready for Production
