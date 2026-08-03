/**
 * Social Media Agent Service — Production Grade
 *
 * - DOM injection for all text (no keyboard.type)
 * - Fresh temp browser per automation task (no conflicts)
 * - Brand hashtag automatically added to every comment
 * - No screenshot saving
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SocialPuppeteerService = require('./socialPuppeteerService');
const DatabaseService = require('./database');

// Fallback comment templates if AI call fails
const FALLBACK_COMMENTS = [
  'Great insights here — exactly what teams scaling in this space need to see! 🔥',
  'Really valuable perspective. Bookmarking this for our team. 💡',
  'This is gold — super actionable for anyone building in this niche. 🚀',
  'Spot on! Appreciate you taking the time to share this. ✨',
  'Absolutely love this take. More founders need to see this! 🙌',
  'Timely and relevant — the kind of content that actually adds value. 🌟',
  'Couldn\'t agree more. Very actionable and well-articulated. 💯',
];

class SocialMediaAgentService {
  static instance = null;

  static getInstance() {
    if (!SocialMediaAgentService.instance) {
      SocialMediaAgentService.instance = new SocialMediaAgentService();
    }
    return SocialMediaAgentService.instance;
  }

  constructor() {
    this.openRouterKey = process.env.OPENROUTER_API_KEY;
    this.modelName = process.env.OPENROUTER_MODEL || process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'openrouter/auto';
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.db = new DatabaseService();
    this.db.connect().catch(() => { });
    this._initPRTable().catch(() => { });
    console.log('✅ SocialMediaAgentService initialized');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async downloadTempImage() {
    const url = `https://picsum.photos/800/600?random=${Date.now()}`;
    const tempDir = path.join(__dirname, '..', '.temp_images');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `img_${crypto.randomBytes(4).toString('hex')}.jpg`);
    const writer = fs.createWriteStream(filePath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', (err) => { fs.unlink(filePath, () => { }); reject(err); });
    });
  }

  // ── PR Comment DB ─────────────────────────────────────────────────────────

  async _initPRTable() {
    await this.db.pool.query(`
      CREATE TABLE IF NOT EXISTS social_pr_comments (
        id          SERIAL PRIMARY KEY,
        user_email  TEXT NOT NULL,
        platform    TEXT NOT NULL,
        hashtag     TEXT,
        comment     TEXT,
        brand_tag   TEXT,
        post_url    TEXT,
        status      TEXT DEFAULT 'posted',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add post_url column if it doesn't exist (for existing installs)
    await this.db.pool.query(`
      ALTER TABLE social_pr_comments ADD COLUMN IF NOT EXISTS post_url TEXT
    `).catch(() => { });
    console.log('[SocialAgent] social_pr_comments table ready');
  }

  /**
   * Fetch recent PR history for a user+platform to prevent duplicates.
   * Returns arrays of already-used post URLs and keywords (last 30 days).
   */
  async _getRecentPRHistory(userEmail, platform) {
    try {
      const result = await this.db.pool.query(
        `SELECT post_url, hashtag
         FROM social_pr_comments
         WHERE user_email = $1 AND platform = $2
           AND created_at > NOW() - INTERVAL '30 days'
         ORDER BY created_at DESC
         LIMIT 100`,
        [userEmail, platform]
      );
      const usedPostUrls = new Set(result.rows.map(r => r.post_url).filter(Boolean));
      const usedKeywords = [...new Set(result.rows.map(r => r.hashtag).filter(Boolean))];
      return { usedPostUrls, usedKeywords };
    } catch (err) {
      console.warn('[SocialAgent] Failed to fetch PR history:', err.message);
      return { usedPostUrls: new Set(), usedKeywords: [] };
    }
  }

  async _logPRComment({ userEmail, platform, hashtag, comment, brandTag, postUrl, status = 'posted' }) {
    try {
      await this.db.pool.query(
        `INSERT INTO social_pr_comments (user_email, platform, hashtag, comment, brand_tag, post_url, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userEmail, platform, hashtag, comment, brandTag || null, postUrl || null, status]
      );
    } catch (err) {
      console.warn('[SocialAgent] Failed to log PR comment:', err.message);
    }
  }

  /**
   * Extract brand name from niche text for use as a branded hashtag.
   * Uses explicit brand-indicator patterns first, then falls back to
   * capitalized words while skipping common English words.
   */
  _extractBrandHashtag(niche) {
    if (!niche) return null;

    // Words to skip — common English words that get falsely matched
    const BLOCKLIST = new Set([
      'We', 'Our', 'The', 'This', 'That', 'Your', 'Their', 'Its', 'My',
      'Are', 'Is', 'Has', 'Have', 'Can', 'Will', 'Get', 'Do', 'Be', 'By',
      'For', 'From', 'With', 'And', 'But', 'Not', 'All', 'Any', 'Some',
      'AI', 'B2B', 'CRM', 'SaaS', 'API', 'CEO', 'COO', 'You',
      'Sales', 'Team', 'Lead', 'Data', 'Auto', 'Tool', 'App', 'Web',
      'Here', 'Now', 'New', 'Use', 'See', 'Help', 'More', 'Top', 'Best',
      'Just', 'Many', 'Also', 'They', 'When', 'What', 'How', 'Why',
      'Time', 'Work', 'Make', 'Find', 'Show', 'Give', 'Take', 'Call',
      'Phone', 'Number', 'Numbers', 'Email', 'Link', 'Page', 'User',
      // Additional common words that should not become brand tags
      'Where', 'Watch', 'Vote', 'Live', 'Join', 'Start', 'Next', 'Build',
      'People', 'Viewers', 'Creators', 'Platform', 'Community', 'Unlike',
      'Influence', 'Perfect', 'Why', 'With', 'Stream', 'Cast', 'Crowd',
      'Features', 'Hosts', 'Earn', 'Launch', 'Create', 'Share', 'Grow',
    ]);

    // Pattern 1: explicit brand markers  e.g. "brand: Pitchers" or "called Pitchers"
    const explicit = niche.match(
      /(?:brand|product|company|app|tool|platform|service|software|startup|called|named|is called|named|product called)[:\s]+([A-Z][A-Za-z0-9]{2,})/i
    );
    if (explicit?.[1] && !BLOCKLIST.has(explicit[1])) return `#${explicit[1]}`;

    // Pattern 2: "XYZ is/helps/automates" — product name before verb
    const verbPattern = niche.match(
      /([A-Z][A-Za-z0-9]{2,})\s+(?:v\d|\d\.\d|is|helps|enables|automates|connects|lets|allows|powers|manages)/
    );
    if (verbPattern?.[1] && !BLOCKLIST.has(verbPattern[1])) return `#${verbPattern[1]}`;

    // Pattern 3: First capitalized word in text (not a common word)
    const words = niche.split(/[\s,.:;!?()]+/);
    for (const word of words) {
      if (/^[A-Z][A-Za-z0-9]{2,}$/.test(word) && !BLOCKLIST.has(word)) {
        return `#${word}`;
      }
    }

    return null;
  }

  // ── Page setup ────────────────────────────────────────────────────────────

  async _setupPage(page) {
    const browser = page.browser();
    let nativeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    try {
      const rawUA = await browser.userAgent();
      if (rawUA) nativeUA = rawUA.replace('HeadlessChrome', 'Chrome');
    } catch (_) { }

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
  }

  // ── Trending context ──────────────────────────────────────────────────────

  _getTrendingContext() {
    const now = new Date();
    const day = now.toLocaleDateString('en-US', { weekday: 'long' });
    const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const contentAngles = [
      'a data-driven insight or statistic that challenges a common industry myth',
      'a contrarian "what most people get wrong" take on a key business challenge',
      'a step-by-step tactical framework for solving a specific pain point',
      'a motivational story highlighting a real customer success or transformation',
      'a trending 2025 topic (AI automation, revenue growth) tied to this niche',
      'a bold industry prediction or thought-leadership opinion for this quarter',
      'a quick-wins productivity hack providing immediate actionable value',
    ];
    const trendingTopics = [
      'AI automation replacing manual work in sales teams',
      'how top B2B companies are scaling with AI tools in 2025',
      'B2B lead generation strategies that actually work',
      'sales automation ROI and conversion rate optimization',
      'why smart AI-driven outreach outperforms cold calling',
      'the future of automated business development pipelines',
      'cutting operational costs while scaling revenue with AI',
    ];

    const angle = contentAngles[now.getDay() % contentAngles.length];
    const trend = trendingTopics[(now.getDate() + now.getHours()) % trendingTopics.length];
    const seed = `${date}-${Math.floor(Date.now() / 3600000)}`;
    return { day, date, angle, trend, seed };
  }

  // ── AI Post Generation ────────────────────────────────────────────────────

  async generateAIPost(platform, niche, tone) {
    if (!this.openRouterKey) throw new Error('OPENROUTER_API_KEY not configured.');

    const { day, date, angle, trend, seed } = this._getTrendingContext();
    const platformGuidelines = platform === 'linkedin'
      ? 'LinkedIn: Bold hook. Short paragraphs (1-3 lines). Bullet points. Clear CTA. Human, not AI-sounding.'
      : platform === 'twitter'
        ? 'X (Twitter): Extremely punchy, short, and brief. Under 180 characters. No line breaks. Max 2 hashtags. Must be under 200 characters total.'
        : 'Instagram: Punchy opener, emojis, storytelling, line breaks, strong hook.';

    const prompt = platform === 'twitter'
      ? `You are an expert X (Twitter) copywriter.
Today: ${day}, ${date}. Trending: "${trend}".
Write an extremely short, punchy tweet (max 180 characters total including spaces) for this business:
---
${niche}
---
Tone: ${tone || 'professional'}
STRICT RULES:
- Must be strictly under 180 characters including spaces.
- Use only 1-2 relevant hashtags.
- DO NOT repeat previous posts or add intro/outro comments.
- Output ONLY the raw tweet text.`
      : `You are an expert ${platform} growth strategist and copywriter.

Today: ${day}, ${date}. Trending: "${trend}".

Write a completely UNIQUE, high-performing ${platform} post for this business:
---
${niche}
---

Content angle: "${angle}"
Tone: ${tone || 'professional'}
${platformGuidelines}
Include 8-12 hashtags (mix of trending + niche-specific).
Uniqueness seed: ${seed}

STRICT RULES:
- NO generic openers like "In today's fast-paced world", "Are you tired of..."
- NO meta-labels like "Post:" or "Caption:"
- Output ONLY the raw post text, ready to copy-paste
- Must feel fresh, timely, written by a real human thought leader`;

    console.log(`[SocialAgent] 🤖 Generating post (${angle.substring(0, 40)}...) for ${platform}`);
    const response = await axios.post(this.baseUrl,
      { model: this.modelName, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'Authorization': `Bearer ${this.openRouterKey}`, 'Content-Type': 'application/json' } }
    );
    const postText = response.data?.choices?.[0]?.message?.content?.trim();
    if (!postText) throw new Error('Empty response from OpenRouter.');

    let finalPost = postText;
    if (platform === 'twitter') {
      if (finalPost.length > 250) {
        console.log(`[SocialAgent:twitter] Post exceeds 250 chars (${finalPost.length}). Truncating...`);
        finalPost = finalPost.substring(0, 245) + '...';
      }
    }
    return finalPost;
  }

  // ── LinkedIn: Post to feed ────────────────────────────────────────────────

  async _postToLinkedIn(page, postText) {
    console.log(`[SocialAgent:linkedin] Navigating to feed...`);
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));

    // Click "Start a post" — LinkedIn renders this as a div[role="button"] with text "Start a post"
    console.log(`[SocialAgent:linkedin] Opening post composer...`);
    let opened = false;

    // Try stable class first
    try {
      const trigger = await page.$('.share-box-feed-entry__trigger');
      if (trigger) {
        await page.evaluate(el => el.scrollIntoView({ block: 'center' }), trigger);
        await new Promise(r => setTimeout(r, 500));
        await trigger.click();
        opened = true;
        console.log('[SocialAgent:linkedin] Clicked stable .share-box-feed-entry__trigger');
      }
    } catch (_) { }

    // Try robust native click detection
    if (!opened) {
      try {
        const triggerHandle = await page.evaluateHandle(() => {
          // 1. Try finding by aria-label
          let el = document.querySelector('[aria-label="Start a post"], [aria-label*="Start a post"]');
          if (el) return el;

          // 2. Try finding by role="button" containing text "Start a post"
          const buttons = Array.from(document.querySelectorAll('[role="button"], button'));
          el = buttons.find(b => b.textContent.trim().toLowerCase().includes('start a post'));
          if (el) return el;

          // 3. Fallback to any element containing text "Start a post"
          const candidates = Array.from(document.querySelectorAll('div, span, p'));
          el = candidates.find(e => e.textContent.trim().toLowerCase() === 'start a post');
          return el || null;
        });

        const triggerEl = triggerHandle.asElement();
        if (triggerEl) {
          console.log('[SocialAgent:linkedin] Found trigger element natively. Clicking...');
          await page.evaluate(el => el.scrollIntoView({ block: 'center' }), triggerEl);
          await new Promise(r => setTimeout(r, 800));
          await triggerEl.click();
          opened = true;
        }
      } catch (e) {
        console.warn('[SocialAgent:linkedin] Native click error:', e.message);
      }
    }

    // Try clicking the placeholder text area at top of feed
    if (!opened) {
      try {
        await page.waitForSelector('[placeholder="Start a post, try a photo or video"], [placeholder*="Start a post"]', { timeout: 3000 });
        const placeholder = await page.$('[placeholder*="Start a post"]');
        if (placeholder) {
          await page.evaluate(el => el.scrollIntoView({ block: 'center' }), placeholder);
          await new Promise(r => setTimeout(r, 500));
          await placeholder.click();
          opened = true;
          console.log('[SocialAgent:linkedin] Clicked placeholder trigger');
        }
      } catch (_) { }
    }

    if (!opened) throw new Error('[LinkedIn] "Start a post" button not found.');
    await new Promise(r => setTimeout(r, 3000));

    // Wait for post composer editor
    // LinkedIn post modal uses dynamic components.
    let editorEl = null;

    try {
      await page.waitForSelector('div[role="dialog"], .share-creation-state__container, .share-box__modal', { timeout: 8000 });
    } catch (_) {
      console.warn('[SocialAgent:linkedin] Modal dialog not found by role, proceeding anyway.');
    }
    await new Promise(r => setTimeout(r, 2000)); // Allow modal animations to complete

    const editorHandle = await page.evaluateHandle(() => {
      // LinkedIn moved the post editor into a Shadow DOM. Standard querySelectorAll fails.
      function findDeepEditors(root) {
        let found = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          if (node.shadowRoot) {
            found = found.concat(findDeepEditors(node.shadowRoot));
          }
          if (
            node.tagName === 'TEXTAREA' ||
            node.hasAttribute('contenteditable') ||
            node.getAttribute('role') === 'textbox' ||
            node.classList.contains('ql-editor') ||
            node.classList.contains('ProseMirror')
          ) {
            if (node.tagName !== 'BUTTON' && !node.disabled) {
              const r = node.getBoundingClientRect();
              // specifically check it has real dimensions and is not hidden
              if (r.width > 10 && r.height > 10) {
                found.push(node);
              }
            }
          }
        }
        return found;
      }

      const allEditors = findDeepEditors(document.body);
      // Return the first visible editor found in the deep tree
      return allEditors[0] || null;
    });

    editorEl = editorHandle.asElement();

    if (!editorEl) throw new Error('[LinkedIn] Post editor element not found after trying robust DOM evaluation.');

    // Click and focus editor, then type using Puppeteer keyboard (not execCommand)
    console.log(`[SocialAgent:linkedin] Typing post text...`);
    await editorEl.click();
    await editorEl.focus();
    await new Promise(r => setTimeout(r, 500));

    // Clear any placeholder content
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await new Promise(r => setTimeout(r, 200));

    // Type post text character by character with small delay
    await editorEl.type(postText, { delay: 12 });
    await new Promise(r => setTimeout(r, 1500));

    // Click Post button — stable selector: .share-actions__primary-action
    console.log(`[SocialAgent:linkedin] Clicking Post button...`);
    let posted = false;

    // Primary: stable artdeco class that has been consistent for years
    try {
      const btn = await page.$('.share-actions__primary-action');
      if (btn && await page.evaluate(b => !b.disabled, btn)) {
        await page.evaluate(b => { b.scrollIntoView({ block: 'center' }); b.click(); }, btn);
        posted = true;
        console.log('[SocialAgent:linkedin] Clicked .share-actions__primary-action');
      }
    } catch (_) { }

    // Fallback: aria-label or data-control-name
    if (!posted) {
      try {
        const btn = await page.$('button[aria-label="Post"], button[data-control-name="share.post"]');
        if (btn && await page.evaluate(b => !b.disabled, btn)) {
          await page.evaluate(b => b.click(), btn);
          posted = true;
        }
      } catch (_) { }
    }

    // Final fallback: any enabled button with text "Post" across all shadow DOMs
    if (!posted) {
      posted = await page.evaluate(() => {
        function findDeepButtons(root) {
          let found = [];
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
          let node;
          while ((node = walker.nextNode())) {
            if (node.shadowRoot) {
              found = found.concat(findDeepButtons(node.shadowRoot));
            }
            if (node.tagName === 'BUTTON') {
              found.push(node);
            }
          }
          return found;
        }

        const buttons = findDeepButtons(document.body);
        const btn = buttons.find(b => {
          const txt = b.textContent.trim();
          return (txt === 'Post' || txt === 'Share') && !b.disabled;
        });

        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
    }

    if (!posted) throw new Error('[LinkedIn] Post submit button not found.');
    await new Promise(r => setTimeout(r, 5000));

    const modalGone = await page.evaluate(() =>
      !document.querySelector('.share-creation-state__container, .share-box__modal')
    );
    console.log(`[SocialAgent:linkedin] ✅ Post submitted (modal closed: ${modalGone})`);
  }

  // ── Auto-Post Execution ───────────────────────────────────────────────────

  async executeAutoPost(platform, userEmail, niche, tone) {
    const socialSvc = SocialPuppeteerService.getInstance();
    const statusCheck = socialSvc.getStatus(platform, userEmail);
    if (!statusCheck.connected) {
      throw new Error(`Platform "${platform}" not connected for ${userEmail}. Please re-connect.`);
    }

    const postText = await this.generateAIPost(platform, niche, tone);

    let tempImagePath = null;
    if (platform === 'instagram') {
      tempImagePath = await this.downloadTempImage().catch(err => {
        throw new Error(`Instagram image fetch failed: ${err.message}`);
      });
    }

    console.log(`[SocialAgent:${platform}] ⚡ Launching automation browser...`);
    let browser = null;
    let tempDir = null;

    try {
      ({ browser, tempDir } = await socialSvc.launchAutomationBrowser(platform, userEmail));
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      await this._setupPage(page);

      if (platform === 'linkedin') {
        await this._postToLinkedIn(page, postText);
      } else if (platform === 'twitter') {
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 6000));

        if (page.url().includes('flow/login') || page.url().includes('/login')) {
          console.warn('[SocialAgent:twitter] Session expired. Disconnecting.');
          await socialSvc.disconnect('twitter', userEmail);
          throw new Error('X (Twitter) session expired or challenged. Please reconnect.');
        }

        const textboxSel = '[data-testid="tweetTextarea_0"], div[role="textbox"]';
        await page.waitForSelector(textboxSel, { timeout: 20000 });
        const textbox = await page.$(textboxSel);
        await textbox.focus();

        await page.evaluate((sel, txt) => {
          const el = document.querySelector(sel);
          if (!el) return;
          el.focus();
          document.execCommand('insertText', false, txt);
        }, textboxSel, postText);
        await new Promise(r => setTimeout(r, 2000));

        const postBtnSel = '[data-testid="tweetButtonInline"], [data-testid="tweetButton"], button[elementtiming="tweetButton"]';
        const postBtn = await page.waitForSelector(postBtnSel, { timeout: 15000 });
        await postBtn.click();
        await new Promise(r => setTimeout(r, 6000));
        console.log('[SocialAgent:twitter] ✅ Published tweet!');

      } else if (platform === 'reddit') {
        let subreddit = 'marketing';
        try {
          const resp = await axios.post(this.baseUrl,
            { model: this.modelName, messages: [{ role: 'user', content: `Based on this niche: "${niche}", give 1 relevant popular subreddit name (no r/ prefix, no spaces, e.g. "saas" or "marketing"). Output ONLY the word.` }] },
            { headers: { 'Authorization': `Bearer ${this.openRouterKey}`, 'Content-Type': 'application/json' } }
          );
          const sub = resp.data?.choices?.[0]?.message?.content?.trim().replace(/r\/|\s/g, '').split('\n')[0];
          if (sub && sub.length > 2) subreddit = sub;
        } catch (_) { }

        const submitUrl = `https://www.reddit.com/r/${subreddit}/submit`;
        console.log(`[SocialAgent:reddit] Navigating to ${submitUrl}...`);
        await page.goto(submitUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 6000));

        const html = await page.content();
        if (html.includes("You've been blocked by network security") || html.includes("blocked by network security")) {
          console.warn('[SocialAgent:reddit] BLOCKED BY REDDIT NETWORK SECURITY (AKAMAI).');
          throw new Error('Reddit network security blocked the automated browser. This requires proxy rotation or manual posting.');
        }

        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/register') || html.includes('pagetype="login"')) {
          console.warn('[SocialAgent:reddit] Session expired. Disconnecting.');
          await socialSvc.disconnect('reddit', userEmail);
          throw new Error('Reddit session expired or challenged. Please reconnect.');
        }

        let titleText = `Introducing CrowdCast - Watch. Vote. Influence.`;
        let bodyText = postText;
        const lines = postText.split('\n').filter(Boolean);
        if (lines.length > 0) {
          titleText = lines[0].replace(/#/g, '').substring(0, 100);
          bodyText = lines.slice(1).join('\n');
        }

        const titleSel = 'input[placeholder="Title"], textarea[placeholder="Title"], [name="title"]';
        await page.waitForSelector(titleSel, { timeout: 15000 });
        await page.type(titleSel, titleText);
        await new Promise(r => setTimeout(r, 1000));

        const bodySel = 'textarea[placeholder="Text (optional)"], div[role="textbox"], [name="text"]';
        const bodyEl = await page.$(bodySel);
        if (bodyEl) {
          await bodyEl.focus();
          await page.evaluate((sel, txt) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.focus();
            if (el.tagName === 'DIV') {
              document.execCommand('insertText', false, txt);
            } else {
              el.value = txt;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, bodySel, bodyText);
        }
        await new Promise(r => setTimeout(r, 2000));

        let submitBtnFound = await page.evaluate(() => {
          function findDeepButtons(root) {
            let found = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
            let node;
            while ((node = walker.nextNode())) {
              if (node.shadowRoot) {
                found = found.concat(findDeepButtons(node.shadowRoot));
              }
              if (node.tagName === 'BUTTON' || node.tagName === 'SHREDDIT-ASYNC-BUTTON') {
                found.push(node);
              }
            }
            return found;
          }

          const buttons = findDeepButtons(document.body);
          const btn = buttons.find(b => {
            const txt = b.textContent.trim().toLowerCase();
            const type = b.getAttribute('type') || '';
            const disabled = b.disabled || b.hasAttribute('disabled');
            return (txt === 'post' || txt.includes('submit') || type === 'submit') && !disabled;
          });

          if (btn) {
            // Some custom elements need their internal button clicked, or they listen to click themselves
            const innerBtn = btn.shadowRoot ? btn.shadowRoot.querySelector('button') : null;
            if (innerBtn) innerBtn.click();
            else btn.click();
            return true;
          }
          return false;
        });

        if (!submitBtnFound) {
          try {
            await page.click('button[type="submit"]');
          } catch (e) {
            throw new Error('Reddit submit button not found');
          }
        }
        await new Promise(r => setTimeout(r, 6000));
        console.log('[SocialAgent:reddit] ✅ Published post on Reddit!');

      } else if (platform === 'instagram') {
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 4000));

        const createSvg = await page.$('svg[aria-label="New post"], svg[aria-label="Create"]');
        if (!createSvg) throw new Error('Instagram create button not found');
        const createBtn = await page.evaluateHandle(el => el.closest('a') || el.closest('button') || el, createSvg);
        await page.evaluate(el => el.click(), createBtn);
        await new Promise(r => setTimeout(r, 2000));

        const fileInput = await page.$('input[type="file"]');
        if (!fileInput) throw new Error('Instagram file input not found');
        await fileInput.uploadFile(tempImagePath);
        await new Promise(r => setTimeout(r, 4000));

        for (let i = 0; i < 2; i++) {
          const nextBtn = await page.evaluateHandle(() =>
            Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Next'))
          );
          if (nextBtn) await page.evaluate(el => el.click(), nextBtn);
          await new Promise(r => setTimeout(r, 1500));
        }

        await page.waitForSelector('textarea[placeholder*="Write a caption"]', { timeout: 15000 });
        await page.evaluate((txt) => {
          const el = document.querySelector('textarea[placeholder*="Write a caption"]');
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, txt);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, postText);
        await new Promise(r => setTimeout(r, 1500));

        const shareBtn = await page.evaluateHandle(() =>
          Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.includes('Share') || b.textContent.includes('Post'))
        );
        if (shareBtn) await page.evaluate(el => el.click(), shareBtn);
        else throw new Error('Instagram share button not found');
        await new Promise(r => setTimeout(r, 6000));
        console.log(`[SocialAgent:instagram] ✅ Published!`);
      }

      return { success: true, postText, imageUrl: null };
    } finally {
      await socialSvc.closeBrowserAndCleanup(browser, tempDir);
      if (tempImagePath && fs.existsSync(tempImagePath)) fs.unlink(tempImagePath, () => { });
    }
  }

  // ── PR Marketing: Auto-Comment ────────────────────────────────────────────

  async executeSocialMarketingPR(platform, userEmail, niche) {
    const socialSvc = SocialPuppeteerService.getInstance();
    const statusCheck = socialSvc.getStatus(platform, userEmail);
    if (!statusCheck.connected) {
      console.warn(`[SocialAgent:PR] ${platform} not connected for ${userEmail}. Skipping.`);
      return;
    }
    if (!this.openRouterKey) {
      console.warn('[SocialAgent:PR] No OPENROUTER_API_KEY. Skipping.');
      return;
    }

    // Extract required tags from niche (e.g. #crowdCast #ufdevs)
    const requiredTags = [];
    const tagMatches = niche.match(/#[a-zA-Z][a-zA-Z0-9_]+/g);
    if (tagMatches) requiredTags.push(...tagMatches.slice(0, 4)); // max 4 required tags
    const brandTag = requiredTags.length > 0 ? requiredTags.join(' ') : this._extractBrandHashtag(niche);
    console.log(`[SocialAgent:${platform}:PR] Starting PR comment (brand tags: ${brandTag || 'none'})`);

    // ── Load recent history to avoid duplicates ─────────────────────────────
    const { usedPostUrls, usedKeywords } = await this._getRecentPRHistory(userEmail, platform);
    const recentKeywordsStr = usedKeywords.slice(0, 20).join(', ') || 'none';
    console.log(`[SocialAgent:${platform}:PR] Already used ${usedKeywords.length} keywords, ${usedPostUrls.size} post URLs in last 30 days`);

    // ── Generate a UNIQUE, ROTATING hashtag keyword each run ───────────────
    const FALLBACK_KEYWORDS = [
      'liveStreaming', 'creatorEconomy', 'audienceEngagement', 'interactiveContent',
      'digitalMarketing', 'communityBuilding', 'contentCreation', 'videoMarketing',
      'growthHacking', 'saasGrowth', 'b2bSales', 'outreachStrategies',
      'socialSelling', 'techInnovation', 'founderLife', 'growthMarketing',
      'brandStrategy', 'leadGeneration', 'startupGrowth', 'digitalStrategy',
      'contentMarketing', 'b2bMarketing', 'salesAutomation', 'organicGrowth'
    ];
    const availableFallbacks = FALLBACK_KEYWORDS.filter(k => !usedKeywords.includes(k));
    let keyword = availableFallbacks.length > 0
      ? availableFallbacks[Math.floor(Math.random() * availableFallbacks.length)]
      : FALLBACK_KEYWORDS[Math.floor(Math.random() * FALLBACK_KEYWORDS.length)];

    const sessionSeed = Math.floor(Math.random() * 10000);
    try {
      const resp = await axios.post(this.baseUrl,
        {
          model: this.modelName,
          messages: [{
            role: 'user',
            content: `Based on this niche: "${niche}", generate 1 fresh trending ${platform} hashtag keyword for a PR comment campaign.

STRICT Rules:
- No # symbol, no spaces, single CamelCase or lowercase word only
- Must be relevant to: livestreaming, interactive content, creator economy, audience engagement, or community building
- MUST be DIFFERENT from these recently used keywords: [${recentKeywordsStr}]
- Use synonyms, related concepts, or adjacent topics to find fresh angles
- Random seed for variety: ${sessionSeed}
- Output ONLY the single keyword, nothing else`
          }]
        },
        { headers: { 'Authorization': `Bearer ${this.openRouterKey}`, 'Content-Type': 'application/json' } }
      );
      const kw = resp.data?.choices?.[0]?.message?.content?.trim().replace(/#|\s|\n/g, '').split(/[^a-zA-Z0-9]/)[0];
      if (kw && kw.length > 2 && kw.length < 30 && !usedKeywords.includes(kw)) {
        keyword = kw;
      }
    } catch (_) { }

    console.log(`[SocialAgent:${platform}:PR] Using hashtag keyword: #${keyword}`);

    // Generate AI comment — unique each run, informed by recent history
    let aiComment = FALLBACK_COMMENTS[Math.floor(Math.random() * FALLBACK_COMMENTS.length)];
    if (brandTag) aiComment += ` ${brandTag}`;

    try {
      const tagInstruction = brandTag
        ? `IMPORTANT: Always end your comment with these exact hashtags: ${brandTag}`
        : '';
      const uniquenessInstruction = `CRITICAL: Your comment must be COMPLETELY UNIQUE, insightful, human, and DIFFERENT from any previous comments. Avoid cliché robotic openers like "Great insights!" or "Bookmarking this!". Add genuine perspective (1-2 sentences).`;
      const contentPrompt = platform === 'twitter'
        ? `Write a short, thoughtful Twitter reply (max 200 chars) to a tweet about "#${keyword}" in the "${niche}" space. Sound human, natural, and helpful. ${uniquenessInstruction} ${tagInstruction} Output ONLY the reply text.`
        : `Write a genuine, insightful comment (1-2 sentences) for a ${platform} post about "#${keyword}" in the "${niche}" space. Sound like an expert colleague sharing genuine perspective. ${uniquenessInstruction} ${tagInstruction} Output ONLY the comment text.`;

      const resp = await axios.post(this.baseUrl,
        { model: this.modelName, messages: [{ role: 'user', content: contentPrompt }] },
        { headers: { 'Authorization': `Bearer ${this.openRouterKey}`, 'Content-Type': 'application/json' } }
      );
      const generated = resp.data?.choices?.[0]?.message?.content?.trim();
      if (generated && generated.length > 5 && generated.length < 400) {
        aiComment = generated;
        const missingTags = requiredTags.filter(t => !aiComment.includes(t));
        if (missingTags.length > 0) aiComment = `${aiComment} ${missingTags.join(' ')}`;
        if (platform === 'twitter' && aiComment.length > 250) {
          aiComment = aiComment.substring(0, 245) + '...';
        }
      }
    } catch (_) { }

    console.log(`[SocialAgent:${platform}:PR] #${keyword} | "${aiComment.substring(0, 80)}..."`);

    let browser = null;
    let tempDir = null;
    try {
      ({ browser, tempDir } = await socialSvc.launchAutomationBrowser(platform, userEmail));
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      await this._setupPage(page);

      if (platform === 'linkedin') {
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent('#' + keyword)}&sortBy=%22date_posted%22`;
        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (gotoErr) {
          if (gotoErr.message.includes('ERR_TOO_MANY_REDIRECTS') || gotoErr.message.includes('ERR_CONNECTION_RESET') || gotoErr.message.includes('timeout')) {
            console.error(`[SocialAgent:linkedin:PR] Redirect loop / network block detected on search page. Disconnecting session.`);
            await socialSvc.disconnect('linkedin', userEmail);
            throw new Error(`LinkedIn session invalidated: redirect loop/block detected during content search. Please reconnect.`);
          }
          throw gotoErr;
        }

        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/signup')) {
          console.warn(`[SocialAgent:linkedin:PR] Session expired or challenged (redirected to ${currentUrl}). Disconnecting.`);
          await socialSvc.disconnect('linkedin', userEmail);
          throw new Error(`LinkedIn session expired or challenged (redirected to authentication page). Please reconnect.`);
        }
        await new Promise(r => setTimeout(r, 6000));

        // Click comment button on first FRESH visible post card and extract post details
        const usedUrlsArray = [...usedPostUrls];
        const cardInfo = await page.evaluate((usedUrls) => {
          const usedSet = new Set(usedUrls);
          const cards = Array.from(document.querySelectorAll('.feed-shared-update-v2, div[data-urn], .occludable-update'));
          for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const rect = card.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const urn = card.getAttribute('data-urn');
              let postUrl = '';
              if (urn) {
                postUrl = `https://www.linkedin.com/feed/update/${urn}`;
              } else {
                const anchor = card.querySelector('a[href*="/feed/update/"], a[href*="/posts/"]');
                postUrl = anchor ? anchor.href.split('?')[0] : window.location.href.split('?')[0];
              }
              if (postUrl && usedSet.has(postUrl)) continue;

              const textEl = card.querySelector('.feed-shared-update-v2__description, .break-words, span[dir="ltr"]');
              const postText = textEl ? textEl.textContent.trim().substring(0, 250) : '';

              const allCardBtns = Array.from(card.querySelectorAll('button'));
              const commentBtn = allCardBtns.find(btn => {
                const ariaLbl = (btn.getAttribute('aria-label') || '').toLowerCase();
                if (ariaLbl.includes('comment')) return true;
                const spans = Array.from(btn.querySelectorAll('span'));
                const hasCommentText = spans.some(s => s.textContent.trim().toLowerCase() === 'comment');
                if (hasCommentText) return true;
                const btnText = btn.textContent.trim().toLowerCase();
                return btnText === 'comment';
              });
              if (commentBtn) {
                commentBtn.scrollIntoView({ block: 'center' });
                commentBtn.click();
                return { cardIndex: i, urn, postUrl, postText, success: true };
              }
            }
          }
          return null;
        }, usedUrlsArray);


        let postUrl = 'LinkedIn Search';
        let cardIndex = -1;
        if (cardInfo && cardInfo.success) {
          postUrl = cardInfo.postUrl;
          cardIndex = cardInfo.cardIndex;
          console.log(`[SocialAgent:linkedin:PR] Clicked comment button on card index ${cardIndex}. Target post URL: ${postUrl}`);
        } else {
          console.warn(`[SocialAgent:linkedin:PR] Could not find card-specific comment button. Attempting global click...`);
          // Last-resort global click - find any button with 'Comment' text
          const commentBtnClicked = await page.evaluate(() => {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const btn = allBtns.find(b => {
              const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
              if (lbl.includes('comment')) { b.click(); return true; }
              const spans = Array.from(b.querySelectorAll('span'));
              if (spans.some(s => s.textContent.trim().toLowerCase() === 'comment')) { b.click(); return true; }
              if (b.textContent.trim().toLowerCase() === 'comment') { b.click(); return true; }
              return false;
            });
            return !!btn;
          });
          if (!commentBtnClicked) {
            console.warn(`[SocialAgent:linkedin:PR] Comment button not found`);
            return;
          }
        }

        await new Promise(r => setTimeout(r, 3000));

        // Locate comment box — LinkedIn now uses TipTap/ProseMirror editor (role=textbox, aria-label="Text editor for creating comment")
        const commentBoxSelectors = [
          'div[aria-label="Text editor for creating comment"][contenteditable="true"]',
          'div[role="textbox"][contenteditable="true"]',
          '.tiptap.ProseMirror[contenteditable="true"]',
          '.ProseMirror[contenteditable="true"]',
          'div.comments-comment-box--cr div[contenteditable="true"]',
          'div.comments-comment-box div[contenteditable="true"]',
          'div[contenteditable="true"][data-placeholder*="comment" i]',
          'div[contenteditable="true"][aria-label*="comment" i]',
          'div.editor-content div[contenteditable="true"]',
          '.ql-editor',
          'div[contenteditable="true"]',
          'textarea'
        ];

        let commentBox = null;
        let commentBoxSel = null;

        if (cardIndex !== -1) {
          for (const sel of commentBoxSelectors) {
            const el = await page.evaluateHandle((cIdx, s) => {
              const cards = document.querySelectorAll('.feed-shared-update-v2, div[data-urn], article');
              const card = cards[cIdx];
              if (!card) return null;
              return card.querySelector(s);
            }, cardIndex, sel);
            if (el && el.asElement()) {
              const isVisible = await page.evaluate(e => {
                const r = e.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              }, el);
              if (isVisible) {
                commentBox = el.asElement();
                commentBoxSel = sel;
                break;
              }
            }
          }
        }

        if (!commentBox) {
          for (const sel of commentBoxSelectors) {
            try {
              const el = await page.$(sel);
              if (!el) continue;
              const visible = await page.evaluate(e => {
                const r = e.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              }, el);
              if (visible) {
                commentBox = el;
                commentBoxSel = sel;
                break;
              }
            } catch (_) { }
          }
        }

        if (!commentBox) {
          console.warn(`[SocialAgent:linkedin:PR] Comment input not found`);
          return;
        }

        // Focus and type natively via Puppeteer to trigger Draft.js state updates
        console.log(`[SocialAgent:linkedin:PR] Typing comment natively...`);
        await commentBox.focus();
        await commentBox.click();
        await new Promise(r => setTimeout(r, 500));

        // Select all and backspace to clear the box cleanly
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await new Promise(r => setTimeout(r, 300));

        // Type the AI comment text
        await commentBox.type(aiComment, { delay: 20 });
        await new Promise(r => setTimeout(r, 1000));

        // Force react update events on the element
        await page.evaluate((el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('textInput', { bubbles: true }));
        }, commentBox);
        await new Promise(r => setTimeout(r, 500));

        // Locate and click submit button
        // LinkedIn now uses dynamic hashed class names - can't use class selectors
        // Strategy: find the button closest to (sibling of) the TipTap editor
        let submitted = null;
        let submitBtn = null;

        const submitBtnHandle = await page.evaluateHandle((commentEl) => {
          // The TipTap editor is inside a wrapper. Walk up to find a container that
          // has both the editor AND a button with text "Comment"
          // We go up to 10 levels up from the editor, looking for such a button
          let parent = commentEl ? commentEl.parentElement : null;
          for (let depth = 0; depth < 10 && parent; depth++) {
            const btns = Array.from(parent.querySelectorAll('button'));
            // Find a "Comment" button that is NOT an action-bar button
            // Action bar buttons are usually in a list; form submit is typically standalone
            // We look for the LAST "Comment" button in proximity (the submit, not the trigger)
            const commentBtns = btns.filter(b => {
              const txt = b.textContent.trim();
              return txt === 'Comment' || txt === 'Post' || txt === 'Submit';
            });
            // If there are 1+ Comment buttons AND the container also has the editor
            // then the LAST one is likely the submit button
            if (commentBtns.length >= 1) {
              // Try the LAST one first (most likely to be the submit)
              const candidate = commentBtns[commentBtns.length - 1];
              if (!candidate.disabled) return candidate;
            }
            parent = parent.parentElement;
          }

          // Fallback: find the button AFTER the editor in DOM order
          const editor = document.querySelector('[aria-label="Text editor for creating comment"][contenteditable="true"]');
          if (editor) {
            // Get all buttons after the editor in the DOM
            const allBtns = Array.from(document.querySelectorAll('button'));
            const editorIdx = allBtns.findIndex(b => {
              return editor.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
            });
            // Find first non-disabled "Comment" button after the editor
            for (let i = 0; i < allBtns.length; i++) {
              const b = allBtns[i];
              if (!b.disabled && b.textContent.trim() === 'Comment') {
                const pos = editor.compareDocumentPosition(b);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
                  return b;
                }
              }
            }
          }
          return null;
        }, commentBox);

        if (submitBtnHandle && submitBtnHandle.asElement()) {
          submitBtn = submitBtnHandle.asElement();
        }

        if (submitBtn) {
          console.log(`[SocialAgent:linkedin:PR] Clicking submit button via Puppeteer...`);
          await page.evaluate(btn => btn.scrollIntoView({ block: 'center' }), submitBtn);
          await new Promise(r => setTimeout(r, 500));
          await submitBtn.click();
          submitted = 'puppeteer-click';
          console.log('[SocialAgent:linkedin:PR] Submit button clicked successfully');
        }

        if (!submitted) {
          console.log(`[SocialAgent:linkedin:PR] Fallback: submitting via keyboard Ctrl+Enter...`);
          await commentBox.focus();
          await page.keyboard.down('Control');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Control');
          await new Promise(r => setTimeout(r, 1000));
        }

        await new Promise(r => setTimeout(r, 2000));
        console.log(`[SocialAgent:linkedin:PR] ✅ Comment posted on #${keyword}${brandTag ? ' ' + brandTag : ''}`);
        await this._logPRComment({ userEmail, platform, hashtag: keyword, comment: aiComment, brandTag, postUrl });

      } else if (platform === 'twitter') {
        const searchUrl = `https://x.com/search?q=${encodeURIComponent('#' + keyword)}&f=live`;
        console.log(`[SocialAgent:twitter:PR] Navigating to search: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 6000));

        if (page.url().includes('flow/login') || page.url().includes('/login')) {
          console.warn('[SocialAgent:twitter:PR] Session expired. Disconnecting.');
          await socialSvc.disconnect('twitter', userEmail);
          throw new Error('X (Twitter) session expired or challenged. Please reconnect.');
        }

        // Get tweet status links — deduplicate by tweet ID
        const tweetLinks = await page.evaluate(() => {
          const seen = new Set();
          return Array.from(document.querySelectorAll('a[href*="/status/"]'))
            .map(a => a.href)
            .filter(href => {
              if (!href || href.includes('/photo/') || href.includes('/video/')) return false;
              // Normalize to just status URL (strip query params)
              const clean = href.split('?')[0];
              if (seen.has(clean)) return false;
              seen.add(clean);
              return true;
            });
        });

        if (tweetLinks.length === 0) {
          console.warn(`[SocialAgent:twitter:PR] No tweets found for #${keyword}`);
          return;
        }

        // Skip posts already commented on — pick first fresh one
        const freshLinks = tweetLinks.filter(url => !usedPostUrls.has(url.split('?')[0]));
        if (freshLinks.length === 0) {
          console.warn(`[SocialAgent:twitter:PR] All ${tweetLinks.length} tweets for #${keyword} have already been commented on. Skipping to avoid spam.`);
          return;
        }

        // Pick a random fresh tweet (not always the top one)
        const targetTweetUrl = freshLinks[Math.floor(Math.random() * Math.min(freshLinks.length, 5))];
        console.log(`[SocialAgent:twitter:PR] Navigating to fresh tweet (${freshLinks.length} available): ${targetTweetUrl}`);
        await page.goto(targetTweetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Random human-like delay: 4–8 seconds
        await new Promise(r => setTimeout(r, 4000 + Math.floor(Math.random() * 4000)));

        // Focus reply textbox
        const replySel = '[data-testid="tweetTextarea_0"], div[role="textbox"]';
        await page.waitForSelector(replySel, { timeout: 15000 });
        const replyBox = await page.$(replySel);
        await replyBox.focus();

        // Inject reply comment
        await page.evaluate((sel, txt) => {
          const el = document.querySelector(sel);
          if (!el) return;
          el.focus();
          document.execCommand('insertText', false, txt);
        }, replySel, aiComment);
        await new Promise(r => setTimeout(r, 1500));

        // Click reply/Post button
        const replyBtnSel = '[data-testid="tweetButtonInline"], button[data-testid="tweetButton"]';
        const replyBtn = await page.waitForSelector(replyBtnSel, { timeout: 10000 });
        await replyBtn.click();
        await new Promise(r => setTimeout(r, 4000));

        console.log(`[SocialAgent:twitter:PR] ✅ Reply comment posted on #${keyword}`);
        await this._logPRComment({ userEmail, platform, hashtag: keyword, comment: aiComment, brandTag, postUrl: targetTweetUrl.split('?')[0] });

      } else if (platform === 'reddit') {

        const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(keyword)}`;
        console.log(`[SocialAgent:reddit:PR] Navigating to search: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 6000));

        const html = await page.content();
        if (html.includes("You've been blocked by network security") || html.includes("blocked by network security")) {
          console.warn('[SocialAgent:reddit:PR] BLOCKED BY REDDIT NETWORK SECURITY (AKAMAI).');
          throw new Error('Reddit network security blocked the automated browser. This requires proxy rotation or manual posting.');
        }

        if (page.url().includes('/login') || page.url().includes('/register')) {
          console.warn('[SocialAgent:reddit:PR] Session expired. Disconnecting.');
          await socialSvc.disconnect('reddit', userEmail);
          throw new Error('Reddit session expired or challenged. Please reconnect.');
        }

        // Get Reddit post links — deduplicate
        const postLinks = await page.evaluate(() => {
          const seen = new Set();
          return Array.from(document.querySelectorAll('a[href*="/comments/"]'))
            .map(a => a.href.split('?')[0])
            .filter(href => {
              if (!href || seen.has(href)) return false;
              seen.add(href);
              return true;
            });
        });

        if (postLinks.length === 0) {
          console.warn(`[SocialAgent:reddit:PR] No posts found for keyword "${keyword}"`);
          return;
        }

        // Skip posts already commented on
        const freshRedditLinks = postLinks.filter(url => !usedPostUrls.has(url));
        if (freshRedditLinks.length === 0) {
          console.warn(`[SocialAgent:reddit:PR] All ${postLinks.length} posts for "${keyword}" already commented on. Skipping to avoid spam.`);
          return;
        }

        // Pick a random fresh post (not always the first)
        const targetPostUrl = freshRedditLinks[Math.floor(Math.random() * Math.min(freshRedditLinks.length, 5))];
        console.log(`[SocialAgent:reddit:PR] Navigating to fresh Reddit post (${freshRedditLinks.length} available): ${targetPostUrl}`);
        await page.goto(targetPostUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 4000 + Math.floor(Math.random() * 3000)));

        // Focus comment editor — try clicking a 'Comment'/'Add a comment' link first
        const openedCommentBox = await page.evaluate(() => {
          const addBtn = Array.from(document.querySelectorAll('a, button, p'))
            .find(el => {
              const txt = el.textContent.trim().toLowerCase();
              return txt === 'add a comment' || txt === 'be the first to comment' || txt === 'share your thoughts...';
            });
          if (addBtn) { addBtn.click(); return true; }
          return false;
        });
        if (openedCommentBox) await new Promise(r => setTimeout(r, 2000));

        // Reddit New UI uses a contenteditable div editor
        const commentSel = [
          'div[data-lexical-editor="true"]',
          'div[role="textbox"][contenteditable="true"]',
          'textarea[placeholder*="thought" i]',
          'textarea[placeholder*="comment" i]',
          'textarea',
        ];
        let commentBox = null;
        for (const sel of commentSel) {
          try {
            await page.waitForSelector(sel, { timeout: 5000 });
            commentBox = await page.$(sel);
            if (commentBox) break;
          } catch (_) { }
        }
        if (!commentBox) {
          console.warn('[SocialAgent:reddit:PR] Comment editor not found on post page');
          return;
        }
        await commentBox.focus();

        // Inject comment text natively to trigger React/Lexical state updates
        await commentBox.click();
        await new Promise(r => setTimeout(r, 500));
        await commentBox.type(aiComment, { delay: 15 });
        await new Promise(r => setTimeout(r, 1500));

        let commentSubmitFound = await page.evaluate(() => {
          function findDeepButtons(root) {
            let found = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
            let node;
            while ((node = walker.nextNode())) {
              if (node.shadowRoot) {
                found = found.concat(findDeepButtons(node.shadowRoot));
              }
              if (node.tagName === 'BUTTON' || node.tagName === 'SHREDDIT-ASYNC-BUTTON') {
                found.push(node);
              }
            }
            return found;
          }

          const buttons = findDeepButtons(document.body);
          const btn = buttons.find(b => {
            const txt = b.textContent.trim().toLowerCase();
            const type = b.getAttribute('type') || '';
            const disabled = b.disabled || b.hasAttribute('disabled');
            return (txt === 'comment' || txt === 'save' || type === 'submit') && !disabled;
          });

          if (btn) {
            btn.scrollIntoView({ block: 'center' });
            const innerBtn = btn.shadowRoot ? btn.shadowRoot.querySelector('button') : null;
            if (innerBtn) innerBtn.click();
            else btn.click();
            return true;
          }
          return false;
        });

        if (!commentSubmitFound) {
          // Fallback keyboard submit
          await page.keyboard.down('Control');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Control');
        }
        await new Promise(r => setTimeout(r, 4000));

        console.log(`[SocialAgent:reddit:PR] ✅ Comment posted on Reddit post`);
        await this._logPRComment({ userEmail, platform, hashtag: keyword, comment: aiComment, brandTag, postUrl: targetPostUrl });


      } else if (platform === 'instagram') {
        // Parse target handles / accounts from niche description
        // E.g. @hudabeauty or instagram.com/hudabeauty
        const targetHandles = [];
        const handleRegex = /(?:instagram\.com\/|@)([a-zA-Z0-9_\.]+)/gi;
        let match;
        while ((match = handleRegex.exec(niche)) !== null) {
          const handle = match[1].trim().replace(/\.$/, '');
          if (handle && !targetHandles.includes(handle) && !['instagram', 'p', 'reel', 'explore', 'tags'].includes(handle.toLowerCase())) {
            targetHandles.push(handle);
          }
        }

        let igPostUrl = null;
        let postLinkFound = false;

        // Try targeting specific profiles if provided in the niche setting
        if (targetHandles.length > 0) {
          const selectedHandle = targetHandles[Math.floor(Math.random() * targetHandles.length)];
          console.log(`[SocialAgent:instagram:PR] Targeting competitor profile: @${selectedHandle}...`);
          try {
            await page.goto(`https://www.instagram.com/${selectedHandle}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 6000));

            // Select post or reel link (usually index 0 represents the latest, active post/reel)
            const links = await page.evaluate(() => {
              return Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'))
                .map(a => a.getAttribute('href'))
                .filter(Boolean);
            });

            if (links.length > 0) {
              const targetPath = links[0];
              const targetUrl = targetPath.startsWith('http') ? targetPath : `https://www.instagram.com${targetPath}`;
              console.log(`[SocialAgent:instagram:PR] Navigating to target post/reel: ${targetUrl}`);
              await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await new Promise(r => setTimeout(r, 4000));
              igPostUrl = page.url();
              postLinkFound = true;
            } else {
              console.log(`[SocialAgent:instagram:PR] No posts/reels found on profile of @${selectedHandle}. Falling back to explore tags.`);
            }
          } catch (profileErr) {
            console.warn(`[SocialAgent:instagram:PR] Error targeting profile @${selectedHandle}:`, profileErr.message);
          }
        }

        // Fallback or default tag-based targeting
        if (!postLinkFound) {
          const tagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(keyword)}/`;
          console.log(`[SocialAgent:instagram:PR] Navigating to explore hashtag: #${keyword}...`);
          await page.goto(tagUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise(r => setTimeout(r, 6000));

          // Extract top posts/reels from the explore page
          const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'))
              .map(a => a.getAttribute('href'))
              .filter(Boolean);
          });

          if (links.length === 0) {
            console.warn(`[SocialAgent:instagram:PR] No posts found for #${keyword}`);
            return;
          }

          const allIgUrls = links.map(l => {
            const full = l.startsWith('http') ? l : `https://www.instagram.com${l}`;
            return full.split('?')[0];
          });
          const freshIgLinks = allIgUrls.filter(u => !usedPostUrls.has(u));

          if (freshIgLinks.length === 0) {
            console.warn(`[SocialAgent:instagram:PR] All ${allIgUrls.length} posts for #${keyword} already commented on. Skipping.`);
            return;
          }

          // Pick a random fresh post or reel
          const targetUrl = freshIgLinks[Math.floor(Math.random() * freshIgLinks.length)];

          console.log(`[SocialAgent:instagram:PR] Navigating to fresh content (${freshIgLinks.length} fresh available): ${targetUrl}`);
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise(r => setTimeout(r, 4000));
          igPostUrl = page.url().split('?')[0];
        }

        const igSelectors = [
          'textarea[placeholder*="Add a comment"]',
          'textarea[placeholder*="Comment"]',
          'textarea[aria-label*="comment" i]',
          'form textarea',
        ];
        let commentBoxSel = null;
        for (const sel of igSelectors) {
          const el = await page.$(sel);
          if (el) { commentBoxSel = sel; break; }
        }

        if (!commentBoxSel) {
          console.warn(`[SocialAgent:instagram:PR] Comment box not found`);
          return;
        }

        const commentEl = await page.$(commentBoxSel);
        await page.evaluate(el => { el.focus(); el.click(); }, commentEl);
        await new Promise(r => setTimeout(r, 400));

        // DOM inject
        await page.evaluate((sel, txt) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, txt);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, commentBoxSel, aiComment);
        await new Promise(r => setTimeout(r, 600));

        // Click Post button
        const submitted = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button'))
            .find(b => (b.textContent.trim().toLowerCase() === 'post' || b.textContent.trim().toLowerCase() === 'submit') && !b.disabled);
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (!submitted) await page.keyboard.press('Enter');

        await new Promise(r => setTimeout(r, 2000));
        console.log(`[SocialAgent:instagram:PR] ✅ Comment posted on #${keyword}${brandTag ? ' ' + brandTag : ''}`);
        await this._logPRComment({ userEmail, platform, hashtag: keyword, comment: aiComment, brandTag, postUrl: igPostUrl });
      }
    } catch (err) {
      console.warn(`[SocialAgent:${platform}:PR] Error:`, err.message);
      await this._logPRComment({ userEmail, platform, hashtag: keyword || '?', comment: aiComment || '', brandTag, postUrl: null, status: 'failed' });
    } finally {
      await socialSvc.closeBrowserAndCleanup(browser, tempDir);
    }
  }
}

module.exports = SocialMediaAgentService;
