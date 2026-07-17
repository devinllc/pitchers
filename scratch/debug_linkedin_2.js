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
  
  // click trigger
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
    await triggerEl.click();
    console.log("Clicked trigger.");
  } else {
    console.log("No trigger.");
    await browser.close();
    return;
  }

  await new Promise(r => setTimeout(r, 4000));
  
  const html = await page.evaluate(() => {
    // Find all visible contenteditables and textareas
    const editors = Array.from(document.querySelectorAll('[contenteditable], textarea, [role="textbox"], .ql-editor, .editor-content')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.tagName !== 'BUTTON';
    });
    
    return editors.map(e => e.outerHTML).join('\n\n=====\n\n');
  });

  fs.writeFileSync('scratch/debug_editors.html', html);
  console.log("Dumped editors. Found: " + html.length);
  await browser.close();
})();
