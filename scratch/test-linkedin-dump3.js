const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const userDataDir = '/Users/rameshvishwakarma/ufdevsllc/pitchers/.social_sessions/linkedin/rameshnda09_gmail_com_303eeaa1';
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: userDataDir,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  const page = await browser.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 6000));
  
  // Robust click
  const triggerHandle = await page.evaluateHandle(() => {
    let el = document.querySelector('[aria-label="Start a post"], [aria-label*="Start a post"]');
    if (el) return el;
    const buttons = Array.from(document.querySelectorAll('[role="button"], button'));
    el = buttons.find(b => b.textContent.trim().toLowerCase().includes('start a post'));
    if (el) return el;
    const candidates = Array.from(document.querySelectorAll('div, span, p'));
    el = candidates.find(e => e.textContent.trim().toLowerCase() === 'start a post');
    return el || null;
  });

  const triggerEl = triggerHandle.asElement();
  if (triggerEl) {
    console.log("Found trigger, clicking...");
    await page.evaluate(el => el.scrollIntoView({ block: 'center' }), triggerEl);
    await new Promise(r => setTimeout(r, 800));
    await triggerEl.click();
    console.log("Clicked.");
  } else {
    console.log("No trigger found.");
  }

  await new Promise(r => setTimeout(r, 5000));
  const html = await page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog) return dialog.outerHTML;
    return document.body.innerHTML;
  });
  fs.writeFileSync('scratch/linkedin_dialog.html', html);
  console.log("Dumped dialog.");
  await browser.close();
})();
