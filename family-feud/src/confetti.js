// Tiny confetti burst for the winner screen. No dependency, respects
// prefers-reduced-motion (app.js simply doesn't start it).

export function confetti(canvas, { duration = 6000, count = 170 } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const COLORS = ['#ffc83d', '#ffffff', '#49d5ff', '#c88a12', '#fff3cf'];
  const W = canvas.width, H = canvas.height;

  const bits = Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: -Math.random() * H,
    w: 8 + Math.random() * 14,
    h: 12 + Math.random() * 18,
    vy: 110 + Math.random() * 190,
    vx: -50 + Math.random() * 100,
    rot: Math.random() * Math.PI * 2,
    vr: -3 + Math.random() * 6,
    color: COLORS[(Math.random() * COLORS.length) | 0],
  }));

  let raf = 0, started = 0, stopped = false;

  function frame(now) {
    if (stopped) return;
    if (!started) started = now;
    const elapsed = now - started;
    const dt = 1 / 60;

    ctx.clearRect(0, 0, W, H);
    const fade = elapsed > duration - 1200 ? Math.max(0, (duration - elapsed) / 1200) : 1;

    for (const b of bits) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      if (b.y > H + 40) { b.y = -40; b.x = Math.random() * W; }

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }

    if (elapsed < duration) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  }

  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, W, H);
  };
}
