/**
 * Social Media Puppeteer Routes
 * Browser-based login + DM automation for Instagram & LinkedIn
 *
 * POST /api/v1/social/:platform/connect      → open browser for user to login
 * GET  /api/v1/social/:platform/status       → get session status
 * POST /api/v1/social/:platform/disconnect   → close browser & session
 * POST /api/v1/social/:platform/send         → send single DM
 * POST /api/v1/social/:platform/send-batch   → bulk DM campaign
 * GET  /api/v1/social/sessions               → all active sessions (admin)
 */

const express = require('express');
const router = express.Router();
const SocialPuppeteerService = require('../services/socialPuppeteerService');

const SUPPORTED_PLATFORMS = ['instagram', 'linkedin', 'twitter', 'reddit'];

// Lazy singleton
const getSvc = () => SocialPuppeteerService.getInstance();

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
  const { platform } = req.params;
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported platform "${platform}". Supported: ${SUPPORTED_PLATFORMS.join(', ')}`,
    });
  }
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/social/:platform/connect
 * Open a visible browser window for the user to log into the platform
 */
router.post('/:platform/connect', requirePlatform, requireEmail, async (req, res) => {
  try {
    const { platform } = req.params;
    const result = await getSvc().connect(platform, req.userEmail);
    res.json(result);
  } catch (err) {
    console.error('[SocialRoutes] connect error:', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/**
 * POST /api/v1/social/:platform/connect-cookie
 * Connect using a session cookie (sessionid for Instagram, li_at for LinkedIn)
 */
router.post('/:platform/connect-cookie', requirePlatform, requireEmail, async (req, res) => {
  try {
    const { platform } = req.params;
    const { cookieValue, username } = req.body;

    if (!cookieValue) {
      return res.status(400).json({ success: false, error: 'cookieValue is required' });
    }

    const result = await getSvc().connectWithCookie(platform, req.userEmail, cookieValue, username);
    res.json(result);
  } catch (err) {
    console.error('[SocialRoutes] connect-cookie error:', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/**
 * GET /api/v1/social/:platform/status
 * Get connection status for this user + platform
 */
router.get('/:platform/status', requirePlatform, requireEmail, (req, res) => {
  try {
    const { platform } = req.params;
    const status = getSvc().getStatus(platform, req.userEmail);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/social/:platform/disconnect
 * Close browser and remove session
 */
router.post('/:platform/disconnect', requirePlatform, requireEmail, async (req, res) => {
  try {
    const { platform } = req.params;
    const result = await getSvc().disconnect(platform, req.userEmail);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/social/:platform/send
 * Send a single DM
 * Body: { userEmail, recipient: "@handle" | "linkedin.com/in/..." , message }
 */
router.post('/:platform/send', requirePlatform, requireEmail, async (req, res) => {
  try {
    const { platform } = req.params;
    const { recipient, message } = req.body;

    if (!recipient || !message) {
      return res.status(400).json({ success: false, error: 'recipient and message are required' });
    }

    const result = await getSvc().sendDM(platform, req.userEmail, recipient, message);
    res.json(result);
  } catch (err) {
    const errObj = typeof err === 'object' ? err : { error: String(err) };
    res.status(500).json({ success: false, ...errObj });
  }
});

/**
 * POST /api/v1/social/:platform/send-batch
 * Bulk DM campaign
 * Body: {
 *   userEmail,
 *   leads: [{ id, name, instagram_handle | linkedin_url, message }],
 *   dailyLimit: 50,
 *   defaultMessage: "Hey {{name}}! ..."
 * }
 */
router.post('/:platform/send-batch', requirePlatform, requireEmail, async (req, res) => {
  try {
    const { platform } = req.params;
    const { leads = [], dailyLimit, defaultMessage } = req.body;

    if (!leads.length) {
      return res.status(400).json({ success: false, error: 'leads array is required' });
    }

    // Attach defaultMessage to each lead if they don't have their own
    const leadsWithMsg = leads.map(l => ({ ...l, message: l.message || defaultMessage || '' }));

    // Get DB for status updates (optional, don't fail if unavailable)
    let db = null;
    try {
      const DatabaseJobManager = require('../services/databaseJobManager');
      db = DatabaseJobManager.getInstance().databaseService;
    } catch { /* optional */ }

    const result = await getSvc().sendBatch(platform, req.userEmail, leadsWithMsg, { dailyLimit, db });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/**
 * GET /api/v1/social/sessions
 * List all active social sessions (useful for debugging)
 */
router.get('/sessions', (req, res) => {
  try {
    const sessions = getSvc().getAllSessions();
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
