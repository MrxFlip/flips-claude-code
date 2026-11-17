// Scales the fixed 1920x1080 #stage to fit whatever viewport it lands in.
// This is what makes the game read as a broadcast set rather than a web page:
// every coordinate in styles.css is a literal stage pixel.
//
// Phones get one extra mode. In landscape the on-screen keyboard covers most
// of the screen, and a stage scaled to fit what is left would be a postage
// stamp with the answer box hidden under the keys. So while a text box has
// focus and the keyboard is up, the stage is scaled to the screen's WIDTH and
// slid so the box being typed in — and the prompt line above it — sits at the
// top of the visible area. When the keyboard goes away it snaps back.

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export function initStage(el = document.getElementById('stage')) {
  if (!el) throw new Error('initStage: #stage not found');

  const vv = window.visualViewport ?? null;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  let raf = 0;

  /** Top of `node` in unscaled stage pixels. */
  const stageY = (node) => {
    let y = 0;
    while (node && node !== el) { y += node.offsetTop; node = node.offsetParent; }
    return y;
  };

  const fit = () => {
    raf = 0;
    const fullW = window.innerWidth;
    const fullH = window.innerHeight;
    const seenW = vv?.width ?? fullW;
    const seenH = vv?.height ?? fullH;

    const field = document.activeElement;
    const typing = coarse
      && field instanceof HTMLInputElement && field.type === 'text' && el.contains(field)
      && seenH < fullH * 0.8;                        // the keyboard is actually up

    if (typing) {
      const scale = seenW / STAGE_W;
      // Leave room above the box for the line that says whose turn it is.
      const anchor = Math.max(0, Math.min(stageY(field) - 78, STAGE_H - seenH / scale));
      el.style.left = `${vv?.offsetLeft ?? 0}px`;
      el.style.top = `${vv?.offsetTop ?? 0}px`;
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(0px, ${-anchor * scale}px) scale(${scale})`;
      el.dataset.scale = scale.toFixed(4);
      el.dataset.typing = '1';
      return;
    }

    const scale = Math.min(fullW / STAGE_W, fullH / STAGE_H);
    el.style.left = '';
    el.style.top = '';
    el.style.transformOrigin = '';
    el.style.transform = `translate(-50%, -50%) scale(${scale})`;
    el.dataset.scale = scale.toFixed(4);
    delete el.dataset.typing;
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(fit);
  };

  fit();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  vv?.addEventListener('resize', schedule, { passive: true });
  vv?.addEventListener('scroll', schedule, { passive: true });
  // The keyboard arrives a beat after focus does, and leaves a beat after blur.
  for (const type of ['focusin', 'focusout']) {
    document.addEventListener(type, () => { schedule(); setTimeout(schedule, 350); });
  }

  // Fonts landing late can change nothing about layout here (fixed stage),
  // but re-fit anyway so a late viewport change during load is caught.
  if (document.fonts?.ready) document.fonts.ready.then(schedule).catch(() => {});

  return { fit: schedule };
}
