// Five short songs, written as notes and rendered offline into AudioBuffers.
const SR = 22050;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------------------------------------------------------------- instruments
function env(ctx, t, a, att, dec, sus = 0, rel = 0.2, len = 0) {
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + att);
  if (len) { g.gain.setTargetAtTime(a * sus, t + att, dec / 3); g.gain.setTargetAtTime(0, t + len, rel / 3); }
  else g.gain.setTargetAtTime(0, t + att, dec / 3);
  return g;
}
function osc(ctx, type, f, t, stop) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(stop); return o; }

const I = {
  // electric piano: two-operator FM with a short bell tine
  rhodes(ctx, out, t, m, dur, v = 0.5) {
    const f = hz(m), end = t + dur + 1.6;
    const car = osc(ctx, 'sine', f, t, end), mod = osc(ctx, 'sine', f, t, end), tine = osc(ctx, 'sine', Math.min(9000, f * 7.02), t, t + 0.3);
    const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 2.2 * v, t); mg.gain.setTargetAtTime(f * 0.35, t, 0.12);
    mod.connect(mg).connect(car.frequency);
    const g = env(ctx, t, 0.22 * v, 0.006, 2.4, 0.55, 0.35, dur);
    car.connect(g).connect(out);
    const tg = env(ctx, t, 0.02 * v, 0.002, 0.08); tine.connect(tg).connect(out);
  },
  piano(ctx, out, t, m, dur, v = 0.5) {
    const f = hz(m), end = t + dur + 2.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(800 + 5000 * v, t); lp.frequency.setTargetAtTime(600, t, 0.6);
    const g = env(ctx, t, 0.16 * v, 0.004, 3.5, 0.4, 0.5, dur);
    [1, 2, 3, 4, 5].forEach((k, i) => {
      const o = osc(ctx, i ? 'sine' : 'triangle', f * k * (1 + 0.0004 * k * k), t, end);
      const pg = ctx.createGain(); pg.gain.value = 1 / (k * k * 0.7 + 0.3);
      o.connect(pg).connect(lp);
    });
    lp.connect(g).connect(out);
  },
  musicbox(ctx, out, t, m, dur, v = 0.5) {
    const f = hz(m);
    [[1, 1, 1.6], [3.98, 0.25, 0.4], [6.3, 0.08, 0.2], [2, 0.1, 0.8]].filter(([k]) => f * k < 9500).forEach(([k, a, d]) => {
      const o = osc(ctx, 'sine', f * k, t, t + d * 2.5);
      o.connect(env(ctx, t, 0.16 * v * a, 0.002, d)).connect(out);
    });
  },
  vibes(ctx, out, t, m, dur, v = 0.5) {
    const f = hz(m), end = t + dur + 2;
    const g = env(ctx, t, 0.18 * v, 0.003, 2.2, 0.5, 0.6, dur);
    const trem = ctx.createGain(); trem.gain.value = 0.8;
    const lfo = osc(ctx, 'sine', 5.2, t, end); const lg = ctx.createGain(); lg.gain.value = 0.2; lfo.connect(lg).connect(trem.gain);
    osc(ctx, 'sine', f, t, end).connect(trem);
    const h = osc(ctx, 'sine', Math.min(9000, f * 4), t, t + 0.6); h.connect(env(ctx, t, 0.05 * v, 0.002, 0.25)).connect(out);
    trem.connect(g).connect(out);
  },
  pad(ctx, out, t, m, dur, v = 0.5) {
    const f = hz(m), end = t + dur + 3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3;
    const g = env(ctx, t, 0.05 * v, Math.min(2.5, dur * 0.4), 1, 1, 2.2, dur);
    [-7, 0, 6].forEach(d => { const o = osc(ctx, 'sawtooth', f, t, end); o.detune.value = d; o.connect(lp); });
    lp.connect(g).connect(out);
  },
  bass(ctx, out, t, m, dur, v = 0.5) {
    const f = hz(m), end = t + dur + 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.setTargetAtTime(300, t, 0.08);
    osc(ctx, 'triangle', f, t, end).connect(lp);
    const s = osc(ctx, 'sine', f, t, end); s.connect(lp);
    lp.connect(env(ctx, t, 0.4 * v, 0.008, 0.9, 0.5, 0.12, dur)).connect(out);
  },
  pluck(ctx, out, t, m, dur, v = 0.5, opts) { out.__ks(t, m, dur, v, opts); },
  kick(ctx, out, t, v = 0.6) {
    const o = osc(ctx, 'sine', 120, t, t + 0.5);
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(env(ctx, t, 0.7 * v, 0.002, 0.3)).connect(out);
  },
  snare(ctx, out, t, v = 0.5, noise) {
    const n = ctx.createBufferSource(); n.buffer = noise; n.start(t, Math.random() * 1, 0.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
    n.connect(bp).connect(env(ctx, t, 0.28 * v, 0.002, 0.16)).connect(out);
    const o = osc(ctx, 'triangle', 190, t, t + 0.15); o.connect(env(ctx, t, 0.15 * v, 0.001, 0.06)).connect(out);
  },
  brush(ctx, out, t, v = 0.5, noise, len = 0.25) {
    const n = ctx.createBufferSource(); n.buffer = noise; n.start(t, Math.random() * 1, len + 0.3);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * v, t + len * 0.4); g.gain.linearRampToValueAtTime(0, t + len);
    n.connect(bp).connect(g).connect(out);
  },
  hat(ctx, out, t, v = 0.4, noise) {
    const n = ctx.createBufferSource(); n.buffer = noise; n.start(t, Math.random() * 1, 0.1);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    n.connect(hp).connect(env(ctx, t, 0.12 * v, 0.001, 0.04)).connect(out);
  },
};

// Karplus-Strong string, computed directly
function ksBuffer(ctx, f, dur, bright = 0.5, damp = 0.996) {
  const len = Math.floor(SR * (dur + 1.5)), N = Math.max(2, Math.round(SR / f));
  const b = ctx.createBuffer(1, len, SR), d = b.getChannelData(0);
  const ring = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) { lp += ((Math.random() * 2 - 1) - lp) * bright; ring[i] = lp; }
  let idx = 0, prev = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const y = damp * 0.5 * (cur + prev);
    prev = cur; ring[idx] = y; idx = (idx + 1) % N;
    d[i] = cur;
  }
  return b;
}

// ---------------------------------------------------------------- song data
// chord: [bassMidi, [voicing...]]; melody: [bar, beat, midi, beats]
const SONGS = [
  {
    title: 'Lake Song', bpm: 74, swing: 0.6, bars: 32, beats: 4,
    chords: [[43, [59, 62, 66, 69]], [42, [57, 61, 64, 69]], [47, [62, 66, 69, 73]], [45, [62, 66, 69, 73]], [43, [59, 62, 66, 69]], [42, [57, 61, 64, 69]], [40, [55, 59, 62, 66]], [45, [55, 61, 66, 71]]],
    melody: [[0, .5, 74, 1], [0, 1.5, 73, .5], [0, 2, 71, 1.5], [1, 0, 69, 1], [1, 1.5, 71, .5], [1, 2, 73, 2], [2, .5, 74, .5], [2, 1, 76, 1], [2, 2, 74, .5], [2, 2.5, 73, 1.5], [3, 0, 69, 3],
      [4, .5, 71, 1], [4, 1.5, 74, .5], [4, 2, 78, 1], [4, 3, 76, 1], [5, 0, 74, 1.5], [5, 1.5, 73, .5], [5, 2, 69, 2], [6, .5, 67, .5], [6, 1, 69, 1], [6, 2, 71, 1], [6, 3, 73, 1], [7, 0, 69, 3.5]],
    lead: 'rhodes', comp: 'rhodes', drums: 'lofi', bass: 'bass',
  },
  {
    title: 'Pine Lullaby', bpm: 84, swing: 0.5, bars: 40, beats: 3,
    chords: [[48, [60, 64, 67]], [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [55, 59, 62]], [48, [60, 64, 67]], [40, [56, 59, 62]], [50, [57, 62, 65]], [48, [55, 60, 64]]],
    melody: [[0, 0, 76, 1], [0, 1, 79, 1], [0, 2, 76, 1], [1, 0, 74, 1.5], [1, 1.5, 72, .5], [1, 2, 69, 1], [2, 0, 72, 1], [2, 1, 69, 1], [2, 2, 65, 1], [3, 0, 67, 3],
      [4, 0, 76, 1], [4, 1, 79, 1], [4, 2, 84, 1], [5, 0, 83, 1.5], [5, 1.5, 81, .5], [5, 2, 76, 1], [6, 0, 77, 1], [6, 1, 76, 1], [6, 2, 74, 1], [7, 0, 72, 3]],
    lead: 'musicbox', comp: 'arp-box', drums: null, bass: null, pad: true,
  },
  {
    title: 'Driftwood', bpm: 80, swing: 0.5, bars: 40, beats: 4,
    chords: [[45, [52, 57, 60, 64]], [41, [48, 53, 57, 60]], [48, [55, 60, 64, 67]], [43, [50, 55, 59, 62]], [45, [52, 57, 60, 64]], [41, [48, 53, 57, 60]], [50, [57, 62, 65, 69]], [40, [47, 52, 56, 59]]],
    melody: [[0, 0, 76, 2], [0, 2, 74, 1], [0, 3, 72, 1], [1, 0, 72, 2], [1, 2, 69, 2], [2, 0, 67, 1], [2, 1, 72, 1], [2, 2, 76, 2], [3, 0, 74, 4],
      [4, 0, 76, 1.5], [4, 1.5, 77, .5], [4, 2, 76, 1], [4, 3, 72, 1], [5, 0, 69, 3], [5, 3, 72, 1], [6, 0, 74, 1], [6, 1, 77, 1], [6, 2, 81, 1], [6, 3, 77, 1], [7, 0, 76, 4]],
    lead: 'pluck-lead', comp: 'fingerpick', drums: null, bass: null,
  },
  {
    title: 'Night Swim', bpm: 60, swing: 0.5, bars: 36, beats: 4,
    chords: [[39, [55, 58, 62]], [39, [55, 58, 62]], [36, [51, 55, 58, 62]], [36, [51, 55, 58, 62]], [44, [60, 63, 67, 74]], [44, [60, 63, 67, 74]], [46, [53, 58, 63, 65]], [46, [53, 56, 58, 63]]],
    melody: null, lead: 'piano-sparse', comp: 'pad', drums: null, bass: 'pad-bass', scale: [63, 65, 67, 70, 72, 75, 77, 79, 82],
  },
  {
    title: 'Porch Light', bpm: 88, swing: 0.64, bars: 40, beats: 4,
    chords: [[36, [51, 55, 58, 62]], [41, [51, 57, 62, 67]], [34, [50, 53, 57, 60]], [43, [46, 50, 53, 57]], [39, [55, 58, 62, 65]], [[45, 38], [[55, 60, 63], [54, 60, 63]]], [43, [46, 50, 53, 57]], [[36, 41], [[52, 58, 62], [51, 57, 62, 67]]]],
    melody: [[0, 0, 74, 1.5], [0, 1.5, 72, .5], [0, 2, 70, 2], [1, .5, 69, .5], [1, 1, 72, 1], [1, 2, 77, 2], [2, 0, 74, 3], [2, 3, 72, 1], [3, 0, 70, 1], [3, 1, 69, 1], [3, 2, 67, 2],
      [4, 0, 70, 1.5], [4, 1.5, 74, .5], [4, 2, 77, 1], [4, 3, 79, 1], [5, 0, 75, 1], [5, 1, 72, 1], [5, 2, 72, .5], [5, 2.5, 70, .5], [5, 3, 66, 1], [6, 0, 67, 3], [7, 0, 70, 1], [7, 1, 72, 1], [7, 2, 74, 1], [7, 3, 77, 1]],
    lead: 'vibes', comp: 'rhodes', drums: 'brushes', bass: 'walking',
  },
];

export const SONG_TITLES = SONGS.map(s => s.title);

function impulse(ctx, secs, decay) {
  const len = Math.floor(SR * secs), b = ctx.createBuffer(2, len, SR);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return b;
}

export async function renderSong(i) {
  const S = SONGS[i];
  const beat = 60 / S.bpm, bar = beat * S.beats;
  const total = S.bars * bar + 4;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  const R = rng(1000 + i * 77);
  const noise = ctx.createBuffer(1, SR * 2, SR); { const d = noise.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1; }
  // mix bus: gentle lowpass, a room, glue compression
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.connect(ctx.destination);
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 7000; tone.connect(comp);
  const bus = ctx.createGain(); bus.gain.value = 0.6; bus.connect(tone);
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 2.6, 2.4);
  const send = ctx.createGain(); send.gain.value = S.lead === 'musicbox' || S.lead === 'piano-sparse' ? 0.55 : 0.28;
  send.connect(verb).connect(tone);
  const out = ctx.createGain(); out.connect(bus); out.connect(send);
  const ksCache = new Map();
  out.__ks = (t, m, dur, v, { bright = 0.5, damp = 0.996, pan = 0 } = {}) => {
    const key = m + ':' + bright + ':' + damp;
    if (!ksCache.has(key)) ksCache.set(key, ksBuffer(ctx, hz(m), 3, bright, damp));
    const src = ctx.createBufferSource(); src.buffer = ksCache.get(key);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35 * v, t); g.gain.setTargetAtTime(0, t + dur, 0.08);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(g).connect(p).connect(out); src.start(t, 0, dur + 0.5);
  };
  const T = (barN, b) => {
    // swing the off-beat eighths
    const whole = Math.floor(b), frac = b - whole;
    const sw = Math.abs(frac - 0.5) < 1e-3 ? S.swing : frac;
    return 1.2 + barN * bar + (whole + sw) * beat;
  };
  const human = () => (R() - 0.5) * 0.014;
  const L = S.chords.length;
  for (let n = 0; n < S.bars; n++) {
    // building thousands of nodes at once blocks the page; let a frame through every couple of bars
    if (n % 2 === 1) await new Promise(r => setTimeout(r, 0));
    const c = S.chords[n % L];
    const split = Array.isArray(c[0]);
    const parts = split ? [[c[0][0], c[1][0], 0, S.beats / 2], [c[0][1], c[1][1], S.beats / 2, S.beats / 2]] : [[c[0], c[1], 0, S.beats]];
    const phrase = Math.floor(n / L);
    const intro = phrase === 0, outro = n >= S.bars - L;
    // ---- comping
    for (const [root, voicing, b0, len] of parts) {
      if (S.comp === 'rhodes') {
        voicing.forEach((m, k) => I.rhodes(ctx, out, T(n, b0) + k * 0.012 + human(), m, len * beat * 0.45, 0.32));
        if (len >= 4) voicing.forEach((m, k) => I.rhodes(ctx, out, T(n, b0 + 2.5) + k * 0.01 + human(), m, beat * 1.2, 0.24));
      } else if (S.comp === 'pad') {
        if (n % 2 === 0) voicing.forEach(m => I.pad(ctx, out, T(n, 0), m, bar * 2, 0.7));
      } else if (S.comp === 'arp-box') {
        const tones = [root, root + 7, root + 12, voicing[1] - 12 + 12];
        for (let k = 0; k < S.beats * 2; k++) I.musicbox(ctx, out, T(n, k * 0.5) + human(), tones[k % tones.length] + 12, 0.4, 0.45);
      } else if (S.comp === 'fingerpick') {
        const strings = [root, ...voicing];
        const pattern = [0, 2, 3, 4, 1, 3, 2, 3];
        pattern.forEach((si, k) => out.__ks(T(n, k * 0.5) + human(), strings[si], k === 0 ? beat * 3 : beat * 1.6, k === 0 ? 0.9 : 0.55, { bright: 0.35, damp: 0.995, pan: (si - 2) * 0.12 }));
      }
      // ---- bass
      if (S.bass === 'bass' && !intro) { I.bass(ctx, out, T(n, b0), root - 12 + 12, beat * 1.4, 0.8); if (len >= 4) I.bass(ctx, out, T(n, b0 + 2.5), root + (R() < 0.5 ? 7 : 12), beat * 0.9, 0.6); }
      if (S.bass === 'pad-bass' && n % 2 === 0) I.pad(ctx, out, T(n, 0), root, bar * 2, 0.9);
      if (S.bass === 'walking') {
        const next = S.chords[(n + 1) % L], nr = Array.isArray(next[0]) ? next[0][0] : next[0];
        const steps = len >= 4 ? [root, root + (R() < 0.5 ? 3 : 4), root + 7, nr + (R() < 0.5 ? 1 : -1)] : [root, nr + (R() < 0.5 ? 1 : -1)];
        steps.forEach((m, k) => out.__ks(T(n, b0 + k) + human(), m - 12 + 12 + (m < 34 ? 12 : 0), beat * 0.95, 0.85, { bright: 0.22, damp: 0.993 }));
      }
    }
    // ---- drums
    if (S.drums === 'lofi' && !intro) {
      I.kick(ctx, out, T(n, 0), 0.8); I.kick(ctx, out, T(n, 2.5), 0.55);
      if (R() < 0.3) I.kick(ctx, out, T(n, 3.5), 0.4);
      I.snare(ctx, out, T(n, 1) + 0.01, 0.55, noise); I.snare(ctx, out, T(n, 3) + 0.01, 0.55, noise);
      for (let k = 0; k < 8; k++) I.hat(ctx, out, T(n, k * 0.5) + human(), k % 2 ? 0.35 : 0.6, noise);
    }
    if (S.drums === 'brushes' && !intro) {
      for (let k = 0; k < 4; k++) I.brush(ctx, out, T(n, k), k % 2 ? 0.9 : 0.6, noise, beat * 0.8);
      I.brush(ctx, out, T(n, 1.5), 0.4, noise, 0.08); I.brush(ctx, out, T(n, 3.5), 0.4, noise, 0.08);
      I.kick(ctx, out, T(n, 0), 0.3);
    }
    // ---- melody: from the second phrase, with a little variation, and an octave lift once
    if (S.melody && !intro && !(outro && S.bars / L > 4)) {
      const up = phrase === 3 ? 12 : 0;
      for (const [mb, b, m, d] of S.melody) {
        if (mb !== n % L) continue;
        if (phrase === 2 && R() < 0.15) continue;
        const v = 0.55 + R() * 0.2;
        if (S.lead === 'rhodes') I.rhodes(ctx, out, T(n, b) + human(), m + up, d * beat, v);
        else if (S.lead === 'musicbox') I.musicbox(ctx, out, T(n, b), m + up, d * beat, v * 1.2);
        else if (S.lead === 'vibes') I.vibes(ctx, out, T(n, b) + human(), m + up, d * beat, v);
        else if (S.lead === 'pluck-lead') out.__ks(T(n, b) + human(), m, d * beat + 0.3, 1.0, { bright: 0.55, damp: 0.997, pan: 0.1 });
      }
    }
    if (S.lead === 'piano-sparse' && n >= 2) {
      const count = 1 + Math.floor(R() * 3);
      for (let k = 0; k < count; k++) {
        const m = S.scale[Math.floor(R() * S.scale.length)];
        I.piano(ctx, out, T(n, Math.floor(R() * 8) * 0.5), m, beat * 2.5, 0.45 + R() * 0.25);
      }
    }
    if (S.pad && n % 2 === 0) { const [root, v] = parts[0]; v.forEach(m => I.pad(ctx, out, T(n, 0), m - 12, bar * 2, 0.35)); }
  }
  const buf = await ctx.startRendering();
  // normalise every song to the same peak
  let pk = 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let k = 0; k < d.length; k++) { const a = Math.abs(d[k]); if (a > pk) pk = a; } }
  const g = 0.8 / Math.max(pk, 1e-4);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let k = 0; k < d.length; k++) d[k] *= g; }
  return buf;
}
