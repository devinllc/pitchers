/**
 * WhatsApp Integration Routes — Production
 *
 * Dual-mode WhatsApp automation:
 *   Mode 1 — QR / Chrome Extension: Real WhatsApp Web via Puppeteer + whatsapp-web.js
 *   Mode 2 — Meta Business API: Official Cloud API (templates + free-form text)
 *
 * All responses follow a consistent envelope: { success, data?, error? }
 */

const express = require('express');
const router = express.Router();
const WhatsAppPuppeteerService = require('../services/whatsappPuppeteerService');
const WhatsAppMetaAPI = require('../services/whatsappMetaAPI');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const DatabaseService = require('../services/database');

// ── Singletons (persist across requests) ─────────────────────────────────────

const whatsappPuppeteer = WhatsAppPuppeteerService.getInstance();
const whatsappMeta = new WhatsAppMetaAPI();

let _db;
function getDB() {
  if (!_db) _db = new DatabaseService();
  return _db;
}

let _waConn;
function getWAConn() {
  if (!_waConn) _waConn = new WhatsAppConnection(getDB());
  return _waConn;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractEmail(req) {
  return (
    req.headers['x-user-email'] ||
    req.body?.user_email ||
    req.query?.user_email ||
    req.body?.email ||
    req.query?.email ||
    null
  );
}

function ok(res, data) {
  return res.json({ success: true, ...data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ─────────────────────────────────────────────────────────────────────────────
//  STATUS & CONNECTION INFO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/whatsapp/status
 * Lightweight status check (QR session state)
 */
router.get('/status', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    let qrStatus = await whatsappPuppeteer.getQRStatus(userEmail);

    if (qrStatus.status === 'not_initialized') {
      const reconnect = await whatsappPuppeteer.reconnectExisting(userEmail);
      if (reconnect.success) {
        qrStatus = await whatsappPuppeteer.getQRStatus(userEmail);
        // Force the status to connected for UI while reconnecting
        qrStatus.status = 'connected';
      }
    }

    // Also check DB connection for Meta API state
    let dbConn = null;
    try {
      dbConn = await getWAConn().getConnectionByEmail(userEmail);
    } catch (_) {
      // DB may not be available — non-fatal
    }

    return ok(res, {
      status: qrStatus.status,
      phoneNumber: qrStatus.phoneNumber || dbConn?.qr_connected_phone || null,
      connectedAt: qrStatus.connectedAt || dbConn?.qr_connected_at || null,
      activeMode: dbConn?.active_mode || (qrStatus.status === 'connected' ? 'qr' : 'none'),
      modes: {
        qr: qrStatus.status === 'connected',
        meta_api: dbConn?.meta_api_enabled || false,
      },
      qrCode: qrStatus.qrCode || null,
    });
  } catch (error) {
    console.error('❌ Error getting status:', error);
    fail(res, 500, error.message || 'Failed to get status');
  }
});

/**
 * GET /api/v1/whatsapp/connection-info
 * Full connection info including Meta credentials validity
 */
router.get('/connection-info', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    let dbConn = null;
    try {
      dbConn = await getWAConn().getConnectionByEmail(userEmail);
    } catch (_) { }

    let qrStatus = await whatsappPuppeteer.getQRStatus(userEmail);
    if (qrStatus.status === 'not_initialized') {
      const reconnect = await whatsappPuppeteer.reconnectExisting(userEmail);
      if (reconnect.success) {
        qrStatus = await whatsappPuppeteer.getQRStatus(userEmail);
        qrStatus.status = 'connected';
      }
    }

    return ok(res, {
      connection: {
        activeMode: dbConn?.active_mode || 'none',
        isActive: dbConn?.is_active || false,
        qr: {
          enabled: dbConn?.qr_enabled || qrStatus.status === 'connected',
          status: qrStatus.status,
          phone: qrStatus.phoneNumber || dbConn?.qr_connected_phone,
          connectedAt: qrStatus.connectedAt || dbConn?.qr_connected_at,
        },
        metaApi: {
          enabled: dbConn?.meta_api_enabled || false,
          phoneNumberId: dbConn?.meta_phone_number_id || null,
          businessAccountId: dbConn?.meta_business_account_id || null,
          hasToken: !!dbConn?.meta_api_token,
          verifiedAt: dbConn?.meta_verified_at || null,
        },
        lastMessageSentAt: dbConn?.last_message_sent_at || null,
      },
    });
  } catch (error) {
    console.error('❌ Error getting connection info:', error);
    fail(res, 500, error.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  QR / CHROME EXTENSION MODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/whatsapp/generate-qr
 * Start Puppeteer, launch headless Chrome, begin WhatsApp Web QR flow
 */
router.post('/generate-qr', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    console.log(`📱 [WhatsApp] Generate QR request for ${userEmail}`);

    const result = await whatsappPuppeteer.generateQRCode(userEmail);

    if (!result.success) {
      return fail(res, 500, result.error || 'QR generation failed');
    }

    // If QR was already generated and cached, include it
    return ok(res, {
      status: result.status,
      qrCode: result.qrCode || null,
      phoneNumber: result.phoneNumber || null,
      message: result.message,
      expiresIn: result.expiresIn || 120000,
    });
  } catch (error) {
    console.error('❌ Error generating QR:', error);
    fail(res, 500, error.message || 'Failed to generate QR code');
  }
});

/**
 * GET /api/v1/whatsapp/get-qr
 * Poll for the QR code image (base64 data-URI)
 */
router.get('/get-qr', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const status = await whatsappPuppeteer.getQRStatus(userEmail);

    if (status.status === 'connected') {
      return ok(res, {
        status: 'connected',
        phoneNumber: status.phoneNumber,
        connectedAt: status.connectedAt,
        message: 'Already connected',
      });
    }

    if (!status.qrCode) {
      return ok(res, {
        status: status.status,
        qrCode: null,
        message: status.status === 'initializing'
          ? 'QR not ready yet. Wait 5-10 seconds and retry.'
          : 'No QR available. Call /generate-qr first.',
      });
    }

    return ok(res, {
      status: 'qr_generated',
      qrCode: status.qrCode,
      expiresIn: status.expiresIn,
    });
  } catch (error) {
    console.error('❌ Error fetching QR:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp/verify-qr
 * Check if QR was scanned and device paired (poll-based verification)
 */
router.post('/verify-qr', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const status = await whatsappPuppeteer.getQRStatus(userEmail);

    if (status.status === 'connected') {
      // Persist to DB
      try {
        await getWAConn().getOrCreateConnection(userEmail);
        await getWAConn().updateQRConnection(userEmail, {
          sessionToken: 'puppeteer_session',
          connectedPhone: status.phoneNumber,
          connectedAt: status.connectedAt,
        });
      } catch (_) {
        // Non-fatal — session works even without DB persistence
        console.warn('⚠️  Could not persist QR connection to DB');
      }

      return ok(res, {
        status: 'connected',
        phoneNumber: status.phoneNumber,
        connectedAt: status.connectedAt,
        mode: 'qr',
        message: 'WhatsApp connected successfully!',
      });
    }

    return ok(res, {
      status: status.status,
      message: status.status === 'qr_generated'
        ? 'QR displayed. Waiting for scan...'
        : `Current status: ${status.status}`,
    });
  } catch (error) {
    console.error('❌ Error verifying QR:', error);
    fail(res, 500, error.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  META BUSINESS API MODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/whatsapp/set-meta-credentials
 * Save and verify Meta WhatsApp Business API credentials
 */
router.post('/set-meta-credentials', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const { businessAccountId, accessToken, phoneNumberId } = req.body;
    if (!accessToken || !phoneNumberId) {
      return fail(res, 400, 'accessToken and phoneNumberId are required');
    }

    console.log(`🔑 [WhatsApp] Setting Meta API credentials for ${userEmail}`);

    // Verify credentials with Meta
    let verification = { success: false };
    try {
      verification = await whatsappMeta.getPhoneNumberDetails(accessToken, phoneNumberId);
    } catch (verErr) {
      return fail(res, 400, `Meta API verification failed: ${verErr.response?.data?.error?.message || verErr.message}`);
    }

    // Persist to DB
    try {
      await getWAConn().getOrCreateConnection(userEmail);
      await getWAConn().updateMetaAPIConnection(userEmail, {
        phoneNumberId,
        businessAccountId: businessAccountId || '',
        apiToken: accessToken,
        verifiedAt: new Date(),
      });
    } catch (dbErr) {
      console.error('⚠️  DB persist failed for Meta credentials:', dbErr.message);
    }

    return ok(res, {
      status: 'verified',
      mode: 'meta_api',
      phone: verification.phoneNumber,
      businessName: verification.businessName,
      message: 'Meta API credentials verified and saved!',
    });
  } catch (error) {
    console.error('❌ Error setting Meta credentials:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp/verify-meta
 * Test-fire a credential check without saving
 */
router.post('/verify-meta', async (req, res) => {
  try {
    const { accessToken, phoneNumberId } = req.body;
    if (!accessToken || !phoneNumberId) {
      return fail(res, 400, 'accessToken and phoneNumberId are required');
    }

    const result = await whatsappMeta.getPhoneNumberDetails(accessToken, phoneNumberId);

    return ok(res, {
      verified: true,
      phone: result.phoneNumber,
      businessName: result.businessName,
      quality: result.quality,
    });
  } catch (error) {
    return ok(res, {
      verified: false,
      error: error.response?.data?.error?.message || error.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  MODE SWITCHING & DISCONNECT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/whatsapp/set-active-mode
 * Switch between 'qr' and 'meta_api'
 */
router.post('/set-active-mode', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const { mode } = req.body;
    if (!['qr', 'meta_api', 'none'].includes(mode)) {
      return fail(res, 400, "mode must be 'qr', 'meta_api', or 'none'");
    }

    try {
      await getWAConn().getOrCreateConnection(userEmail);
      await getWAConn().setActiveMode(userEmail, mode);
    } catch (_) {
      console.warn('⚠️  Could not persist mode switch to DB');
    }

    return ok(res, {
      activeMode: mode,
      message: `Active mode set to ${mode}`,
    });
  } catch (error) {
    console.error('❌ Error switching mode:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp/disconnect
 * Disconnect all sessions and deactivate
 */
router.post('/disconnect', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    console.log(`🔌 Disconnecting WhatsApp for ${userEmail}`);

    // Disconnect Puppeteer client
    await whatsappPuppeteer.disconnect(userEmail);

    // Deactivate in DB
    try {
      await getWAConn().disableConnection(userEmail);
    } catch (_) { }

    return ok(res, { message: 'WhatsApp disconnected successfully' });
  } catch (error) {
    console.error('❌ Error disconnecting:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp/shutdown
 * Shutdown WhatsApp client preserving its saved session directory on disk
 */
router.post('/shutdown', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    console.log(`🔌 Shutting down WhatsApp client (preserving session folder) for ${userEmail}`);

    // Gracefully shut down Puppeteer client only (do not delete persistent folders)
    await whatsappPuppeteer.shutdownClientOnly(userEmail);

    return ok(res, { message: 'WhatsApp client shut down successfully' });
  } catch (error) {
    console.error('❌ Error shutting down client:', error);
    fail(res, 500, error.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  MESSAGING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/whatsapp/send
 * Send a single message via the active mode
 */
router.post('/send', async (req, res) => {
  try {
    const { phoneNumber, message, mode: requestedMode, media, leadId } = req.body;
    const userEmail = extractEmail(req);

    if (!userEmail || !phoneNumber || !message) {
      return fail(res, 400, 'user_email, phoneNumber, and message are required');
    }

    // Determine which mode to use
    let mode = requestedMode || 'qr';
    try {
      const conn = await getWAConn().getConnectionByEmail(userEmail);
      if (conn?.active_mode && conn.active_mode !== 'none') {
        mode = conn.active_mode;
      }
    } catch (_) { }

    console.log(`💬 Sending message from ${userEmail} to ${phoneNumber} via ${mode} (Media: ${!!media})`);

    // Check automation limit (highest tier first)
    const apiKeyQuery = `
      SELECT id, automation_limit FROM api_keys 
      WHERE user_email = $1 AND is_active = true 
      ORDER BY 
        CASE plan_type 
          WHEN 'enterprise' THEN 4 
          WHEN 'pro' THEN 3 
          WHEN 'basic' THEN 2 
          WHEN 'trial' THEN 1 
          WHEN 'free' THEN 0 
          ELSE -1 
        END DESC,
        created_at DESC
      LIMIT 1
    `;
    const apiKeyResult = await getDB().pool.query(apiKeyQuery, [userEmail]);
    if (apiKeyResult.rows.length > 0) {
      const apiKey = apiKeyResult.rows[0];
      if (apiKey.automation_limit <= 0) {
        return fail(res, 403, 'Monthly automation limit reached for this plan');
      }
      await getDB().pool.query('UPDATE api_keys SET automation_limit = automation_limit - 1 WHERE id = $1', [apiKey.id]);
    }

    const signature = '\n\nThis message is send by pitchers - *AI-Powered* Leads Providers and Automation Tool. *Visit now for free Trail* \n *https://pitchers.ufdevs.live*';
    const finalMessage = message + signature;

    let result;
    if (mode === 'meta_api') {
      // Send via Meta Business API
      let conn;
      try {
        conn = await getWAConn().getConnectionByEmail(userEmail);
      } catch (_) { }

      if (!conn?.meta_api_token || !conn?.meta_phone_number_id) {
        return fail(res, 400, 'Meta API credentials not configured. Go to Settings > WhatsApp.');
      }

      result = await whatsappMeta.sendTextMessage(
        conn.meta_api_token,
        conn.meta_phone_number_id,
        phoneNumber,
        finalMessage
      );
    } else {
      // Send via QR / Puppeteer
      result = await whatsappPuppeteer.sendMessage(userEmail, phoneNumber, finalMessage, { media });
    }

    // Update status in business_data if leadId is provided and successful
    if (leadId && result.success) {
      const query = `UPDATE business_data SET status = 'Contacted - WhatsApp', updated_at = NOW() WHERE id = $1 AND user_email = $2`;
      await getDB().pool.query(query, [leadId, userEmail]).catch(e => console.error('Error updating status:', e));
    }

    // Update last message timestamp
    try {
      await getWAConn().updateLastMessageSent(userEmail);
    } catch (_) { }

    return ok(res, result);
  } catch (error) {
    console.error('❌ Error sending message:', error);
    fail(res, 400, error.message || error.error || 'Failed to send message');
  }
});

/**
 * POST /api/v1/whatsapp/send-batch
 * Send messages to multiple leads with rate limiting
 */
router.post('/send-batch', async (req, res) => {
  try {
    const { leads, delayMs = 2000, mode: requestedMode, media } = req.body;
    const userEmail = extractEmail(req);

    if (!userEmail || !leads || !Array.isArray(leads)) {
      return fail(res, 400, 'user_email and leads (array) are required');
    }

    // Determine mode
    let mode = requestedMode || 'qr';
    let conn;
    try {
      conn = await getWAConn().getConnectionByEmail(userEmail);
      if (conn?.active_mode && conn.active_mode !== 'none') {
        mode = conn.active_mode;
      }
    } catch (_) { }

    console.log(`📤 Batch send from ${userEmail} to ${leads.length} leads via ${mode} (Media: ${!!media})`);

    // Check automation limit (highest tier first)
    const apiKeyQuery = `
      SELECT id, automation_limit FROM api_keys 
      WHERE user_email = $1 AND is_active = true 
      ORDER BY 
        CASE plan_type 
          WHEN 'enterprise' THEN 4 
          WHEN 'pro' THEN 3 
          WHEN 'basic' THEN 2 
          WHEN 'trial' THEN 1 
          WHEN 'free' THEN 0 
          ELSE -1 
        END DESC,
        created_at DESC
      LIMIT 1
    `;
    const apiKeyResult = await getDB().pool.query(apiKeyQuery, [userEmail]);
    if (apiKeyResult.rows.length > 0) {
      const apiKey = apiKeyResult.rows[0];
      if (apiKey.automation_limit < leads.length) {
        return fail(res, 403, `Monthly automation limit reached. You have ${apiKey.automation_limit} left, but tried to send ${leads.length}.`);
      }
      await getDB().pool.query('UPDATE api_keys SET automation_limit = automation_limit - $1 WHERE id = $2', [leads.length, apiKey.id]);
    }

    if (mode === 'meta_api') {
      // Batch via Meta API
      if (!conn?.meta_api_token || !conn?.meta_phone_number_id) {
        return fail(res, 400, 'Meta API credentials not configured.');
      }

      const signature = '\n\nThis message is send by pitchers - *AI-Powered* Leads Providers and Automation Tool. *Visit now for free Trail* \n *https://pitchers.ufdevs.live*';

      const results = [];
      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        const finalMessage = lead.message + signature;
        try {
          const r = await whatsappMeta.sendTextMessage(
            conn.meta_api_token,
            conn.meta_phone_number_id,
            lead.phone,
            finalMessage
          );
          results.push({ ...r, phoneNumber: lead.phone });
          
          // Update status in business_data for Meta API as well
          if (lead.id) {
            const query = `UPDATE business_data SET status = 'Contacted - WhatsApp', updated_at = NOW() WHERE id = $1 AND user_email = $2`;
            await getDB().pool.query(query, [lead.id, userEmail]).catch(e => console.error('Error updating status for lead:', e));
          }
        } catch (err) {
          results.push({
            success: false,
            phoneNumber: lead.phone,
            error: err.response?.data?.error?.message || err.message,
          });

          if (lead.id) {
            const query = `UPDATE business_data SET status = 'Failed - WhatsApp', notes = CONCAT(COALESCE(notes, ''), '\nWhatsApp Fail: ', $1::text), updated_at = NOW() WHERE id = $2 AND user_email = $3`;
            await getDB().pool.query(query, [String(err.message), lead.id, userEmail]).catch(e => console.error('Error updating fail status for lead:', e));
          }
        }
        // Rate limit
        if (i < leads.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      return ok(res, {
        total: leads.length,
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      });
    } else {
      // Batch via Puppeteer
      const signature = '\n\nThis message is send by pitchers - *AI-Powered* Leads Providers and Automation Tool. *Visit now for free Trail* \n *https://pitchers.ufdevs.live*';
      const modifiedLeads = leads.map(l => ({ ...l, message: l.message + signature }));
      const result = await whatsappPuppeteer.sendBatch(userEmail, modifiedLeads, { delayMs, media });

      // ✅ Update lead statuses in DB based on per-lead results (mirrors Meta API path)
      if (result.results && Array.isArray(result.results)) {
        const updatePromises = result.results.map(async (r, idx) => {
          const lead = modifiedLeads[idx];
          if (!lead?.id) return;
          try {
            if (r.success) {
              await getDB().pool.query(
                `UPDATE business_data SET status = 'Contacted - WhatsApp', updated_at = NOW() WHERE id = $1 AND user_email = $2`,
                [lead.id, userEmail]
              );
            } else {
              await getDB().pool.query(
                `UPDATE business_data SET status = 'Failed - WhatsApp', notes = CONCAT(COALESCE(notes, ''), '\nWhatsApp Fail: ', $1::text), updated_at = NOW() WHERE id = $2 AND user_email = $3`,
                [String(r.error || 'Unknown error'), lead.id, userEmail]
              );
            }
          } catch (e) {
            console.error(`Error updating lead ${lead.id} status:`, e.message);
          }
        });
        await Promise.allSettled(updatePromises);
      }

      return ok(res, result);
    }
  } catch (error) {
    console.error('❌ Error in batch send:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp/send-template
 * Send a template message via Meta API
 */
router.post('/send-template', async (req, res) => {
  try {
    const { phoneNumber, templateName, variables = [] } = req.body;
    const userEmail = extractEmail(req);

    if (!userEmail || !phoneNumber || !templateName) {
      return fail(res, 400, 'user_email, phoneNumber, and templateName are required');
    }

    let conn;
    try {
      conn = await getWAConn().getConnectionByEmail(userEmail);
    } catch (_) { }

    if (!conn?.meta_api_token || !conn?.meta_phone_number_id) {
      return fail(res, 400, 'Meta API credentials required for template messages');
    }

    const result = await whatsappMeta.sendTemplateMessage(
      conn.meta_api_token,
      conn.meta_phone_number_id,
      phoneNumber,
      templateName,
      variables
    );

    return ok(res, result);
  } catch (error) {
    console.error('❌ Error sending template:', error);
    fail(res, 500, error.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN / UTILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/whatsapp/all-sessions
 * List all active Puppeteer sessions (admin)
 */
router.get('/all-sessions', async (req, res) => {
  try {
    const sessions = whatsappPuppeteer.getAllSessions();
    return ok(res, { count: sessions.length, sessions });
  } catch (error) {
    console.error('❌ Error getting sessions:', error);
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/v1/whatsapp/leads
 * Fetch leads with phone numbers for campaign targeting
 */
router.get('/leads', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    console.log(`📋 Fetching leads for WhatsApp campaign from ${userEmail}`);

    const query = `
      SELECT id, name, email, phone, website, company, status, created_at
      FROM leads
      WHERE user_id = (SELECT id FROM users WHERE email = $1)
        AND phone IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1000
    `;

    const result = await getDB().pool.query(query, [userEmail]);
    const leads = await getDB().getLeadsByEmail(userEmail);
    return ok(res, { count: leads.length, leads });
  } catch (error) {
    console.error('❌ Error fetching leads:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp/campaign/generate
 * Generate WhatsApp campaign text using OpenRouter
 */
router.post('/campaign/generate', async (req, res) => {
  try {
    const { context } = req.body;
    const model = process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash:free';
    const userEmail = extractEmail(req);

    if (!context) {
      return fail(res, 400, 'Context is required for generation');
    }

    const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.OPEN_AI_API_KEY;
    if (!openRouterKey || !openRouterKey.startsWith('sk-or-v1-')) {
      return fail(res, 401, 'OpenRouter API key is missing or invalid in environment');
    }

    console.log(`🤖 Generating AI Campaign via OpenRouter (${model}) for ${userEmail}`);

    // Check usage limit for AI generation and campaign count (highest tier first)
    const apiKeyQuery = `
      SELECT id, usage_count, usage_limit, whatsapp_campaign_limit FROM api_keys 
      WHERE user_email = $1 AND is_active = true 
      ORDER BY 
        CASE plan_type 
          WHEN 'enterprise' THEN 4 
          WHEN 'pro' THEN 3 
          WHEN 'basic' THEN 2 
          WHEN 'trial' THEN 1 
          WHEN 'free' THEN 0 
          ELSE -1 
        END DESC,
        created_at DESC
      LIMIT 1
    `;
    const apiKeyResult = await getDB().pool.query(apiKeyQuery, [userEmail]);
    
    if (apiKeyResult.rows.length > 0) {
      const apiKey = apiKeyResult.rows[0];
      
      // 1. Check general usage limit
      if (apiKey.usage_count >= apiKey.usage_limit) {
        return fail(res, 403, 'Monthly total usage limit reached');
      }

      // 2. Check WhatsApp campaign specific limit
      const CampaignTemplate = require('../models/CampaignTemplate');
      const templateModel = new CampaignTemplate(getDB());
      const currentCampaigns = await templateModel.countUserTemplates(userEmail, 'whatsapp');
      
      if (currentCampaigns >= apiKey.whatsapp_campaign_limit) {
        return fail(res, 403, `WhatsApp campaign limit reached (${apiKey.whatsapp_campaign_limit}). Please upgrade your plan.`);
      }

      // Increment usage for AI call
      await getDB().pool.query('UPDATE api_keys SET usage_count = usage_count + 1 WHERE id = $1', [apiKey.id]);
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ufdevs.live',
        'X-Title': 'Pitchers Automation'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are an expert sales copywriter creating brief, engaging WhatsApp outreach messages. Use emojis sparingly. Keep it under 3 sentences. IMPORTANT: You MUST use the literal variables {name} and {company} in your response instead of hardcoding real names. The system will auto-replace these variables later. Do not include any pleasantries, quotation marks, or surrounding text.' },
          { role: 'user', content: `Generate a generic WhatsApp outreach message template with the following parameters:\n${context}` }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API Error:', errorText);
      return fail(res, response.status, 'Failed to generate campaign via OpenRouter');
    }

    const data = await response.json();
    const generatedText = data.choices[0].message.content.trim();

    // Save generated campaign to DB
    try {
      const CampaignTemplate = require('../models/CampaignTemplate');
      const templateModel = new CampaignTemplate(getDB());
      const templateId = `gen_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      
      await templateModel.createTemplate({
        templateId,
        userEmail,
        templateName: `AI Campaign - ${new Date().toLocaleDateString()}`,
        channel: 'whatsapp',
        templateText: generatedText,
        isPreset: false
      });
    } catch (saveErr) {
      console.error('⚠️ Could not save generated campaign to DB:', saveErr.message);
    }

    return ok(res, { campaign: generatedText });
  } catch (error) {
    console.error('❌ Error generating campaign:', error);
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/v1/whatsapp/templates
 * Consolidated route for both Meta API and saved DB templates
 */
router.get('/templates', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    // 1. Fetch Saved Templates from DB
    let savedTemplates = [];
    try {
      const CampaignTemplate = require('../models/CampaignTemplate');
      const templateModel = new CampaignTemplate(getDB());
      savedTemplates = await templateModel.getUserTemplates(userEmail, 'whatsapp');
    } catch (dbErr) {
      console.warn('⚠️ Could not fetch saved templates:', dbErr.message);
    }

    // 2. Fetch Meta API Templates if configured
    let metaTemplates = [];
    let conn;
    try {
      conn = await getWAConn().getConnectionByEmail(userEmail);
      if (conn?.meta_api_token && conn?.meta_business_account_id) {
        metaTemplates = await whatsappMeta.getAvailableTemplates(
          conn.meta_api_token,
          conn.meta_business_account_id
        );
      }
    } catch (_) { }

    return ok(res, { 
      templates: savedTemplates, // Primary for AI campaign generator
      metaTemplates,
      message: metaTemplates.length === 0 && !conn?.meta_api_token ? 'Meta API not configured' : undefined
    });
  } catch (error) {
    console.error('❌ Error fetching templates:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp/webhook
 * Meta API webhook for delivery status updates
 */
router.post('/webhook', async (req, res) => {
  try {
    const statuses = whatsappMeta.parseWebhookData(req.body);
    console.log(`📬 Webhook received: ${statuses.length} status updates`);

    // TODO: Persist delivery statuses to campaign_executions table

    return ok(res, { received: statuses.length });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/v1/whatsapp/webhook
 * Meta API webhook verification (required by Meta)
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'pitchers_whatsapp_verify';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Forbidden');
});

/**
 * GET /api/v1/whatsapp/config
 * Get WhatsApp automation configuration (metadata)
 */
router.get('/config', async (req, res) => {
  try {
    const userEmail = req.query.email || extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    let conn;
    try {
      conn = await getWAConn().getConnectionByEmail(userEmail);
    } catch (_) { }

    return ok(res, { config: conn || { metadata: {} } });
  } catch (error) {
    console.error('❌ Config fetch error:', error);
    fail(res, 500, error.message);
  }
});



/**
 * POST /api/v1/whatsapp/config
 * Update WhatsApp automation configuration
 */
router.post('/config', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const { metadata } = req.body;
    if (!metadata) return fail(res, 400, 'metadata is required');

    const connModel = getWAConn();
    await connModel.updateMetadata(userEmail, JSON.stringify(metadata));

    return ok(res, { updated: true });
  } catch (error) {
    console.error('❌ Error updating config:', error);
    fail(res, 500, error.message);
  }
});

module.exports = router;
