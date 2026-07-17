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
  
  // click natively
  try {
      const trigger = await page.$('.share-box-feed-entry__trigger');
      if (trigger) {
        await page.evaluate(el => el.scrollIntoView({ block: 'center' }), trigger);
        await new Promise(r => setTimeout(r, 500));
        await trigger.click();
      }
  } catch(e) {}

  await new Promise(r => setTimeout(r, 3000));
  const html = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('scratch/linkedin_body.html', html);
  console.log("Dumped body.");
  await browser.close();
})();
