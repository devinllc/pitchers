const puppeteer = require('puppeteer-core');

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

  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  
  // click trigger
  const triggerHandle = await page.evaluateHandle(() => {
    let el = document.querySelector('[aria-label="Start a post"], [aria-label*="Start a post"]');
    if (el) return el;
    const buttons = Array.from(document.querySelectorAll('[role="button"], button'));
    return buttons.find(b => b.textContent.trim().toLowerCase().includes('start a post')) || null;
  });

  const triggerEl = triggerHandle.asElement();
  if (triggerEl) {
    await triggerEl.click();
  }

  await new Promise(r => setTimeout(r, 4000));
  
  const shadowEditors = await page.evaluate(() => {
    function findEditors(root) {
      let found = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) {
          found = found.concat(findEditors(node.shadowRoot));
        }
        if (node.tagName === 'TEXTAREA' || node.hasAttribute('contenteditable') || node.getAttribute('role') === 'textbox') {
          if (node.tagName !== 'BUTTON') {
             const r = node.getBoundingClientRect();
             if (r.width > 0 && r.height > 0) {
               found.push({ tag: node.tagName, class: node.className, id: node.id });
             }
          }
        }
      }
      return found;
    }
    return findEditors(document.body);
  });

  console.log("Shadow Editors Found:", shadowEditors);
  await browser.close();
})();
