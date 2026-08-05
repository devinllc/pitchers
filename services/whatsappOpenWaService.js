/**
 * WhatsApp open-wa Service (Lightweight Beta)
 * Connects to WhatsApp Web via WebSockets using the open-wa library.
 * Keeps Puppeteer headless sessions isolated.
 */

const { create, ev } = require('@open-wa/wa-automate');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');

class WhatsAppOpenWaService extends EventEmitter {
  static instance = null;

  static getInstance(options = {}) {
    if (!WhatsAppOpenWaService.instance) {
      WhatsAppOpenWaService.instance = new WhatsAppOpenWaService(options);
    }
    return WhatsAppOpenWaService.instance;
  }

  constructor(options = {}) {
    super();
    this.clients = new Map(); // userEmail -> client instance
    this.sessions = new Map(); // userEmail -> { qrCode, status, connectedPhone, etc }
    this.sessionDir = options.sessionDir || path.join(__dirname, '../.whatsapp_openwa_sessions');

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    console.log('✅ WhatsAppOpenWaService initialized');
    console.log(`📁 OpenWa Session directory: ${this.sessionDir}`);
  }

  buildClientId(userEmail) {
    const raw = String(userEmail || '').trim().toLowerCase();
    const sanitized = raw.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
    return `wa_light_${sanitized || 'user'}_${hash}`;
  }

  getSessionFolder(userEmail) {
    const clientId = this.buildClientId(userEmail);
    return path.join(this.sessionDir, `session-${clientId}`);
  }

  getChromePath() {
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '';
    if (!executablePath) {
      // Check standard search paths
      const commonPaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          executablePath = p;
          break;
        }
      }
    }

    // If still not found, search the local Puppeteer cache directory
    if (!executablePath) {
      try {
        const cacheBase = path.join(__dirname, '../.cache/puppeteer/chrome');
        if (fs.existsSync(cacheBase)) {
          const platforms = fs.readdirSync(cacheBase);
          for (const platform of platforms) {
            const platformPath = path.join(cacheBase, platform);
            if (fs.statSync(platformPath).isDirectory()) {
              const versions = fs.readdirSync(platformPath);
              for (const version of versions) {
                const exeDir = path.join(platformPath, version, 'chrome-linux64');
                const exePath = path.join(exeDir, 'chrome');
                if (fs.existsSync(exePath)) {
                  executablePath = exePath;
                  break;
                }
              }
            }
            if (executablePath) break;
          }
        }
      } catch (err) {
        console.warn('[WhatsApp-OpenWa] Error searching local puppeteer cache:', err.message);
      }
    }

    return executablePath;
  }

  /**
   * Initialize a new open-wa client connection and generate/listen for QR code
   */
  async generateQRCode(userEmail) {
    try {
      console.log(`📱 [WhatsApp-OpenWa] Generating QR for user: ${userEmail}`);
      const clientId = this.buildClientId(userEmail);

      if (this.clients.has(userEmail)) {
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
        if (state && state.status === 'initializing') {
          return {
            success: true,
            status: 'initializing',
            message: 'WhatsApp Light client is currently initializing. Please wait.'
          };
        }
      }

      // Force delete SingletonCookie, SingletonLock, and SingletonSocket before start
      const sessionFolder = this.getSessionFolder(userEmail);
      if (fs.existsSync(sessionFolder)) {
        try {
          const lockFiles = ['SingletonCookie', 'SingletonLock', 'SingletonSocket', 'lockfile'];
          for (const file of lockFiles) {
            const filePath = path.join(sessionFolder, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`🧹 [WhatsApp-OpenWa] Force deleted lock file: ${filePath}`);
            }
          }
        } catch (err) {
          console.warn(`[WhatsApp-OpenWa] Warning deleting lock files:`, err.message);
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

      // Register QR listener before calling create to prevent race conditions
      ev.on(`qr.${clientId}`, async (qrCodeData) => {
        console.log(`📸 [WhatsApp-OpenWa] QR Code received for ${userEmail}`);
        const currentSession = this.sessions.get(userEmail) || { userEmail };
        currentSession.qrCode = qrCodeData; // already base64 data URL
        currentSession.status = 'qr_generated';
        this.sessions.set(userEmail, currentSession);
        this.emit('qr', { userEmail, qrCode: qrCodeData });
      });

      // Start the client in the background (async) so it doesn't block the HTTP request
      this.initClient(userEmail).catch(err => {
        console.error(`❌ [WhatsApp-OpenWa] Async init failed for ${userEmail}:`, err.message);
        const currentSession = this.sessions.get(userEmail) || { userEmail };
        currentSession.status = 'disconnected';
        currentSession.qrCode = null;
        this.sessions.set(userEmail, currentSession);
      });

      return {
        success: true,
        status: 'initializing',
        message: 'WhatsApp Light client initializing, generating QR...'
      };
    } catch (error) {
      console.error(`❌ [WhatsApp-OpenWa] Error starting connection for ${userEmail}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Main client initializer
   */
  async initClient(userEmail) {
    const sessionFolder = this.getSessionFolder(userEmail);
    const clientId = this.buildClientId(userEmail);

    // Discover executablePath
    const executablePath = this.getChromePath();

    console.log(`🚀 [WhatsApp-OpenWa] Creating client with session folder: ${sessionFolder}`);
    if (executablePath) {
      console.log(`🔍 [WhatsApp-OpenWa] Found Chrome path: ${executablePath}`);
    } else {
      console.log(`⚠️ [WhatsApp-OpenWa] No Puppeteer Chrome path found. Falling back to useChrome: true`);
    }

    const client = await create({
      sessionId: clientId,
      headless: true,
      useChrome: executablePath ? false : true, // recommended if no manual executablePath
      qrTimeout: 0,
      authTimeout: 0,
      sessionDataPath: this.sessionDir,
      userDataDir: sessionFolder,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ...(executablePath ? { executablePath } : {}),
      chromiumArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions'
      ]
    });

    this.clients.set(userEmail, client);

    const currentSession = this.sessions.get(userEmail) || { userEmail };
    currentSession.status = 'connected';
    currentSession.qrCode = null;
    currentSession.connectedPhone = (await client.getMe())?.id?.split('@')[0] || 'unknown';
    currentSession.connectedAt = new Date();
    this.sessions.set(userEmail, currentSession);

    this.emit('connected', { userEmail, phone: currentSession.connectedPhone });

    // Handle incoming messages
    client.onMessage(async (msg) => {
      if (!msg.fromMe && msg.body) {
        const from = msg.from;
        const body = msg.body;
        console.log(`📬 [WhatsApp-OpenWa] Message from ${from}: ${body}`);
        this.emit('message', { userEmail, from, body, raw: msg });

        const normalizedMsg = {
          from,
          body,
          isStatus: from.includes('status'),
          fromMe: msg.fromMe || false,
          timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
        };

        await this._handleIncomingAutoReply(userEmail, client, normalizedMsg);
      }
    });

    // Handle disconnect events
    client.onStateChanged((state) => {
      console.log(`🔌 [WhatsApp-OpenWa] State changed for ${userEmail}: ${state}`);
      if (state === 'UNPAIRED' || state === 'CONFLICT' || state === 'UNLAUNCHED') {
        const sess = this.sessions.get(userEmail);
        if (sess) {
          sess.status = 'disconnected';
          sess.qrCode = null;
        }
        this.cleanupSession(userEmail);
      }
    });
  }

  /**
   * Get current connection status & QR image
   */
  async getQRStatus(userEmail) {
    const session = this.sessions.get(userEmail);
    if (!session) {
      const sessionFolder = this.getSessionFolder(userEmail);
      if (fs.existsSync(sessionFolder)) {
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
      const client = this.clients.get(userEmail);
      if (!client) {
        throw new Error('WhatsApp Light client not connected or initialized for this user');
      }

      let formattedPhone = String(phoneNumber).replace(/[^0-9]/g, '');
      if (!formattedPhone.endsWith('@c.us')) {
        formattedPhone = `${formattedPhone}@c.us`;
      }

      console.log(`💬 [WhatsApp-OpenWa] Sending text message to ${formattedPhone}`);
      await client.sendText(formattedPhone, message);

      return { success: true, messageId: 'openwa_msg_' + Date.now() };
    } catch (error) {
      console.error(`❌ [WhatsApp-OpenWa] Send failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reconnect existing session on boot or status check
   */
  async reconnectExisting(userEmail) {
    const sessionFolder = this.getSessionFolder(userEmail);
    if (fs.existsSync(sessionFolder)) {
      if (this.clients.has(userEmail)) return { success: true };
      
      console.log(`🔄 [WhatsApp-OpenWa] Auto-reconnecting existing session for ${userEmail}`);
      
      const sessionState = {
        userEmail,
        status: 'initializing',
        qrCode: null,
        connectedPhone: null,
        connectedAt: null,
        createdAt: new Date()
      };
      this.sessions.set(userEmail, sessionState);

      await this.initClient(userEmail);
      return { success: true };
    }
    return { success: false, error: 'No saved credentials' };
  }

  /**
   * Disconnect and wipe credentials
   */
  async disconnect(userEmail) {
    console.log(`🔌 [WhatsApp-OpenWa] Disconnecting and removing session for ${userEmail}`);
    const client = this.clients.get(userEmail);
    if (client) {
      try {
        await client.kill();
      } catch (_) {}
    }
    this.cleanupSession(userEmail);
    return { success: true };
  }

  /**
   * Cleanup local maps and file credentials
   */
  cleanupSession(userEmail) {
    this.clients.delete(userEmail);
    this.sessions.delete(userEmail);

    const folder = this.getSessionFolder(userEmail);
    if (fs.existsSync(folder)) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
        console.log(`🧹 [WhatsApp-OpenWa] Deleted session folder: ${folder}`);
      } catch (err) {
        console.error(`⚠️ [WhatsApp-OpenWa] Error deleting session folder:`, err.message);
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
        if (dir.startsWith('session-wa_light_')) {
          // Extract user email hash/pattern
          const parts = dir.replace('session-wa_light_', '').split('_');
          const hashIndex = parts.length - 1;
          const emailParts = parts.slice(0, hashIndex);
          const emailName = emailParts.join('_').replace(/_/g, '@'); // Fallback string conversion
          
          // Reconnect using directories
          console.log(`🚀 [WhatsApp-OpenWa] Auto-starting session for directory: ${dir}`);
          // Reconnect via exact userEmail mapped from database connections if possible,
          // otherwise try fallback
          const DatabaseJobManager = require('./databaseJobManager');
          const dbManager = DatabaseJobManager.getInstance();
          const WhatsAppConnection = require('../models/WhatsAppConnection');
          const waModel = new WhatsAppConnection(dbManager.databaseService);
          
          const activeConnections = await dbManager.databaseService.pool.query(
            "SELECT user_email FROM whatsapp_connections WHERE active_mode = 'light'"
          );
          
          if (activeConnections.rows.length > 0) {
            for (const row of activeConnections.rows) {
              const checkDir = this.getSessionFolder(row.user_email);
              if (checkDir.endsWith(dir)) {
                console.log(`🚀 [WhatsApp-OpenWa] Auto-starting active session found in DB: ${row.user_email}`);
                this.reconnectExisting(row.user_email).catch(() => {});
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[WhatsApp-OpenWa] Error auto-starting sessions:', error);
    }
  }

  /**
   * Safe, Anti-Ban Auto-Reply Handler
   */
  async _handleIncomingAutoReply(userEmail, client, msg) {
    if (!this.contactCooldowns) this.contactCooldowns = new Map();
    if (!this.autoReplyQueues) this.autoReplyQueues = new Map();
    if (!this.autoReplyProcessing) this.autoReplyProcessing = new Map();

    const state = this.sessions.get(userEmail);
    const msgTime = (msg.timestamp || 0) * 1000;
    const now = Date.now();

    // 1. Skip status updates, group messages, and self-sent messages
    if (msg.isStatus || msg.fromMe || (msg.from && (msg.from.endsWith('@g.us') || msg.from.includes('status')))) {
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

      // Push to queue
      if (!this.autoReplyQueues.has(userEmail)) {
        this.autoReplyQueues.set(userEmail, []);
      }
      const existingQueue = this.autoReplyQueues.get(userEmail) || [];
      const deduplicatedQueue = existingQueue.filter(item => item.msg.from !== msg.from);
      deduplicatedQueue.push({ msg, meta, cooldownKey, apiKeyId: apiKeyResult.rows[0]?.id });
      this.autoReplyQueues.set(userEmail, deduplicatedQueue);

      this._processAutoReplyQueue(userEmail, client);

    } catch (err) {
      console.error(`❌ [Auto-Reply Light] Lookup error for ${userEmail}:`, err.message);
    }
  }

  /**
   * Process Auto-Reply queue sequentially
   */
  async _processAutoReplyQueue(userEmail, client) {
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
            await client.simulateTyping(msg.from, true);
            await new Promise(r => setTimeout(r, 4000));
            await client.simulateTyping(msg.from, false);
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
              const bufferData = meta.autoReplyMedia.data;
              const filename = meta.autoReplyMedia.filename || 'attachment';
              const fileDataUri = `data:${mimeType};base64,${bufferData}`;
              
              await client.sendFile(msg.from, fileDataUri, filename, generatedReply);
            } else {
              await client.sendText(msg.from, generatedReply);
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
}

module.exports = WhatsAppOpenWaService;
