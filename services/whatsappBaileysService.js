/**
 * WhatsApp Baileys Service (Lightweight Beta)
 * Connects directly to WhatsApp Web via WebSockets without Chromium/Puppeteer.
 * Consumes 15-20MB RAM per session instead of 200MB+.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class WhatsAppBaileysService extends EventEmitter {
  static instance = null;

  static getInstance(options = {}) {
    if (!WhatsAppBaileysService.instance) {
      WhatsAppBaileysService.instance = new WhatsAppBaileysService(options);
    }
    return WhatsAppBaileysService.instance;
  }

  constructor(options = {}) {
    super();
    this.sockets = new Map(); // userEmail -> WASocket client
    this.sessions = new Map(); // userEmail -> { qrCode, status, connectedPhone, etc }
    this.sessionDir = options.sessionDir || path.join(__dirname, '../.whatsapp_light_sessions');

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    console.log('✅ WhatsAppBaileysService initialized');
    console.log(`📁 Light Session directory: ${this.sessionDir}`);
  }

  /**
   * Helper to build a clean directory path for auth state
   */
  getSessionFolder(userEmail) {
    const sanitized = String(userEmail || '').trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '_');
    return path.join(this.sessionDir, `session-${sanitized}`);
  }

  /**
   * Initialize a new Baileys socket connection and generate QR code
   */
  async generateQRCode(userEmail) {
    try {
      console.log(`📱 [WhatsApp-Light] Generating QR for user: ${userEmail}`);
      
      if (this.sockets.has(userEmail)) {
        const state = this.sessions.get(userEmail);
        if (state && state.status === 'connected') {
          return {
            success: true,
            status: 'already_connected',
            phoneNumber: state.connectedPhone,
            message: `Already connected as ${state.connectedPhone}`
          };
        }
        if (state && state.status === 'qr_generated') {
          return {
            success: true,
            status: 'qr_pending',
            qrCode: state.qrCode,
            message: 'Previous QR still valid.'
          };
        }
      }

      // Initialize session state
      const sessionState = {
        userEmail,
        status: 'initializing',
        qrCode: null,
        connectedPhone: null,
        connectedAt: null,
        createdAt: new Date()
      };
      this.sessions.set(userEmail, sessionState);

      await this.initSocket(userEmail);

      return {
        success: true,
        status: 'initializing',
        message: 'WhatsApp Light client initializing, generating QR...'
      };
    } catch (error) {
      console.error(`❌ [WhatsApp-Light] Error starting connection for ${userEmail}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Core Socket Initializer
   */
  async initSocket(userEmail) {
    const sessionFolder = this.getSessionFolder(userEmail);
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      defaultQueryTimeoutMs: undefined
    });

    this.sockets.set(userEmail, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const currentSession = this.sessions.get(userEmail) || { userEmail };

      if (qr) {
        try {
          console.log(`📸 [WhatsApp-Light] QR Code received for ${userEmail}`);
          const qrImage = await QRCode.toDataURL(qr);
          currentSession.qrCode = qrImage;
          currentSession.status = 'qr_generated';
          this.sessions.set(userEmail, currentSession);
          this.emit('qr', { userEmail, qrCode: qrImage });
        } catch (qrErr) {
          console.error('[WhatsApp-Light] Failed to convert QR string:', qrErr);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`🔌 [WhatsApp-Light] Connection closed for ${userEmail}. Reconnecting: ${shouldReconnect}`);
        
        currentSession.status = 'disconnected';
        currentSession.qrCode = null;
        this.sessions.set(userEmail, currentSession);

        if (shouldReconnect) {
          await this.initSocket(userEmail);
        } else {
          this.cleanupSession(userEmail);
        }
      } else if (connection === 'open') {
        console.log(`✅ [WhatsApp-Light] Connection opened successfully for ${userEmail}!`);
        const phone = sock.user?.id ? sock.user.id.split(':')[0] : 'unknown';
        
        currentSession.status = 'connected';
        currentSession.qrCode = null;
        currentSession.connectedPhone = phone;
        currentSession.connectedAt = new Date();
        this.sessions.set(userEmail, currentSession);

        this.emit('connected', { userEmail, phone });
      }
    });

    // Handle incoming messages for Auto-Reply / Logs (matches Puppeteer features)
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            const from = msg.key.remoteJid;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            if (body) {
              console.log(`📬 [WhatsApp-Light] Message from ${from}: ${body}`);
              this.emit('message', { userEmail, from, body, raw: msg });

              // Map baileys msg to the normalized structure used by our auto-reply handler
              const normalizedMsg = {
                from,
                body,
                isStatus: from.includes('status@broadcast'),
                fromMe: msg.key.fromMe || false,
                timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000)
              };

              await this._handleIncomingAutoReply(userEmail, sock, normalizedMsg);
            }
          }
        }
      }
    });
  }

  /**
   * Safe, Anti-Ban Auto-Reply Handler for Baileys
   */
  async _handleIncomingAutoReply(userEmail, sock, msg) {
    if (!this.contactCooldowns) this.contactCooldowns = new Map();
    if (!this.autoReplyQueues) this.autoReplyQueues = new Map();
    if (!this.autoReplyProcessing) this.autoReplyProcessing = new Map();

    const state = this.sessions.get(userEmail);
    const msgTime = (msg.timestamp || 0) * 1000;
    const now = Date.now();

    // 1. Skip status updates, group messages, and self-sent messages
    if (msg.isStatus || msg.fromMe || (msg.from && (msg.from.endsWith('@g.us') || msg.from.includes('status@broadcast')))) {
      return;
    }

    // 2. Skip startup grace period (30s after client connection)
    if (state?.connectedAt && (now - state.connectedAt.getTime() < 30000)) {
      console.log(`⏳ [Auto-Reply Light] Skipping message during 30s startup grace period for ${userEmail}`);
      return;
    }

    // 3. Skip historical/cached messages older than 2 minutes before connection
    if (state?.connectedAt && msgTime > 0 && msgTime < (state.connectedAt.getTime() - 120000)) {
      console.log(`⏳ [Auto-Reply Light] Skipping historical message from ${msg.from} timestamp ${new Date(msgTime).toISOString()}`);
      return;
    }

    console.log(`📬 [Auto-Reply Light] Message received from ${msg.from} for ${userEmail}: "${(msg.body || '').substring(0, 50)}..."`);
    this.emit(`message:${userEmail}`, msg);

    // 4. Enforce randomized 1-3 minute per-contact cooldown
    const cooldownKey = `${userEmail}:${msg.from}`;
    const lastRepliedObj = this.contactCooldowns.get(cooldownKey);
    const lastReplied = typeof lastRepliedObj === 'object' ? lastRepliedObj.time : (lastRepliedObj || 0);
    const contactCooldownMs = typeof lastRepliedObj === 'object' ? lastRepliedObj.duration : 60000;

    if (now - lastReplied < contactCooldownMs) {
      const remainingSec = Math.ceil((contactCooldownMs - (now - lastReplied)) / 1000);
      console.log(`⏳ [Auto-Reply Light] Skipping ${msg.from} for ${userEmail}: Cooldown active (${remainingSec}s remaining)`);
      return;
    }

    // 5. Fetch user auto-reply configuration
    try {
      const DatabaseJobManager = require('./databaseJobManager');
      const dbManager = DatabaseJobManager.getInstance();
      const WhatsAppConnection = require('../models/WhatsAppConnection');
      const waModel = new WhatsAppConnection(dbManager.databaseService);

      const conn = await waModel.getConnectionByEmail(userEmail);
      let meta = {};
      try {
        meta = typeof conn?.metadata === 'string' ? JSON.parse(conn.metadata) : (conn?.metadata || {});
      } catch (e) { meta = {}; }

      const isEnabled = meta.autoReplyEnabled === true || meta.autoReplyEnabled === 'true' || meta.autoReplyEnabled === '1';
      if (!isEnabled || !meta.autoReplyPrompt) {
        console.log(`ℹ️ [Auto-Reply Light] Skipping ${userEmail}: Auto-reply not enabled or empty prompt`);
        return;
      }

      // Check plan limits
      const apiKeyQuery = `
        SELECT id, auto_reply_limit FROM api_keys 
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
      const apiKeyResult = await dbManager.databaseService.pool.query(apiKeyQuery, [userEmail]);
      if (apiKeyResult.rows.length > 0 && apiKeyResult.rows[0].auto_reply_limit <= 0) {
        console.log(`🚫 [Auto-Reply Light] Limit reached for ${userEmail}`);
        return;
      }

      // Push to user queue (deduplicate: keep latest message from same sender)
      if (!this.autoReplyQueues.has(userEmail)) {
        this.autoReplyQueues.set(userEmail, []);
      }
      const existingQueue = this.autoReplyQueues.get(userEmail) || [];
      const deduplicatedQueue = existingQueue.filter(item => item.msg.from !== msg.from);
      deduplicatedQueue.push({ msg, meta, cooldownKey, apiKeyId: apiKeyResult.rows[0]?.id });
      this.autoReplyQueues.set(userEmail, deduplicatedQueue);

      // Trigger queue worker
      this._processAutoReplyQueue(userEmail, sock);

    } catch (err) {
      console.error(`❌ [Auto-Reply Light] Lookup error for ${userEmail}:`, err.message);
    }
  }

  /**
   * Process Auto-Reply queue sequentially for Baileys
   */
  async _processAutoReplyQueue(userEmail, sock) {
    if (this.autoReplyProcessing.get(userEmail)) return;
    this.autoReplyProcessing.set(userEmail, true);

    try {
      const queue = this.autoReplyQueues.get(userEmail) || [];

      while (queue.length > 0) {
        const item = queue.shift();
        const { msg, meta, cooldownKey, apiKeyId } = item;

        try {
          // Re-verify cooldown
          const lastRepliedObj = this.contactCooldowns.get(cooldownKey);
          const lastReplied = typeof lastRepliedObj === 'object' ? lastRepliedObj.time : (lastRepliedObj || 0);
          const contactCooldownMs = typeof lastRepliedObj === 'object' ? lastRepliedObj.duration : 60000;
          if (Date.now() - lastReplied < contactCooldownMs) {
            console.log(`⏳ [Auto-Reply Light Queue] Skipping ${msg.from}: Cooldown active`);
            continue;
          }

          // Random human typing delay: 15 to 45 seconds
          const humanDelay = 15000 + Math.floor(Math.random() * 30000);
          console.log(`⏳ [Auto-Reply Light Queue] Simulating human reading & typing delay (${Math.round(humanDelay / 1000)}s) before replying to ${msg.from}...`);
          await new Promise(r => setTimeout(r, humanDelay));

          // Simulate WhatsApp typing indicator
          try {
            await sock.sendPresenceUpdate('composing', msg.from);
            await new Promise(r => setTimeout(r, 4000));
            await sock.sendPresenceUpdate('paused', msg.from);
          } catch (_) {}

          const axios = require('axios');
          const openRouterKey = process.env.OPENROUTER_API_KEY;
          const modelName = process.env.OPENROUTER_MODEL || process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'openrouter/free';

          if (!openRouterKey) {
            console.log('❌ [Auto-Reply Light] skipped: No OPENROUTER_API_KEY');
            continue;
          }

          const systemPrompt = `You are a friendly, smart, and helpful human representative/assistant.
Tone & Style:
- Sound like a warm, supportive human colleague typing a real WhatsApp message.
- Do NOT sound like an AI, generic bot, or computer program (never say "As an AI...", "Here is the requested info:", "How can I assist you?").
- Be conversational, natural, and helpful. Use quick, friendly greetings and warm transitions.
- Format for WhatsApp: bold key words using *asterisks* where helpful.
- Keep response concise, neat, and relevant (1-3 short paragraphs).

Business Instructions & Context:
${meta.autoReplyPrompt}

Incoming Message from Contact: "${msg.body}"

Respond to the message warmly and contextually. Do NOT include any promotional link signatures or bot disclaimers.`;

          let generatedReply = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: modelName,
                messages: [{ role: 'user', content: systemPrompt }]
              }, {
                headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
                timeout: 15000
              });
              if (response.data?.choices?.[0]?.message?.content) {
                generatedReply = response.data.choices[0].message.content.trim();
                break;
              }
            } catch (err) {
              if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
            }
          }

          if (generatedReply) {
            if (meta.autoReplyMedia && meta.autoReplyMedia.data) {
              const mimeType = meta.autoReplyMedia.mimeType || 'application/pdf';
              const buffer = Buffer.from(meta.autoReplyMedia.data, 'base64');
              const filename = meta.autoReplyMedia.filename || 'attachment';
              
              if (mimeType.startsWith('image/')) {
                await sock.sendMessage(msg.from, { 
                  image: buffer, 
                  caption: generatedReply 
                });
              } else {
                await sock.sendMessage(msg.from, { 
                  document: buffer, 
                  mimetype: mimeType, 
                  fileName: filename, 
                  caption: generatedReply 
                });
              }
            } else {
              await sock.sendMessage(msg.from, { text: generatedReply });
            }

            // Update cooldown map with fresh random 1-3 minute window
            const nextCooldownMs = 60000 + Math.floor(Math.random() * 120000);
            this.contactCooldowns.set(cooldownKey, { time: Date.now(), duration: nextCooldownMs });

            // Decrement user plan limit
            if (apiKeyId) {
              try {
                const DatabaseJobManager = require('./databaseJobManager');
                const dbManager = DatabaseJobManager.getInstance();
                await dbManager.databaseService.pool.query('UPDATE api_keys SET auto_reply_limit = auto_reply_limit - 1 WHERE id = $1', [apiKeyId]);
              } catch (_) {}
            }

            console.log(`✅ [Auto-Reply Light Safe] Successfully sent human-like reply to ${msg.from}`);
          }
        } catch (err) {
          console.error(`❌ [Auto-Reply Light Queue] Error processing item for ${userEmail}:`, err.message);
        }
      }
    } finally {
      this.autoReplyProcessing.set(userEmail, false);
    }
  }

  /**
   * Get current connection status & QR image
   */
  async getQRStatus(userEmail) {
    const session = this.sessions.get(userEmail);
    if (!session) {
      // If folder exists, try reconnecting
      const sessionFolder = this.getSessionFolder(userEmail);
      if (fs.existsSync(sessionFolder) && fs.existsSync(path.join(sessionFolder, 'creds.json'))) {
        this.reconnectExisting(userEmail).catch(() => {});
        return { status: 'initializing', qrCode: null };
      }
      return { status: 'disconnected', qrCode: null };
    }
    return {
      status: session.status,
      qrCode: session.qrCode,
      phoneNumber: session.connectedPhone,
      connectedAt: session.connectedAt
    };
  }

  /**
   * Send a WhatsApp message
   */
  async sendMessage(userEmail, phoneNumber, message) {
    try {
      const sock = this.sockets.get(userEmail);
      if (!sock) {
        throw new Error('WhatsApp Light client not connected or initialized for this user');
      }

      // Format phone number to WhatsApp JID format
      let formattedPhone = String(phoneNumber).replace(/[^0-9]/g, '');
      if (!formattedPhone.endsWith('@s.whatsapp.net')) {
        formattedPhone = `${formattedPhone}@s.whatsapp.net`;
      }

      console.log(`💬 [WhatsApp-Light] Sending to ${formattedPhone}...`);
      await sock.sendMessage(formattedPhone, { text: message });

      return { success: true, messageId: 'light_msg_' + Date.now() };
    } catch (error) {
      console.error(`❌ [WhatsApp-Light] Send failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reconnect existing session on boot or status check
   */
  async reconnectExisting(userEmail) {
    const sessionFolder = this.getSessionFolder(userEmail);
    if (fs.existsSync(sessionFolder) && fs.existsSync(path.join(sessionFolder, 'creds.json'))) {
      if (this.sockets.has(userEmail)) return { success: true };
      
      console.log(`🔄 [WhatsApp-Light] Auto-reconnecting existing session for ${userEmail}`);
      
      const sessionState = {
        userEmail,
        status: 'initializing',
        qrCode: null,
        connectedPhone: null,
        connectedAt: null,
        createdAt: new Date()
      };
      this.sessions.set(userEmail, sessionState);

      await this.initSocket(userEmail);
      return { success: true };
    }
    return { success: false, error: 'No saved credentials' };
  }

  /**
   * Disconnect and wipe credentials
   */
  async disconnect(userEmail) {
    console.log(`🔌 [WhatsApp-Light] Disconnecting and removing session for ${userEmail}`);
    const sock = this.sockets.get(userEmail);
    if (sock) {
      try {
        await sock.logout();
      } catch (_) {}
      try {
        sock.end();
      } catch (_) {}
    }
    this.cleanupSession(userEmail);
    return { success: true };
  }

  /**
   * Cleanup local maps and file credentials
   */
  cleanupSession(userEmail) {
    this.sockets.delete(userEmail);
    this.sessions.delete(userEmail);

    const folder = this.getSessionFolder(userEmail);
    if (fs.existsSync(folder)) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
        console.log(`🧹 [WhatsApp-Light] Deleted session folder: ${folder}`);
      } catch (err) {
        console.error(`⚠️ [WhatsApp-Light] Error deleting session folder:`, err.message);
      }
    }
  }

  /**
   * Auto start all sessions found on disk
   */
  async autoStartSessions() {
    try {
      if (!fs.existsSync(this.sessionDir)) return;
      const dirs = fs.readdirSync(this.sessionDir);
      for (const dir of dirs) {
        if (dir.startsWith('session-')) {
          const userEmail = dir.replace('session-', '').replace(/_/g, '@'); // Simple fallback extraction
          const credsFile = path.join(this.sessionDir, dir, 'creds.json');
          if (fs.existsSync(credsFile)) {
            console.log(`🚀 [WhatsApp-Light] Auto-starting session for: ${userEmail}`);
            this.reconnectExisting(userEmail).catch(err => {
              console.error(`Failed to auto-start session for ${userEmail}:`, err.message);
            });
          }
        }
      }
    } catch (error) {
      console.error('[WhatsApp-Light] Error auto-starting sessions:', error);
    }
  }
}

module.exports = WhatsAppBaileysService;
