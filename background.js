/* global browser */
let capturing = false;
let stopRequested = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs in the page. All changes are restored even if capture fails.
function pageStep(action, y) {
  const key = '__scrollScreenshotState';
  if (action === 'prepare') {
    if (window[key]) throw new Error('A capture is already running on this page.');
    // Apps such as Discord scroll a panel while the document remains stationary.
    const root = document.scrollingElement || document.documentElement;
    const visibleBox = element => {
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, rect.left + element.clientLeft);
      const top = Math.max(0, rect.top + element.clientTop);
      return { x: left, y: top,
        width: Math.max(0, Math.min(innerWidth, rect.left + element.clientLeft + element.clientWidth) - left),
        height: Math.max(0, Math.min(innerHeight, rect.top + element.clientTop + element.clientHeight) - top) };
    };
    const candidates = [...document.querySelectorAll('body *')].filter(element => {
      const css = getComputedStyle(element);
      return /^(auto|scroll|overlay)$/.test(css.overflowY) &&
        element.scrollHeight > element.clientHeight + 1 &&
        css.visibility !== 'hidden' && css.display !== 'none';
    }).map(element => ({ element, box: visibleBox(element) }))
      .filter(item => item.box.width > 100 && item.box.height > 100)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    const target = root.scrollHeight > innerHeight + 1 ? root : (candidates[0]?.element || root);
    const isRoot = target === root;
    const style = document.createElement('style');
    style.textContent = 'html, body, * { scroll-behavior: auto !important; scroll-snap-type: none !important; overflow-anchor: none !important; }';
    window[key] = { target, isRoot, x: target.scrollLeft, y: target.scrollTop, style, hidden: [], fixedHidden: false, stopped: false };
    window[key].onKey = event => {
      if (event.key === 'Escape') { window[key].stopped = true; event.preventDefault(); }
    };
    window.addEventListener('keydown', window[key].onKey, true);
    document.documentElement.appendChild(style);
    if (!isRoot) {
      // A sibling composer/header can cover the panel without reducing clientHeight.
      // Hide only small covering branches, preserving layout and restoring inline styles.
      const box = visibleBox(target);
      for (const fraction of [0.01, 0.1, 0.2, 0.8, 0.9, 0.99]) {
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height * fraction);
        if (!hit || target.contains(hit) || hit.contains(target)) continue;
        let overlay;
        for (let node = hit; node && !node.contains(target); node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= box.width / 2 && rect.height > 0 && rect.height <= box.height * 0.45) overlay = node;
        }
        if (overlay && !window[key].hidden.some(([element]) => element === overlay)) {
          window[key].hidden.push([overlay, overlay.style.getPropertyValue('visibility'), overlay.style.getPropertyPriority('visibility')]);
          overlay.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    }
  }
  const state = window[key];
  if (!state) throw new Error('The page changed during capture.');
  if (action === 'scroll') {
    if (!state.fixedHidden) {
      state.fixedHidden = true;
      for (const element of (state.isRoot ? document : state.target).querySelectorAll('*')) {
        if (!element.contains(state.target) && !state.hidden.some(([hidden]) => hidden === element) && ['fixed', 'sticky'].includes(getComputedStyle(element).position)) {
          state.hidden.push([element, element.style.getPropertyValue('visibility'), element.style.getPropertyPriority('visibility')]);
          element.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    }
    state.target.scrollTo(state.x, y);
  }
  if (action === 'restore') {
    for (const [element, value, priority] of state.hidden) {
      if (value) element.style.setProperty('visibility', value, priority);
      else element.style.removeProperty('visibility');
    }
    state.target.scrollTo(state.x, state.y);
    window.removeEventListener('keydown', state.onKey, true);
    state.style.remove();
    delete window[key];
    return;
  }
  const rect = state.target.getBoundingClientRect();
  const clip = state.isRoot ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : {
    x: Math.max(0, rect.left + state.target.clientLeft),
    y: Math.max(0, rect.top + state.target.clientTop),
    width: Math.min(state.target.clientWidth, innerWidth - Math.max(0, rect.left + state.target.clientLeft)),
    height: Math.min(state.target.clientHeight, innerHeight - Math.max(0, rect.top + state.target.clientTop))
  };
  if (clip.width <= 0 || clip.height <= 0) throw new Error('The scrolling panel is no longer visible.');
  return { stopped: state.stopped, y: state.target.scrollTop, width: innerWidth,
    viewport: clip.height, clip, height: state.target.scrollHeight };
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
      // Retain an overlap; append only rows beyond covered, using actual scrollTop.
      if (index > 0) await step('scroll', Math.max(start, covered - Math.min(64, initial.viewport / 4)));
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
          canvas.width = Math.round(position.clip.width * scale);
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
        if (position.y > covered || end <= covered) throw new Error('This page prevents scrolling and cannot be captured fully.');
        const sourceY = Math.round((position.clip.y + covered - position.y) * scale);
        const pixels = Math.round((end - start) * scale) - Math.round((covered - start) * scale);
        context.drawImage(bitmap, Math.round(position.clip.x * scale), sourceY, canvas.width, pixels,
          0, Math.round((covered - start) * scale), canvas.width, pixels);
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
