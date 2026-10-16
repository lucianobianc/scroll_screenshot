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
    await background.exposeFunction('executeInTab', async ({ code, file }) => [await page.evaluate(file ? fs.readFileSync(path.join(__dirname, '..', file), 'utf8') : code)]);
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
    async function waitForCapture() {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const state = await background.evaluate(() => window.captureListener({ type: 'status' }));
        if (!state.running) return state;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Capture did not finish within 15 seconds');
    }
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
    assert.match(blocked.warning, /rolagem parou antes do fim/);
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
    // Dynamic document height and a one-pixel metrics discrepancy at the bottom.
    await page.setContent('<style>body{margin:0}</style><div id="content" style="height:2250px;background:linear-gradient(red,blue)"></div>');
    await page.evaluate(() => {
      scrollTo(0, 200);
      const root = document.scrollingElement;
      Object.defineProperty(root, 'scrollHeight', { configurable: true, get: () => document.getElementById('content').offsetHeight + 1 });
    });
    let shrinkFrames = 0;
    await background.exposeFunction('captureShrinking', async () => {
      const data = 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
      if (++shrinkFrames === 1) await page.locator('#content').evaluate(el => { el.style.height = '1500px'; });
      return data;
    });
    await background.evaluate(() => { window.browser.tabs.captureVisibleTab = () => window.captureShrinking(); });
    const shortened = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(shortened.success, true, JSON.stringify(shortened));
    assert.equal(shortened.warning, undefined, 'A changed bottom is not a scrolling failure');
    assert.equal(await imageHeight(), 1300);
    await page.evaluate(() => { delete document.scrollingElement.scrollHeight; });
    await background.evaluate(() => { window.browser.tabs.captureVisibleTab = () => window.captureTab(); });
    const rootArea = await background.evaluate(() => window.captureListener({ type: 'capture', options: { region: { x: 50, y: 100, width: 200, height: 200 } } }));
    assert.equal(rootArea.success, true, JSON.stringify(rootArea));
    assert.equal(rootArea.warning, undefined);
    assert.equal(await imageHeight(), 900);
    assert.equal(await page.evaluate(() => scrollY), 200);
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
    const readRows = () => background.evaluate(async url => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      return Array.from({length: bitmap.height}, (_, y) => [...ctx.getImageData(300, y, 1, 1).data]);
    }, download.url);
    const rows = await readRows();
    assert.equal(rows.length, 2050);
    for (let y = 0; y < rows.length; y++) {
      assert.deepEqual(rows[y], [(y + 200) % 251, Math.floor((y + 200) / 251), 100, 255], `Missing, duplicate, or obscured row ${y}`);
    }
    assert.equal(await page.locator('form').evaluate(el => el.style.visibility), '');
    assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 200);
    // Virtualized views can adjust scrollTop after a requested scroll.
    await page.locator('main').evaluate(el => {
      el.addEventListener('scroll', () => { el.scrollTop += 150; }, { once: true });
    });
    const jumped = await background.evaluate(() => window.captureListener({ type: 'capture' }));
    assert.equal(jumped.success, true);
    assert.equal(jumped.warning, undefined, 'A recoverable scroll adjustment must not abort capture');
    assert.equal(await imageHeight(), 2050);
    assert.deepEqual(await readRows(), rows, 'Scroll recovery must preserve every row');
    const selectionSource = fs.readFileSync(path.join(__dirname, '../selection.js'), 'utf8');
    const selecting = page.evaluate(selectionSource);
    await page.locator('#__scrollScreenshotSelection').waitFor();
    await page.mouse.move(400, 400); await page.mouse.down();
    await page.mouse.move(200, 100); await page.mouse.up();
    const region = await selecting;
    assert.deepEqual(region, { x: 200, y: 100, width: 200, height: 300 });
    assert.equal(await page.locator('#__scrollScreenshotSelection').count(), 0);
    const selected = await background.evaluate(region => window.captureListener({ type: 'capture', options: { region } }), region);
    assert.equal(selected.success, true, JSON.stringify(selected));
    assert.equal(selected.warning, undefined);
    const selectedRows = await background.evaluate(async url => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, rows: Array.from({length: bitmap.height}, (_, y) => [...ctx.getImageData(100, y, 1, 1).data]) };
    }, download.url);
    assert.equal(selectedRows.width, 200);
    assert.equal(selectedRows.rows.length, 1850);
    for (let y = 0; y < selectedRows.rows.length; y++) {
      assert.deepEqual(selectedRows.rows[y], [(y + 250) % 251, Math.floor((y + 250) / 251), 100, 255], `Selected area seam at row ${y}`);
    }
    assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 200);
    for (const [mode, amount, height] of [['screens', 2, 600], ['pixels', 450, 450]]) {
      const result = await background.evaluate(options => window.captureListener({ type: 'capture', options }), { region, mode, amount });
      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(await imageHeight(), height);
    }
    await background.evaluate(() => { window.browser.tabs.captureVisibleTab = () => window.captureWithEscape(); });
    const regionStopped = await background.evaluate(region => window.captureListener({ type: 'capture', options: { region } }), region);
    assert.equal(regionStopped.success, true);
    assert.equal(await imageHeight(), 300);
    await background.evaluate(() => { window.browser.tabs.captureVisibleTab = () => window.captureTab(); });
    const areaStarted = await background.evaluate(() => window.captureListener({ type: 'capture', options: { selectArea: true, mode: 'screens', amount: 2 } }));
    assert.equal(areaStarted.started, true);
    await page.locator('#__scrollScreenshotSelection').waitFor();
    await page.mouse.move(200, 100); await page.mouse.down();
    await page.mouse.move(400, 400); await page.mouse.up();
    await waitForCapture();
    const areaFinished = await background.evaluate(() => window.captureListener({ type: 'status' }));
    assert.equal(areaFinished.result.success, true, JSON.stringify(areaFinished));
    assert.equal(await imageHeight(), 600);
    const downloadsBeforeCancel = download.url;
    const started = await background.evaluate(() => window.captureListener({ type: 'capture', options: { selectArea: true } }));
    assert.equal(started.started, true);
    await page.locator('#__scrollScreenshotSelection').waitFor();
    await page.keyboard.press('Escape');
    await waitForCapture();
    const cancelled = await background.evaluate(() => window.captureListener({ type: 'status' }));
    assert.equal(cancelled.result.cancelled, true);
    assert.equal(download.url, downloadsBeforeCancel);
    const invalid = await background.evaluate(() => window.captureListener({ type: 'capture', options: { region: { x: 0, y: 0, width: 400, height: 400 } } }));
    assert.match(invalid.error, /único painel/);
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
    console.log('Passed: stitched dimensions and pixels, download filename, scroll/style restoration, restricted-page error, current-position capture, pixel/screen limits, Escape partial save, nested panel stitching and limits, blocked panel error, every row across joins under a composer overlay, scroll-jump recovery, dynamic height and rounded bottom completion, region selection/cancellation, all selected-area rows and limits.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
