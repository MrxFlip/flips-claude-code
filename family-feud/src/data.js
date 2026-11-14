// Loads and lightly re-checks the survey data at runtime.
// tools/validate-surveys.mjs is the real gate; this only guards against
// shipping a file that would render a broken board.

export async function loadSurveys(url = 'data/surveys.json') {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (cause) {
    throw new Error(
      `Could not fetch ${url}. Serve the folder over http:// — ` +
      `ES modules and fetch are blocked on file:// in most browsers.`,
      { cause }
    );
  }
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data.main) || data.main.length === 0) {
    throw new Error(`${url}: "main" is missing or empty`);
  }

  for (const q of data.main) {
    const total = q.answers.reduce((n, a) => n + a.points, 0);
    if (total !== 100) {
      console.warn(`[surveys] ${q.id} points total ${total}, expected 100`);
    }
  }

  return data;
}
