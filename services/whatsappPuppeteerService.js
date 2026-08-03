/**
 * WhatsApp Puppeteer Service
 * Real WhatsApp Web automation using whatsapp-web.js and Puppeteer
 * Generates actual QR codes for device pairing, manages sessions, sends messages
 *
 * Similar architecture to GoogleMapsWebService - uses Puppeteer for browser automation
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');

class WhatsAppPuppeteerService extends EventEmitter {
  static instance = null;

  static getInstance(options = {}) {
    if (!WhatsAppPuppeteerService.instance) {
      WhatsAppPuppeteerService.instance = new WhatsAppPuppeteerService(options);
    }
    return WhatsAppPuppeteerService.instance;
  }

  constructor(options = {}) {
    super();
    this.clients = new Map(); // Map of userEmail -> Client instance
    this.sessions = new Map(); // Map of userEmail -> { qrCode, status, connectedPhone, etc }
    this.sessionDir = options.sessionDir || path.join(__dirname, '../.whatsapp_sessions');
    this.messageQueue = new Map(); // Queue pending messages per user

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    console.log('✅ WhatsAppPuppeteerService initialized');
    console.log(`📁 Session directory: ${this.sessionDir}`);
  }

  /**
   * Build a whatsapp-web.js compatible LocalAuth clientId.
   * Allowed chars are [A-Za-z0-9_-], so we sanitize and append a short hash
   * to keep IDs stable and avoid collisions across similar emails.
   */
  buildClientId(userEmail) {
    const raw = String(userEmail || '').trim().toLowerCase();
    const sanitized = raw.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
    return `wa_${sanitized || 'user'}_${hash}`;
  }

  /**
   * Initialize WhatsApp client and generate QR code for user
   * @param {string} userEmail - User email (used as unique session ID)
   * @returns {Promise<Object>} QR code data and session info
   */
  async generateQRCode(userEmail) {
    try {
      console.log(`📱 Generating QR for user: ${userEmail}`);
      const clientId = this.buildClientId(userEmail);

      // Check if client already exists
      if (this.clients.has(userEmail)) {
        const client = this.clients.get(userEmail);
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
            expiresIn: 120000,
            message: 'Previous QR still valid. Scan with WhatsApp to connect.'
          };
        }

        if (state && state.status === 'initializing') {
          return {
            success: true,
            status: 'initializing',
            message: 'WhatsApp client is currently initializing. Please wait.'
          };
        }
      }

      // Terminate any zombie processes and clear stale lock files to prevent "browser already running" error
      const sessionFolder = path.join(this.sessionDir, `session-${clientId}`);
      if (fs.existsSync(sessionFolder)) {
        await this.killZombieChromiumProcesses(sessionFolder, userEmail);
      }

      // Production headless mode — no GUI Chromium window
      const isHeadless = true;

      const headlessArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ];

      const headedArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--start-maximized'
      ];

      let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '';
      if (!executablePath) {
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

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId,
          dataPath: this.sessionDir
        }),
        puppeteer: {
          headless: isHeadless,
          args: isHeadless ? headlessArgs : headedArgs,
          ...(executablePath ? { executablePath } : {})
        }
      });

      // Store client
      this.clients.set(userEmail, client);

      // Initialize session state
      const sessionState = {
        userEmail,
        status: 'initializing',
        qrCode: null,
        connectedPhone: null,
        connectedAt: null,
        createdAt: new Date(),
        messageCount: 0
      };
      this.sessions.set(userEmail, sessionState);

      // Listen for QR code
      client.on('qr', async (qr) => {
        try {
          console.log(`\n📸 QR Code received for ${userEmail}`);
          const state = this.sessions.get(userEmail);

          // Convert QR string to base64 image
          const qrImage = await QRCode.toDataURL(qr);

          state.qrCode = qrImage;
          state.status = 'qr_generated';
          state.qrExpiresAt = Date.now() + 120000; // 2 minutes

          console.log(`✅ QR ready for ${userEmail}`);

          // Emit event for API handlers
          this.emit(`qr:${userEmail}`, qrImage);
        } catch (error) {
          console.error(`❌ Error converting QR to image: ${error.message}`);
        }
      });

      // Listen for client ready (device connected)
      client.on('ready', async () => {
        try {
          const info = await client.getWWebVersion();
          let phoneNumber = null;
          if (client.info) {
            phoneNumber = client.info.wid?.user || 
                          client.info.user?.id || 
                          client.info.me?.user || 
                          (client.info.wid?._serialized ? client.info.wid._serialized.split('@')[0] : null);
          }

          const state = this.sessions.get(userEmail);
          state.status = 'connected';
          state.connectedPhone = phoneNumber;
          state.connectedAt = new Date();
          state.qrCode = null; // Clear QR after connection

          console.log(`✅ WhatsApp connected for ${userEmail}: ${phoneNumber}`);
          console.log(`   Client version: ${info}`);

          // Automatically persist to DB
          try {
            const DatabaseJobManager = require('./databaseJobManager');
            const dbManager = DatabaseJobManager.getInstance();
            const WhatsAppConnection = require('../models/WhatsAppConnection');
            const waModel = new WhatsAppConnection(dbManager.databaseService);

            await waModel.getOrCreateConnection(userEmail);
            await waModel.updateQRConnection(userEmail, {
              sessionToken: 'puppeteer_session',
              connectedPhone: phoneNumber,
              connectedAt: state.connectedAt
            });
            console.log(`💾 Persisted active WhatsApp connection to DB for ${userEmail}`);
          } catch (dbErr) {
            console.warn(`⚠️ Could not persist QR connection to DB for ${userEmail}:`, dbErr.message);
          }

          this.emit(`connected:${userEmail}`, {
            phoneNumber,
            version: info,
            connectedAt: state.connectedAt
          });
        } catch (error) {
          console.error(`❌ Error getting client info: ${error.message}`);
        }
      });

      // Listen for auth failure
      client.on('auth_failure', (msg) => {
        console.error(`❌ Auth failure for ${userEmail}: ${msg}`);
        const state = this.sessions.get(userEmail);
        state.status = 'auth_failed';
        state.error = msg;

        this.emit(`auth_failed:${userEmail}`, msg);
      });

      // Listen for disconnection
      client.on('disconnected', (reason) => {
        console.log(`⚠️  WhatsApp disconnected for ${userEmail}: ${reason}`);
        const state = this.sessions.get(userEmail);
        state.status = 'disconnected';

        // Clean up client
        this.clients.delete(userEmail);

        this.emit(`disconnected:${userEmail}`, reason);
      });

      // Listen for incoming messages (Auto Reply Feature)
      client.on('message_create', async (msg) => {
        this._handleIncomingAutoReply(userEmail, client, msg).catch(err => {
          console.error(`❌ Error in Auto-Reply handler for ${userEmail}:`, err.message);
        });
      });

      // Initialize client (triggers QR generation) — fire-and-forget
      // Do NOT await this — it blocks until full init or QR scan.
      // The 'qr' and 'ready' events above update session state asynchronously.
      client.initialize().catch((err) => {
        console.error(`❌ Client init error for ${userEmail}: ${err.message}`);
        const state = this.sessions.get(userEmail);
        if (state) {
          state.status = 'error';
          state.error = err.message;
        }
        this.clients.delete(userEmail);
      });

      return {
        success: true,
        status: 'initializing',
        message: 'WhatsApp client initializing. QR code will be ready in ~10-20 seconds. Poll /get-qr for the QR image.',
        expiresIn: 120000
      };
    } catch (error) {
      console.error(`❌ Error generating QR: ${error.message}`);
      throw {
        success: false,
        error: error.message,
        statusCode: 500
      };
    }
  }

  /**
   * Get current QR code or session status for user
   * @param {string} userEmail - User email
   * @returns {Object} Current status and QR if available
   */
  async getQRStatus(userEmail) {
    try {
      // STRICT per-user isolation — only return this user's own session
      const state = this.sessions.get(userEmail);

      if (!state) {
        return {
          success: true,
          status: 'not_initialized',
          message: 'No session found. Call generateQRCode first.'
        };
      }

      // Check if QR has expired
      if (state.qrExpiresAt && Date.now() > state.qrExpiresAt) {
        state.status = 'qr_expired';
        state.qrCode = null;
      }

      return {
        success: true,
        status: state.status,
        qrCode: state.qrCode,
        phoneNumber: state.connectedPhone,
        connectedAt: state.connectedAt,
        expiresIn: state.qrExpiresAt ? state.qrExpiresAt - Date.now() : null
      };
    } catch (error) {
      console.error(`❌ Error getting QR status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send message to a single phone number
   * @param {string} userEmail - User email (device owner)
   * @param {string} phoneNumber - Recipient phone (E.164 format: +1234567890)
   * @param {string} message - Message text
   * @param {Object} options - { media: { data, mimeType, filename } }
   * @returns {Promise<Object>} Send result
   */
  async sendMessage(userEmail, phoneNumber, message, options = {}) {
    try {
      // STRICT per-user isolation — only use this user's own client
      const client = this.clients.get(userEmail);
      const state = this.sessions.get(userEmail);

      if (!client || state?.status !== 'connected') {
        throw new Error(
          `WhatsApp not connected for ${userEmail}. Status: ${state?.status || 'unknown'}`
        );
      }

      console.log(`💬 Sending message from ${userEmail} to ${phoneNumber} (Media: ${!!options.media})`);

      // Normalize phone to WhatsApp chatId format (E.164 digits + @c.us)
      // Steps:
      //  1. Strip everything except digits and leading '+'
      //  2. Remove any leading '+' for digit-only processing
      //  3. Remove leading zeros
      //  4. If the result has ≤ 10 digits it is missing a country code — the
      //     caller should have already prepended one, but as a safety-net we
      //     log a warning so it is easy to spot in logs.
      let digits = phoneNumber.replace(/[^0-9+]/g, '').replace(/^\+/, '');
      while (digits.startsWith('0')) digits = digits.substring(1);

      if (digits.length <= 10) {
        console.warn(`⚠️  [sendMessage] Phone '${phoneNumber}' has only ${digits.length} digits — country code may be missing. Sending as-is.`);
      }

      const whatsappChatId = `${digits}@c.us`;

      // Check if number is registered on WhatsApp (swallow errors if the internal check fails due to WhatsApp updates)
      let isRegistered = true;
      try {
        isRegistered = await client.isRegisteredUser(whatsappChatId);
      } catch (regErr) {
        console.warn(`⚠️ Warning: isRegisteredUser failed for ${whatsappChatId} (${regErr.message}). Attempting to send anyway.`);
      }

      if (!isRegistered) {
        throw new Error('Number is not registered on WhatsApp');
      }

      // Send message (handle media if present)
      let response;
      if (options.media && options.media.data) {
        const media = new MessageMedia(
          options.media.mimeType || 'application/pdf',
          options.media.data,
          options.media.filename || 'attachment'
        );
        response = await client.sendMessage(whatsappChatId, media, { caption: message });
      } else {
        response = await client.sendMessage(whatsappChatId, message);
      }

      // Increment counter
      state.messageCount = (state.messageCount || 0) + 1;

      console.log(`✅ Message sent to ${phoneNumber}: ${response?.id?.id || 'unknown'}`);

      return {
        success: true,
        messageId: response?.id?.id || 'unknown',
        phoneNumber,
        status: 'sent',
        timestamp: new Date()
      };
    } catch (error) {
      const errorMsg = error.message || error;
      console.error(`❌ Error sending message: ${errorMsg}`);
      throw {
        success: false,
        error: errorMsg,
        phoneNumber,
        statusCode: 500
      };
    }
  }

  /**
   * Send messages to multiple leads in batch
   * Anti-ban: enforces randomized 15–45s delay, periodic cooldowns, and message personalization
   * @param {string} userEmail - User email
   * @param {Array} leads - Array of { phone, name, message, id }
   * @param {Object} options - { delayMs: number (ignored if below floor), skipErrors: true, media }
   * @returns {Promise<Object>} Results array
   */
  async sendBatch(userEmail, leads, options = {}) {
    try {
      const { skipErrors = true, media } = options;
      const results = [];
      const DatabaseJobManager = require('./databaseJobManager');
      const db = DatabaseJobManager.getInstance().databaseService;

      // ── Anti-ban constants ─────────────────────────────────────────────────
      // WhatsApp bans accounts that send too fast. Minimum safe delay is 15s.
      const MIN_DELAY_MS  = 15000;  // 15 seconds minimum
      const MAX_DELAY_MS  = 45000;  // 45 seconds maximum (random pick each time)
      const BATCH_PAUSE_EVERY = 25; // pause for 2 min after every 25 messages
      const BATCH_PAUSE_MS    = 120000; // 2 minutes cooldown

      // Randomized delay in [MIN, MAX] range — looks human, avoids bot fingerprinting
      const getHumanDelay = () =>
        Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;

      // Friendly name greetings to personalise each message and avoid identical content
      const greetings = ['Hey', 'Hi', 'Hello', 'Hey there', 'Hi there'];
      const randomGreeting = () => greetings[Math.floor(Math.random() * greetings.length)];

      console.log(`📤 Anti-ban batch: ${leads.length} leads from ${userEmail} | delay ${MIN_DELAY_MS/1000}–${MAX_DELAY_MS/1000}s`);

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        try {
          const activeMedia = lead.media || media;

          // Personalise the message with the lead's name to break identical-content patterns
          let personalizedMessage = lead.message;
          if (lead.name && lead.name.trim()) {
            const firstName = lead.name.trim().split(' ')[0];
            personalizedMessage = `${randomGreeting()} *${firstName}!* 👋\n\n${lead.message}`;
          }

          const result = await this.sendMessage(userEmail, lead.phone, personalizedMessage, { media: activeMedia });
          results.push(result);

          // Update status in business_data if lead has an ID
          if (lead.id) {
            const query = `UPDATE business_data SET status = 'Contacted - WhatsApp', updated_at = NOW() WHERE id = $1 AND user_email = $2`;
            await db.pool.query(query, [lead.id, userEmail]).catch(e => console.error('Error updating status for lead:', e));
          }

          // Periodic long cooldown every BATCH_PAUSE_EVERY messages
          if ((i + 1) % BATCH_PAUSE_EVERY === 0 && i < leads.length - 1) {
            console.log(`⏸️  [Anti-ban] Sent ${i + 1} messages — cooling down for ${BATCH_PAUSE_MS / 60000} min to avoid rate limits...`);
            await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
          } else if (i < leads.length - 1) {
            // Standard randomized human-like delay between each message
            const humanDelay = getHumanDelay();
            console.log(`⏳ [Anti-ban] Waiting ${(humanDelay / 1000).toFixed(1)}s before next message...`);
            await new Promise(resolve => setTimeout(resolve, humanDelay));
          }

        } catch (error) {
          const errorMsg = error.error || error.message || error;
          console.error(`❌ Failed to send to ${lead.phone}: ${errorMsg}`);
          
          if (lead.id) {
            const query = `UPDATE business_data SET status = 'Failed - WhatsApp', notes = CONCAT(COALESCE(notes, ''), '\nWhatsApp Fail: ', $1::text), updated_at = NOW() WHERE id = $2 AND user_email = $3`;
            await db.pool.query(query, [String(errorMsg), lead.id, userEmail]).catch(e => console.error('Error updating fail status for lead:', e));
          }

          if (skipErrors) {
            results.push({
              success: false,
              phoneNumber: lead.phone,
              error: errorMsg
            });
          } else {
            throw error;
          }
        }
      }

      console.log(`✅ Batch complete: ${results.filter(r => r.success).length}/${leads.length} sent`);

      return {
        success: true,
        total: leads.length,
        sent: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };
    } catch (error) {
      console.error(`❌ Error in batch send: ${error.message}`);
      throw error;
    }
  }

  /**
   * Disconnect and clean up client
   * @param {string} userEmail - User email
   */
  async disconnect(userEmail) {
    try {
      const client = this.clients.get(userEmail);
      const clientId = this.buildClientId(userEmail);
      const fs = require('fs');
      const path = require('path');

      if (client) {
        try {
          await client.logout();
        } catch (e) {
          console.log(`[WhatsApp] logout skipped: ${e.message}`);
        }
        await client.destroy();
        this.clients.delete(userEmail);
      }

      const state = this.sessions.get(userEmail);
      if (state) {
        state.status = 'disconnected';
        state.qrCode = null;
      }
      this.sessions.delete(userEmail);

      const sessionFolder = path.join(this.sessionDir, `session-${clientId}`);
      if (fs.existsSync(sessionFolder)) {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
        console.log(`🗑️ Deleted session folder for ${userEmail}`);
      }

      console.log(`✅ WhatsApp fully disconnected for ${userEmail}`);
    } catch (error) {
      console.error(`❌ Error disconnecting: ${error.message}`);
    }
  }

  /**
   * Stop the client's Puppeteer browser without deleting its session folder on disk
   * @param {string} userEmail - User email
   */
  async shutdownClientOnly(userEmail) {
    try {
      const client = this.clients.get(userEmail);
      if (client) {
        try {
          await client.destroy();
        } catch (e) {
          console.log(`[WhatsApp] destroy skipped during shutdown: ${e.message}`);
        }
        this.clients.delete(userEmail);
      }
      const state = this.sessions.get(userEmail);
      if (state) {
        state.status = 'disconnected';
      }
      console.log(`✅ WhatsApp client shut down (session folder preserved) for ${userEmail}`);
    } catch (error) {
      console.error(`❌ Error shutting down client: ${error.message}`);
    }
  }

  /**
   * Reconnect to existing session from disk
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Connection status
   */
  async reconnectExisting(userEmail) {
    try {
      const fs = require('fs');
      const path = require('path');
      const clientId = this.buildClientId(userEmail);
      const sessionPath = path.join(this.sessionDir, `session-${clientId}`);

      if (!fs.existsSync(sessionPath)) {
        return {
          success: false,
          status: 'no_session_found',
          message: 'No saved session. Generate new QR code.'
        };
      }

      console.log(`🔄 Reconnecting to existing session for ${userEmail}`);

      // This will load from disk and reconnect
      await this.generateQRCode(userEmail);

      return {
        success: true,
        status: 'connected',
        message: 'Attempting to restore session...'
      };
    } catch (error) {
      console.error(`❌ Error reconnecting: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all active sessions
   * @returns {Array} Active session info
   */
  getAllSessions() {
    const sessions = [];
    for (const [userEmail, state] of this.sessions) {
      sessions.push({
        userEmail,
        status: state.status,
        phoneNumber: state.connectedPhone,
        connectedAt: state.connectedAt,
        messageCount: state.messageCount,
        createdAt: state.createdAt
      });
    }
    return sessions;
  }

  /**
   * Initialize all active sessions from the DB at startup
   */
  async initializeAllActiveSessions() {
    try {
      console.log(`[WhatsApp] Booting up active background sessions...`);
      const DatabaseJobManager = require('./databaseJobManager');
      const dbManager = DatabaseJobManager.getInstance();
      const WhatsAppConnection = require('../models/WhatsAppConnection');
      const waModel = new WhatsAppConnection(dbManager.databaseService);

      const activeConnections = await waModel.getAllActiveConnections();

      for (const conn of activeConnections) {
        if (conn.user_email) {
          console.log(`[WhatsApp] Auto-starting background session for ${conn.user_email}`);
          // Reconnect without waiting for it to finish so we don't block startup
          this.reconnectExisting(conn.user_email).catch(e => {
            console.error(`[WhatsApp] Failed to auto-start session for ${conn.user_email}:`, e.message);
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error initializing active sessions: ${error.message}`);
    }
  }

  /**
   * Clean up old/inactive sessions
   * @param {number} maxAgeMs - Max age in ms (default: 24 hours)
   */
  async cleanupOldSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
    try {
      const now = Date.now();
      const toDelete = [];

      for (const [userEmail, state] of this.sessions) {
        const age = now - state.createdAt.getTime();
        if (age > maxAgeMs && state.status !== 'connected') {
          toDelete.push(userEmail);
        }
      }

      for (const userEmail of toDelete) {
        await this.disconnect(userEmail);
        this.sessions.delete(userEmail);
        console.log(`🗑️  Cleaned up old session for ${userEmail}`);
      }

      console.log(`✅ Cleanup complete: ${toDelete.length} sessions removed`);
    } catch (error) {
      console.error(`❌ Error cleaning up sessions: ${error.message}`);
    }
  }

  /**
   * Safe check and termination of any zombie Chromium processes holding a lock on this session directory
   * @param {string} sessionFolder - Absolute path to the session directory
   * @param {string} userEmail - User's email address
   */
  async killZombieChromiumProcesses(sessionFolder, userEmail) {
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    const lockPath = path.join(sessionFolder, 'SingletonLock');
    const defaultLockPath = path.join(sessionFolder, 'Default', 'SingletonLock');

    // 1. Try to read PID from symlinks and kill directly
    const lockFiles = [lockPath, defaultLockPath];
    for (const file of lockFiles) {
      if (fs.existsSync(file)) {
        try {
          const stats = fs.lstatSync(file);
          if (stats.isSymbolicLink()) {
            const linkTarget = fs.readlinkSync(file);
            // Chromium SingletonLock symlink target is host-pid
            const parts = linkTarget.split('-');
            const pid = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(pid) && pid > 0) {
              console.log(`💀 Found process ${pid} from lock file ${path.basename(file)} for ${userEmail}. Killing...`);
              try {
                process.kill(pid, 'SIGKILL');
                console.log(`✅ Successfully killed process ${pid}`);
              } catch (killErr) {
                if (killErr.code !== 'ESRCH') {
                  console.warn(`⚠️ Failed to kill process ${pid}: ${killErr.message}`);
                }
              }
            }
          }
        } catch (symErr) {
          console.warn(`⚠️ Could not read lock symlink ${file}: ${symErr.message}`);
        }
      }
    }

    // 2. Fallback: shell search for processes using this session folder
    try {
      const escapedFolder = sessionFolder.replace(/"/g, '\\"');
      let cmd = '';
      if (process.platform === 'win32') {
        cmd = `wmic process where "commandline like '%${escapedFolder.replace(/\\/g, '\\\\')}%'" get processid`;
      } else {
        cmd = `ps aux | grep "${escapedFolder}" | grep -v grep | awk '{print $2}'`;
      }
      
      const stdout = execSync(cmd).toString().trim();
      if (stdout) {
        const pids = stdout.split(/\s+/).map(Number).filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
            console.log(`💀 Forcefully terminated zombie process ${pid} via fallback for ${userEmail}`);
          } catch (killErr) {
            if (killErr.code !== 'ESRCH') {
              console.warn(`⚠️ Failed to kill zombie process ${pid} in fallback: ${killErr.message}`);
            }
          }
        }
      }
    } catch (err) {
      // Ignore errors if ps/grep isn't available or fails
    }

    // 3. Delete the lock files to make sure they are gone
    for (const file of lockFiles) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log(`🧹 Deleted lock file: ${file}`);
        } catch (unErr) {
          console.error(`⚠️ Failed to delete lock file ${file}: ${unErr.message}`);
        }
      }
    }
  }

  /**
   * Safe, Anti-Ban Auto-Reply Handler
   * - Ignores messages received during startup chat sync (30s grace period after ready)
   * - Ignores messages with timestamps older than connection ready time
   * - Ignores statuses, group chats, self-sent messages, and system broadcast
   * - Enforces 6-hour per-contact cooldown (never reply to same sender within 6h)
   * - Enqueues messages to process one-by-one with randomized human typing delays (15–45s)
   */
  async _handleIncomingAutoReply(userEmail, client, msg) {
    if (!this.contactCooldowns) this.contactCooldowns = new Map();
    if (!this.autoReplyQueues) this.autoReplyQueues = new Map();
    if (!this.autoReplyProcessing) this.autoReplyProcessing = new Map();

    const state = this.sessions.get(userEmail);
    const msgTime = (msg.timestamp || 0) * 1000;
    const now = Date.now();
    const connectTime = state?.connectedAt ? state.connectedAt.getTime() : (now - 60000);

    // 1. Skip status updates, group messages, and self-sent messages
    if (msg.isStatus || msg.fromMe || (msg.from && (msg.from.endsWith('@g.us') || msg.from.includes('status@broadcast')))) {
      return;
    }

    // 2. Skip startup grace period (30s after client connection) only if state.connectedAt is fresh
    if (state?.connectedAt && (now - state.connectedAt.getTime() < 30000)) {
      console.log(`⏳ [Auto-Reply] Skipping message during 30s startup grace period for ${userEmail}`);
      return;
    }

    // 3. Skip historical/cached messages older than 2 minutes before connection
    if (state?.connectedAt && msgTime > 0 && msgTime < (state.connectedAt.getTime() - 120000)) {
      console.log(`⏳ [Auto-Reply] Skipping historical message from ${msg.from} timestamp ${new Date(msgTime).toISOString()}`);
      return;
    }

    console.log(`📬 [Auto-Reply] Message received from ${msg.from} for ${userEmail}: "${(msg.body || '').substring(0, 50)}..."`);
    this.emit(`message:${userEmail}`, msg);

    // 4. Enforce randomized 1-3 minute per-contact cooldown (60s to 180s)
    const cooldownKey = `${userEmail}:${msg.from}`;
    const lastRepliedObj = this.contactCooldowns.get(cooldownKey);
    const lastReplied = typeof lastRepliedObj === 'object' ? lastRepliedObj.time : (lastRepliedObj || 0);
    const contactCooldownMs = typeof lastRepliedObj === 'object' ? lastRepliedObj.duration : 60000;

    if (now - lastReplied < contactCooldownMs) {
      const remainingSec = Math.ceil((contactCooldownMs - (now - lastReplied)) / 1000);
      console.log(`⏳ [Auto-Reply] Skipping ${msg.from} for ${userEmail}: Cooldown active (${remainingSec}s remaining)`);
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
        console.log(`ℹ️ [Auto-Reply] Skipping ${userEmail}: Auto-reply not enabled or empty prompt (Enabled: ${meta.autoReplyEnabled}, Prompt length: ${meta.autoReplyPrompt?.length || 0})`);
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
        console.log(`🚫 Auto-reply limit reached for ${userEmail}`);
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
      this._processAutoReplyQueue(userEmail, client);

    } catch (err) {
      console.error(`❌ Auto-Reply lookup error for ${userEmail}:`, err.message);
    }
  }

  async _processAutoReplyQueue(userEmail, client) {
    if (this.autoReplyProcessing.get(userEmail)) return; // Strictly single-threaded: one reply at a time
    this.autoReplyProcessing.set(userEmail, true);

    try {
      const queue = this.autoReplyQueues.get(userEmail) || [];

      while (queue.length > 0) {
        const item = queue.shift();
        const { msg, meta, cooldownKey, apiKeyId } = item;

        try {
          // Re-verify cooldown in case multiple messages from same sender were queued
          const lastRepliedObj = this.contactCooldowns.get(cooldownKey);
          const lastReplied = typeof lastRepliedObj === 'object' ? lastRepliedObj.time : (lastRepliedObj || 0);
          const contactCooldownMs = typeof lastRepliedObj === 'object' ? lastRepliedObj.duration : 60000;
          if (Date.now() - lastReplied < contactCooldownMs) {
            console.log(`⏳ [Auto-Reply Queue] Skipping ${msg.from}: Cooldown active`);
            continue;
          }

          // Random human typing delay: 15 to 45 seconds to guarantee human-like behavior
          const humanDelay = 15000 + Math.floor(Math.random() * 30000);
          console.log(`⏳ [Auto-Reply Queue] Simulating human reading & typing delay (${Math.round(humanDelay / 1000)}s) before replying to ${msg.from}...`);
          await new Promise(r => setTimeout(r, humanDelay));

          // Simulate WhatsApp typing indicator
          try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            await new Promise(r => setTimeout(r, 3000));
          } catch (_) {}

          const axios = require('axios');
          const openRouterKey = process.env.OPENROUTER_API_KEY;
          const modelName = process.env.OPENROUTER_MODEL || process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'openrouter/free';

          if (!openRouterKey) {
            console.log('❌ Auto-Reply skipped: No OPENROUTER_API_KEY');
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
            // NO FORCED PROMOTIONAL SPAM LINK SIGNATURE!
            if (meta.autoReplyMedia && meta.autoReplyMedia.data) {
              const media = new MessageMedia(
                meta.autoReplyMedia.mimeType || 'application/pdf',
                meta.autoReplyMedia.data,
                meta.autoReplyMedia.filename || 'attachment'
              );
              await client.sendMessage(msg.from, media, { caption: generatedReply });
            } else {
              await client.sendMessage(msg.from, generatedReply);
            }

            // Update cooldown map with fresh random 1-3 minute window (60,000 to 180,000 ms)
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

            console.log(`✅ [Auto-Reply Safe] Successfully sent human-like reply to ${msg.from}`);
          }
        } catch (err) {
          console.error(`❌ Error processing auto-reply queue item for ${userEmail}:`, err.message);
        }

        // Buffer pause between processing queued messages for different contacts
        if (queue.length > 0) {
          const interBufferMs = 10000 + Math.floor(Math.random() * 15000); // 10-25s safe buffer
          console.log(`⏳ [Auto-Reply Queue] Waiting ${Math.round(interBufferMs / 1000)}s inter-message buffer before processing next contact...`);
          await new Promise(r => setTimeout(r, interBufferMs));
        }
      }
    } finally {
      this.autoReplyProcessing.set(userEmail, false);
    }
  }
}

module.exports = WhatsAppPuppeteerService;

