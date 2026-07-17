const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  await page.setCookie({
    name: 'li_at',
    value: 'AQEDAVxij1oCyJ7BAAABnsTG4U0AAAGe6NNlTU0AovSdDbkcCEe-lP65KnkYag4rvejJSR6fQjLMHKoD_moPmnYrqDMeovg6jP7f_o8QFPKLo3VIcwf-b6JqPzwLCFfX97OahJfVDX8RfgD9dXuDOgxh',
    domain: '.linkedin.com'
  });

  console.log("Navigating to feed...");
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  
  await page.screenshot({ path: 'scratch/feed_before.png' });
  console.log("Took feed screenshot.");

  // find trigger
  const triggerHandle = await page.evaluateHandle(() => {
    let el = document.querySelector('[aria-label="Start a post"], [aria-label*="Start a post"]');
    if (el) return el;
    const buttons = Array.from(document.querySelectorAll('[role="button"], button'));
    el = buttons.find(b => b.textContent.trim().toLowerCase().includes('start a post'));
    if (el) return el;
    return null;
  });

  const triggerEl = triggerHandle.asElement();
  if (triggerEl) {
    console.log("Found trigger. Clicking...");
    await page.evaluate(e => e.scrollIntoView({ block: 'center' }), triggerEl);
    await new Promise(r => setTimeout(r, 1000));
    await triggerEl.click();
    console.log("Clicked.");
  } else {
    console.log("Trigger not found. Look at scratch/feed_before.png");
    await browser.close();
    return;
  }

  await new Promise(r => setTimeout(r, 4000));
  await page.screenshot({ path: 'scratch/modal_after.png' });
  console.log("Took modal screenshot.");

  const html = await page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"], .share-creation-state__container, .share-box__modal, .share-box-modal');
    if (dialog) return dialog.outerHTML;
    return document.body.innerHTML;
  });

  fs.writeFileSync('scratch/debug_modal.html', html);
  console.log("Dumped modal HTML. Size: " + html.length);
  await browser.close();
})();
