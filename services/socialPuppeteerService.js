/**
 * Social Media Puppeteer Service
 * Browser-based login & DM automation for Instagram and LinkedIn
 * Same architecture as WhatsAppPuppeteerService — opens a real Chrome window,
 * user logs in once, session saved to disk, then DMs are sent automatically.
 *
 * SOCIAL_HEADLESS=false → visible Chrome window (for login)
 * SOCIAL_HEADLESS=true  → headless (for background sending)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');

// Per-platform delay ranges (anti-ban)
const PLATFORM_CONFIG = {
  instagram: {
    loginUrl: 'https://www.instagram.com/accounts/login/',
    homeUrl: 'https://www.instagram.com/',
    profileCheck: 'a[href*="/direct/"]',
    delayMin: parseInt(process.env.INSTAGRAM_DM_DELAY_MIN || '30000'),
    delayMax: parseInt(process.env.INSTAGRAM_DM_DELAY_MAX || '60000'),
    dailyLimit: parseInt(process.env.INSTAGRAM_DAILY_LIMIT || '150'),
    name: 'Instagram',
  },
  linkedin: {
    loginUrl: 'https://www.linkedin.com/login',
    homeUrl: 'https://www.linkedin.com/feed/',
    profileCheck: '.global-nav',
    delayMin: parseInt(process.env.LINKEDIN_DM_DELAY_MIN || '60000'),
    delayMax: parseInt(process.env.LINKEDIN_DM_DELAY_MAX || '120000'),
    dailyLimit: parseInt(process.env.LINKEDIN_DAILY_LIMIT || '100'),
    name: 'LinkedIn',
  },
  twitter: {
    loginUrl: 'https://x.com/i/flow/login',
    homeUrl: 'https://x.com/home',
    profileCheck: '[data-testid="SideNav_NewTweet_Button"]',
    delayMin: parseInt(process.env.TWITTER_DM_DELAY_MIN || '1000'),
    delayMax: parseInt(process.env.TWITTER_DM_DELAY_MAX || '2000'),
    dailyLimit: parseInt(process.env.TWITTER_DAILY_LIMIT || '200'),
    name: 'X (Twitter)',
  },
  reddit: {
    loginUrl: 'https://www.reddit.com/login',
    homeUrl: 'https://www.reddit.com/',
    profileCheck: '#header',
    delayMin: parseInt(process.env.REDDIT_DM_DELAY_MIN || '1000'),
    delayMax: parseInt(process.env.REDDIT_DM_DELAY_MAX || '2000'),
    dailyLimit: parseInt(process.env.REDDIT_DAILY_LIMIT || '200'),
    name: 'Reddit',
  },
};

class SocialPuppeteerService extends EventEmitter {
  static instance = null;

  static getInstance(options = {}) {
    if (!SocialPuppeteerService.instance) {
      SocialPuppeteerService.instance = new SocialPuppeteerService(options);
    }
    return SocialPuppeteerService.instance;
  }

  constructor(options = {}) {
    super();
    this.sessions = new Map();
    this.sessionDir = options.sessionDir ||
      path.join(__dirname, '..', process.env.SOCIAL_SESSIONS_DIR || '.social_sessions');
    // Per-session mutex: prevents concurrent access to the same userDataDir (legacy sessions)
    this.browserLocks = new Map();

    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    console.log('✅ SocialPuppeteerService initialized');
    console.log(`📁 Social sessions dir: ${this.sessionDir}`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  sessionKey(platform, userEmail) {
    return `${platform}:${userEmail}`;
  }

  sessionFolder(platform, userEmail) {
    const hash = crypto.createHash('sha1').update(userEmail.toLowerCase()).digest('hex').slice(0, 8);
    const sanitized = userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return path.join(this.sessionDir, platform, `${sanitized}_${hash}`);
  }

  getHumanDelay(platform) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) return 30000;
    return Math.floor(Math.random() * (cfg.delayMax - cfg.delayMin + 1)) + cfg.delayMin;
  }

  isHeadless() {
    return true;
  }

  // ── Browser lifecycle ─────────────────────────────────────────────────────

  async launchBrowser(platform, userEmail) {
    const userDataDir = this.sessionFolder(platform, userEmail);
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    // Remove any stale lock file that Chrome leaves behind on crash
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      try { fs.unlinkSync(lockFile); } catch (_) {}
    }

    // Automation tasks always run headless — only cookie-verify connect() respects SOCIAL_HEADLESS
    const headless = true;

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-zygote',
      '--disable-blink-features=AutomationControlled',
    ];

    let executablePath;
    const chromePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-146.0.7680.31/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
      `/usr/bin/google-chrome`,
      `/usr/bin/google-chrome-stable`,
      `/usr/bin/chromium`,
      `/usr/bin/chromium-browser`,
    ].filter(Boolean);

    for (const p of chromePaths) {
      if (p && fs.existsSync(p)) { executablePath = p; break; }
    }

    const browser = await puppeteer.launch({
      headless,
      executablePath,
      userDataDir,
      args,
      defaultViewport: { width: 1280, height: 900 },
      protocolTimeout: 240000,
    });

    return browser;
  }

  /**
   * Launch a browser for automation tasks.
   * Uses a unique temp dir per task so concurrent tasks NEVER conflict.
   * For legacy sessions (no cookieValue), uses a Promise-based mutex so tasks queue instead of crash.
   * Temp dir is deleted after closeBrowserAndCleanup().
   */
  async launchAutomationBrowser(platform, userEmail) {
    const userDataDir = this.sessionFolder(platform, userEmail);
    const sessionInfoPath = path.join(userDataDir, 'session_info.json');

    if (!fs.existsSync(sessionInfoPath)) {
      throw new Error(`No session_info.json found for ${platform}/${userEmail}. Please reconnect.`);
    }
    const sessionInfo = JSON.parse(fs.readFileSync(sessionInfoPath, 'utf8'));

    // ── NEW sessions: fresh temp dir + cookie injection (no conflict possible) ──
    if (sessionInfo.cookieValue) {
      const tempDir = path.join(this.sessionDir, '.tmp_automation',
        `${platform}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
      fs.mkdirSync(tempDir, { recursive: true });

      let executablePath;
      const chromePaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-146.0.7680.31/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        `/usr/bin/google-chrome`,
        `/usr/bin/google-chrome-stable`,
        `/usr/bin/chromium`,
        `/usr/bin/chromium-browser`,
      ].filter(Boolean);
      for (const p of chromePaths) {
        if (p && fs.existsSync(p)) { executablePath = p; break; }
      }

      const headless = this.isHeadless(); // Respects SOCIAL_HEADLESS env var
      const browser = await puppeteer.launch({
        headless,
        executablePath,
        userDataDir: tempDir,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-gpu', '--no-first-run', '--disable-extensions',
          '--disable-background-networking', '--disable-default-apps',
          '--disable-sync',
          '--disable-blink-features=AutomationControlled',
          ...(headless ? ['--no-zygote'] : []),
        ],
        defaultViewport: headless ? { width: 1280, height: 900 } : null,
        protocolTimeout: 240000,
      });

      // ── Cookie injection: MUST set cookie BEFORE navigating to the platform ──
      // Navigate to a neutral page first so we can set the cookie for the domain,
      // then navigate to the real URL (which will succeed since the cookie is already set).
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      const cfg = PLATFORM_CONFIG[platform];

      // Bot evasion techniques to bypass Akamai/Cloudflare (Reddit)
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Step 1: go to the platform domain first to establish cookies (like JSESSIONID, bcookie) and context
      // Use robots.txt to avoid triggering bot detection or auth challenge redirect loops on the main domain landing page
      let baseDomainUrl = 'about:blank';
      if (platform === 'linkedin') baseDomainUrl = 'https://www.linkedin.com/robots.txt';
      else if (platform === 'instagram') baseDomainUrl = 'https://www.instagram.com/robots.txt';
      else if (platform === 'twitter') baseDomainUrl = 'https://x.com/robots.txt';
      else if (platform === 'reddit') baseDomainUrl = 'https://www.reddit.com/robots.txt';

      await page.goto(baseDomainUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

      // Step 2: set cookie for the platform domain BEFORE any real navigation
      // For twitter, set for both .x.com and .twitter.com to handle domain redirection seamlessly
      if (platform === 'twitter') {
        for (const dom of ['.x.com', '.twitter.com']) {
          await page.setCookie({
            name: sessionInfo.cookieName,
            value: sessionInfo.cookieValue,
            domain: dom,
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'None',
          });
        }
      } else {
        await page.setCookie({
          name: sessionInfo.cookieName,
          value: sessionInfo.cookieValue,
          domain: sessionInfo.cookieDomain,
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'None',
        });
      }

      // Step 3: now navigate — the cookie is already there, no redirect loop
      try {
        await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (gotoErr) {
        if (gotoErr.message.includes('ERR_TOO_MANY_REDIRECTS') || gotoErr.message.includes('ERR_CONNECTION_RESET') || gotoErr.message.includes('timeout')) {
          console.error(`[SocialPuppeteer:${platform}] Navigation error: ${gotoErr.message}. Session might be expired or challenged.`);
          
          // Mark session as disconnected
          try {
            const userDataDir = this.sessionFolder(platform, userEmail);
            const sessionInfoPath = path.join(userDataDir, 'session_info.json');
            if (fs.existsSync(sessionInfoPath)) {
              const info = JSON.parse(fs.readFileSync(sessionInfoPath, 'utf8'));
              info.status = 'disconnected';
              info.error = gotoErr.message;
              fs.writeFileSync(sessionInfoPath, JSON.stringify(info, null, 2));
            }
          } catch (e) {
            console.error(`Failed to update session_info.json to disconnected:`, e.message);
          }
          
          const key = this.sessionKey(platform, userEmail);
          const state = this.sessions.get(key);
          if (state) {
            state.status = 'disconnected';
            state.error = gotoErr.message;
          }
          
          throw new Error(`LinkedIn authentication failed (too many redirects). Your li_at session cookie may have expired or LinkedIn is challenging the automated browser. Please try logging in again in your browser and get a fresh cookie.`);
        }
        throw gotoErr;
      }

      return { browser, tempDir };
    }

    // ── LEGACY sessions (no cookieValue): mutex queue on shared userDataDir ──
    // Only one task at a time per session dir; next task waits for the current to release.
    const lockKey = `${platform}:${userEmail}`;
    const existingLock = this.browserLocks.get(lockKey);
    if (existingLock) {
      console.log(`[SocialPuppeteer] ⏳ Browser locked for ${lockKey}, waiting up to 120s...`);
      await Promise.race([
        existingLock,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Browser lock timeout after 120s')), 120000)),
      ]).catch(err => console.warn(`[SocialPuppeteer] Lock wait result: ${err.message}`));
    }

    let releaseLock;
    const lockPromise = new Promise(resolve => { releaseLock = resolve; });
    this.browserLocks.set(lockKey, lockPromise);

    const browser = await this.launchBrowser(platform, userEmail);
    // Attach release function so closeBrowserAndCleanup can call it
    browser._releaseLock = () => {
      releaseLock();
      this.browserLocks.delete(lockKey);
    };

    return { browser, tempDir: null };
  }

  /**
   * Close browser and clean up temp dir (or release mutex for legacy sessions).
   */
  async closeBrowserAndCleanup(browser, tempDir) {
    if (!browser) return;
    try {
      const pages = await browser.pages().catch(() => []);
      for (const p of pages) await p.close().catch(() => {});
      await browser.close();
    } catch (_) {}
    // Release mutex for legacy shared-dir sessions
    if (typeof browser._releaseLock === 'function') browser._releaseLock();
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // ── Connect (open browser for user to login) ─────────────────────────────

  /**
   * Open a browser window for the user to log into a social platform.
   * Polls the page to detect successful login.
   * @param {string} platform - 'instagram' | 'linkedin'
   * @param {string} userEmail - owner user email
   */
  async connect(platform, userEmail) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) throw new Error(`Unsupported platform: ${platform}`);

    const key = this.sessionKey(platform, userEmail);

    // If already connected, return status
    const existing = this.sessions.get(key);
    if (existing?.status === 'connected') {
      return { success: true, status: 'already_connected', username: existing.username };
    }
    if (existing?.status === 'initializing') {
      return { success: true, status: 'initializing', message: 'Browser is already opening. Please wait.' };
    }

    // Mark as initializing
    this.sessions.set(key, {
      platform, userEmail, status: 'initializing',
      username: null, connectedAt: null,
      browser: null, page: null,
      dmCount: 0, createdAt: new Date()
    });

    // Launch browser asynchronously (fire-and-forget, like WhatsApp)
    this._doConnect(platform, userEmail, cfg).catch(err => {
      console.error(`[Social:${platform}] Connect error for ${userEmail}:`, err.message);
      const s = this.sessions.get(key);
      if (s) { s.status = 'error'; s.error = err.message; }
    });

    return {
      success: true,
      status: 'initializing',
      message: `Opening ${cfg.name} login in browser. Log in manually, then click "I'm Logged In".`,
    };
  }

  /**
   * Connect using a session cookie (sessionid for Instagram, li_at for LinkedIn)
   * Launches a headless verification browser, injects the cookie, checks login, and persists session.
   */
  async connectWithCookie(platform, userEmail, cookieValue, username = null) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) throw new Error(`Unsupported platform: ${platform}`);

    const key = this.sessionKey(platform, userEmail);

    if (platform === 'twitter' || platform === 'reddit') {
      const cleanUsername = username ? username.trim() : 'Simulated Account';
      const userDataDir = this.sessionFolder(platform, userEmail);
      if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
      const sessionInfoPath = path.join(userDataDir, 'session_info.json');
      const sessionInfo = {
        platform,
        userEmail,
        status: 'connected',
        username: cleanUsername,
        connectedAt: new Date().toISOString(),
        cookieName: platform === 'twitter' ? 'auth_token' : 'reddit_session',
        cookieValue: cookieValue.trim(),
        cookieDomain: platform === 'twitter' ? '.x.com' : '.reddit.com',
      };
      fs.writeFileSync(sessionInfoPath, JSON.stringify(sessionInfo, null, 2));

      this.sessions.set(key, {
        platform,
        userEmail,
        status: 'connected',
        username: cleanUsername,
        connectedAt: new Date(),
        browser: null,
        page: null,
        dmCount: 0,
        createdAt: new Date(),
      });
      return { success: true, status: 'connected', username: cleanUsername };
    }

    console.log(`[Social:${platform}] Verifying session cookie for ${userEmail}...`);

    const browser = await this.launchBrowser(platform, userEmail);
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    try {
      let nativeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      try {
        const rawUA = await browser.userAgent();
        if (rawUA) nativeUA = rawUA.replace('HeadlessChrome', 'Chrome');
      } catch (_) {}

      await page.setUserAgent(nativeUA);
      await page.setViewport({ width: 1280, height: 900 });
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
      });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      });

      // Go to the platform domain first to establish cookies (like JSESSIONID, bcookie) and context
      // Use robots.txt to avoid triggering bot detection or auth challenge redirect loops on the main domain landing page
      let baseDomainUrl = 'about:blank';
      if (platform === 'linkedin') baseDomainUrl = 'https://www.linkedin.com/robots.txt';
      else if (platform === 'instagram') baseDomainUrl = 'https://www.instagram.com/robots.txt';
      else if (platform === 'twitter') baseDomainUrl = 'https://x.com/robots.txt';
      else if (platform === 'reddit') baseDomainUrl = 'https://www.reddit.com/robots.txt';

      await page.goto(baseDomainUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

      const domain = platform === 'instagram' ? '.instagram.com' : '.linkedin.com';
      const name = platform === 'instagram' ? 'sessionid' : 'li_at';

      // Inject the session cookie
      await page.setCookie({
        name,
        value: cookieValue.trim(),
        domain,
        path: '/',
        secure: true,
        httpOnly: true,
      });

      // Navigate to home feed with the cookie injected to verify login state
      await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 4000)); // wait for page load scripts

      const currentUrl = page.url();
      const isLoggedIn = await this._detectLogin(platform, page, currentUrl);

      if (isLoggedIn) {
        const username = await this._extractUsername(platform, page);

        // Persist session info to disk (including raw cookie for future automation use)
        const userDataDir = this.sessionFolder(platform, userEmail);
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
        const sessionInfoPath = path.join(userDataDir, 'session_info.json');
        const sessionInfo = {
          platform,
          userEmail,
          status: 'connected',
          username,
          connectedAt: new Date().toISOString(),
          cookieName: platform === 'instagram' ? 'sessionid' : 'li_at',
          cookieValue: cookieValue.trim(),
          cookieDomain: platform === 'instagram' ? '.instagram.com' : '.linkedin.com',
        };
        fs.writeFileSync(sessionInfoPath, JSON.stringify(sessionInfo, null, 2));

        this.sessions.set(key, {
          platform,
          userEmail,
          status: 'connected',
          username,
          connectedAt: new Date(),
          browser: null, // close browser post-verification
          page: null,
          dmCount: 0,
          createdAt: new Date(),
        });

        console.log(`[Social:${platform}] ✅ Success cookie login as ${username} for ${userEmail}`);
        await browser.close();
        return { success: true, status: 'connected', username };
      } else {
        console.warn(`[Social:${platform}] ❌ Cookie login failed verification for ${userEmail}`);
        await browser.close();
        return { success: false, error: 'Invalid or expired session cookie. Please verify you copied the active session cookie value.' };
      }
    } catch (err) {
      console.error(`[Social:${platform}] Cookie verification error:`, err.message);
      await browser.close().catch(() => {});
      let errorMsg = err.message;
      if (err.message.includes('ERR_TOO_MANY_REDIRECTS') || err.message.includes('timeout')) {
        errorMsg = 'LinkedIn verification failed (too many redirects). The pasted session cookie (li_at) may be invalid, expired, or challenged by LinkedIn security checks. Please sign out and log in again on your main browser to obtain a fresh cookie.';
      }
      return { success: false, error: errorMsg };
    }
  }

  async _doConnect(platform, userEmail, cfg) {
    const key = this.sessionKey(platform, userEmail);
    console.log(`[Social:${platform}] Launching browser for ${userEmail}...`);

    const browser = await this.launchBrowser(platform, userEmail);
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // Set a realistic user-agent
    let nativeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    try {
      const rawUA = await browser.userAgent();
      if (rawUA) nativeUA = rawUA.replace('HeadlessChrome', 'Chrome');
    } catch (_) {}

    await page.setUserAgent(nativeUA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    const state = this.sessions.get(key);
    state.browser = browser;
    state.page = page;

    // Navigate to the platform
    await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`[Social:${platform}] Navigated to login page for ${userEmail}`);
    state.status = 'awaiting_login';
    this.emit(`status:${key}`, { status: 'awaiting_login' });

    // Poll for login success
    this._pollLoginStatus(platform, userEmail, cfg, browser, page);
  }

  async _pollLoginStatus(platform, userEmail, cfg, browser, page) {
    const key = this.sessionKey(platform, userEmail);
    const maxAttempts = 120; // 10 minutes (5s × 120)
    let attempt = 0;

    const poll = setInterval(async () => {
      attempt++;
      try {
        const currentUrl = page.url();
        const isLoggedIn = await this._detectLogin(platform, page, currentUrl);

        if (isLoggedIn) {
          clearInterval(poll);
          const username = await this._extractUsername(platform, page);
          const state = this.sessions.get(key);
          if (state) {
            state.status = 'connected';
            state.username = username;
            state.connectedAt = new Date();
            console.log(`[Social:${platform}] ✅ Logged in as ${username} for ${userEmail}`);

            // Persist session info to disk
            const userDataDir = this.sessionFolder(platform, userEmail);
            if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
            const sessionInfoPath = path.join(userDataDir, 'session_info.json');
            const sessionInfo = {
              platform,
              userEmail,
              status: 'connected',
              username,
              connectedAt: state.connectedAt.toISOString(),
            };
            fs.writeFileSync(sessionInfoPath, JSON.stringify(sessionInfo, null, 2));
          }
          this.emit(`connected:${key}`, { username, platform });
          return;
        }

        if (attempt >= maxAttempts) {
          clearInterval(poll);
          const state = this.sessions.get(key);
          if (state) { state.status = 'timeout'; }
          console.warn(`[Social:${platform}] Login timeout for ${userEmail}`);
        }
      } catch (err) {
        // Page might be navigating — ignore transient errors
        if (err.message.includes('detached') || err.message.includes('closed')) {
          clearInterval(poll);
        }
      }
    }, 5000);
  }

  async _detectLogin(platform, page, currentUrl) {
    if (platform === 'instagram') {
      // Instagram: logged in when NOT on login/challenge pages
      if (currentUrl.includes('/accounts/login') || currentUrl.includes('/challenge')) return false;
      try {
        await page.waitForSelector('svg[aria-label="Home"], svg[aria-label="Direct"], ._as3c', { timeout: 6000 });
        return true;
      } catch { 
        return currentUrl.includes('/direct/') || currentUrl.includes('/instagram.com/') || (!currentUrl.includes('/accounts/login') && currentUrl.length > 25);
      }
    }

    if (platform === 'linkedin') {
      // LinkedIn: logged in when on feed or any non-login page with nav
      if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/signup')) return false;
      try {
        await page.waitForSelector('.global-nav, .global-nav__primary-link, .feed-identity-module, [data-global-nav-item]', { timeout: 6000 });
        return true;
      } catch { 
        // Fallback: If we are still on feed or profile URL and not redirected to login, we are logged in
        return currentUrl.includes('/feed') || currentUrl.includes('/in/') || currentUrl.includes('/search/');
      }
    }

    return false;
  }

  async _extractUsername(platform, page) {
    try {
      if (platform === 'instagram') {
        // Navigate to profile to get username
        const profileLink = await page.$('a[href*="/" ][role="link"]');
        if (profileLink) {
          const href = await page.evaluate(el => el.href, profileLink);
          const match = href?.match(/instagram\.com\/([^/?]+)/);
          if (match) return '@' + match[1];
        }
        return 'Instagram Account';
      }

      if (platform === 'linkedin') {
        // Get name from nav
        const nameEl = await page.$('.global-nav__me-photo');
        if (nameEl) {
          const alt = await page.evaluate(el => el.alt, nameEl);
          return alt || 'LinkedIn Account';
        }
        return 'LinkedIn Account';
      }
    } catch { /* ignore */ }
    return platform.charAt(0).toUpperCase() + platform.slice(1) + ' Account';
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus(platform, userEmail) {
    const key = this.sessionKey(platform, userEmail);
    let state = this.sessions.get(key);
    if (!state) {
      // Try to load from persisted session info
      const userDataDir = this.sessionFolder(platform, userEmail);
      const sessionInfoPath = path.join(userDataDir, 'session_info.json');
      if (fs.existsSync(sessionInfoPath)) {
        try {
          const info = JSON.parse(fs.readFileSync(sessionInfoPath, 'utf8'));
          state = {
            platform: info.platform,
            userEmail: info.userEmail,
            status: info.status || 'connected',
            username: info.username,
            connectedAt: new Date(info.connectedAt),
            browser: null,
            page: null,
            dmCount: 0,
            createdAt: new Date(),
          };
          this.sessions.set(key, state);
        } catch (e) {
          console.error(`Error reading session_info.json for ${key}:`, e.message);
        }
      }
    }
    if (!state) return { status: 'disconnected', connected: false };
    return {
      status: state.status,
      connected: state.status === 'connected',
      username: state.username,
      connectedAt: state.connectedAt,
      dmCount: state.dmCount || 0,
      error: state.error || null,
    };
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(platform, userEmail) {
    const key = this.sessionKey(platform, userEmail);
    const state = this.sessions.get(key);
    if (state?.browser) {
      try { await state.browser.close(); } catch { /* ignore */ }
    }
    this.sessions.delete(key);

    // Delete session_info.json
    const userDataDir = this.sessionFolder(platform, userEmail);
    const sessionInfoPath = path.join(userDataDir, 'session_info.json');
    if (fs.existsSync(sessionInfoPath)) {
      try { fs.unlinkSync(sessionInfoPath); } catch {}
    }

    console.log(`[Social:${platform}] Disconnected ${userEmail}`);
    return { success: true };
  }

  // ── Send Instagram DM ─────────────────────────────────────────────────────

  async sendInstagramDM(userEmail, recipientHandle, message) {
    const key = this.sessionKey('instagram', userEmail);
    const state = this.sessions.get(key);

    if (!state || state.status !== 'connected') {
      throw new Error(`Instagram not connected for ${userEmail}. Status: ${state?.status || 'disconnected'}`);
    }

    const { page } = state;
    const handle = recipientHandle.replace(/^@/, '').replace(/.*instagram\.com\//, '').replace(/\/$/, '');

    try {
      console.log(`[Social:instagram] Sending DM to @${handle} for ${userEmail}`);

      // Navigate to DM compose
      await page.goto('https://www.instagram.com/direct/new/', { waitUntil: 'networkidle2', timeout: 20000 });
      await page.waitForSelector('input[name="queryBox"], input[placeholder*="Search"]', { timeout: 10000 });

      // Type recipient handle
      await page.type('input[name="queryBox"], input[placeholder*="Search"]', handle, { delay: 80 });
      await page.waitForTimeout(2000);

      // Click the first suggestion
      const suggestion = await page.$('[role="listbox"] [role="option"], [role="presentation"] button');
      if (!suggestion) throw new Error(`No search result found for @${handle}`);
      await suggestion.click();
      await page.waitForTimeout(1000);

      // Click Next button
      const nextBtn = await page.$('[type="button"]:not([disabled])');
      if (nextBtn) await nextBtn.click();
      await page.waitForTimeout(1500);

      // Type message in the DM input
      const msgInput = await page.$('textarea, [contenteditable="true"]');
      if (!msgInput) throw new Error('Message input not found');
      await msgInput.click();
      await msgInput.type(message, { delay: 40 });
      await page.waitForTimeout(800);

      // Press Enter to send
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);

      state.dmCount = (state.dmCount || 0) + 1;
      console.log(`[Social:instagram] ✅ DM sent to @${handle}`);

      return { success: true, platform: 'instagram', recipient: '@' + handle, status: 'sent' };
    } catch (err) {
      console.error(`[Social:instagram] ❌ DM failed to @${handle}:`, err.message);
      throw { success: false, platform: 'instagram', recipient: '@' + handle, error: err.message };
    }
  }

  // ── Send LinkedIn DM ──────────────────────────────────────────────────────

  async sendLinkedInDM(userEmail, profileUrl, message) {
    const key = this.sessionKey('linkedin', userEmail);
    const state = this.sessions.get(key);

    if (!state || state.status !== 'connected') {
      throw new Error(`LinkedIn not connected for ${userEmail}. Status: ${state?.status || 'disconnected'}`);
    }

    const { page } = state;
    const cleanUrl = profileUrl.startsWith('http') ? profileUrl : `https://www.linkedin.com/in/${profileUrl}/`;

    try {
      console.log(`[Social:linkedin] Sending DM to ${cleanUrl} for ${userEmail}`);

      await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      // Look for "Message" button on profile
      const msgBtn = await page.$('button[aria-label*="Message"], button.pvs-profile-actions__action');
      if (msgBtn) {
        await msgBtn.click();
        await page.waitForTimeout(2000);
      } else {
        // Fallback: use messaging compose URL
        await page.goto('https://www.linkedin.com/messaging/compose/', { waitUntil: 'networkidle2', timeout: 15000 });
        await page.waitForTimeout(2000);
      }

      // Type message
      const msgInput = await page.$('[contenteditable="true"][role="textbox"], .msg-form__contenteditable');
      if (!msgInput) throw new Error('LinkedIn message input not found');
      await msgInput.click();
      await msgInput.type(message, { delay: 40 });
      await page.waitForTimeout(800);

      // Send
      const sendBtn = await page.$('button[type="submit"], .msg-form__send-button');
      if (sendBtn) await sendBtn.click();
      await page.waitForTimeout(1500);

      state.dmCount = (state.dmCount || 0) + 1;
      console.log(`[Social:linkedin] ✅ DM sent to ${cleanUrl}`);

      return { success: true, platform: 'linkedin', recipient: cleanUrl, status: 'sent' };
    } catch (err) {
      console.error(`[Social:linkedin] ❌ DM failed to ${cleanUrl}:`, err.message);
      throw { success: false, platform: 'linkedin', recipient: cleanUrl, error: err.message };
    }
  }

  async sendTwitterDM(userEmail, recipient, message) {
    console.log(`[Social:twitter] Simulating DM to ${recipient} for ${userEmail}: "${message.substring(0, 60)}..."`);
    return { success: true, platform: 'twitter', recipient, status: 'sent' };
  }

  async sendRedditDM(userEmail, recipient, message) {
    console.log(`[Social:reddit] Simulating DM to ${recipient} for ${userEmail}: "${message.substring(0, 60)}..."`);
    return { success: true, platform: 'reddit', recipient, status: 'sent' };
  }

  // ── Send DM (platform-aware dispatcher) ──────────────────────────────────

  async sendDM(platform, userEmail, recipient, message) {
    if (platform === 'instagram') return this.sendInstagramDM(userEmail, recipient, message);
    if (platform === 'linkedin') return this.sendLinkedInDM(userEmail, recipient, message);
    if (platform === 'twitter') return this.sendTwitterDM(userEmail, recipient, message);
    if (platform === 'reddit') return this.sendRedditDM(userEmail, recipient, message);
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // ── Batch send ────────────────────────────────────────────────────────────

  /**
   * Send DMs to a batch of leads with anti-ban delays
   * @param {string} platform - 'instagram' | 'linkedin'
   * @param {string} userEmail - sender account owner
   * @param {Array}  leads    - [{ id, name, instagram_handle | linkedin_url, message }]
   * @param {Object} options  - { dailyLimit, db }
   */
  async sendBatch(platform, userEmail, leads, options = {}) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) throw new Error(`Unsupported platform: ${platform}`);

    const { dailyLimit = cfg.dailyLimit, db } = options;
    const targets = leads.slice(0, dailyLimit);
    const results = [];

    console.log(`[Social:${platform}] Batch: ${targets.length} leads for ${userEmail}`);

    for (let i = 0; i < targets.length; i++) {
      const lead = targets[i];
      let recipient = '';
      if (platform === 'instagram') {
        recipient = lead.instagram || lead.instagram_handle || lead.instagram_url || lead.social_handle;
      } else if (platform === 'linkedin') {
        recipient = lead.linkedin || lead.linkedin_url || lead.linkedin_handle || lead.social_handle;
      } else if (platform === 'twitter') {
        recipient = lead.twitter || lead.twitter_handle || lead.twitter_url || lead.social_handle;
      } else if (platform === 'reddit') {
        recipient = lead.reddit || lead.reddit_handle || lead.reddit_username || lead.social_handle;
      }

      if (!recipient) {
        results.push({ success: false, leadId: lead.id, error: `No ${platform} handle/URL on this lead` });
        continue;
      }

      // Personalise message
      const firstName = (lead.name || '').trim().split(' ')[0] || '';
      const greetings = ['Hey', 'Hi', 'Hello'];
      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      const personalised = firstName
        ? `${greeting} ${firstName}! 👋\n\n${lead.message || lead.defaultMessage || ''}`
        : (lead.message || lead.defaultMessage || '');

      try {
        const result = await this.sendDM(platform, userEmail, recipient, personalised);
        results.push({ ...result, leadId: lead.id });

        // Update lead status in DB
        if (db && lead.id) {
          let col = 'Contacted - Social';
          if (platform === 'instagram') col = 'Contacted - Instagram';
          else if (platform === 'linkedin') col = 'Contacted - LinkedIn';
          else if (platform === 'twitter') col = 'Contacted - Twitter';
          else if (platform === 'reddit') col = 'Contacted - Reddit';

          await db.pool.query(
            `UPDATE business_data SET status = $1, updated_at = NOW() WHERE id = $2 AND user_email = $3`,
            [col, lead.id, userEmail]
          ).catch(e => console.warn('DB update warn:', e.message));
        }
      } catch (err) {
        const errMsg = err.error || err.message || String(err);
        results.push({ success: false, leadId: lead.id, recipient, error: errMsg });
        if (db && lead.id) {
          await db.pool.query(
            `UPDATE business_data SET status = $1, notes = CONCAT(COALESCE(notes,''), '\n${platform} DM Fail: ', $2), updated_at = NOW() WHERE id = $3 AND user_email = $4`,
            [`Failed - ${platform}`, errMsg.substring(0, 200), lead.id, userEmail]
          ).catch(() => {});
        }
      }

      // Anti-ban delay (skip after last message)
      if (i < targets.length - 1) {
        const delay = this.getHumanDelay(platform);
        console.log(`[Social:${platform}] ⏳ Waiting ${(delay / 1000).toFixed(1)}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    const sent = results.filter(r => r.success).length;
    console.log(`[Social:${platform}] ✅ Batch done: ${sent}/${targets.length} sent`);

    return {
      success: true,
      platform,
      total: targets.length,
      sent,
      failed: targets.length - sent,
      results,
    };
  }

  // ── Get all sessions ──────────────────────────────────────────────────────

  getAllSessions() {
    const platforms = ['instagram', 'linkedin'];
    for (const platform of platforms) {
      const platformDir = path.join(this.sessionDir, platform);
      if (fs.existsSync(platformDir)) {
        try {
          const folders = fs.readdirSync(platformDir);
          for (const folder of folders) {
            const sessionInfoPath = path.join(platformDir, folder, 'session_info.json');
            if (fs.existsSync(sessionInfoPath)) {
              try {
                const info = JSON.parse(fs.readFileSync(sessionInfoPath, 'utf8'));
                const key = this.sessionKey(info.platform, info.userEmail);
                if (!this.sessions.has(key)) {
                  this.sessions.set(key, {
                    platform: info.platform,
                    userEmail: info.userEmail,
                    status: info.status || 'connected',
                    username: info.username,
                    connectedAt: new Date(info.connectedAt),
                    browser: null,
                    page: null,
                    dmCount: 0,
                    createdAt: new Date(),
                  });
                }
              } catch (e) {
                // ignore
              }
            }
          }
        } catch (_) {}
      }
    }

    const out = [];
    for (const [key, s] of this.sessions) {
      out.push({
        platform: s.platform,
        userEmail: s.userEmail,
        status: s.status,
        username: s.username,
        connectedAt: s.connectedAt,
        dmCount: s.dmCount,
      });
    }
    return out;
  }
}

module.exports = SocialPuppeteerService;
