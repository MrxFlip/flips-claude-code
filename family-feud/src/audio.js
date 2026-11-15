// Audio: procedural sound effects + Bella voice playback.
//
// SFX are synthesized with the Web Audio API rather than loaded from files.
// That means the game has a full sound design with zero audio assets, nothing
// to license, and nothing to 404. Drop real .mp3s into audio/sfx/<name>.mp3 and
// they override the synth automatically.
//
// Voice uses the three-stage chain from the plan: pre-rendered Bella clip ->
// speechSynthesis -> subtitles on a timer. No stage can deadlock the game.

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5, G6: 1568 };

export function createAudio(opts = {}) {
  const {
    manifestUrl = 'data/voice-manifest.json',
    sfxDir = 'audio/sfx',
  } = opts;

  let ctx = null;
  let master = null;
  let unlocked = false;
  let muted = false;
  let volume = 0.8;

  let manifest = null;              // { key: [file, ...] }
  const fileCache = new Map();      // name -> HTMLAudioElement|null
  const subtitleListeners = new Set();
  let currentVoice = null;          // { stop() }

  // ---------- lifecycle ----------

  function unlock() {
    if (unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      unlocked = true;
    } catch (e) {
      console.warn('[audio] Web Audio unavailable; running silent', e);
      unlocked = true; // don't retry forever
    }
    resume();
  }

  /**
   * An AudioContext does not stay running. Switching tab, locking the screen or
   * changing the output device suspends it, and a suspended context accepts
   * scheduled nodes and plays none of them. That is the bug where every effect
   * went quiet for the rest of the match while Bella kept talking: `unlocked`
   * was still true, so nothing ever looked at ctx.state again. Every entry
   * point now resumes first, and the page listens for coming back into view.
   */
  function resume() {
    if (!ctx || ctx.state !== 'suspended') return;
    try { ctx.resume().catch(() => {}); } catch {}
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resume();
    });
    window.addEventListener?.('focus', resume);
  }

  function setMuted(v) {
    muted = !!v;
    if (master) master.gain.value = muted ? 0 : volume;
    if (muted) stopVoice();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.value = volume;
  }

  // ---------- synth primitives ----------

  function tone({ freq, type = 'sine', start = 0, dur = 0.18, gain = 0.3, sweepTo = null }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise({ start = 0, dur = 0.3, gain = 0.25, type = 'lowpass', freq = 1200, q = 1 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + start;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // ---------- sound effects ----------

  const SYNTH = {
    ding() {
      tone({ freq: NOTE.C6, dur: 0.5, gain: 0.32 });
      tone({ freq: NOTE.E6, dur: 0.5, gain: 0.2, start: 0.005 });
      tone({ freq: NOTE.G6, dur: 0.42, gain: 0.12, start: 0.01 });
    },
    flip() {
      noise({ dur: 0.1, gain: 0.18, type: 'bandpass', freq: 2600, q: 0.8 });
      tone({ freq: 320, type: 'triangle', dur: 0.09, gain: 0.14 });
    },
    strike() {
      tone({ freq: 150, type: 'sawtooth', dur: 0.55, gain: 0.3 });
      tone({ freq: 143, type: 'sawtooth', dur: 0.55, gain: 0.3, start: 0.004 });
      noise({ dur: 0.18, gain: 0.2, freq: 400 });
    },
    buzz() {
      tone({ freq: 110, type: 'square', dur: 0.32, gain: 0.22 });
    },
    nudge() {
      tone({ freq: 440, type: 'triangle', dur: 0.1, gain: 0.12 });
    },
    roundStart() {
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.22, start: i * 0.085 }));
    },
    bank() {
      [NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) =>
        tone({ freq: f, dur: 0.35, gain: 0.2, start: i * 0.06 }));
    },
    steal() {
      tone({ freq: 220, type: 'sawtooth', dur: 0.8, gain: 0.16, sweepTo: 880 });
    },
    tick() {
      tone({ freq: 1800, type: 'square', dur: 0.035, gain: 0.1 });
    },
    tickUrgent() {
      tone({ freq: 2400, type: 'square', dur: 0.05, gain: 0.18 });
    },
    bell() {
      tone({ freq: NOTE.C6, dur: 1.1, gain: 0.3 });
      tone({ freq: NOTE.G6, dur: 0.9, gain: 0.16, start: 0.02 });
    },
    win() {
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.22, start: i * 0.1 }));
      SYNTH.applause(0.3);
    },
    lose() {
      [NOTE.G5, 622.25, NOTE.C5].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.45, gain: 0.2, start: i * 0.16 }));
    },
    applause(start = 0) {
      for (let i = 0; i < 10; i++) {
        noise({
          start: start + i * 0.09,
          dur: 0.5,
          gain: 0.05 + Math.random() * 0.05,
          type: 'bandpass',
          freq: 1400 + Math.random() * 1800,
          q: 0.6,
        });
      }
    },
  };

  /** Play a named effect. A real file at audio/sfx/<name>.mp3 wins over the synth. */
  function sfx(name) {
    if (muted) return;
    if (!unlocked) unlock();
    resume();

    if (fileCache.has(name)) {
      const el = fileCache.get(name);
      if (el) { try { el.currentTime = 0; el.volume = volume; el.play().catch(() => {}); return; } catch {} }
    } else {
      // Mark the probe as in flight before starting it. The cache is only
      // written when the probe settles, so without this placeholder every call
      // for a name with no file on disk — the default, since the synth covers
      // all of them — started another download of the same 404.
      fileCache.set(name, null);
      const el = new Audio(`${sfxDir}/${name}.mp3`);
      el.preload = 'auto';
      el.addEventListener('canplaythrough', () => fileCache.set(name, el), { once: true });
    }

    SYNTH[name]?.();
  }

  // ---------- voice ----------

  async function loadManifest() {
    if (manifest) return manifest;
    try {
      const res = await fetch(manifestUrl, { cache: 'no-cache' });
      manifest = res.ok ? await res.json() : {};
    } catch {
      manifest = {};
    }
    return manifest;
  }

  function onSubtitle(fn) {
    subtitleListeners.add(fn);
    return () => subtitleListeners.delete(fn);
  }

  function emitSubtitle(text) {
    for (const fn of subtitleListeners) { try { fn(text); } catch {} }
  }

  function stopVoice() {
    if (currentVoice) { try { currentVoice.stop(); } catch {} currentVoice = null; }
    try { window.speechSynthesis?.cancel(); } catch {}
  }

  /** Rough spoken duration, used as the subtitle-only fallback timing. */
  function estimateMs(text) {
    const words = String(text).trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1200, Math.min(9000, (words / 2.7) * 1000 + 600));
  }

  /**
   * One element, reused for every line. A fresh `new Audio()` per line left a
   * hundred-odd media elements alive over a long match, and browsers cap how
   * many they will decode — past the cap play() rejects and Bella silently
   * drops to the robot voice and then to subtitles.
   */
  let voiceEl = null;

  function playClip(src, text) {
    return new Promise((resolve) => {
      if (!voiceEl) {
        voiceEl = new Audio();
        voiceEl.preload = 'auto';
      }
      const el = voiceEl;
      let done = false;
      let guard = 0;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        el.onended = el.onerror = el.onloadedmetadata = null;
        resolve(ok);
      };

      // 'ended' is what resolves a clip; the timer only exists so a stalled
      // download cannot hold the game up. It used to resolve TRUE on a
      // duration+1.5s timer, which bolted 1.5 seconds of dead air onto the end
      // of every single line Bella spoke.
      el.onended = () => finish(true);
      el.onerror = () => finish(false);
      guard = setTimeout(() => finish(false), estimateMs(text) + 4000);
      el.onloadedmetadata = () => {
        clearTimeout(guard);
        guard = setTimeout(() => finish(false), el.duration * 1000 + 2000);
      };

      el.volume = muted ? 0 : volume;
      el.src = src;
      currentVoice = { stop: () => { try { el.pause(); } catch {} finish(false); } };
      el.play().catch(() => finish(false));
    });
  }

  function speakSynth(text) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || muted) return resolve(false);
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        u.pitch = 1.1;
        const voices = synth.getVoices();
        const preferred = voices.find((v) => /female|samantha|zira|karen|google uk english female/i.test(v.name))
          ?? voices.find((v) => v.lang?.startsWith('en'));
        if (preferred) u.voice = preferred;

        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        u.onend = () => finish(true);
        u.onerror = () => finish(false);
        const guard = setTimeout(() => finish(false), estimateMs(text) + 4000);
        u.onend = () => { clearTimeout(guard); finish(true); };

        currentVoice = { stop: () => { try { synth.cancel(); } catch {} finish(false); } };
        synth.speak(u);
      } catch {
        resolve(false);
      }
    });
  }

  // Lines are spoken one at a time. Every say() used to begin by cancelling
  // whatever was still playing, so "Good answer!" cut "Number one answer!" off
  // mid-word and a fast round reduced Bella to syllables. The queue below plays
  // them in order instead, and the priority decides what happens when a line
  // arrives while she is still talking.
  let voiceChain = Promise.resolve();
  let voiceDepth = 0;                 // lines playing or waiting

  /**
   * Speak a line. Resolves when it's done (or when the fallback timer expires).
   * @param {string|null} key   manifest key, e.g. "q:q001" or "host:goodAnswer"
   * @param {string} text       the words, used for subtitles and fallbacks
   * @param {object} [opts]
   * @param {number|null} [opts.index]   which take to use, so the subtitle on
   *        screen is the take that actually plays instead of a different one.
   * @param {'interrupt'|'queue'|'chatter'} [opts.priority]
   *        interrupt — cut the current line off (a new question read);
   *        queue     — wait your turn (the default);
   *        chatter   — skip entirely if she is already mid-line (reactions,
   *                    which are nice to have and never worth a collision).
   */
  function speak(key, text, { index = null, priority = 'queue' } = {}) {
    if (priority === 'chatter' && voiceDepth > 0) return Promise.resolve('skipped');
    if (priority === 'interrupt') stopVoice();

    voiceDepth += 1;
    const line = voiceChain.then(() => speakNow(key, text, index));
    voiceChain = line.then(() => {}, () => {});
    return line.finally(() => { voiceDepth -= 1; });
  }

  async function speakNow(key, text, index) {
    stopVoice();
    emitSubtitle(text);

    if (muted) {
      await new Promise((r) => setTimeout(r, Math.min(1400, estimateMs(text))));
      emitSubtitle('');
      return 'muted';
    }
    resume();

    let used = 'subtitle';
    const m = await loadManifest();
    const clips = key ? m[key] : null;

    if (Array.isArray(clips) && clips.length) {
      const pick = index == null
        ? Math.floor(Math.random() * clips.length)
        : ((index % clips.length) + clips.length) % clips.length;
      if (await playClip(clips[pick], text)) used = 'clip';
    }

    if (used === 'subtitle' && await speakSynth(text)) used = 'synth';

    if (used === 'subtitle') {
      await new Promise((r) => setTimeout(r, estimateMs(text)));
    }

    currentVoice = null;
    emitSubtitle('');
    return used;
  }

  return {
    unlock, resume, setMuted, setVolume, sfx, speak, stopVoice, onSubtitle,
    get isMuted() { return muted; },
    get speaking() { return voiceDepth > 0; },
    // Diagnostic: 'running' is healthy, 'suspended' means the browser has
    // parked the context and every effect would be silent.
    get contextState() { return ctx ? ctx.state : 'none'; },
    // Test hook: park the context the way backgrounding the tab does, so the
    // recovery path can be exercised without depending on browser policy.
    __suspendForTest() { return ctx ? ctx.suspend() : Promise.resolve(); },
    get volume() { return volume; },
  };
}
