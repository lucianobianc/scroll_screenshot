/* global browser */
let capturing = false;
let stopRequested = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs in the page. All changes are restored even if capture fails.
function pageStep(action, y) {
  const key = '__scrollScreenshotState';
  if (action === 'prepare') {
    if (window[key]) throw new Error('A capture is already running on this page.');
    const style = document.createElement('style');
    style.textContent = 'html, body, * { scroll-behavior: auto !important; scroll-snap-type: none !important; overflow-anchor: none !important; }';
    window[key] = { x: scrollX, y: scrollY, style, hidden: [], stopped: false };
    window[key].onKey = event => {
      if (event.key === 'Escape') { window[key].stopped = true; event.preventDefault(); }
    };
    window.addEventListener('keydown', window[key].onKey, true);
    document.documentElement.appendChild(style);
  }
  const state = window[key];
  if (!state) throw new Error('The page changed during capture.');
  if (action === 'scroll') {
    if (!state.hidden.length) {
      for (const element of document.querySelectorAll('body *')) {
        if (['fixed', 'sticky'].includes(getComputedStyle(element).position)) {
          state.hidden.push([element, element.style.getPropertyValue('visibility'), element.style.getPropertyPriority('visibility')]);
          element.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    }
    window.scrollTo(state.x, y);
  }
  if (action === 'restore') {
    for (const [element, value, priority] of state.hidden) {
      if (value) element.style.setProperty('visibility', value, priority);
      else element.style.removeProperty('visibility');
    }
    window.scrollTo(state.x, state.y);
    window.removeEventListener('keydown', state.onKey, true);
    state.style.remove();
    delete window[key];
    return;
  }
  return { stopped: state.stopped, y: scrollY, width: innerWidth, viewport: innerHeight,
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) };
}

async function capture(options = {}) {
  if (capturing) return { error: 'A screenshot is already in progress.' };
  capturing = true;
  stopRequested = false;
  let tab;
  let prepared = false;
  try {
    [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:\/\//.test(tab.url || '')) {
      throw new Error('Open a regular web page first. Firefox internal pages cannot be captured.');
    }
    const step = async (action, y = 0) => (await browser.tabs.executeScript(tab.id, {
      code: `(${pageStep.toString()})(${JSON.stringify(action)}, ${Number(y)})`
    }))[0];
    const mode = options.mode || 'end';
    if (!['end', 'pixels', 'screens'].includes(mode)) throw new Error('Invalid capture mode.');
    const amount = Number(options.amount);
    if (mode !== 'end' && (!Number.isFinite(amount) || amount <= 0)) {
      throw new Error('Enter a positive number of pixels or screens.');
    }
    const initial = await step('prepare');
    prepared = true;
    await pause(400);
    const canvas = document.createElement('canvas');
    let context;
    let scale;
    const start = initial.y;
    let covered = start;
    // Freeze the initial height so infinite-scroll pages cannot run indefinitely.
    const requested = mode === 'end' ? initial.height - start : amount * (mode === 'screens' ? initial.viewport : 1);
    const height = Math.min(initial.height, start + Math.max(1, Math.round(requested)));
    for (let index = 0; covered < height; index++) {
      if (index >= 100) throw new Error('This page is too long to capture (100 screens maximum).');
      if (index > 0 && (stopRequested || (await step('status')).stopped)) break;
      if (index > 0) await step('scroll', covered);
      await pause(550);
      const position = await step('status');
      if (index > 0 && (stopRequested || position.stopped)) break;
      const [active] = await browser.tabs.query({ active: true, windowId: tab.windowId });
      if (active?.id !== tab.id) throw new Error('Capture stopped because you switched tabs. Please try again.');
      const data = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      try {
        if (!context) {
          scale = bitmap.width / position.width;
          canvas.width = bitmap.width;
          canvas.height = Math.ceil((height - start) * scale);
          if (canvas.height > 32767 || canvas.width * canvas.height > 100000000) {
            throw new Error('This page is too large for a single image. Try reducing the browser zoom.');
          }
          context = canvas.getContext('2d');
          if (!context) throw new Error('Unable to create the screenshot image.');
        }
        if (position.width !== initial.width || position.viewport !== initial.viewport) {
          throw new Error('The browser was resized during capture. Please try again.');
        }
        const end = Math.min(height, position.y + position.viewport);
        if (end <= covered) throw new Error('This page prevents scrolling and cannot be captured fully.');
        const sourceY = Math.round((covered - position.y) * scale);
        const pixels = Math.round((end - start) * scale) - Math.round((covered - start) * scale);
        context.drawImage(bitmap, 0, sourceY, bitmap.width, pixels,
          0, Math.round((covered - start) * scale), bitmap.width, pixels);
        covered = end;
      } finally { bitmap.close(); }
    }
    // Trim the unused area when Escape ends a capture early.
    const output = document.createElement('canvas');
    output.width = canvas.width;
    output.height = Math.round((covered - start) * scale);
    output.getContext('2d').drawImage(canvas, 0, 0);
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not encode this image.');
    const url = URL.createObjectURL(blob);
    try {
      const name = (tab.title || 'screenshot').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
      await browser.downloads.download({ url, filename: `${name}-${Date.now()}.png`, saveAs: false });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
    return { success: true };
  } catch (error) {
    return { error: error.message || 'Unable to capture this page.' };
  } finally {
    if (prepared) {
      try { await browser.tabs.executeScript(tab.id, { code: `(${pageStep.toString()})('restore')` }); }
      catch (_) { /* A closed or navigated tab no longer needs restoration. */ }
    }
    capturing = false;
  }
}
browser.runtime.onMessage.addListener(message => {
  if (message.type === 'stop') { stopRequested = true; return Promise.resolve({ success: true }); }
  if (message.type === 'capture') return capture(message.options);
});
