/*
 * GoogleMapsWebService
 * Scrapes Google Maps web UI (no API key) to collect business website URLs for a query,
 * then optionally scrapes each website for contact information (email/phone) directly.
 *
 * WARNING: Scraping Google properties may violate their Terms of Service. Use responsibly.
 */

// Always use full puppeteer; no deployment/environment detection
const puppeteer = require('puppeteer');
const axios = require('axios');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const RateLimiter = require('./rateLimiter');
const ErrorHandler = require('./errorHandler');
const PerformanceMonitor = require('./performanceMonitor');

class GoogleMapsWebService {
  constructor(options = {}) {
    this.errorHandler = options.errorHandler || new ErrorHandler();
    this.rateLimiter = options.rateLimiter || new RateLimiter({ baseDelayMs: 1000 });
    this.performanceMonitor = options.performanceMonitor || new PerformanceMonitor({ errorHandler: this.errorHandler });

    // this.headless = options.headless !== undefined ? options.headless : true;
    this.headless = true;
    console.log(`🔍 GoogleMapsWebService constructor: headless = ${this.headless}`);
    this.maxScrollPages = options.maxScrollPages || 10; // deeper pagination per phrase for higher throughput
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    // Cache to avoid re-fetching the same host repeatedly during email enrichment
    this._emailHostCache = new Set();

    // Reusable browser instance and tracking
    this._browser = null;
    this._activeBrowsers = new Set();
    this._browserCleanupInterval = null;

    // Start browser cleanup monitoring for Render
    if (process.env.RENDER) {
      this._startBrowserCleanupMonitoring();
    }

    // Environment debugging
    // Removed debug log to reduce console spam
    // console.log(`[DEBUG] Environment info:`, {
    //   platform: process.platform,
    //   nodeVersion: process.version,
    //   isRender: !!process.env.RENDER,
    //   puppeteerCacheDir: process.env.PUPPETEER_CACHE_DIR,
    //   headless: this.headless
    // });

    // Comprehensive memory management and logging for all environments
    const logMemoryUsage = () => {
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      const externalMB = Math.round(mem.external / 1024 / 1024);
      const arrayBuffersMB = Math.round(mem.arrayBuffers / 1024 / 1024);
      
      console.log(`🧠 MEMORY USAGE: Heap: ${heapMB}MB, RSS: ${rssMB}MB, External: ${externalMB}MB, ArrayBuffers: ${arrayBuffersMB}MB`);
      
      if (heapMB > 150) {
        console.warn(`🧠 HIGH MEMORY USAGE: ${heapMB}MB (Peak: ${this._peakMemory || heapMB}MB)`);
        if (heapMB > (this._peakMemory || 0)) {
          this._peakMemory = heapMB;
        }
      }
    };

    // Log memory usage every 10 seconds
    setInterval(logMemoryUsage, 10000);

    // Aggressive memory management for Render
    if (process.env.RENDER) {
      // Force garbage collection every 30 seconds on Render
      if (global.gc) {
        setInterval(() => {
          const before = process.memoryUsage().heapUsed;
          global.gc();
          const after = process.memoryUsage().heapUsed;
          console.log(`🧠 Render GC: Freed ${Math.round((before - after) / 1024 / 1024)}MB`);
        }, 30000);
      }
    }
  }

  // Ensure a single browser instance is launched and reused
  async _ensureBrowser() {
    if (this._browser && this._browser.isConnected()) return this._browser;
    const launchOptions = await this._buildLaunchOptions();
    try {
      this._browser = await puppeteer.launch(launchOptions);
    } catch (error) {
      if (this.isBrowserDependencyError(error)) {
        error.browserDependencyError = true;
      }
      throw error;
    }
    return this._browser;
  }

  isBrowserDependencyError(error) {
    const message = String(error?.message || '').toLowerCase();
    return Boolean(
      error?.browserDependencyError ||
      message.includes('failed to launch the browser process') ||
      message.includes('error while loading shared libraries') ||
      message.includes('libnspr4.so') ||
      message.includes('libnss3.so')
    );
  }

  // Create a new page with common defaults
  async _newPage() {
    const browser = await this._ensureBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(this.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1366, height: 900 });
    // Harden timeouts - increased for better reliability
    page.setDefaultNavigationTimeout(180000); // 3 minutes
    page.setDefaultTimeout(120000); // 2 minutes
    await this._attachNetworkBlocking(page);
    return page;
  }

  // Speed: block heavy/inessential resources to improve page responsiveness
  async _attachNetworkBlocking(page) {
    try {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        const url = req.url();
        // Allow only essential types for Maps UI
        if (type === 'document' || type === 'xhr' || type === 'fetch' || type === 'script') {
          return req.continue();
        }
        // Block images, media, fonts, styles to speed up
        if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') {
          return req.abort();
        }
        // Block obvious trackers and 3rd-party noise
        if (/doubleclick|googletagmanager|google-analytics|facebook|fbcdn|hotjar|segment|optimizely/i.test(url)) {
          return req.abort();
        }
        return req.continue();
      });
    } catch (_) { /* ignore */ }
  }

  // Build launch options (local-like, no environment detection)
  async _buildLaunchOptions() {
    const commonArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=site-per-process,IsolateOrigins,site-per-process',
      '--disable-extensions',
      '--disable-background-networking',
      '--metrics-recording-only',
      '--force-color-profile=srgb',
    ];
    const opts = { headless: this.headless, args: commonArgs, protocolTimeout: 600000 };
    const executablePath = await this._discoverChromeExecutable();
    if (executablePath) {
      opts.executablePath = executablePath;
    }
    return opts;
  }

  // Removed retrying browser launcher to match local behavior

  // Best-effort: locate Chrome from Puppeteer's cache or standard system locations
  async _discoverChromeExecutable() {
    try {
      const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH || '';
      if (envPath && fs.existsSync(envPath)) return envPath;

      const bases = [
        path.join(__dirname, '..', '.cache', 'puppeteer'),
        '/opt/render/project/src/.cache/puppeteer',
        '/opt/render/.cache/puppeteer',
        process.env.PUPPETEER_CACHE_DIR || '',
      ].filter(Boolean);

      const candidates = [];
      for (const base of bases) {
        const chromeDir = path.join(base, 'chrome');
        if (!fs.existsSync(chromeDir)) continue;
        let entries = [];
        try { entries = fs.readdirSync(chromeDir); } catch (_) { entries = []; }
        for (const name of entries) {
          const subdirs = [
            path.join(chromeDir, name, 'chrome-linux64', 'chrome'),
            path.join(chromeDir, name, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path.join(chromeDir, name, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path.join(chromeDir, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          ];
          for (const s of subdirs) {
            if (fs.existsSync(s)) candidates.push(s);
          }
        }
      }

      // Check standard system locations on macOS/Linux
      const systemPaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
      for (const p of systemPaths) {
        if (fs.existsSync(p)) candidates.push(p);
      }

      // Prefer highest version by reverse sort of path strings
      candidates.sort().reverse();
      for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch (_) { }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // Utility: Collect card entries with both container selector and anchor href
  async _getCardEntries(page) {
    // Prefer direct element handles to avoid brittle nth-of-type selectors
    const handles = await page.$$('[role="feed"] .Nv2PK');
    return handles;
  }

  // Utility: Click logic with fallback: try anchor, then container
  async _clickCard(page, cardHandle) {
    try {
      // Try clicking the anchor inside the card; fallback to the card itself
      const anchor = await cardHandle.$('a.hfpxzc');
      if (anchor) {
        await anchor.evaluate(a => { a.scrollIntoView({ block: 'center' }); a.click(); });
      } else {
        await cardHandle.evaluate(el => { el.scrollIntoView({ block: 'center' }); el.click(); });
      }
    } catch (_) { /* ignore click errors */ }
  }

  // Public: NEW - collect full business details from Maps details panel without visiting external websites
  // options: { maxResults?: number, onBusiness?: (biz) => Promise<void> | void }
  async collectBusinessDetailsFromQuery(query, options = {}) {
    const { maxResults = 50, onBusiness } = options;
    const startTime = Date.now();
    const context = { operation: 'collectBusinessDetailsFromQuery', query };

    try {
      this.errorHandler.logProgress('maps-web-search', { status: 'started', query });
      // Initial small pacing only once per query
      await this._sleep(150);

      const page = await this._newPage();

      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
      } catch (_) {
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 120000 });
      }

      await this._handleConsent(page);
      await this._sleep(250);
      if (process.env.DEBUG_WEBSCRAPER === '1') {
        await this._saveDebugArtifacts(page, 'init');
      }

      const matchedSel = await this._waitForResultsList(page);
      this.errorHandler.logProgress('maps-web-search', { status: 'results-list-detected', selector: matchedSel || 'unknown' });

      const results = [];
      const seen = new Set(); // dedupe by website or name+phone
      const seenCards = new Set(); // dedupe cards by stable href
      let lastPlaceName = '';

      for (let pageIndex = 0; pageIndex < this.maxScrollPages && results.length < maxResults; pageIndex++) {
        const entries = await this._getCardEntries(page);
        this.errorHandler.logProgress('maps-web-search', { status: 'cards-found', pageIndex, count: entries.length });

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          try {
            // Build a stable key using anchor href inside the card
            const href = await entry.evaluate(el => (el.querySelector('a.hfpxzc') || {}).href || '');
            const cardKey = href || await entry.evaluate((el) => el.getAttribute('data-result-id') || '');
            if (cardKey && seenCards.has(cardKey)) continue;

            const beforeName = await this._getCurrentPlaceName(page);
            if (cardKey) seenCards.add(cardKey);

            // First attempt: extract minimal info from list card without opening panel
            let quick = await this._extractFromListCard(page, entry, query);
            if (quick && (quick.phone || quick.website)) {
              const key = quick.website || `${quick.name}|${quick.phone || ''}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push(quick);
                if (typeof onBusiness === 'function') {
                  try { 
                    // Removed debug log to reduce console spam
                    // console.log(`[DEBUG] Calling onBusiness callback for quick: ${quick.name}`, {
                    //   name: quick.name,
                    //   phone: quick.phone,
                    //   website: quick.website,
                    //   hasCallback: typeof onBusiness === 'function'
                    // });
                    await onBusiness(quick); 
                    // Removed debug log to reduce console spam
                    // console.log(`[DEBUG] onBusiness callback completed for quick: ${quick.name}`);
                  } catch (cbErr) { 
                    console.error(`[DEBUG] onBusiness callback failed for quick: ${quick.name}`, {
                      error: cbErr.message,
                      stack: cbErr.stack
                    });
                    await this.errorHandler.logAndContinue(cbErr, { ...context, step: 'onBusiness-quick' }); 
                  }
                } else {
                  // Removed debug log to reduce console spam
                  // console.log(`[DEBUG] No onBusiness callback provided for quick: ${quick.name}`);
                }
                continue; // Skip opening the panel
              } else {
                // Removed debug log to reduce console spam
                // console.log(`[DEBUG] Duplicate quick business skipped: ${quick.name} (key: ${key})`);
              }
            }

            // Only open details panel if BOTH phone and website are missing on the list card
            await this._clickCard(page, entry);

            // Faster UI pacing: keep total wait budget under ~800ms
            await this._sleep(40);
            await page.waitForSelector('[role="main"]', { timeout: 200 }).catch(() => { });
            await page.waitForFunction(() => {
              const nameEl = document.querySelector('[role="main"] .DUwDvf, [role="main"] h1');
              const t = nameEl ? nameEl.textContent?.trim() : '';
              return t && !/Results|Directions|Photos/i.test(t);
            }, { timeout: 200 }).catch(() => { });
            const currentName = await this._getCurrentPlaceName(page);
            if (!currentName || currentName === beforeName) {
              // One retry click on the container
              await this._clickCard(page, entry);
              await this._sleep(80);
            }

            // Small wait for action elements, bounded
            await page
              .waitForSelector('[role="main"] a[href^="tel:"], [role="main"] a[aria-label*="Website"], [role="main"] [data-item-id^="phone:"]', { timeout: 120 })
              .catch(() => { });

            const details = await this._extractDetailsFromPanel(page, query);
            // Removed debug log to reduce console spam
            // console.log(`[DEBUG] Panel extraction result:`, {
            //   hasDetails: !!details,
            //   name: details?.name,
            //   website: details?.website,
            //   phone: details?.phone
            // });

            if (details && (details.website || details.name)) {
              const key = details.website || `${details.name}|${details.phone || ''}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push(details);
                this.errorHandler.logProgress('maps-web-search', { status: 'details-collected', name: details.name, website: details.website });
                // Stream out this business immediately if callback provided
                if (typeof onBusiness === 'function') {
                  try {
                    // Removed debug log to reduce console spam
                    // console.log(`[DEBUG] Calling onBusiness callback for: ${details.name}`, {
                    //   name: details.name,
                    //   phone: details.phone,
                    //   website: details.website,
                    //   hasCallback: typeof onBusiness === 'function'
                    // });
                    await onBusiness(details);
                    // Removed debug log to reduce console spam
                    // console.log(`[DEBUG] onBusiness callback completed for: ${details.name}`);
                  } catch (cbErr) {
                    console.error(`[DEBUG] onBusiness callback failed for: ${details.name}`, {
                      error: cbErr.message,
                      stack: cbErr.stack
                    });
                    await this.errorHandler.logAndContinue(cbErr, { ...context, step: 'onBusiness-callback', name: details.name, website: details.website });
                  }
                } else {
                  // Removed debug log to reduce console spam
                  // console.log(`[DEBUG] No onBusiness callback provided for: ${details.name}`);
                }
              } else {
                // Removed debug log to reduce console spam
                // console.log(`[DEBUG] Duplicate business skipped: ${details.name} (key: ${key})`);
              }
            } else {
              // Fallback: try minimal extraction from list card when panel fails
              const minimal = await this._extractFromListCard(page, entry, query);
              if (minimal && (minimal.name || minimal.phone)) {
                const key = minimal.website || `${minimal.name}|${minimal.phone || ''}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  results.push(minimal);
                  this.errorHandler.logProgress('maps-web-search', { status: 'details-collected-minimal', name: minimal.name, phone: minimal.phone });
                  if (typeof onBusiness === 'function') {
                    try { 
                      // Removed debug log to reduce console spam
                      // console.log(`[DEBUG] Calling onBusiness callback for minimal: ${minimal.name}`, {
                      //   name: minimal.name,
                      //   phone: minimal.phone,
                      //   website: minimal.website,
                      //   hasCallback: typeof onBusiness === 'function'
                      // });
                      await onBusiness(minimal); 
                      // Removed debug log to reduce console spam
                      // console.log(`[DEBUG] onBusiness callback completed for minimal: ${minimal.name}`);
                    } catch (cbErr) {
                      console.error(`[DEBUG] onBusiness callback failed for minimal: ${minimal.name}`, {
                        error: cbErr.message,
                        stack: cbErr.stack
                      });
                      await this.errorHandler.logAndContinue(cbErr, { ...context, step: 'onBusiness-callback-minimal', name: minimal.name, phone: minimal.phone });
                    }
                  } else {
                    // Removed debug log to reduce console spam
                    // console.log(`[DEBUG] No onBusiness callback provided for minimal: ${minimal.name}`);
                  }
                } else {
                  // Removed debug log to reduce console spam
                  // console.log(`[DEBUG] Duplicate minimal business skipped: ${minimal.name} (key: ${key})`);
                }
              } else {
                // Capture artifacts to diagnose why panel failed
                if (process.env.DEBUG_WEBSCRAPER === '1') {
                  await this._saveDebugArtifacts(page, 'details-missing');
                }
                this.errorHandler.logProgress('maps-web-search', { status: 'details-missing' });
              }
            }
          } catch (err) {
            await this.errorHandler.logAndContinue(err, { ...context, step: 'collect-details' });
          }
        }

        const loadedMore = await this._scrollResultsList(page);
        if (!loadedMore) break;
      }

      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, true);
      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);
      await this.errorHandler.logAndContinue(error, context);
      return [];
    } finally {
      // Close only the page; keep browser alive for reuse
      try {
        const pages = (await (this._browser ? this._browser.pages() : [])) || [];
        // Close all but keep browser for reuse; page variable is out of scope here, so close newest
        if (pages.length) {
          const p = pages[pages.length - 1];
          await p.close().catch(() => {});
        }
      } catch (_) { }
    }
  }

  // Public: Step 1 - given a query, collect a deduped list of website URLs from Maps UI.
  async collectWebsiteUrlsFromQuery(query) {
    const startTime = Date.now();
    const context = { operation: 'collectWebsiteUrlsFromQuery', query };

    try {
      this.errorHandler.logProgress('maps-web-search', { status: 'started', query });
      // Light pacing only once per query (UI-only)
      await this._sleep(150);
      const page = await this._newPage();

      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 120000 });

      // Try to accept consent if shown
      await this._handleConsent(page);
      // Short settle after consent; UI only
      await this._sleep(300);

      // Debug: initial snapshot (optional)
      if (process.env.DEBUG_WEBSCRAPER === '1') {
        await this._saveDebugArtifacts(page, 'init');
      }

      // Wait for results feed to appear
      // Selectors on Maps change frequently; these are best-effort and resilient with fallbacks.
      const matchedSel = await this._waitForResultsList(page);
      this.errorHandler.logProgress('maps-web-search', { status: 'results-list-detected', selector: matchedSel || 'unknown' });

      const websiteUrls = new Set();
      let lastPlaceName = '';

      // Scroll the results list and open each card to read the website link from the details pane
      for (let pageIndex = 0; pageIndex < this.maxScrollPages; pageIndex++) {
        const cardSelectors = await this._getResultCardSelectors(page);
        this.errorHandler.logProgress('maps-web-search', { status: 'cards-found', pageIndex, count: cardSelectors.length });
        for (const cardSelector of cardSelectors) {
          try {
            // Open the result details by clicking the card
            await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) {
                el.scrollIntoView({ block: 'center' });
                (el.querySelector('a.hfpxzc') || el).click();
              }
            }, cardSelector);

            // UI settle only; do not use global rateLimiter here
            await this._sleep(80);

            // Wait for the side panel details to change/render
            await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => { });
            const currentName = await this._getCurrentPlaceName(page);
            if (currentName && currentName === lastPlaceName) {
              // likely didn't change; try a short wait and continue
              await this._sleep(150);
            } else if (currentName) {
              lastPlaceName = currentName;
            }

            // Try to extract website button from the details panel
            const website = await this._extractWebsiteFromDetails(page);
            if (website) {
              this.errorHandler.logProgress('maps-web-search', { status: 'website-found', website });
            } else {
              this.errorHandler.logProgress('maps-web-search', { status: 'no-website-on-card', selector: cardSelector });
            }
            if (website) {
              websiteUrls.add(this._normalizeUrl(website));
            }
          } catch (err) {
            await this.errorHandler.logAndContinue(err, { ...context, step: 'open-card-or-extract-website' });
          }
        }

        // Scroll the results list to load more
        const loadedMore = await this._scrollResultsList(page);
        if (!loadedMore) break;
      }

      const urls = this._postProcessUrls(Array.from(websiteUrls).filter(Boolean));
      const duration = Date.now() - startTime;
      // Use existing metric bucket to avoid warnings
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, true);
      this.errorHandler.logProgress('maps-web-search', { status: 'completed', query, urlCount: urls.length });

      if (urls.length === 0) {
        if (process.env.DEBUG_WEBSCRAPER === '1') {
          await this._saveDebugArtifacts(page, 'no-urls');
        }
        this.errorHandler.logProgress('maps-web-search', { status: 'debug-artifacts', message: 'No URLs found, saved snapshots' });
      }

      return urls;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);
      await this.errorHandler.logAndContinue(error, context);
      return [];
    } finally {
      // Close only the page; keep browser alive for reuse
      try {
        const pages = (await (this._browser ? this._browser.pages() : [])) || [];
        if (pages.length) {
          const p = pages[pages.length - 1];
          await p.close().catch(() => {});
        }
      } catch (_) { }
    }
  }

  // Public: Step 2 - given a website URL, scrape contact info.
  // Optionally pass searchPhrase to be included in the returned record.
  async scrapeContactInfoFromWebsite(websiteUrl, searchPhrase = '') {
    const startTime = Date.now();
    const context = { operation: 'scrapeContactInfoFromWebsite', websiteUrl };

    try {
      await this.rateLimiter.delay();
      const normalizedUrl = this._normalizeUrl(websiteUrl);

      // Fetch homepage HTML
      const resp = await axios.get(normalizedUrl, { timeout: 15000, headers: { 'User-Agent': this.userAgent } });
      const html = resp.data || '';

      const emails = this._extractEmails(html);
      const phones = this._extractPhones(html);
      const name = this._guessBusinessName(html) || this._hostnameAsName(normalizedUrl);

      const data = {
        name,
        phone: phones[0] || '',
        address: '', // Not available from site without deeper parsing
        website: normalizedUrl,
        rating: null,
        totalReviews: null,
        openingHours: null,
        searchPhrase,
        placeId: normalizedUrl,
        contact: {
          emails,
          phones,
        },
        website_url: normalizedUrl,
      };

      const duration = Date.now() - startTime;
      // Not a known bucket; reuse googleMapsSearch to avoid warnings
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, true);
      return data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);
      await this.errorHandler.logAndContinue(error, context);
      return {
        name: this._hostnameAsName(websiteUrl),
        phone: '',
        address: '',
        website: this._normalizeUrl(websiteUrl),
        rating: null,
        totalReviews: null,
        openingHours: null,
        searchPhrase,
        placeId: this._normalizeUrl(websiteUrl),
        contact: { emails: [], phones: [] },
        website_url: this._normalizeUrl(websiteUrl),
      };
    }
  }

  // Public: High-level helper - performs step 1 and 2 for a single query.
  // Returns array of business-like objects matching the DB/Sheets schema, with placeId set to website URL.
  async scrapeBusinessesForQuery(query, options = {}) {
    const { maxWebsites = 100, concurrency = 3 } = options;
    const startTime = Date.now();
    const context = { operation: 'scrapeBusinessesForQuery', query };

    try {
      const urls = await this.collectWebsiteUrlsFromQuery(query);
      const limited = urls.slice(0, maxWebsites);

      const results = [];
      let index = 0;
      // Simple concurrency pool
      const worker = async () => {
        while (index < limited.length) {
          const i = index++;
          const url = limited[i];
          try {
            // Avoid double delay; scrapeContactInfoFromWebsite applies its own rate limiting
            const data = await this.scrapeContactInfoFromWebsite(url, query);
            results.push(data);
          } catch (err) {
            await this.errorHandler.logAndContinue(err, { ...context, step: 'scrape-website', url });
          }
        }
      };

      const workers = Array.from({ length: Math.max(1, Math.min(concurrency, 5)) }, () => worker());
      await Promise.all(workers);

      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, true);
      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);
      await this.errorHandler.logAndContinue(error, context);
      return [];
    }
  }

  // Utility: Wait for the results list to be present
  async _waitForResultsList(page) {
    // Try a few known selectors. Maps uses a scrollable list on the left with role="feed" or specific class names.
    const selectors = [
      '[role="feed"]',
      '.m6QErb[aria-label]',
      '.section-layout.section-layout-root',
    ];
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 15000 });
        return sel;
      } catch (_) { }
    }
    // As a fallback, just wait a bit (keep small to avoid global slowdowns)
    await this._sleep(200);
    return '';
  }

  // Utility: Return CSS selectors for the currently visible result cards in the list
  async _getResultCardSelectors(page) {
    // Prefer the container elements under the feed for stable nth-of-type
    const selectors = await page.evaluate(() => {
      const cards = [];
      const generic = document.querySelectorAll('[role="feed"] .Nv2PK');
      if (generic && generic.length) {
        generic.forEach((el, idx) => {
          const selector = `[role=feed] .Nv2PK:nth-of-type(${idx + 1})`;
          cards.push(selector);
        });
      } else {
        // Fallback to any visible anchors if needed
        const items = document.querySelectorAll('[role="feed"] a.hfpxzc, a.hfpxzc');
        items.forEach((el, idx) => {
          const selector = `a.hfpxzc:nth-of-type(${idx + 1})`;
          cards.push(selector);
        });
      }
      return cards.slice(0, 50);
    });
    return selectors;
  }

  // Utility: Read current place name from details panel
  async _getCurrentPlaceName(page) {
    try {
      const name = await page.evaluate(() => {
        const el = document.querySelector('[role="main"] .DUwDvf') || document.querySelector('[role="main"] h1');
        const t = el ? el.textContent.trim() : '';
        return t && t.toLowerCase() !== 'results' ? t : '';
      });
      return name;
    } catch (_) {
      return '';
    }
  }

  // Utility: Scroll the results list to load more entries with improved reliability
  async _scrollResultsList(page) {
    try {
      console.log('📄 Attempting to scroll...');
      
      const scrollResult = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (!feed) {
          return { success: false, reason: 'no-feed', before: 0, after: 0 };
        }
        
        const before = feed.scrollTop;
        const scrollHeight = feed.scrollHeight;
        const clientHeight = feed.clientHeight;
        
        // Check if we're already at the bottom
        if (feed.scrollTop + clientHeight >= scrollHeight - 10) {
          return { success: false, reason: 'already-at-bottom', before, after: before, scrollHeight, clientHeight };
        }
        
        // Try multiple scroll methods with increasing aggressiveness
        let scrolled = false;
        
        // Method 1: Standard scroll
        feed.scrollBy(0, clientHeight * 0.8);
        if (feed.scrollTop !== before) scrolled = true;
        
        // Method 2: Scroll to near bottom
        if (!scrolled) {
          feed.scrollTop = feed.scrollHeight - clientHeight - 100;
          if (feed.scrollTop !== before) scrolled = true;
        }
        
        // Method 3: Window scroll as fallback
        if (!scrolled) {
          window.scrollBy(0, window.innerHeight);
          // Check if feed scrolled due to window scroll
          if (feed.scrollTop !== before) scrolled = true;
        }
        
        const after = feed.scrollTop;
        
        return {
          success: scrolled,
          reason: scrolled ? 'scrolled' : 'no-scroll',
          before,
          after,
          scrollHeight,
          clientHeight,
          scrollDelta: after - before
        };
      });
      
      console.log(`📄 Scroll result: ${scrollResult.success ? 'SUCCESS' : 'FAILED'} (${scrollResult.reason})`);
      console.log(`📄 Scroll metrics: before=${scrollResult.before}, after=${scrollResult.after}, delta=${scrollResult.scrollDelta}, clientHeight=${scrollResult.clientHeight}`);
      
      if (scrollResult.success) {
        console.log(`📄 ✅ Scrolling successful! Waiting 6 seconds for new content...`);
        await this._sleep(6000); // Restored proper wait time for data loading
        return true;
      } else {
        console.log(`📄 ❌ Scrolling failed: ${scrollResult.reason}`);
        return false;
      }
    } catch (error) {
      console.log(`📄 ❌ Scroll error:`, error.message);
      return false;
    }
  }

  // Utility: Extract website from details panel
  async _extractWebsiteFromDetails(page) {
    try {
      // Try known website button/anchor patterns
      const website = await page.evaluate(() => {
        // Buttons usually have a link with data-item-id or aria-label containing "Website"
        const labels = Array.from(document.querySelectorAll('a, button'));
        // Prefer anchors with href starting http(s)
        for (const el of labels) {
          const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
          const href = el.getAttribute('href') || '';
          if ((label.includes('website') || label.includes('site')) && href.startsWith('http')) {
            return href;
          }
        }
        // Look for link icons in action bar
        const action = document.querySelector('a[data-item-id*="authority"]') || document.querySelector('a[data-item-id*="website"]');
        if (action && action.href && action.href.startsWith('http')) return action.href;
        return '';
      });
      return website || '';
    } catch (_) {
      return '';
    }
  }

  // Attempt to accept Google consent popup if present
  async _handleConsent(page) {
    try {
      // Try common consent selectors
      const selectors = [
        '#L2AGLb', // Google consent button id commonly used
        'button[aria-label="Accept all"]',
        'button:has-text("I agree")',
        'button:has-text("Accept all")',
      ];
      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) {
          await el.click().catch(() => { });
          this.errorHandler.logProgress('maps-web-search', { status: 'consent-accepted', selector: sel });
          await this._sleep(800);
          break;
        }
      }
    } catch (_) {
      // ignore failures, continue
    }
  }

  // Save screenshot and HTML snapshot to debug/
  async _saveDebugArtifacts(page, tag) {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const base = path.join(__dirname, '..', 'debug');
      const shot = path.join(base, `maps-web-${tag}-${ts}.png`);
      const html = path.join(base, `maps-web-${tag}-${ts}.html`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => { });
      const content = await page.content();
      fs.writeFileSync(html, content, 'utf8');
    } catch (_) {
      // ignore debug artifact failures
    }
  }

  _normalizeUrl(input) {
    // Returns a cleaned string URL suitable for HTTP requests and display
    try {
      const u = new URL(String(input));
      if (!/^https?:$/.test(u.protocol)) return '';
      // strip tracking params
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'mc_cid', 'mc_eid'].forEach(p => u.searchParams.delete(p));
      // hostname without www
      u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
      // normalize trailing slash to single slash at end
      u.pathname = u.pathname.replace(/\/+$|$/, '/');
      return u.toString();
    } catch (_) {
      return (input || '').trim();
    }
  }

  _hostnameAsName(input) {
    try {
      const url = new URL(this._normalizeUrl(input));
      return url.hostname.replace(/^www\./, '');
    } catch (_) {
      return input;
    }
  }

  _extractEmails(html) {
    const emails = new Set();
    const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
      emails.add(m[0].toLowerCase());
    }
    return Array.from(emails);
  }

  _extractSocialProfiles(html) {
    const socials = {
      linkedin: '',
      facebook: '',
      instagram: '',
      twitter: '',
      youtube: '',
      tiktok: ''
    };

    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match;
    
    const ignorePatterns = [
      /sharer/i, /share/i, /intent\/tweet/i, /plugins/i, /widget/i, /static/i, /assets/i,
      /js/i, /css/i, /images/i, /svg/i, /png/i, /jpg/i, /jpeg/i, /gif/i
    ];

    const isValid = (url) => {
      return !ignorePatterns.some(pattern => pattern.test(url));
    };

    const normalizeUrl = (url) => {
      if (url.startsWith('//')) return `https:${url}`;
      if (url.startsWith('www.')) return `https://${url}`;
      if (!url.startsWith('http://') && !url.startsWith('https://')) return `https://${url}`;
      return url;
    };

    while ((match = hrefRegex.exec(html)) !== null) {
      let url = match[1].trim();
      if (!url) continue;
      
      // LinkedIn
      if (url.includes('linkedin.com/') && isValid(url) && !socials.linkedin) {
        socials.linkedin = normalizeUrl(url);
      }
      // Facebook
      else if (url.includes('facebook.com/') && isValid(url) && !socials.facebook) {
        socials.facebook = normalizeUrl(url);
      }
      // Instagram
      else if (url.includes('instagram.com/') && isValid(url) && !socials.instagram) {
        socials.instagram = normalizeUrl(url);
      }
      // Twitter / X
      else if ((url.includes('twitter.com/') || url.includes('x.com/')) && isValid(url) && !socials.twitter) {
        socials.twitter = normalizeUrl(url);
      }
      // YouTube
      else if (url.includes('youtube.com/') && isValid(url) && !socials.youtube) {
        socials.youtube = normalizeUrl(url);
      }
      // TikTok
      else if (url.includes('tiktok.com/') && isValid(url) && !socials.tiktok) {
        socials.tiktok = normalizeUrl(url);
      }
    }

    return socials;
  }

  _extractPhones(text) {
    const phones = new Set();
    // Loosely match various phone formats, prefer 7+ digits
    const regex = /(?:(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{3,4})?)/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const cleaned = m[0].replace(/[^\d+]/g, '');
      if (cleaned.replace(/\D/g, '').length >= 7) phones.add(m[0].trim());
    }
    return Array.from(phones);
  }

  _guessBusinessName(html) {
    // Try <title>, then h1
    const titleMatch = /<title>([^<]{2,120})<\/title>/i.exec(html);
    if (titleMatch) return this._cleanText(titleMatch[1]);
    const h1Match = /<h1[^>]*>([^<]{2,120})<\/h1>/i.exec(html);
    if (h1Match) return this._cleanText(h1Match[1]);
    return '';
  }

  _cleanText(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  // Simple sleep helper (avoid using page.waitForTimeout which may be unavailable)
  async _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Removed goto retry helper to match local behavior

  // Normalize, dedupe and filter domains we don't want (e.g., social/review sites)
  _postProcessUrls(rawUrls) {
    const blocked = [
      'facebook.com', 'm.facebook.com', 'instagram.com', 'x.com', 'twitter.com',
      'linkedin.com', 'yelp.com', 'bing.com', 'apple.com', 'maps.google.',
      'tripadvisor.', 'angieslist.', 'carecredit.', 'healthgrades.', 'zocdoc.',
    ];
    const seenHost = new Set();
    const out = [];
    for (const u of rawUrls) {
      const nu = this._normalizeUrl(u);
      if (!nu) continue;
      let host = '';
      try { host = new URL(nu).hostname.replace(/^www\./, ''); } catch (_) { continue; }
      if (blocked.some(b => host.includes(b.replace(/^www\./, '')))) continue;
      if (seenHost.has(host)) continue;
      seenHost.add(host);
      out.push(nu);
    }
    return out;
  }

  // Utility: Extract full details (name, website, phone, emails, address, rating, reviews) from details panel
  async _extractDetailsFromPanel(page, searchPhrase = '') {
    try {
      const panel = await page.$('[role="main"]');
      if (!panel) {
        // Removed debug log to reduce console spam
        // console.log(`[DEBUG] No panel found with [role="main"]`);
        return null;
      }
      const html = await page.evaluate(el => el.innerHTML, panel);

      const name = await this._getCurrentPlaceName(page);
      if (!name) {
        // Removed debug log to reduce console spam
        // console.log(`[DEBUG] No place name found in panel`);
        return null; // ignore generic panels like 'Results'
      }

      // Removed debug log to reduce console spam
      // console.log(`[DEBUG] Panel extraction for: ${name}`);

      // Website link with timeout handling
      const website = await Promise.race([
        page.evaluate(() => {
        const selectors = [
          '[role="main"] a[data-item-id*="authority"]',
          '[role="main"] a[data-item-id*="website"]',
          '[role="main"] a[aria-label*="Website"]',
          '[role="main"] a[aria-label*="website"]',
          '[role="main"] a[href^="http"]:not([href*="google.com"]):not([href*="maps"])'
        ];

        let foundWebsite = '';
        let usedSelector = '';

        for (const selector of selectors) {
          const a = document.querySelector(selector);
          if (a && a.href && a.href.startsWith('http')) {
            foundWebsite = a.href;
            usedSelector = selector;
            break;
          }
        }

        // Debug: log available links
        const allLinks = Array.from(document.querySelectorAll('[role="main"] a[href]')).map(a => ({
          href: a.href,
          text: a.textContent?.trim(),
          ariaLabel: a.getAttribute('aria-label'),
          dataItemId: a.getAttribute('data-item-id')
        })).slice(0, 5);

        // Removed debug log to reduce console spam
        // console.log(`[DEBUG] Website extraction:`, {
        //   foundWebsite,
        //   usedSelector,
        //   allLinks
        // });

        return foundWebsite;
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Website extraction timeout')), 30000)
      )
      ]);

      // Primary phone with timeout handling
      const phone = await Promise.race([
        page.evaluate(() => {
        const selectors = [
          '[role="main"] a[href^="tel:"]',
          '[role="main"] button[data-item-id*="phone:"]',
          '[role="main"] [aria-label*="Phone"]'
        ];

        let foundPhone = '';
        let usedSelector = '';

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            if (el.href && el.href.startsWith('tel:')) {
              foundPhone = el.getAttribute('href').replace('tel:', '');
              usedSelector = selector;
              break;
            } else if (el.textContent && /\d{7,}/.test(el.textContent.replace(/\D/g, ''))) {
              foundPhone = el.textContent.trim();
              usedSelector = selector;
              break;
            }
          }
        }

        // Debug: log available phone-related elements
        const phoneElements = Array.from(document.querySelectorAll('[role="main"] a[href^="tel:"], [role="main"] *[data-item-id*="phone"], [role="main"] *[aria-label*="Phone"]')).map(el => ({
          tagName: el.tagName,
          href: el.href,
          textContent: el.textContent?.trim(),
          ariaLabel: el.getAttribute('aria-label'),
          dataItemId: el.getAttribute('data-item-id')
        })).slice(0, 3);

        // Removed debug log to reduce console spam
        // console.log(`[DEBUG] Phone extraction:`, {
        //   foundPhone,
        //   usedSelector,
        //   phoneElements
        // });

        return foundPhone && /\d{7,}/.test(foundPhone.replace(/\D/g, '')) ? foundPhone : '';
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Phone extraction timeout')), 30000)
      )
      ]);

      // Address candidates with timeout handling
      let address = await Promise.race([
        page.evaluate(() => {
        const trySelectors = [
          '[role="main"] button[data-item-id*="address"] div',
          '[role="main"] div[aria-label*="Address"]',
          '[role="main"] .Io6YTe',
        ];
        for (const sel of trySelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 8) {
            return el.textContent.trim();
          }
        }
        return '';
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Address extraction timeout')), 30000)
      )
      ]);
      if (address) address = address.replace(/^[^A-Za-z0-9]+/, '').trim();

      // Rating and total reviews
      const { rating, reviews } = await page.evaluate(() => {
        const out = { rating: null, reviews: null };
        const ratingEl = document.querySelector('[role="main"] [aria-label$="stars"], [role="main"] .F7nice');
        if (ratingEl) {
          const t = ratingEl.getAttribute('aria-label') || ratingEl.textContent || '';
          const m = /(\d+(?:\.\d+)?)/.exec(t);
          if (m) out.rating = parseFloat(m[1]);
        }
        const revEl = document.querySelector('[role="main"] a[href*="reviews"], [role="main"] .UY7F9');
        if (revEl) {
          const t = revEl.textContent || '';
          const m = /(\d[\d,]*)/.exec(t);
          if (m) out.reviews = parseInt(m[1].replace(/,/g, ''), 10);
        }
        return out;
      });

      const emails = this._extractEmails(html);
      // Only trust tel: link plus strong patterns from panel, avoid small numbers noise
      const morePhones = this._extractPhones(html).filter(p => p.replace(/\D/g, '').length >= 10);
      const phones = Array.from(new Set([phone, ...morePhones])).filter(Boolean);

      const normSite = website ? this._normalizeUrl(website) : '';

      // Removed debug log to reduce console spam
      // console.log(`[DEBUG] Final extraction result:`, {
      //   name,
      //   website: normSite,
      //   phone: phones[0] || '',
      //   address,
      //   rating,
      //   reviews,
      //   emailCount: emails.length
      // });

      return {
        name: name || (normSite ? this._hostnameAsName(normSite) : ''),
        phone: phones[0] || '',
        address: address || '',
        website: normSite || '',
        rating: rating ?? null,
        totalReviews: reviews ?? null,
        openingHours: null,
        searchPhrase,
        placeId: normSite || name || '',
        contact: {
          emails,
          phones,
        },
        website_url: normSite || '',
      };
    } catch (_) {
      return null;
    }
  }

  // Process a single card with timeout protection and optimized extraction
  async _processCardWithTimeout(page, entry, query, options, cardNumber) {
    try {
      // First try to extract from list card
      let rec = await this._extractFromListCard(page, entry, query);
      
      // If no phone found OR if we need email extraction, click aggressively to get full details
      if (!rec || !rec.phone || (options.wantEmail && !rec.website)) {
        console.log(`📞 No phone found or need website for email extraction, clicking card ${cardNumber} aggressively...`);
        
        // Add timeout protection for clicking and panel loading
        const clickPromise = this._clickCardAndExtract(page, entry, query);
        const clickTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Card ${cardNumber} click timeout after 15 seconds`)), 15000)
        );
        
        const full = await Promise.race([clickPromise, clickTimeoutPromise]);
        
        if (full && full.phone) {
          rec = full;
          console.log(`✅ Got contact after clicking: ${rec.name} - ${rec.phone}${rec.website ? ` - Website: ${rec.website}` : ''}`);
        } else {
          console.log(`❌ Still no contact after clicking card ${cardNumber}`);
          return null;
        }
      }
      
      return rec;
    } catch (err) {
      console.log(`❌ Error in _processCardWithTimeout for card ${cardNumber}:`, err.message);
      return null;
    }
  }

  // Optimized click and extract method with better error handling
  async _clickCardAndExtract(page, entry, query) {
    try {
      await this._clickCard(page, entry);
      await this._sleep(2000); // Restored proper wait time for data loading
      
      // Check for pause/stop after clicking card
      if (this.isPaused && this.isPaused()) {
        console.log('⏸️ Card processing paused after clicking');
        while (this.isPaused && this.isPaused()) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('▶️ Card processing resumed after clicking');
      }
      
      if (this.shouldStop && this.shouldStop()) {
        console.log('⏹️ Card processing stopped after clicking');
        return null;
      }
      
      // Try to extract from panel with timeout
      const extractPromise = this._extractDetailsFromPanel(page, query);
      const extractTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Panel extraction timeout')), 15000) // Increased timeout
      );
      
      return await Promise.race([extractPromise, extractTimeoutPromise]);
    } catch (err) {
      console.log(`❌ Error in _clickCardAndExtract:`, err.message);
      return null;
    }
  }

  // Extract minimal info from a list card without opening panel (ElementHandle-based)
  async _extractFromListCard(page, entry, searchPhrase = '') {
    try {
      // Add comprehensive timeout handling for evaluate call
      const data = await Promise.race([
        entry.evaluate((card) => {
        if (!card) return { debug: 'card_handle_null' };

        // Try multiple selectors for name
        const nameSelectors = ['.qBF1Pd', '.NrDZNb', '.qBF1Pd span', 'a.hfpxzc', '[data-value="Name"]', '.fontHeadlineSmall'];
        let nameEl = null;
        let usedNameSelector = '';

        for (const selector of nameSelectors) {
          nameEl = card.querySelector(selector);
          if (nameEl) { usedNameSelector = selector; break; }
        }
        const name = nameEl ? (nameEl.textContent || '').trim() : '';

        // Phone on card (if present)
        const telEl = card.querySelector('a[href^="tel:"]');
        const phone = telEl ? telEl.getAttribute('href').replace('tel:', '') : '';

        // Website on card (rare but possible)
        const webEl = card.querySelector('a[aria-label*="Website"], a[aria-label*="website"], a[href^="http"]');
        let website = '';
        if (webEl) {
          const href = webEl.getAttribute('href') || '';
          if (href && !/google\.com|maps\.google/i.test(href)) website = href;
        }

        // Debug info
        const cardHTML = card.outerHTML.substring(0, 500);
        const availableClasses = Array.from(card.querySelectorAll('*')).map(el => el.className).filter(Boolean).slice(0, 10);

        return {
          name,
          phone,
          website,
          debug: {
            foundCard: true,
            usedNameSelector,
            nameFound: !!name,
            phoneFound: !!phone,
            websiteFound: !!website,
            cardHTML,
            availableClasses
          }
        };
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Extract timeout')), 120000)
      )
      ]);

      // Enhanced logging for debugging
      if (data && data.debug) {
        // Removed debug log to reduce console spam
        // console.log(`[DEBUG] Card extraction result:`, {
        //   name: data.name,
        //   phone: data.phone,
        //   website: data.website,
        //   debug: data.debug
        // });
      }

      if (!data || !(data.name || data.phone || data.website)) {
        // Removed debug log to reduce console spam
        // console.log(`[DEBUG] No valid data extracted from card:`, data);
        return null;
      }

      return {
        name: data.name || '',
        phone: data.phone || '',
        address: '',
        website: data.website || '',
        rating: null,
        totalReviews: null,
        openingHours: null,
        searchPhrase,
        placeId: data.name || data.website || '',
        contact: { emails: [], phones: data.phone ? [data.phone] : [] },
        website_url: data.website || '',
      };
    } catch (err) {
      // Removed debug log to reduce console spam
      // console.log(`[DEBUG] Error in _extractFromListCard:`, err.message);
      // Return minimal data instead of null to prevent job failure
      return {
        name: 'Unknown Business',
        phone: '',
        address: '',
        website: '',
        rating: null,
        totalReviews: null,
        openingHours: null,
        searchPhrase,
        placeId: '',
        contact: { emails: [], phones: [] },
        website_url: '',
      };
    }
  }

  // Fast mode: get contact from list card; click only if phone missing (contact mandatory)
  async collectContactsFast(query, options = {}) {
    const { maxResults = 50, onBusiness, wantEmail = false } = options;
    const startTime = Date.now();
    const context = { operation: 'collectContactsFast', query };

    try {
      this.errorHandler.logProgress('maps-web-search', { status: 'started-fast', query });
      // Reuse shared browser/page for faster startup
      const page = await this._newPage();

      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 120000 });

      await this._handleConsent(page);
      await this._sleep(300);

      await this._waitForResultsList(page);

      const results = [];
      const seen = new Set();
      const processedCardKeys = new Set(); // Track processed card keys to prevent infinite loops

      let pageIndex = 0;
      let consecutiveScrollFailures = 0;
      const maxConsecutiveScrollFailures = 3;
      let totalCardsProcessed = 0;
      let totalCardsSkipped = 0;
      const startTime = Date.now();
      
      // Track last time we successfully saved a business to detect stalls
      let lastProgressAt = Date.now();

      while (pageIndex < this.maxScrollPages && results.length < maxResults) {
        const pageStartTime = Date.now();
        const entries = await this._getCardEntries(page);
        console.log(`📄 Page ${pageIndex + 1}: Found ${entries.length} business cards`);
        
        let processedThisPage = 0;
        let skippedThisPage = 0;
        
        // Process each card aggressively - extract immediately, click if needed
        for (let i = 0; i < entries.length && results.length < maxResults; i++) {
          const entry = entries[i];
          const cardStartTime = Date.now();
          
          try {
            console.log(`🔍 Processing card ${i + 1}/${entries.length}: ${results.length}/${maxResults} businesses extracted`);
            
            // Generate a unique key for this card to prevent infinite loops (with timeout fallback)
            const evalKey = entry.evaluate((el) => {
              const href = el.querySelector('a.hfpxzc')?.href || '';
              const name = el.querySelector('.qBF1Pd, .NrDZNb, .qBF1Pd span, a.hfpxzc')?.textContent?.trim() || '';
              return `${href}|${name}`;
            });
            const evalKeyTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('cardKey evaluate timeout')), 8000));
            let cardKey = '';
            try {
              cardKey = await Promise.race([evalKey, evalKeyTimeout]);
            } catch (e) {
              // Fallback to index-based key if evaluation is slow on server
              cardKey = `idx:${i}`;
              console.warn(`⚠️ Using fallback card key due to evaluate delay: ${e.message}`);
            }
            
            // Skip if we've already processed this exact card
            if (processedCardKeys.has(cardKey)) {
              console.log(`🔄 Skipping already processed card: ${cardKey}`);
              skippedThisPage++;
              continue;
            }
            
            // Mark this card as processed
            processedCardKeys.add(cardKey);
            
            // Check for pause/stop before processing each card
            if (this.isPaused && this.isPaused()) {
              console.log('⏸️ Card processing paused by user request');
              while (this.isPaused && this.isPaused()) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              console.log('▶️ Card processing resumed by user request');
            }
            
            if (this.shouldStop && this.shouldStop()) {
              console.log('⏹️ Card processing stopped by user request');
              return results;
            }
            
            // Add timeout protection for each card processing
            const cardProcessingPromise = this._processCardWithTimeout(page, entry, query, options, i + 1);
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Card ${i + 1} processing timeout after 30 seconds`)), 30000)
            );
            
            let rec = await Promise.race([cardProcessingPromise, timeoutPromise]);
            
            // Save if we have valid contact
            if (rec && rec.phone) {
              const key = `${rec.name}|${rec.phone}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push(rec);
                processedThisPage++;
                lastProgressAt = Date.now();
                console.log(`✅ Saved business: ${rec.name} - Phone: ${rec.phone} (${results.length}/${maxResults})`);
                if (typeof onBusiness === 'function') {
                  console.log(`📧 Calling onBusiness callback for: ${rec.name}${rec.website ? ` - Website: ${rec.website}` : ''}`);
                  try { await onBusiness(rec); } catch (cbErr) { await this.errorHandler.logAndContinue(cbErr, { ...context, step: 'onBusiness-fast' }); }
                }
              } else {
                console.log(`🔄 Duplicate business skipped: ${rec.name} (key: ${key})`);
                skippedThisPage++;
              }
            } else {
              console.log(`❌ Invalid business data, skipping card ${i + 1}`);
              skippedThisPage++;
            }
            
            const cardDuration = Date.now() - cardStartTime;
            if (cardDuration > 10000) {
              console.warn(`⚠️ Card ${i + 1} took ${cardDuration}ms to process`);
            }
            
          } catch (err) {
            console.log(`❌ Error processing card ${i + 1}:`, err.message);
            skippedThisPage++;
            await this.errorHandler.logAndContinue(err, { ...context, step: 'fast-card' });
            
            // If we've had too many consecutive errors, break to prevent infinite loops
            if (skippedThisPage > 10 && processedThisPage === 0) {
              console.warn(`⚠️ Too many consecutive errors (${skippedThisPage}), breaking to prevent timeout`);
              break;
            }
            
            // If we're getting too many duplicates, break to prevent infinite loops
            if (skippedThisPage > 20) {
              console.warn(`⚠️ Too many skipped cards (${skippedThisPage}), likely infinite loop detected`);
              break;
            }
          }
        }
        
        totalCardsProcessed += processedThisPage;
        totalCardsSkipped += skippedThisPage;
        const pageDuration = Date.now() - pageStartTime;
        const totalDuration = Date.now() - startTime;
        
        console.log(`📄 Page ${pageIndex + 1}: Processed ${processedThisPage} new, skipped ${skippedThisPage} from ${entries.length} cards`);
        console.log(`📄 Page ${pageIndex + 1} took ${pageDuration}ms. Total: ${totalCardsProcessed} processed, ${totalCardsSkipped} skipped in ${totalDuration}ms`);
        
        // Only scroll if we haven't reached maxResults yet
        if (results.length < maxResults) {
          console.log(`📄 Scrolling to load more cards... (current: ${results.length}/${maxResults})`);
          const loadedMore = await this._scrollResultsList(page);
          console.log(`📄 Scrolling result: ${loadedMore ? 'SUCCESS' : 'FAILED'}`);
          
          if (!loadedMore) {
            consecutiveScrollFailures++;
            console.log(`📄 ⚠️ Scroll failure ${consecutiveScrollFailures}/${maxConsecutiveScrollFailures}`);
            
            if (consecutiveScrollFailures >= maxConsecutiveScrollFailures) {
              console.log(`📄 🛑 Stopping: ${maxConsecutiveScrollFailures} consecutive scroll failures`);
              break;
            }
            
            console.log(`📄 ⏳ Waiting 3 seconds before retry...`);
            await this._sleep(3000);
          } else {
            consecutiveScrollFailures = 0; // Reset counter on successful scroll
          }

          // If no progress for 60 seconds, try a gentle UI nudge to change selection
          const noProgressMs = Date.now() - lastProgressAt;
          if (noProgressMs > 60000) {
            console.warn(`⚠️ No new businesses saved for ${noProgressMs}ms, nudging UI to avoid stall`);
            try {
              await page.keyboard.press('End');
              await this._sleep(1500);
              await page.keyboard.press('Home');
              await this._sleep(1500);
            } catch (_) {}
            lastProgressAt = Date.now();
          }
        } else {
          console.log(`📄 🎯 Target reached! Extracted ${results.length}/${maxResults} businesses`);
          break;
        }
        
        pageIndex++;
      }

      const duration = Date.now() - startTime;
      console.log(`📊 Final Summary: ${results.length}/${maxResults} businesses extracted in ${duration}ms`);
      console.log(`📊 Total cards processed: ${totalCardsProcessed}, skipped: ${totalCardsSkipped}`);
      console.log(`📊 Average time per business: ${results.length > 0 ? Math.round(duration / results.length) : 0}ms`);
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, true);
      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);
      await this.errorHandler.logAndContinue(error, context);
      return [];
    } finally {
      // Close only the page; keep browser alive for reuse
      try {
        const pages = (await (this._browser ? this._browser.pages() : [])) || [];
        if (pages.length) {
          const p = pages[pages.length - 1];
          await p.close().catch(() => {});
        }
      } catch (_) { }
    }
  }

  // Enrich with emails from website pages; normalize and dedupe by hostname
    async enrichBusinessEmail(biz, options = {}) {
        const { deepPaths = true, timeoutMs = 8000 } = options; // Reduced timeout
        try {
            const website = biz.website || biz.website_url || '';
            console.log(`📧 Email extraction for: ${biz.name} - Website: ${website}`);
            
            if (!website) {
                console.log(`📧 ❌ No website found for ${biz.name}`);
                return biz;
            }
            
            // Skip long URLs and third-party platforms for speed
            const skipPatterns = [
                'swiggy.com', 'zomato.com', 'instagram.com', 'facebook.com', 
                'twitter.com', 'linkedin.com', 'youtube.com', 'tiktok.com',
                'google.com', 'maps.google.com'
            ];
            
            const shouldSkip = skipPatterns.some(pattern => website.includes(pattern));
            if (shouldSkip) {
                console.log(`📧 ⚡ Skipping third-party URL for speed: ${website}`);
                return biz;
            }
            
            const norm = this._normalizeUrl(website);
            if (!norm) {
                console.log(`📧 ❌ Could not normalize URL: ${website}`);
                return biz;
            }
            
            let host = '';
            try { host = new URL(norm).hostname.replace(/^www\./, ''); } catch (_) { }
            if (!this._emailHostCache) this._emailHostCache = new Set();
            if (host && this._emailHostCache.has(host)) {
                console.log(`📧 ⚠️ Already processed host: ${host}`);
                return biz;
            }

            const fetchAndExtract = async (url) => {
                try {
                    console.log(`📧 🔍 Fetching: ${url}`);
                    const resp = await axios.get(url, { 
                        timeout: timeoutMs, 
                        headers: { 'User-Agent': this.userAgent },
                        maxRedirects: 3 // Limit redirects for speed
                    });
                    const html = resp.data || '';
                    const emails = this._extractEmails(html);
                    const socials = this._extractSocialProfiles(html);
                    console.log(`📧 📧 Found ${emails.length} emails and socials on ${url}`);
                    return { emails, socials };
                } catch (err) {
                    console.log(`📧 ❌ Failed to fetch ${url}: ${err.message}`);
                    return { emails: [], socials: {} };
                }
            };

            // Only check main page and contact page for speed
            const urls = [norm];
            if (deepPaths) {
                const base = norm.replace(/\/$/, '');
                urls.push(`${base}/contact`); // Only contact page, not all pages
            }

            console.log(`📧 🔍 Checking ${urls.length} URLs for emails & socials...`);
            const foundEmails = new Set();
            const foundSocials = {
              linkedin: '',
              facebook: '',
              instagram: '',
              twitter: '',
              youtube: '',
              tiktok: ''
            };

            for (const u of urls) {
                const { emails, socials } = await fetchAndExtract(u);
                emails.forEach(e => foundEmails.add(e));
                
                Object.keys(socials).forEach(platform => {
                  if (socials[platform] && !foundSocials[platform]) {
                    foundSocials[platform] = socials[platform];
                  }
                });
            }

            const enrichedBiz = {
              ...biz,
              socialProfiles: {
                linkedin: foundSocials.linkedin || biz.linkedin || biz.socialProfiles?.linkedin || '',
                facebook: foundSocials.facebook || biz.facebook || biz.socialProfiles?.facebook || '',
                instagram: foundSocials.instagram || biz.instagram || biz.socialProfiles?.instagram || '',
                twitter: foundSocials.twitter || biz.twitter || biz.socialProfiles?.twitter || '',
                youtube: foundSocials.youtube || biz.youtube || biz.socialProfiles?.youtube || '',
                tiktok: foundSocials.tiktok || biz.tiktok || biz.socialProfiles?.tiktok || ''
              }
            };

            enrichedBiz.linkedin = enrichedBiz.socialProfiles.linkedin;
            enrichedBiz.facebook = enrichedBiz.socialProfiles.facebook;
            enrichedBiz.instagram = enrichedBiz.socialProfiles.instagram;
            enrichedBiz.twitter = enrichedBiz.socialProfiles.twitter;
            enrichedBiz.youtube = enrichedBiz.socialProfiles.youtube;
            enrichedBiz.tiktok = enrichedBiz.socialProfiles.tiktok;

            if (foundEmails.size > 0) {
                if (host) this._emailHostCache.add(host);
                const merged = Array.from(new Set([...(biz.contact?.emails || []), ...Array.from(foundEmails)]));
                console.log(`📧 ✅ Successfully extracted ${merged.length} emails for ${biz.name}: ${merged.join(', ')}`);
                enrichedBiz.contact = { ...(biz.contact || {}), emails: merged };
            } else {
                console.log(`📧 ❌ No emails found for ${biz.name} on any URL`);
            }
            return enrichedBiz;
        } catch (err) {
            console.log(`📧 ❌ Email extraction error for ${biz.name}: ${err.message}`);
            return biz;
        }
    }

  // Browser cleanup monitoring for Render
  _startBrowserCleanupMonitoring() {
    // Removed debug log to reduce console spam
    // console.log('[DEBUG] Starting browser cleanup monitoring for Render');

    // Monitor active browsers every 30 seconds
    this._browserCleanupInterval = setInterval(() => {
      // Removed debug log to reduce console spam
      // console.log(`[DEBUG] Active browsers: ${this._activeBrowsers.size}`);

      // Force cleanup of any stale browsers
      if (this._activeBrowsers.size > 0) {
        console.warn(`[DEBUG] Found ${this._activeBrowsers.size} active browsers, attempting cleanup`);
        this._activeBrowsers.forEach(async (browser) => {
          try {
            if (browser && !browser._closed) {
              await browser.close();
              // Removed debug log to reduce console spam
              // console.log('[DEBUG] Cleaned up stale browser');
            }
            this._activeBrowsers.delete(browser);
          } catch (error) {
            console.error('[DEBUG] Error cleaning up browser:', error.message);
          }
        });
      }
    }, 30000);
  }

  // Track browser instances
  _trackBrowser(browser) {
    if (process.env.RENDER) {
      this._activeBrowsers.add(browser);
      // Removed debug log to reduce console spam
      // console.log(`[DEBUG] Tracking browser (total: ${this._activeBrowsers.size})`);
    }
  }

  // Untrack browser instances
  _untrackBrowser(browser) {
    if (process.env.RENDER) {
      this._activeBrowsers.delete(browser);
      // Removed debug log to reduce console spam
      // console.log(`[DEBUG] Untracked browser (remaining: ${this._activeBrowsers.size})`);
    }
  }
}

module.exports = GoogleMapsWebService;