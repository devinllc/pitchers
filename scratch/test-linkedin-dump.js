const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log("Connecting to local chrome...");
  const userDataDir = '/Users/rameshvishwakarma/ufdevsllc/pitchers/.social_sessions/linkedin/rameshnda09_gmail_com_303eeaa1';
  
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: userDataDir,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  
  const page = await browser.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 5000));
  
  console.log("Clicking start a post...");
  const triggerHandle = await page.evaluateHandle(() => {
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span, p'));
    return candidates.find(el => el.textContent.toLowerCase().includes('start a post'));
  });
  
  if (triggerHandle) {
    const el = triggerHandle.asElement();
    if (el) {
       await el.click();
       await new Promise(r => setTimeout(r, 3000));
       
       console.log("Dumping HTML...");
       const html = await page.evaluate(() => {
         const modal = document.querySelector('div[role="dialog"]') || document.querySelector('.share-box__modal') || document.querySelector('.share-creation-state__container');
         return modal ? modal.outerHTML : document.body.innerHTML;
       });
       
       fs.writeFileSync('scratch/modal_dump.html', html);
       console.log("Dumped to scratch/modal_dump.html");
    }
  }
  
  await browser.close();
})();
