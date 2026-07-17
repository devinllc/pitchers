/**
 * Voice Call Routes — LiveKit SIP Integration
 *
 * Endpoints for creating voice calls via LiveKit's SIP trunking.
 * Generates room tokens so the browser can connect and place outbound calls.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const { AccessToken, SipClient } = require('livekit-server-sdk');

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractEmail(req) {
  return req.headers['x-user-email'] || req.body?.user_email || req.query?.user_email || null;
}

function ok(res, data) { return res.json({ success: true, ...data }); }
function fail(res, status, msg) { return res.status(status).json({ success: false, error: msg }); }

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE CALL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/voice/create-call
 * Create a LiveKit room, trigger a SIP outbound call, and return a token for the UI.
 */
router.post('/create-call', async (req, res) => {
  try {
    const userEmail = extractEmail(req);
    if (!userEmail) return fail(res, 400, 'User email required');

    const { phone, leadName, callerNumber, sipTrunkId, livekitUrl, apiKey: bodyApiKey, apiSecret: bodyApiSecret } = req.body;
    if (!phone) return fail(res, 400, 'Phone number required');

    const roomName = `call_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const identity = `caller_${userEmail.replace(/[^a-z0-9]/gi, '_')}`;

    // Priority: env vars > request body
    const apiKey = process.env.LIVEKIT_API_KEY || bodyApiKey;
    const apiSecret = process.env.LIVEKIT_API_SECRET || bodyApiSecret;
    // For REST APIs like createSipParticipant, we usually need the HTTP URL, not WSS.
    const serverUrl = livekitUrl || process.env.LIVEKIT_URL;
    const httpUrl = serverUrl ? serverUrl.replace('wss://', 'https://').replace('ws://', 'http://') : null;

    console.log(`[Voice] apiKey=${apiKey ? '✓ set' : '✗ missing'}, apiSecret=${apiSecret ? '✓ set' : '✗ missing'}, url=${serverUrl || 'not set'}`);

    if (!apiKey || !apiSecret || !serverUrl) {
      return fail(res, 400, 'LiveKit API keys and URL must be configured');
    }

    // 1. Generate token for the frontend UI to join the room
    const at = new AccessToken(apiKey, apiSecret, {
      identity: identity,
      name: userEmail,
      ttl: 600,
    });
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();

    // 2. Instruct LiveKit to dial the SIP number and bridge it into the room
    if (sipTrunkId && phone) {
      try {
        const cleanPhone = phone.replace(/[^0-9+]/g, ''); // Remove spaces and dashes
        console.log(`[Voice] Initiating SIP outbound call to ${cleanPhone} via trunk ${sipTrunkId}`);
        const sipClient = new SipClient(httpUrl, apiKey, apiSecret);
        await sipClient.createSipParticipant(sipTrunkId, cleanPhone, roomName, {
          participantIdentity: `sip_${cleanPhone.replace(/[^0-9]/g, '')}`,
          participantName: leadName || phone,
          // playRingtone: true // Optional, plays ringtone into the room while dialing
        });
        console.log(`[Voice] ✅ SIP Participant dispatched for ${cleanPhone}`);
      } catch (sipErr) {
        console.error(`[Voice] ❌ Failed to dispatch SIP participant:`, sipErr.message);
        // We log the error but still return the token so the UI can join the room and show the error via room events
      }
    } else {
      console.log(`[Voice] ⚠️ No SIP trunk ID provided, skipping outbound dial.`);
    }

    console.log(`📞 Voice call created: ${userEmail} → ${phone} (room: ${roomName})`);

    return ok(res, {
      roomName,
      token,
      livekitUrl: serverUrl,
      identity,
      phone,
      leadName,
    });
  } catch (error) {
    console.error('❌ Error creating voice call:', error);
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/v1/voice/status
 * Check voice call configuration status
 */
router.get('/status', (req, res) => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const configured = !!(apiKey && apiSecret);
  console.log(`[Voice Status] LIVEKIT_API_KEY=${apiKey ? `"${apiKey.substring(0, 4)}..."` : 'MISSING'}, LIVEKIT_API_SECRET=${apiSecret ? '✓ set' : 'MISSING'}`);
  return ok(res, {
    configured,
    livekitUrl: process.env.LIVEKIT_URL || null,
    hasSipTrunk: !!process.env.LIVEKIT_SIP_TRUNK_ID,
  });
});

module.exports = router;
