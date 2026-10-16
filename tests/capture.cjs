// Run with Node.js and Playwright installed: node tests/capture.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    await page.setContent('<style>body{margin:0}section{height:750px}header{position:fixed;top:0;background:black;color:white}</style><header>Header</header><section style="background:red"></section><section style="background:green"></section><section style="background:blue"></section>');
    await page.evaluate(() => scrollTo(0, 200));
    const background = await browser.newPage();
    let download;
    await background.exposeFunction('executeInTab', async ({ code }) => [await page.evaluate(code)]);
    await background.exposeFunction('captureTab', async () => 'data:image/png;base64,' + (await page.screenshot()).toString('base64'));
    await background.exposeFunction('recordDownload', value => { download = value; return 1; });
    await background.evaluate(() => {
      window.testTab = { id: 1, windowId: 1, url: 'https://example.org/', title: 'Test page' };
      window.browser = {
        tabs: { query: async () => [window.testTab], executeScript: (_, options) => window.executeInTab(options), captureVisibleTab: () => window.captureTab() },
        downloads: { download: value => window.recordDownload(value) },
        runtime: { onMessage: { addListener: fn => { window.captureListener = fn; } } }
      };
    });
    await background.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8') });
    const result = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(result.success, true, JSON.stringify(result));
    assert.match(download.filename, /^Test-page-\d+\.png$/);
    const image = await background.evaluate(async url => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, colors: [400, 1000, 2000].map(y => [...ctx.getImageData(400, y, 1, 1).data]) };
    }, download.url);
    assert.equal(image.width, 800); assert.equal(image.height, 2050);
    assert.deepEqual(image.colors, [[255,0,0,255],[0,128,0,255],[0,0,255,255]]);
    assert.equal(await page.evaluate(() => scrollY), 200);
    assert.equal(await page.locator('header').evaluate(el => el.style.visibility), '');
    const imageHeight = () => background.evaluate(async url => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return bitmap.height;
    }, download.url);
    for (const [mode, amount, height] of [['pixels', 900, 900], ['screens', 2, 1200], ['pixels', 100, 100]]) {
      const limited = await background.evaluate(options => window.captureListener({ type: 'capture', options }), { mode, amount });
      assert.equal(limited.success, true, JSON.stringify(limited));
      assert.equal(await imageHeight(), height);
      assert.equal(await page.evaluate(() => scrollY), 200);
    }
    // Escape from the page after the first frame: save only completed content.
    await background.evaluate(() => {
      window.browser.tabs.captureVisibleTab = () => window.captureTab();
    });
    let frames = 0;
    await background.exposeFunction('captureWithEscape', async () => {
      const data = 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
      if (++frames >= 1) await page.keyboard.press('Escape');
      return data;
    });
    await background.evaluate(() => { window.browser.tabs.captureVisibleTab = () => window.captureWithEscape(); });
    const stopped = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(stopped.success, true);
    assert.equal(await imageHeight(), 600);
    assert.equal(await page.evaluate(() => scrollY), 200);
    assert.equal(await page.evaluate(() => '__scrollScreenshotState' in window), false);
    await background.evaluate(() => { window.testTab.url = 'about:config'; });
    const denied = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.match(denied.error, /regular web page/);
    await background.evaluate(() => {
      window.testTab.url = 'https://example.org/';
      let frames = 0;
      window.browser.tabs.captureVisibleTab = async () => {
        if (++frames === 2) throw new Error('Capture interrupted');
        return window.captureTab();
      };
    });
    const interrupted = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(interrupted.success, true);
    assert.match(interrupted.warning, /Capture interrupted/);
    assert.equal(await imageHeight(), 600);
    const retained = await background.evaluate(() => window.captureListener({ type: 'status' }));
    assert.equal(retained.running, false);
    assert.match(retained.result.warning, /Capture interrupted/);
    assert.equal(await page.evaluate(() => scrollY), 200);
    assert.equal(await page.locator('header').evaluate(el => el.style.visibility), '');
    assert.equal(await page.evaluate(() => '__scrollScreenshotState' in window), false);
    await page.setContent('<style>html,body{margin:0;height:100%;overflow:hidden}main{position:fixed;left:100px;top:50px;width:600px;height:500px;overflow:auto}section{height:750px}</style><main><section style="background:red"></section><section style="background:green"></section><section style="background:blue"></section></main>');
    await page.locator('main').evaluate(el => { el.scrollTop = 200; });
    await background.evaluate(() => { window.browser.tabs.captureVisibleTab = () => window.captureTab(); });
    const nested = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(nested.success, true, JSON.stringify(nested));
    assert.equal(await imageHeight(), 2050, 'Nested scroll panel must capture beyond the visible viewport');
    const panelImage = await background.evaluate(async url => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, colors: [400, 1000, 2000].map(y => [...ctx.getImageData(300, y, 1, 1).data]) };
    }, download.url);
    assert.equal(panelImage.width, 600);
    assert.deepEqual(panelImage.colors, [[255,0,0,255],[0,128,0,255],[0,0,255,255]]);
    assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 200);
    const panelLimit = await background.evaluate(() => window.captureListener({ type: 'capture', options: { mode: 'screens', amount: 2 } }));
    assert.equal(panelLimit.success, true, JSON.stringify(panelLimit));
    assert.equal(await imageHeight(), 1000);
    await page.locator('main').evaluate(el => { el.scrollTo = () => {}; });
    const blocked = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(blocked.success, true);
    assert.match(blocked.warning, /prevents scrolling/);
    assert.equal(await imageHeight(), 500);
    assert.equal(await page.evaluate(() => '__scrollScreenshotState' in window), false);
    await page.locator('main').evaluate(el => { delete el.scrollTo; });
    const panelStopped = await background.evaluate(() => {
      window.browser.tabs.captureVisibleTab = () => window.captureWithEscape();
      return window.captureListener({ type: 'capture' });
    });
    assert.equal(panelStopped.success, true, JSON.stringify(panelStopped));
    assert.equal(await imageHeight(), 500);
    assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 200);
    // A composer overlays the bottom of the scroller, as in chat applications.
    await page.setContent(`<style>html,body{margin:0;height:100%;overflow:hidden}
      main{position:absolute;left:100px;top:50px;width:600px;height:500px;overflow:auto}
      form{position:absolute;z-index:10;left:100px;top:480px;width:600px;height:70px;margin:0;background:magenta}</style>
      <main>${Array.from({length:2250}, (_, y) => `<div style="height:1px;background:rgb(${y % 251},${Math.floor(y / 251)},100)"></div>`).join('')}</main>
      <form><textarea aria-label="Message">Message composer</textarea></form>`);
    await page.locator('main').evaluate(el => { el.scrollTop = 200; });
    await background.evaluate(() => { window.browser.tabs.captureVisibleTab = () => window.captureTab(); });
    const composerCapture = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(composerCapture.success, true, JSON.stringify(composerCapture));
    const rows = await background.evaluate(async url => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      return Array.from({length: bitmap.height}, (_, y) => [...ctx.getImageData(300, y, 1, 1).data]);
    }, download.url);
    assert.equal(rows.length, 2050);
    for (let y = 0; y < rows.length; y++) {
      assert.deepEqual(rows[y], [(y + 200) % 251, Math.floor((y + 200) / 251), 100, 255], `Missing, duplicate, or obscured row ${y}`);
    }
    assert.equal(await page.locator('form').evaluate(el => el.style.visibility), '');
    assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 200);
    await background.evaluate(() => {
      window.browser.downloads.download = async () => { throw new Error('Download rejected'); };
    });
    const rejected = await background.evaluate(() => window.captureListener({ type: 'capture', options: { mode: 'pixels', amount: 100 } }));
    assert.match(rejected.error, /Download rejected/);
    const failureStatus = await background.evaluate(() => window.captureListener({ type: 'status' }));
    assert.match(failureStatus.result.error, /Download rejected/);
    assert.match(await page.locator('#__scrollScreenshotNotice').textContent(), /Download rejected/);
    assert.equal(await page.locator('form').evaluate(el => el.style.visibility), '');
    assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 200);
    console.log('Passed: stitched dimensions and pixels, download filename, scroll/style restoration, restricted-page error, current-position capture, pixel/screen limits, Escape partial save, nested panel stitching and limits, blocked panel error, every row across joins under a composer overlay.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
