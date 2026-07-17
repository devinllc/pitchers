const puppeteer = require('puppeteer');

async function testBrowserUI() {
  console.log('🔍 Testing browser UI visibility...');
  
  try {
    const browser = await puppeteer.launch({
      headless: false,
      devtools: false,
      slowMo: 1000, // Slow down for visibility
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--force-color-profile=srgb',
      ]
    });
    
    console.log('✅ Browser launched successfully');
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    
    console.log('🌐 Navigating to Google Maps...');
    await page.goto('https://www.google.com/maps/search/restaurants+in+Mumbai', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    console.log('⏳ Waiting 10 seconds for you to see the browser...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log('🔍 Taking screenshot...');
    await page.screenshot({ path: 'browser-test.png', fullPage: true });
    
    await browser.close();
    console.log('✅ Test completed. Check browser-test.png for screenshot.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testBrowserUI();
