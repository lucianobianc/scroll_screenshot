// This promise resolves after dragging a rectangle, or Escape to cancel.
(() => new Promise(resolve => {
  document.getElementById('__scrollScreenshotNotice')?.remove();
  const overlay = document.createElement('div');
  overlay.id = '__scrollScreenshotSelection';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.2);touch-action:none;';
  const hint = document.createElement('div');
  hint.textContent = 'Arraste para selecionar a área. Esc cancela.';
  hint.style.cssText = 'position:absolute;top:12px;left:12px;background:#222;color:white;padding:12px;font:14px system-ui;pointer-events:none;';
  const rectangle = document.createElement('div');
  rectangle.style.cssText = 'position:absolute;border:2px solid #a99aff;box-sizing:border-box;background:rgba(255,255,255,.08);pointer-events:none;';
  overlay.append(hint, rectangle);
  let origin;
  const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
  const bounds = event => {
    const current = point(event);
    return { x: Math.min(origin.x, current.x), y: Math.min(origin.y, current.y), width: Math.abs(current.x - origin.x), height: Math.abs(current.y - origin.y) };
  };
  const finish = region => {
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    resolve(region);
  };
  const onKey = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(null); }
  };
  const onResize = () => finish(null);
  overlay.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    origin = point(event);
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener('pointermove', event => {
    if (!origin) return;
    const box = bounds(event);
    Object.assign(rectangle.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  });
  overlay.addEventListener('pointerup', event => {
    if (!origin) return;
    const box = bounds(event);
    if (box.width < 24 || box.height < 24) {
      origin = null;
      hint.textContent = 'Selecione uma área de pelo menos 24 × 24 pixels. Esc cancela.';
      return;
    }
    finish(box);
  });
  overlay.addEventListener('pointercancel', () => finish(null));
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  document.documentElement.appendChild(overlay);
}))();
