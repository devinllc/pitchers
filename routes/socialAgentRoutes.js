/**
 * Social Media AI PR Agent & Auto-Poster Routes
 */

const express = require('express');
const router = express.Router();
const DatabaseService = require('../services/database');
const SocialMediaAgentService = require('../services/socialMediaAgentService');

const SUPPORTED_PLATFORMS = ['instagram', 'linkedin', 'twitter', 'reddit'];
const db = new DatabaseService();

db.connect().catch(() => {});

// ── Middleware: extract userEmail ─────────────────────────────────────────

function requireEmail(req, res, next) {
  const email =
    req.body?.userEmail ||
    req.body?.user_email ||
    req.query?.userEmail ||
    req.query?.user_email ||
    req.headers['x-user-email'];

  if (!email) {
    return res.status(400).json({ success: false, error: 'userEmail is required' });
  }
  req.userEmail = email;
  next();
}

function requirePlatform(req, res, next) {
  const platform = req.query.platform || req.body.platform;
  if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported platform "${platform}". Supported: ${SUPPORTED_PLATFORMS.join(', ')}`,
    });
  }
  req.platform = platform;
  next();
}

// ── Endpoints ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/social-agent/settings
 * Fetch settings for user + platform
 */
router.get('/settings', requireEmail, requirePlatform, async (req, res) => {
  try {
    const query = `
      SELECT * FROM social_media_agents 
      WHERE user_email = $1 AND platform = $2
    `;
    const result = await db.pool.query(query, [req.userEmail, req.platform]);
    res.json({ success: true, settings: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/social-agent/settings
 * Save or update AI PR Agent configurations (niche, tone, schedule, toggle state)
 */
router.post('/settings', requireEmail, requirePlatform, async (req, res) => {
  try {
    const { niche, tone = 'professional', scheduleTime = '09:00', enabled = false, marketingEnabled = false } = req.body;

    if (!niche || !niche.trim()) {
      return res.status(400).json({ success: false, error: 'Business niche/description is required' });
    }

    const query = `
      INSERT INTO social_media_agents (user_email, platform, niche, tone, schedule_time, enabled, marketing_enabled, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (user_email, platform) 
      DO UPDATE SET niche = $3, tone = $4, schedule_time = $5, enabled = $6, marketing_enabled = $7, updated_at = NOW()
      RETURNING *
    `;
    
    const result = await db.pool.query(query, [
      req.userEmail, 
      req.platform, 
      niche.trim(), 
      tone, 
      scheduleTime, 
      enabled, 
      marketingEnabled
    ]);

    res.json({ success: true, settings: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/social-agent/preview
 * Instantly draft sample post copy via OpenRouter (does not trigger publishing)
 */
router.post('/preview', requireEmail, requirePlatform, async (req, res) => {
  try {
    const { niche, tone = 'professional' } = req.body;

    if (!niche || !niche.trim()) {
      return res.status(400).json({ success: false, error: 'Business niche/description is required' });
    }

    const agentSvc = SocialMediaAgentService.getInstance();
    const postText = await agentSvc.generateAIPost(req.platform, niche.trim(), tone);

    res.json({ success: true, postText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/social-agent/trigger
 * Manually force execution of automated posting instantly (useful for testing/debugging)
 */
router.post('/trigger', requireEmail, requirePlatform, async (req, res) => {
  try {
    const { niche, tone = 'professional' } = req.body;

    if (!niche || !niche.trim()) {
      return res.status(400).json({ success: false, error: 'Business niche/description is required' });
    }

    // 1. Insert a log entry
    const logRes = await db.pool.query(
      `INSERT INTO social_media_posts (user_email, platform, post_text, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.userEmail, req.platform, 'Generating manual content...', 'publishing']
    );
    const logId = logRes.rows[0].id;

    const agentSvc = SocialMediaAgentService.getInstance();

    try {
      // 2. Publish post via Puppeteer
      const result = await agentSvc.executeAutoPost(req.platform, req.userEmail, niche.trim(), tone);

      // 3. Update log
      await db.pool.query(
        `UPDATE social_media_posts SET post_text = $1, image_url = $2, status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $3`,
        [result.postText, result.imageUrl || null, logId]
      );

      // 4. Update the agent settings last_posted_at
      await db.pool.query(
        `UPDATE social_media_agents SET last_posted_at = NOW(), updated_at = NOW() WHERE user_email = $1 AND platform = $2`,
        [req.userEmail, req.platform]
      );

      // Run organic marketing in the background
      agentSvc.executeSocialMarketingPR(req.platform, req.userEmail, niche).catch(prErr => {
        console.warn('[SocialRoutes:PR] Organic marketing warning:', prErr.message);
      });

      res.json({ success: true, message: 'Automated post published successfully!', ...result });
    } catch (postErr) {
      // Log failure
      await db.pool.query(
        `UPDATE social_media_posts SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [postErr.message || String(postErr), logId]
      );
      throw postErr;
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/social-agent/trigger-pr
 * Manually trigger PR marketing interactions (comment on hashtag posts) right now
 */
router.post('/trigger-pr', requireEmail, requirePlatform, async (req, res) => {
  try {
    const { niche } = req.body;
    if (!niche || !niche.trim()) {
      return res.status(400).json({ success: false, error: 'niche is required' });
    }

    const agentSvc = SocialMediaAgentService.getInstance();

    // Fire PR in background, return immediately
    agentSvc.executeSocialMarketingPR(req.platform, req.userEmail, niche.trim())
      .then(() => console.log(`[PRRoute] ✅ Manual PR done for ${req.userEmail}/${req.platform}`))
      .catch(err => console.warn(`[PRRoute] PR warning:`, err.message));

    res.json({ success: true, message: 'PR marketing interactions triggered in background.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/social-agent/history
 * Fetch posting execution logs
 */
router.get('/history', requireEmail, requirePlatform, async (req, res) => {
  try {
    const query = `
      SELECT * FROM social_media_posts 
      WHERE user_email = $1 AND platform = $2 
      ORDER BY created_at DESC 
      LIMIT 30
    `;
    const result = await db.pool.query(query, [req.userEmail, req.platform]);
    res.json({ success: true, history: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/social-agent/pr-history
 * Fetch PR comment history (what the bot commented, where, when)
 */
router.get('/pr-history', requireEmail, async (req, res) => {
  try {
    const { platform, limit = 50 } = req.query;
    let query = `
      SELECT id, user_email, platform, hashtag, comment, brand_tag, post_url, status, created_at
      FROM social_pr_comments
      WHERE user_email = $1
    `;
    const params = [req.userEmail];
    if (platform) {
      query += ` AND platform = $2`;
      params.push(platform);
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(Math.min(parseInt(limit) || 50, 200));

    const result = await db.pool.query(query, params);
    res.json({ success: true, comments: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
