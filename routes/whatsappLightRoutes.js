/**
 * WhatsApp Light Integration Routes (Baileys-based)
 * Connects directly via WebSockets without Puppeteer/Chrome.
 */

const express = require('express');
const router = express.Router();
const WhatsAppBaileysService = require('../services/whatsappBaileysService');
const DatabaseService = require('../services/database');
const WhatsAppConnection = require('../models/WhatsAppConnection');

const whatsappLight = WhatsAppBaileysService.getInstance();

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

/**
 * GET /api/v1/whatsapp-light/status
 */
router.get('/status', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    let status = await whatsappLight.getQRStatus(userEmail);

    if (status.status === 'qr_generated' || status.qrCode) {
      return ok(res, {
        success: true,
        status: 'qr_generated',
        phoneNumber: null,
        connectedAt: null,
        activeMode: 'light',
        qrCode: status.qrCode,
      });
    }

    return ok(res, {
      success: true,
      status: status.status,
      phoneNumber: status.status === 'connected' ? status.phoneNumber : null,
      connectedAt: status.status === 'connected' ? status.connectedAt : null,
      activeMode: status.status === 'connected' ? 'light' : 'none',
      qrCode: status.qrCode || null,
    });
  } catch (error) {
    console.error('❌ Error getting status for WhatsApp Light:', error);
    fail(res, 500, error.message || 'Failed to get status');
  }
});

/**
 * GET /api/v1/whatsapp-light/connection-info
 */
router.get('/connection-info', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    let status = await whatsappLight.getQRStatus(userEmail);

    return ok(res, {
      connection: {
        activeMode: status.status === 'connected' ? 'light' : 'none',
        isActive: status.status === 'connected',
        qr: {
          enabled: status.status === 'connected',
          status: status.status,
          phone: status.phoneNumber || null,
          connectedAt: status.connectedAt || null,
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting connection info for WhatsApp Light:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp-light/generate-qr
 */
router.post('/generate-qr', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    console.log(`📱 [WhatsApp-Light] Generate QR request for ${userEmail}`);
    const result = await whatsappLight.generateQRCode(userEmail);

    if (!result.success) {
      return fail(res, 500, result.error || 'QR generation failed');
    }

    return ok(res, {
      status: result.status,
      qrCode: result.qrCode || null,
      phoneNumber: result.phoneNumber || null,
      message: result.message,
    });
  } catch (error) {
    console.error('❌ Error generating Light QR:', error);
    fail(res, 500, error.message || 'Failed to generate QR code');
  }
});

/**
 * GET /api/v1/whatsapp-light/get-qr
 */
router.get('/get-qr', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const status = await whatsappLight.getQRStatus(userEmail);

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
          ? 'QR not ready yet. Wait 3-5 seconds and retry.'
          : 'No QR available. Call /generate-qr first.',
      });
    }

    return ok(res, {
      status: 'qr_generated',
      qrCode: status.qrCode,
    });
  } catch (error) {
    console.error('❌ Error fetching Light QR:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp-light/verify-qr
 */
router.post('/verify-qr', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const status = await whatsappLight.getQRStatus(userEmail);

    if (status.status === 'connected') {
      return ok(res, {
        status: 'connected',
        phoneNumber: status.phoneNumber,
        connectedAt: status.connectedAt,
        mode: 'light',
        message: 'WhatsApp Light connected successfully!',
      });
    }

    return ok(res, {
      status: status.status,
      message: status.status === 'qr_generated'
        ? 'QR displayed. Waiting for scan...'
        : `Current status: ${status.status}`,
    });
  } catch (error) {
    console.error('❌ Error verifying Light QR:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp-light/disconnect
 */
router.post('/disconnect', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    console.log(`🔌 Disconnecting WhatsApp Light for ${userEmail}`);
    await whatsappLight.disconnect(userEmail);

    return ok(res, { message: 'WhatsApp Light disconnected successfully' });
  } catch (error) {
    console.error('❌ Error disconnecting WhatsApp Light:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp-light/send
 */
router.post('/send', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    const userEmail = extractEmail(req);

    if (!userEmail || !phoneNumber || !message) {
      return fail(res, 400, 'user_email, phoneNumber, and message are required');
    }

    console.log(`✉️ Sending Light message from ${userEmail} to ${phoneNumber}`);
    const result = await whatsappLight.sendMessage(userEmail, phoneNumber, message);

    if (result.success) {
      return ok(res, { message: 'Message sent successfully via WhatsApp Light', messageId: result.messageId });
    } else {
      return fail(res, 500, result.error || 'Failed to send message via WhatsApp Light');
    }
  } catch (error) {
    console.error('❌ Error sending message via WhatsApp Light:', error);
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/v1/whatsapp-light/config
 */
router.get('/config', async (req, res) => {
  try {
    const email = req.query.email || extractEmail(req);
    if (!email) return fail(res, 400, 'Email required');

    const conn = await getWAConn().getConnectionByEmail(email);
    let metadata = {};
    if (conn && conn.metadata) {
      try {
        metadata = typeof conn.metadata === 'string' ? JSON.parse(conn.metadata) : conn.metadata;
      } catch (_) {}
    }

    return ok(res, { config: metadata });
  } catch (error) {
    console.error('Error fetching config:', error);
    fail(res, 500, error.message);
  }
});

/**
 * POST /api/v1/whatsapp-light/config
 */
router.post('/config', async (req, res) => {
  try {
    const email = extractEmail(req);
    const { config } = req.body;

    if (!email || !config) {
      return fail(res, 400, 'email and config are required');
    }

    const conn = await getWAConn().getOrCreateConnection(email);
    let metadata = {};
    if (conn && conn.metadata) {
      try {
        metadata = typeof conn.metadata === 'string' ? JSON.parse(conn.metadata) : conn.metadata;
      } catch (_) {}
    }

    const updatedMetadata = { ...metadata, ...config };
    await getWAConn().updateConnectionMetadata(email, updatedMetadata);

    return ok(res, { message: 'Configuration saved successfully', config: updatedMetadata });
  } catch (error) {
    console.error('Error updating config:', error);
    fail(res, 500, error.message);
  }
});

module.exports = router;
