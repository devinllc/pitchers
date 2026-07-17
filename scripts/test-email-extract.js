#!/usr/bin/env node
/*
 * Script: test-email-extract.js
 * Usage: node scripts/test-email-extract.js <website_url> [--deep]
 *
 * Fetches a site's homepage (and optional deep paths) and prints extracted emails.
 */

const axios = require('axios');
const GoogleMapsWebService = require('../services/googleMapsWebService');

(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/test-email-extract.js <website_url> [--deep]');
    process.exit(1);
  }

  const url = args[0];
  const deep = args.includes('--deep');

  const svc = new GoogleMapsWebService({ headless: true });

  const normalize = (u) => svc._normalizeUrl ? svc._normalizeUrl(u) : u;
  const extractEmails = (html) => svc._extractEmails(html);

  const norm = normalize(url);
  if (!norm) {
    console.error('Could not normalize URL:', url);
    process.exit(2);
  }

  const paths = [norm];
  if (deep) {
    const base = norm.replace(/\/$/, '');
    paths.push(
      `${base}/contact`,
      `${base}/contact-us`,
      `${base}/contactus`,
      `${base}/contacts`,
      `${base}/about`,
      `${base}/about-us`,
      `${base}/team`,
      `${base}/support`,
      `${base}/impressum`,
      `${base}/legal`,
      `${base}/privacy`
    );
  }

  console.log(`Testing email extraction for: ${norm}  (deep paths: ${deep})`);
  const found = new Set();

  for (const p of paths) {
    try {
      console.log('Fetching:', p);
      const resp = await axios.get(p, { timeout: 15000, headers: { 'User-Agent': svc.userAgent } });
      const html = resp.data || '';
      const emails = extractEmails(html);
      emails.forEach(e => found.add(e));
      console.log(` -> found ${emails.length} emails on this page`);
      if (found.size > 0) break;
    } catch (e) {
      console.warn('Fetch failed:', p, e.message);
    }
  }

  const out = Array.from(found);
  if (out.length === 0) {
    console.log('No emails found. Consider using --deep or checking if the site uses obfuscation (images/JS).');
  } else {
    console.log('Emails found:', out);
  }
})();
