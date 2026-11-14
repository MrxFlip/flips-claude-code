// Scales the fixed 1920x1080 #stage to fit whatever viewport it lands in.
// This is what makes the game read as a broadcast set rather than a web page:
// every coordinate in styles.css is a literal stage pixel.

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export function initStage(el = document.getElementById('stage')) {
  if (!el) throw new Error('initStage: #stage not found');

  let raf = 0;

  const fit = () => {
    raf = 0;
    const scale = Math.min(
      window.innerWidth / STAGE_W,
      window.innerHeight / STAGE_H
    );
    el.style.transform = `translate(-50%, -50%) scale(${scale})`;
    el.dataset.scale = scale.toFixed(4);
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(fit);
  };

  fit();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });

  // Fonts landing late can change nothing about layout here (fixed stage),
  // but re-fit anyway so a late viewport change during load is caught.
  if (document.fonts?.ready) document.fonts.ready.then(schedule).catch(() => {});

  return { fit: schedule };
}
