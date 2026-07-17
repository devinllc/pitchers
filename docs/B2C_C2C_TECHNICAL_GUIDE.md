# 🛠️ B2C & C2C Technical Implementation Guide

**Version**: 1.0  
**Status**: Development Ready

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    PITCHERS PLATFORM v2                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │   B2B Module     │  │   B2C Module     │  │  C2C Module│ │
│  ├──────────────────┤  ├──────────────────┤  ├────────────┤ │
│  │ • Google Maps    │  │ • Facebook API   │  │ • Fiverr   │ │
│  │ • LinkedIn       │  │ • Instagram API  │  │ • Upwork   │ │
│  │ • Directories    │  │ • OLX Scraper    │  │ • TaskRab  │ │
│  │                  │  │ • Quikr Scraper  │  │ • Meetup   │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────┬───────┘ │
│           │                     │                  │         │
│           └─────────────────────┼──────────────────┘         │
│                                 │                            │
│                        ┌────────▼────────┐                   │
│                        │ Unified Lead DB │                   │
│                        │ + Segmentation  │                   │
│                        └────────┬────────┘                   │
│                                 │                            │
│        ┌────────────────────────┼────────────────────────┐  │
│        │                        │                        │  │
│   ┌────▼─────┐  ┌──────────┐  ┌─▼──────┐  ┌────────────┐ │
│   │Automation │  │ Analytics│  │ Scoring│  │  API/SDK   │ │
│   └──────────┘  └──────────┘  └────────┘  └────────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Database Schema Extensions

### B2C Leads Table
```sql
-- Enhanced B2C leads table
CREATE TABLE IF NOT EXISTS b2c_leads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  
  -- Identity
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(20),
  
  -- Location & Demographics
  country VARCHAR(100),
  state VARCHAR(100),
  city VARCHAR(100),
  postal_code VARCHAR(20),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  timezone VARCHAR(50),
  
  -- Consumer Profile
  age_range VARCHAR(20), -- '18-25', '26-35', etc.
  gender VARCHAR(20),
  occupation VARCHAR(255),
  company_name VARCHAR(255),
  income_range VARCHAR(50), -- '$0-50K', '$50K-100K', etc.
  
  -- Interests & Signals
  interests JSONB, -- Array of interest tags
  purchase_signals JSONB, -- {searched: [...], viewed: [...], wishlisted: [...]}
  browsing_history JSONB,
  platform_activity JSONB, -- {facebook: {...}, instagram: {...}}
  
  -- Lead Quality Metrics
  engagement_score INTEGER DEFAULT 0, -- 0-100
  purchase_intent VARCHAR(20), -- 'very_high', 'high', 'medium', 'low'
  conversion_probability DECIMAL(3,2), -- 0.00-1.00
  
  -- Lead Source
  source VARCHAR(50), -- 'facebook', 'instagram', 'olx', 'google_reviews'
  source_id VARCHAR(500), -- Platform-specific ID
  source_url VARCHAR(1000),
  
  -- Verification
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  identity_verified BOOLEAN DEFAULT FALSE,
  
  -- Tracking
  captured_at TIMESTAMP,
  first_seen_at TIMESTAMP,
  last_contacted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_b2c_user_id ON b2c_leads(user_id);
CREATE INDEX idx_b2c_email ON b2c_leads(email);
CREATE INDEX idx_b2c_phone ON b2c_leads(phone);
CREATE INDEX idx_b2c_source ON b2c_leads(source);
CREATE INDEX idx_b2c_intent ON b2c_leads(purchase_intent);
CREATE INDEX idx_b2c_score ON b2c_leads(engagement_score DESC);
CREATE INDEX idx_b2c_location ON b2c_leads(city, state);
```

### C2C Service Providers Table
```sql
CREATE TABLE IF NOT EXISTS c2c_service_providers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER, -- Our platform user if they joined
  
  -- Identity
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(20),
  profile_image_url VARCHAR(1000),
  
  -- Location
  country VARCHAR(100),
  state VARCHAR(100),
  city VARCHAR(100),
  service_radius_km INTEGER, -- How far they travel
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  
  -- Service Info
  service_category VARCHAR(100), -- 'plumbing', 'tutoring', etc.
  service_subcategories JSONB, -- Multiple services
  service_description TEXT,
  professional_background TEXT,
  years_experience INTEGER,
  certifications JSONB, -- Array of cert objects
  
  -- Pricing & Availability
  hourly_rate DECIMAL(10,2),
  minimum_project_size DECIMAL(10,2),
  currency VARCHAR(10),
  availability JSONB, -- {monday: ['9-17'], saturday: ['10-14']}
  response_time_minutes INTEGER, -- Average response time
  
  -- Performance Metrics
  overall_rating DECIMAL(2,1), -- 4.5 / 5
  total_reviews INTEGER,
  jobs_completed INTEGER,
  client_satisfaction DECIMAL(3,1), -- 95% satisfied
  repeat_client_rate DECIMAL(3,1),
  on_time_rate DECIMAL(3,1),
  
  -- Social Proof & Links
  social_profiles JSONB, -- {fiverr: {...}, upwork: {...}, fb: {...}}
  portfolio_urls JSONB,
  verified_credentials JSONB,
  
  -- Quality Scoring
  trust_score INTEGER DEFAULT 40, -- 0-100
  quality_score INTEGER DEFAULT 40, -- 0-100
  reliability_score INTEGER DEFAULT 40, -- 0-100
  
  -- Lead Source
  source VARCHAR(50), -- 'fiverr', 'upwork', 'olx', 'facebook'
  source_id VARCHAR(500),
  source_url VARCHAR(1000),
  
  -- Tracking
  captured_at TIMESTAMP,
  last_updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_c2c_user_id ON c2c_service_providers(user_id);
CREATE INDEX idx_c2c_category ON c2c_service_providers(service_category);
CREATE INDEX idx_c2c_city ON c2c_service_providers(city);
CREATE INDEX idx_c2c_rating ON c2c_service_providers(overall_rating DESC);
CREATE INDEX idx_c2c_quality ON c2c_service_providers(quality_score DESC);
CREATE INDEX idx_c2c_location ON c2c_service_providers USING GIST (
  ST_MakePoint(longitude, latitude)
);
```

### B2C & C2C Campaign Executions Table
```sql
-- Extended automation_executions to support B2C/C2C
ALTER TABLE automation_executions ADD COLUMN segment_type VARCHAR(50); -- 'b2b', 'b2c', 'c2c'

CREATE TABLE IF NOT EXISTS b2c_c2c_executions (
  id SERIAL PRIMARY KEY,
  execution_id VARCHAR(255) UNIQUE,
  campaign_id VARCHAR(255),
  
  -- Lead Info
  lead_type VARCHAR(50), -- 'b2c_lead', 'c2c_provider'
  lead_id INTEGER,
  
  -- Recipient
  recipient_name VARCHAR(255),
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20),
  
  -- Campaign
  campaign_segment VARCHAR(50), -- 'ecommerce_buyers', 'freelancers'
  message_sent TEXT,
  
  -- Channel & Delivery
  channel VARCHAR(50), -- 'email', 'whatsapp', 'sms', 'facebook', 'instagram'
  platform_sent_at TIMESTAMP,
  
  -- Status & Response
  status VARCHAR(50), -- 'pending', 'sent', 'opened', 'clicked', 'failed'
  recipient_response TEXT, -- If they replied
  
  -- Platform-specific data
  platform_response JSONB,
  open_count INTEGER,
  click_count INTEGER,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_b2c_c2c_exec_campaign ON b2c_c2c_executions(campaign_id);
CREATE INDEX idx_b2c_c2c_exec_lead ON b2c_c2c_executions(lead_id);
CREATE INDEX idx_b2c_c2c_exec_status ON b2c_c2c_executions(status);
```

---

## 🔌 API Integrations

### Facebook/Instagram API Integration
```javascript
// /pitchers/services/facebookService.js

const axios = require('axios');
const config = require('../config/production');

class FacebookService {
  constructor() {
    this.baseUrl = 'https://graph.instagram.com/v18.0';
    this.accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  }

  /**
   * Get Instagram users by hashtag interests
   */
  async getUsersByHashtag(hashtags, limit = 100) {
    try {
      const users = [];
      
      for (const hashtag of hashtags) {
        const response = await axios.get(`${this.baseUrl}/ig_hashtag_search`, {
          params: {
            user_id: process.env.FACEBOOK_BUSINESS_ACCOUNT_ID,
            fields: 'id,name',
            access_token: this.accessToken
          }
        });

        // Get recent media from this hashtag
        const hashtagId = response.data.data[0].id;
        const mediaResponse = await axios.get(`${this.baseUrl}/${hashtagId}/recent_media`, {
          params: {
            fields: 'id,caption,like_count,comments_count',
            access_token: this.accessToken
          }
        });

        // Extract user interests from caption and engagement
        mediaResponse.data.data.forEach(media => {
          users.push({
            hashtag,
            caption: media.caption,
            engagement: media.like_count + media.comments_count,
            interest_signal: 'high'
          });
        });
      }

      return users;
    } catch (error) {
      console.error('❌ Facebook API error:', error.message);
      throw error;
    }
  }

  /**
   * Get audience data for targeting
   */
  async getAudienceInsights(criteria) {
    try {
      const response = await axios.post(`${this.baseUrl}/audience_insights`, {
        targeting_spec: criteria,
        access_token: this.accessToken
      });

      return {
        total_population: response.data.data[0].total_population,
        demographics: response.data.data[0].demographics
      };
    } catch (error) {
      console.error('❌ Audience insights error:', error.message);
      throw error;
    }
  }

  /**
   * Create lookalike audience from existing customers
   */
  async createLookalikeAudience(customerEmails, country = 'IN') {
    try {
      // Hash customer emails
      const hashedEmails = customerEmails.map(email => 
        this.hashEmail(email.toLowerCase().trim())
      );

      const response = await axios.post(
        `${this.baseUrl}/${process.env.FACEBOOK_AD_ACCOUNT_ID}/audiences`,
        {
          name: `Lookalike - ${Date.now()}`,
          lookalike_spec: {
            type: 'similarity',
            country: country,
            ratio: 0.1 // Top 10%, 0.05 for top 5%
          },
          seed_emails: hashedEmails,
          access_token: this.accessToken
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Lookalike audience error:', error.message);
      throw error;
    }
  }

  hashEmail(email) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(email).digest('hex');
  }
}

module.exports = new FacebookService();
```

### OLX/Quikr Scraper Integration
```javascript
// /pitchers/services/classifiedSitesScraper.js

const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');

class ClassifiedSitesScraper {
  /**
   * Scrape OLX service listings
   */
  async scrapeOLXServices(category, city, maxPages = 5) {
    const listings = [];
    const baseUrl = `https://www.olx.in/${city}/${category}`;

    try {
      for (let page = 1; page <= maxPages; page++) {
        const url = `${baseUrl}?page=${page}`;
        console.log(`📍 Scraping OLX: ${url}`);

        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
          }
        });

        const $ = cheerio.load(response.data);

        // Find all listings
        $('.modalSection').each((index, element) => {
          const title = $(element).find('h2').text().trim();
          const price = $(element).find('.pdp-txt-price').text().trim();
          const description = $(element).find('.itemTitle').text().trim();
          const link = $(element).find('a').attr('href');

          if (title && link) {
            listings.push({
              id: `olx_${uuidv4()}`,
              title,
              price,
              description,
              link,
              category,
              city,
              source: 'olx',
              scraped_at: new Date(),
              seller_info_available: true // Will extract on detail page
            });
          }
        });

        // Random delay to avoid blocking
        await new Promise(resolve => setTimeout(resolve, Math.random() * 3000));
      }

      console.log(`✅ Scraped ${listings.length} OLX listings`);
      return listings;
    } catch (error) {
      console.error('❌ OLX scraping error:', error.message);
      throw error;
    }
  }

  /**
   * Extract seller details from listing
   */
  async extractSellerDetails(listingUrl) {
    try {
      const response = await axios.get(listingUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });

      const $ = cheerio.load(response.data);

      // Extract seller info
      const sellerName = $('.seller-name').text().trim();
      const sellerPhone = $('.seller-phone').text().trim();
      const sellerRating = $('.seller-rating').text().trim();
      const sellerBadges = $('.badge-item').map((i, el) => $(el).text()).get();

      return {
        name: sellerName,
        phone: sellerPhone,
        rating: parseFloat(sellerRating),
        badges: sellerBadges,
        verified: sellerBadges.includes('Verified')
      };
    } catch (error) {
      console.error('❌ Seller extraction error:', error.message);
      throw error;
    }
  }

  /**
   * Scrape Quikr sellers
   */
  async scrapeQuikrSellers(category, city, maxPages = 5) {
    const sellers = [];
    const baseUrl = `https://www.quikr.com/${city}/${category}`;

    try {
      for (let page = 1; page <= maxPages; page++) {
        const response = await axios.get(`${baseUrl}/?page=${page}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        });

        const $ = cheerio.load(response.data);

        $('.listingCard').each((index, element) => {
          const seller = {
            id: `quikr_${uuidv4()}`,
            name: $(element).find('.sellerName').text().trim(),
            title: $(element).find('.title').text().trim(),
            phone: $(element).find('[data-phone]').attr('data-phone'),
            rating: parseFloat($(element).find('.rating').text()),
            reviews: parseInt($(element).find('.reviews').text()),
            city,
            category,
            source: 'quikr',
            scraped_at: new Date()
          };

          if (seller.phone) {
            sellers.push(seller);
          }
        });

        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
      }

      return sellers;
    } catch (error) {
      console.error('❌ Quikr scraping error:', error.message);
      throw error;
    }
  }
}

module.exports = new ClassifiedSitesScraper();
```

### Fiverr API Integration
```javascript
// /pitchers/services/fiverr Service.js

const axios = require('axios');

class FiverrService {
  constructor() {
    this.apiKey = process.env.FIVERR_API_KEY;
    this.baseUrl = 'https://api.fiverr.com/v2';
  }

  /**
   * Search for gig creators by skill
   */
  async searchGigCreators(skill, limit = 100) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/search/gigs`,
        {
          params: {
            query: skill,
            limit,
            level: 'all',
            sort: 'rating'
          },
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      // Extract seller data
      const sellers = response.data.data.gigs.map(gig => ({
        id: `fiverr_${gig.seller_id}`,
        name: gig.seller_name,
        title: gig.title,
        description: gig.description,
        skills: gig.tags,
        rating: gig.rating,
        reviews: gig.reviews_count,
        price_range: {
          min: gig.price_min,
          max: gig.price_max
        },
        response_time_minutes: gig.response_time,
        completed_orders: gig.orders_completed,
        seller_id: gig.seller_id,
        source: 'fiverr',
        captured_at: new Date()
      }));

      return sellers;
    } catch (error) {
      console.error('❌ Fiverr API error:', error.message);
      throw error;
    }
  }

  /**
   * Get seller profile details
   */
  async getSellerProfile(sellerId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/sellers/${sellerId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return response.data.data;
    } catch (error) {
      console.error('❌ Get seller profile error:', error.message);
      throw error;
    }
  }

  /**
   * Get seller reviews/feedback
   */
  async getSellerReviews(sellerId, limit = 50) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/sellers/${sellerId}/reviews`,
        {
          params: { limit },
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return response.data.data.reviews;
    } catch (error) {
      console.error('❌ Get reviews error:', error.message);
      throw error;
    }
  }
}

module.exports = new FiverrService();
```

---

## 🤖 Segmentation & Scoring Engine

```javascript
// /pitchers/services/leadScoringService.js

class LeadScoringService {
  /**
   * Score B2C leads based on multiple signals
   */
  scoreb2cLead(leadData) {
    let score = 0;

    // 1. Email presence & quality (20 points)
    if (leadData.email) {
      const emailDomain = leadData.email.split('@')[1];
      const isFreeDomain = ['gmail.com', 'yahoo.com', 'hotmail.com'].includes(emailDomain);
      score += isFreeDomain ? 10 : 20;
    }

    // 2. Phone presence (15 points)
    if (leadData.phone && this.isValidPhone(leadData.phone)) {
      score += 15;
    }

    // 3. Profile completeness (15 points)
    const completeness = this.calculateProfileCompleteness(leadData);
    score += completeness * 15;

    // 4. Engagement signals (25 points)
    if (leadData.purchase_signals) {
      const engagementLevel = this.calculateEngagementLevel(leadData.purchase_signals);
      score += engagementLevel * 25;
    }

    // 5. Behavioral signals (15 points)
    if (leadData.browsing_history) {
      const recency = this.calculateRecency(leadData.browsing_history);
      score += recency * 15;
    }

    // 6. Source credibility (10 points)
    const sourceWeights = {
      'facebook': 8,
      'instagram': 7,
      'google_reviews': 9,
      'review_sites': 8,
      'olx': 6,
      'quikr': 5
    };
    score += sourceWeights[leadData.source] || 5;

    return Math.min(100, Math.round(score));
  }

  /**
   * Score C2C service providers
   */
  scoreServiceProvider(providerData) {
    let score = 0;

    // 1. Rating (25 points)
    if (providerData.overall_rating) {
      score += (providerData.overall_rating / 5) * 25;
    }

    // 2. Experience (15 points)
    if (providerData.years_experience) {
      const expScore = Math.min(providerData.years_experience / 10, 1);
      score += expScore * 15;
    }

    // 3. Job completion rate (20 points)
    if (providerData.jobs_completed) {
      const completionRate = Math.min(providerData.jobs_completed / 100, 1);
      score += completionRate * 20;
    }

    // 4. Response time (15 points)
    if (providerData.response_time_minutes) {
      let timeScore = 0;
      if (providerData.response_time_minutes <= 30) timeScore = 15;
      else if (providerData.response_time_minutes <= 60) timeScore = 12;
      else if (providerData.response_time_minutes <= 120) timeScore = 8;
      else timeScore = 3;
      score += timeScore;
    }

    // 5. Verification (15 points)
    if (providerData.identity_verified) score += 10;
    if (providerData.certifications && providerData.certifications.length > 0) score += 5;

    // 6. Repeat client rate (10 points)
    if (providerData.repeat_client_rate) {
      score += (providerData.repeat_client_rate / 100) * 10;
    }

    return Math.min(100, Math.round(score));
  }

  /**
   * Segment B2C leads by purchase intent
   */
  segmentb2cLeadByIntent(leadData) {
    if (leadData.engagement_score >= 80) {
      return 'very_high';
    } else if (leadData.engagement_score >= 60) {
      return 'high';
    } else if (leadData.engagement_score >= 40) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Segment C2C providers by quality tier
   */
  segmentProviderByTier(providerScore) {
    if (providerScore >= 85) {
      return { tier: 'platinum', multiplier: 1.5 };
    } else if (providerScore >= 70) {
      return { tier: 'gold', multiplier: 1.25 };
    } else if (providerScore >= 55) {
      return { tier: 'silver', multiplier: 1.0 };
    } else {
      return { tier: 'bronze', multiplier: 0.75 };
    }
  }

  // Helper methods
  isValidPhone(phone) {
    return /^[\d\+\-\(\)\s]+$/.test(phone) && phone.replace(/\D/g, '').length >= 10;
  }

  calculateProfileCompleteness(data) {
    const fields = ['first_name', 'last_name', 'email', 'phone', 'city', 'interests'];
    const completed = fields.filter(f => data[f] && String(data[f]).length > 0).length;
    return completed / fields.length;
  }

  calculateEngagementLevel(signals) {
    let total = 0;
    if (signals.searched && signals.searched.length > 0) total += 0.3;
    if (signals.viewed && signals.viewed.length > 3) total += 0.3;
    if (signals.wishlisted && signals.wishlisted.length > 0) total += 0.2;
    if (signals.commented || signals.shared) total += 0.2;
    return Math.min(total, 1);
  }

  calculateRecency(history) {
    if (!history || history.length === 0) return 0;
    const lastActivity = new Date(Math.max(...history.map(h => new Date(h.timestamp))));
    const daysSinceLastActivity = (Date.now() - lastActivity) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLastActivity <= 7) return 1.0;
    else if (daysSinceLastActivity <= 30) return 0.7;
    else if (daysSinceLastActivity <= 90) return 0.4;
    else return 0.1;
  }
}

module.exports = new LeadScoringService();
```

---

## 🚀 B2C/C2C API Endpoints

```javascript
// /pitchers/routes/b2cRoutes.js

const express = require('express');
const router = express.Router();
const b2cController = require('../controllers/b2cController');
const { authenticateAPIKey } = require('../middleware/authMiddleware');

router.use(authenticateAPIKey);

// B2C Lead Management
router.post('/leads/import', b2cController.importB2CLeads);
router.get('/leads/search', b2cController.searchB2CLeads);
router.get('/leads/:leadId', b2cController.getB2CLeadDetail);
router.post('/leads/:leadId/engage', b2cController.engageB2CLead);

// B2C Segmentation
router.get('/segments', b2cController.getB2CSegments);
router.post('/segments/create', b2cController.createCustomSegment);

// B2C Campaigns
router.post('/campaigns/create', b2cController.createB2CCampaign);
router.get('/campaigns/:campaignId/analytics', b2cController.getB2CCampaignAnalytics);

module.exports = router;
```

```javascript
// /pitchers/routes/c2cRoutes.js

const express = require('express');
const router = express.Router();
const c2cController = require('../controllers/c2cController');
const { authenticateAPIKey } = require('../middleware/authMiddleware');

router.use(authenticateAPIKey);

// C2C Provider Management
router.post('/providers/scrape', c2cController.scrapeServiceProviders);
router.get('/providers/search', c2cController.searchServiceProviders);
router.get('/providers/:providerId', c2cController.getProviderDetail);
router.post('/providers/:providerId/engage', c2cController.engageProvider);

// C2C Matching
router.post('/matches/find', c2cController.findMatches);
router.get('/matches/stats', c2cController.getMatchStats);

// C2C Campaigns  
router.post('/campaigns/create', c2cController.createC2CCampaign);
router.get('/campaigns/:campaignId/analytics', c2cController.getC2CCampaignAnalytics);

module.exports = router;
```

---

## ✅ Implementation Checklist

### Phase 1: B2C Infrastructure (Weeks 1-4)
- [ ] Create B2C leads database schema
- [ ] Build Facebook/Instagram API client
- [ ] Build OLX/Quikr scraper
- [ ] Create lead segmentation engine
- [ ] Build lead scoring service
- [ ] Create B2C leads import API
- [ ] Create B2C leads search API
- [ ] Create B2C automation templates
- [ ] Build B2C campaign creation API

### Phase 2: C2C Infrastructure (Weeks 5-8)
- [ ] Create C2C providers database schema
- [ ] Build Fiverr/Upwork scrapers
- [ ] Build provider matching engine
- [ ] Create provider scoring service
- [ ] Create provider import API
- [ ] Create provider search API
- [ ] Create C2C automation templates
- [ ] Build C2C campaign creation API
- [ ] Create commission tracking system

### Phase 3: Frontend Integration (Weeks 9-12)
- [ ] Create B2C leads dashboard
- [ ] Create B2C segment management UI
- [ ] Create C2C provider dashboard
- [ ] Create C2C matching UI
- [ ] Build analytics dashboards for both
- [ ] Create campaign management interfaces
- [ ] Build lead/provider detail views

---

**Status**: Technical implementation ready  
**Next**: Backend development begins
