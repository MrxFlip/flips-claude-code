// Optional artwork.
//
// Each asset is probed by base name across the accepted extensions, and the
// stage only switches to it once the image has actually decoded. A missing or
// half-filled img/ folder leaves the CSS-drawn fallbacks in place rather than
// showing holes, so the game is playable before any art exists.
//
// Resolved URLs are published as CSS custom properties, which is what lets the
// same stylesheet work whether the file turned up as .webp or .png.

const EXTENSIONS = ['.webp', '.png', '.jpg'];

// base name, class flag on <html>, CSS custom property
const ASSETS = [
  ['backdrop',     'art-backdrop',   '--art-backdrop'],
  ['splash',       'art-splash',     '--art-splash'],
  ['board-frame',  'art-boardframe', '--art-board-frame'],
  ['round-card',   'art-roundcard',  '--art-round-card'],
  ['fastmoney-bg', 'art-fastmoney',  '--art-fastmoney'],
  ['winner',       'art-winner',     '--art-winner'],
  ['podiums',      'art-podiums',    '--art-podiums'],
  ['strike-x',     'art-strike',     '--art-strike'],
  ['tile',         'art-tile',       '--art-tile'],
  ['bella-idle',   'art-bella-idle', '--art-bella-idle'],
  ['bella-win',    'art-bella-win',  '--art-bella-win'],
  ['bella-strike', 'art-bella-strike', '--art-bella-strike'],
];

function probe(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img.naturalWidth > 0), { once: true });
    img.addEventListener('error', () => resolve(false), { once: true });
    img.src = src;
  });
}

async function resolveAsset(base) {
  for (const ext of EXTENSIONS) {
    const src = `img/${base}${ext}`;
    if (await probe(src)) return src;
  }
  return null;
}

export async function initArt() {
  const urls = new Map();
  const root = document.documentElement;

  await Promise.all(ASSETS.map(async ([base, cls, cssVar]) => {
    const src = await resolveAsset(base);
    if (!src) return;
    urls.set(base, src);
    root.classList.add(cls);
    root.style.setProperty(cssVar, `url('${src}')`);
  }));

  // <img data-art-base> elements point at whichever extension turned up.
  for (const el of document.querySelectorAll('img[data-art-base]')) {
    const src = urls.get(el.dataset.artBase);
    if (src) { el.src = src; el.style.display = 'block'; }
    else el.style.display = 'none';
  }

  // The splash and winner frames already contain Bella, so the standalone
  // portrait would put a second one on the same screen.
  if (urls.has('splash')) root.classList.add('art-splash-has-host');
  if (urls.has('winner')) root.classList.add('art-winner-has-host');

  // The arcade tile doubles as the favicon.
  const tile = urls.get('tile');
  if (tile) {
    const link = document.querySelector('link[rel="icon"]') ?? document.createElement('link');
    link.rel = 'icon';
    link.href = tile;
    document.head.append(link);
  }

  return urls;
}
