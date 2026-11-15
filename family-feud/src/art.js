// Optional artwork. Every image is probed; the stage only switches to the
// generated art once it has actually decoded. A missing or half-filled img/
// folder leaves the CSS-drawn fallbacks in place instead of showing holes.

const BACKGROUNDS = [
  ['img/backdrop.png',     'art-backdrop'],
  ['img/board-frame.png',  'art-boardframe'],
  ['img/strike-x.png',     'art-strike'],
  ['img/round-card.png',   'art-roundcard'],
  ['img/fastmoney-bg.png', 'art-fastmoney'],
  ['img/winner.png',       'art-winner'],
];

function probe(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img.naturalWidth > 0), { once: true });
    img.addEventListener('error', () => resolve(false), { once: true });
    img.src = src;
  });
}

export async function initArt() {
  const found = [];

  await Promise.all(BACKGROUNDS.map(async ([src, cls]) => {
    if (await probe(src)) {
      document.documentElement.classList.add(cls);
      found.push(src);
    }
  }));

  // <img data-art> elements start hidden and reveal themselves on load.
  for (const el of document.querySelectorAll('img[data-art]')) {
    if (!el.getAttribute('src')) continue;
    el.addEventListener('load', () => { el.style.display = 'block'; found.push(el.src); }, { once: true });
    el.addEventListener('error', () => { el.style.display = 'none'; }, { once: true });
    if (el.complete) {
      if (el.naturalWidth > 0) el.style.display = 'block';
      else el.style.display = 'none';
    }
  }

  return found;
}

/** Swap the cut-in portrait. Resolves false if that art isn't present. */
export function setCutinSource(imgEl, src) {
  return new Promise((resolve) => {
    imgEl.onload = () => resolve(true);
    imgEl.onerror = () => resolve(false);
    imgEl.src = src;
  });
}
