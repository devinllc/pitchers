/*
 * GoogleMapsWebService
 * Scrapes Google Maps web UI (no API key) to collect business website URLs for a query,
 * then optionally scrapes each website for contact information (email/phone) directly.
 *
 * WARNING: Scraping Google properties may violate their Terms of Service. Use responsibly.
 */

// Puppeteer setup: prefer full puppeteer on Render and local; use puppeteer-core + @sparticuz/chromium only on true serverless (Vercel/Lambda)
let puppeteer;
let chromium;
try {
  const isServerless = !!(process.env.VERCEL || process.env.AWS_REGION || process.env.AWS_EXECUTION_ENV);
  const isRender = !!process.env.RENDER;
  if (isServerless && !isRender) {
    // Serverless (not Render): use puppeteer-core with sparticuz chromium
    puppeteer = require('puppeteer-core');
    chromium = require('@sparticuz/chromium');
  } else {
    // Render or local/dev: use full puppeteer which manages Chrome via postinstall
    puppeteer = require('puppeteer');
  }
} catch (_) {
  // Fallback to puppeteer if dynamic require fails
  try { puppeteer = require('puppeteer'); } catch (__) {}
}
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

    this.headless = options.headless !== undefined ? options.headless : true;
    this.maxScrollPages = options.maxScrollPages || 3; // similar to API's pagination pages
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    // Cache to avoid re-fetching the same host repeatedly during email enrichment
    this._emailHostCache = new Set();
  }

  // Build launch options compatible with both local and serverless
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
    ];

    // 1) If explicit executable path provided (Render recommended), honor it
    let execPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH || '';
    const fs = require('fs');
    const path = require('path');
    const exists = (p) => {
      try { return p && fs.existsSync(p); } catch { return false; }
    };
    if (execPath && !exists(execPath)) {
      // Env provided but invalid, ignore
      execPath = '';
    }
    if (!execPath && puppeteer && typeof puppeteer.executablePath === 'function') {
      try {
        const p = puppeteer.executablePath();
        if (exists(p)) execPath = p;
      } catch (_) {}
    }
    // Scan Puppeteer cache for installed Chrome (works on Render and elsewhere)
    if (!execPath) {
      const bases = [
        process.env.PUPPETEER_CACHE_DIR,
        '/opt/render/project/src/.cache/puppeteer', // project-local so it gets bundled into slug
        '/opt/render/.cache/puppeteer',             // default Render cache (may not be present at runtime)
      ].filter(Boolean);
      for (const cacheBase of bases) {
        try {
          const chromeRoot = path.join(cacheBase, 'chrome');
          if (fs.existsSync(chromeRoot)) {
            const entries = fs.readdirSync(chromeRoot).filter(Boolean);
            if (entries.length) {
              const latest = entries.sort().reverse()[0];
              const platDir = path.join(chromeRoot, latest);
              const candidates = [
                path.join(platDir, 'chrome-linux64', 'chrome'),
                path.join(platDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
              ];
              for (const c of candidates) { if (exists(c)) { execPath = c; break; } }
              if (execPath) break;
            }
          }
        } catch (_) {}
      }
    }
    if (execPath && exists(execPath)) {
      return { headless: this.headless, args: commonArgs, executablePath: execPath, protocolTimeout: 120000 };
    }

    // 2) If using @sparticuz/chromium (true serverless), include its settings
    if (chromium && puppeteer && puppeteer.product !== 'firefox') {
      const chromiumExec = await chromium.executablePath();
      return {
        args: [...chromium.args, ...commonArgs],
        defaultViewport: chromium.defaultViewport,
        executablePath: chromiumExec,
        headless: typeof chromium.headless === 'boolean' ? chromium.headless : 'new',
        protocolTimeout: 120000,
      };
    }

    // 3) Fallback: let puppeteer decide
    return { headless: this.headless, args: commonArgs, protocolTimeout: 120000 };
  }

  // Retry browser launch to mitigate occasional 30s chrome startup timeouts on Render
  async _launchBrowserWithRetry(launchOptions, attempts = 2) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await puppeteer.launch(launchOptions);
      } catch (err) {
        lastErr = err;
        // small backoff before retry
        await this._sleep(1500 * i);
      }
    }
    throw lastErr;
  }

  // Utility: Collect card entries with both container selector and anchor href
  async _getCardEntries(page) {
    const entries = await page.evaluate(() => {
      const list = [];
      const cards = document.querySelectorAll('[role="feed"] .Nv2PK');
      cards.forEach((el, idx) => {
        const selector = `[role="feed"] .Nv2PK:nth-of-type(${idx + 1})`;
        const a = el.querySelector('a.hfpxzc');
        list.push({ selector, href: a && a.href ? a.href : '' });
      });
      return list;
    });
    // Deduplicate by href+selector to be safe
    const seen = new Set();
    const out = [];
    for (const e of entries) {
      const key = `${e.href}|${e.selector}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }

  // Utility: Click logic with fallback: try anchor, then container
  async _clickCard(page, entry) {
    await page.evaluate((e) => {
      const a = e.href ? Array.from(document.querySelectorAll('[role="feed"] a.hfpxzc')).find(x => x.href === e.href) : null;
      if (a) {
        a.scrollIntoView({ block: 'center' });
        a.click();
      } else {
        const el = document.querySelector(e.selector);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          (el.querySelector('a.hfpxzc') || el).click();
        }
      }
    }, entry);
  }

  // Public: NEW - collect full business details from Maps details panel without visiting external websites
  // options: { maxResults?: number, onBusiness?: (biz) => Promise<void> | void }
  async collectBusinessDetailsFromQuery(query, options = {}) {
    const { maxResults = 50, onBusiness } = options;
    const startTime = Date.now();
    const context = { operation: 'collectBusinessDetailsFromQuery', query };

    try {
      this.errorHandler.logProgress('maps-web-search', { status: 'started', query });
      await this.rateLimiter.delay();

      const launchOptions = await this._buildLaunchOptions();
      const browser = await this._launchBrowserWithRetry(launchOptions, 2);
      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      await page.setViewport({ width: 1366, height: 900 });

      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
      await this._gotoWithRetry(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }, 2);

      await this._handleConsent(page);
      await this._sleep(500);
      await this._saveDebugArtifacts(page, 'init');

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
            // Stable key combines href and selector
            const cardKey = `${entry.href}|${entry.selector}`;
            if (cardKey && seenCards.has(cardKey)) {
              continue; // already processed this card
            }

            const beforeName = await this._getCurrentPlaceName(page);

            if (cardKey) seenCards.add(cardKey);

            await this._clickCard(page, entry);

            await this.rateLimiter.delay();
            await page.waitForSelector('[role="main"]', { timeout: 20000 }).catch(() => {});
            // Wait for place name to change and not be a generic 'Results' (longer on Render)
            await page.waitForFunction(() => {
              const nameEl = document.querySelector('[role="main"] .DUwDvf, [role="main"] h1');
              const name = nameEl ? nameEl.textContent.trim() : '';
              return name && name.toLowerCase() !== 'results';
            }, { timeout: 12000 }).catch(() => {});
            const currentName = await this._getCurrentPlaceName(page);
            if (currentName && currentName !== beforeName) lastPlaceName = currentName;
            else {
              // Fallback: try clicking container if anchor didn't switch
              await this._clickCard(page, { selector: entry.selector, href: '' });
              await this._sleep(800);
              // One more try to wait for details
              await page.waitForFunction(() => {
                const nameEl = document.querySelector('[role="main"] .DUwDvf, [role="main"] h1');
                const name = nameEl ? nameEl.textContent.trim() : '';
                return name && name.toLowerCase() !== 'results';
              }, { timeout: 6000 }).catch(() => {});
            }

            const details = await this._extractDetailsFromPanel(page, query);
            if (details && (details.website || details.name)) {
              const key = details.website || `${details.name}|${details.phone || ''}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push(details);
                this.errorHandler.logProgress('maps-web-search', { status: 'details-collected', name: details.name, website: details.website });
                // Stream out this business immediately if callback provided
                if (typeof onBusiness === 'function') {
                  try {
                    await onBusiness(details);
                  } catch (cbErr) {
                    await this.errorHandler.logAndContinue(cbErr, { ...context, step: 'onBusiness-callback', name: details.name, website: details.website });
                  }
                }
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
                    try { await onBusiness(minimal); } catch (cbErr) {
                      await this.errorHandler.logAndContinue(cbErr, { ...context, step: 'onBusiness-callback-minimal', name: minimal.name, phone: minimal.phone });
                    }
                  }
                }
              } else {
                this.errorHandler.logProgress('maps-web-search', { status: 'details-missing', href: entry.href, selector: entry.selector });
              }
            }
          } catch (err) {
            await this.errorHandler.logAndContinue(err, { ...context, step: 'collect-details', href: entry.href, selector: entry.selector });
          }
        }

        const loadedMore = await this._scrollResultsList(page);
        if (!loadedMore) break;
      }

      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, true);
      await browser.close();
      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);
      await this.errorHandler.logAndContinue(error, context);
      return [];
    }
  }

  // Public: Step 1 - given a query, collect a deduped list of website URLs from Maps UI.
  async collectWebsiteUrlsFromQuery(query) {
    const startTime = Date.now();
    const context = { operation: 'collectWebsiteUrlsFromQuery', query };

    try {
      this.errorHandler.logProgress('maps-web-search', { status: 'started', query });
      await this.rateLimiter.delay();

      const launchOptions = await this._buildLaunchOptions();
      const browser = await this._launchBrowserWithRetry(launchOptions, 2);
      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.setViewport({ width: 1366, height: 900 });

      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
      await this._gotoWithRetry(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }, 2);

      // Try to accept consent if shown
      await this._handleConsent(page);
      await this._sleep(1000);

      // Debug: initial snapshot
      await this._saveDebugArtifacts(page, 'init');

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

            await this.rateLimiter.delay();

            // Wait for the side panel details to change/render
            await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => {});
            const currentName = await this._getCurrentPlaceName(page);
            if (currentName && currentName === lastPlaceName) {
              // likely didn't change; try a short wait and continue
              await this._sleep(400);
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
        await this._saveDebugArtifacts(page, 'no-urls');
        this.errorHandler.logProgress('maps-web-search', { status: 'debug-artifacts', message: 'No URLs found, saved snapshots' });
      }

      await browser.close();

      return urls;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);
      await this.errorHandler.logAndContinue(error, context);
      return [];
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
            await this.rateLimiter.delay();
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
      } catch (_) {}
    }
    // As a fallback, just wait a bit
    await this._sleep(2000);
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

  // Utility: Scroll the results list to load more entries
  async _scrollResultsList(page) {
    try {
      const scrolled = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (!feed) return false;
        const before = feed.scrollTop;
        feed.scrollBy(0, feed.clientHeight - 100);
        return feed.scrollTop !== before;
      });
      await this._sleep(1200); // allow new items to load
      return scrolled;
    } catch (_) {
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
          await el.click().catch(() => {});
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
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
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
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','mc_cid','mc_eid'].forEach(p => u.searchParams.delete(p));
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

  // Retry page navigation to reduce flaky timeouts on Maps
  async _gotoWithRetry(page, url, options = {}, attempts = 2) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
      try {
        await page.goto(url, options);
        return;
      } catch (err) {
        lastErr = err;
        // brief backoff and a second attempt with a slightly different wait strategy
        await this._sleep(1000 * i);
        if (i === attempts) break;
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: Math.max(90000, (options.timeout || 60000)) });
          return;
        } catch (e2) {
          lastErr = e2;
        }
      }
    }
    throw lastErr;
  }

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
      if (!panel) return null;
      const html = await page.evaluate(el => el.innerHTML, panel);

      const name = await this._getCurrentPlaceName(page);
      if (!name) return null; // ignore generic panels like 'Results'

      // Website link
      const website = await page.evaluate(() => {
        const a = document.querySelector('[role="main"] a[data-item-id*="authority"], [role="main"] a[data-item-id*="website"], [role="main"] a[aria-label*="Website"]');
        return a && a.href && a.href.startsWith('http') ? a.href : '';
      });

      // Primary phone
      const phone = await page.evaluate(() => {
        const tel = document.querySelector('[role="main"] a[href^="tel:"]');
        const raw = tel ? tel.getAttribute('href').replace('tel:', '') : '';
        return raw && /\d{7,}/.test(raw.replace(/\D/g, '')) ? raw : '';
      });

      // Address candidates
      let address = await page.evaluate(() => {
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
      });
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

  // Extract minimal info from a list card without opening panel
  async _extractFromListCard(page, entry, searchPhrase = '') {
    try {
      const data = await page.evaluate((e) => {
        const card = document.querySelector(e.selector);
        if (!card) return null;
        const nameEl = card.querySelector('.qBF1Pd, .NrDZNb, .qBF1Pd span') || card.querySelector('a.hfpxzc');
        const name = nameEl ? (nameEl.textContent || '').trim() : '';
        const telEl = card.querySelector('a[href^="tel:"]');
        const phone = telEl ? telEl.getAttribute('href').replace('tel:', '') : '';
        return { name, phone };
      }, entry);
      if (!data || !(data.name || data.phone)) return null;
      return {
        name: data.name || '',
        phone: data.phone || '',
        address: '',
        website: '',
        rating: null,
        totalReviews: null,
        openingHours: null,
        searchPhrase,
        placeId: data.name || '',
        contact: { emails: [], phones: data.phone ? [data.phone] : [] },
        website_url: '',
      };
    } catch (_) {
      return null;
    }
  }

  // Fast mode: get contact from list card; click only if phone missing (contact mandatory)
  async collectContactsFast(query, options = {}) {
    const { maxResults = 50, onBusiness } = options;
    const startTime = Date.now();
    const context = { operation: 'collectContactsFast', query };

    try {
      this.errorHandler.logProgress('maps-web-search', { status: 'started-fast', query });
      await this.rateLimiter.delay();

      const launchOptions = await this._buildLaunchOptions();
      const browser = await this._launchBrowserWithRetry(launchOptions, 2);
      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.setViewport({ width: 1366, height: 900 });

      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

      await this._handleConsent(page);
      await this._sleep(500);

      await this._waitForResultsList(page);

      const results = [];
      const seen = new Set();

      for (let pageIndex = 0; pageIndex < this.maxScrollPages && results.length < maxResults; pageIndex++) {
        const entries = await this._getCardEntries(page);
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          try {
            let rec = await this._extractFromListCard(page, entry, query);
            if (!rec || !rec.phone) {
              // Phone is mandatory -> click to panel and try again
              await this._clickCard(page, entry);
              await this.rateLimiter.delay();
              const full = await this._extractDetailsFromPanel(page, query);
              if (full && full.phone) rec = full;
            }
            if (rec && rec.phone) {
              const key = `${rec.name}|${rec.phone}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push(rec);
                if (typeof onBusiness === 'function') {
                  try { await onBusiness(rec); } catch (cbErr) { await this.errorHandler.logAndContinue(cbErr, { ...context, step: 'onBusiness-fast' }); }
                }
              }
            }
          } catch (err) {
            await this.errorHandler.logAndContinue(err, { ...context, step: 'fast-card' });
          }
        }
        const loadedMore = await this._scrollResultsList(page);
        if (!loadedMore) break;
      }

      await browser.close();
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

  // Enrich with emails from website pages; normalize and dedupe by hostname
  async enrichBusinessEmail(biz, options = {}) {
    const { deepPaths = true, timeoutMs = 12000 } = options;
    try {
      const website = biz.website || biz.website_url || '';
      if (!website) return biz;
      const norm = this._normalizeUrl(website);
      if (!norm) return biz;
      let host = '';
      try { host = new URL(norm).hostname.replace(/^www\./, ''); } catch (_) {}
      if (!this._emailHostCache) this._emailHostCache = new Set();
      if (host && this._emailHostCache.has(host)) return biz;

      const fetchAndExtract = async (url) => {
        try {
          const resp = await axios.get(url, { timeout: timeoutMs, headers: { 'User-Agent': this.userAgent } });
          return this._extractEmails(resp.data || '');
        } catch (_) { return []; }
      };

      const urls = [norm];
      if (deepPaths) {
        const base = norm.replace(/\/$/, '');
        urls.push(`${base}/contact`, `${base}/contact-us`, `${base}/about`, `${base}/support`);
      }

      const found = new Set();
      for (const u of urls) {
        const emails = await fetchAndExtract(u);
        emails.forEach(e => found.add(e));
        if (found.size > 0) break;
      }

      if (found.size > 0) {
        if (host) this._emailHostCache.add(host);
        const merged = Array.from(new Set([...(biz.contact?.emails || []), ...Array.from(found)]));
        return { ...biz, contact: { ...(biz.contact || {}), emails: merged } };
      }
      return biz;
    } catch (_) {
      return biz;
    }
  }

}

module.exports = GoogleMapsWebService;
