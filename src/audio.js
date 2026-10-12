// Fully synthesised ambience. Random events are scheduled several seconds ahead so
// background-tab timer throttling never leaves gaps.
const LOOKAHEAD = 4;

export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.vol = { master: 0.8, rain: 0.8, fire: 0.7, water: 0.7, wind: 0.3, life: 0.6 };
    this.scene = { rain: 0, snowFall: 0, night: 0, winter: 0, tod: 1, fireBoost: 0, ice: 0 };
    this.next = {};
  }

  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; this._applyMaster(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.on = true;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);
    // reverb send
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(3.2, 2.6);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.5;
    this.verbIn.connect(this.verb).connect(this.master);

    this.white = this._noise('white', 6);
    this.pink = this._noise('pink', 7);
    this.brown = this._noise('brown', 8);
    this.short = this._noise('white', 0.5);

    this.outFilter = ctx.createBiquadFilter(); this.outFilter.type = 'lowpass'; this.outFilter.frequency.value = 4200; this.outFilter.Q.value = 0.4;
    this.outGain = ctx.createGain(); this.outGain.gain.value = 0.8;
    this.outFilter.connect(this.outGain).connect(this.master);
    const bus = (name, inside) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(inside ? this.master : this.outFilter); this[name] = g; return g; };
    // rain bed
    bus('rainBus');
    this._loop(this.pink, [this._biq('highpass', 380, 0.5), this._biq('lowpass', 6500, 0.4)], 0.55, this.rainBus);
    this._loop(this.brown, [this._biq('lowpass', 700, 0.5)], 0.6, this.rainBus);
    // fire bed
    bus('fireBus', true);
    this.fireRoar = this._loop(this.brown, [this._biq('lowpass', 260, 0.6)], 0.7, this.fireBus);
    // water lapping bed (amplitude rocked by slow LFOs)
    bus('waterBus');
    const lap = this._loop(this.brown, [this._biq('lowpass', 420, 0.5)], 0.0, this.waterBus);
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.12;
    [0.09, 0.143, 0.21].forEach((f, i) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(lfoGain); o.start(); });
    lfoGain.connect(lap.gain);
    lap.gain.value = 0.42;
    // wind
    bus('windBus');
    const wf = this._biq('bandpass', 520, 0.7);
    const wind = this._loop(this.pink, [wf], 0.9, this.windBus);
    const wl = ctx.createOscillator(); wl.frequency.value = 0.045; const wlg = ctx.createGain(); wlg.gain.value = 260; wl.connect(wlg).connect(wf.frequency); wl.start();
    const wa = ctx.createOscillator(); wa.frequency.value = 0.07; const wag = ctx.createGain(); wag.gain.value = 0.45; wa.connect(wag).connect(wind.gain); wa.start();
    // wildlife + sfx buses
    bus('lifeBus'); this.lifeBus.connect(this.verbIn);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.room = ctx.createConvolver(); this.room.buffer = this._impulse(0.7, 4); const rg = ctx.createGain(); rg.gain.value = 0.25; this.sfx.connect(this.room); this.room.connect(rg).connect(this.master);
    bus('paneBus', true);

    const now = ctx.currentTime;
    this.next = { wolf: now + 40 + Math.random() * 60, frog: now + 2, chorus: now + 1, tick: now, drop: now, crackle: now, lap: now + 1, bird: now + 3, cricket: now + 1, loon: now + 20, owl: now + 25 };
    this._applyMaster();
    this.timer = setInterval(() => this._schedule(), 400);
    this._schedule();
  }

  stop() {
    if (!this.ctx) return;
    this.on = false;
    this._applyMaster();
  }

  _applyMaster() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.on ? this.vol.master * Math.pow(1 - (this.sleepK || 0), 1.5) : 0, t, 0.6);
    if (!this.on) setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 2500);
  }

  /** sleep timer: 0 = normal, 1 = silent (a slow, eased fade) */
  setSleep(k) { this.sleepK = k; if (this.ctx && this.on) this.master.gain.setTargetAtTime(this.vol.master * Math.pow(1 - k, 1.5), this.ctx.currentTime, 0.5); }
  setVolume(k, v) { this.vol[k] = v; if (k === 'master') this._applyMaster(); }

  // called every frame-ish with smoothed scene state
  update(s) {
    Object.assign(this.scene, s);
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime, v = this.vol, S = this.scene;
    const set = (g, val) => g.gain.setTargetAtTime(val, t, 0.5);
    set(this.rainBus, v.rain * S.rain * 0.55);
    set(this.fireBus, v.fire * 0.05 * (S.candle ?? 0));
    set(this.paneBus, v.rain * Math.min(1, S.rain * 1.3) * (1 - (S.open ?? 0) * 0.6) * (1 - S.winter * 0.8));
    this.outFilter.frequency.setTargetAtTime(4200 + (S.open ?? 0) * 9000, t, 0.4);
    this.outGain.gain.setTargetAtTime(0.75 + (S.open ?? 0) * 0.5, t, 0.4);
    set(this.waterBus, v.water * (1 - S.ice * 0.85) * 0.5);
    set(this.windBus, v.wind * (0.05 + S.winter * 0.07 + S.rain * 0.05 + S.snowFall * 0.05));
    set(this.lifeBus, v.life);
  }

  _schedule() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const horizon = ctx.currentTime + LOOKAHEAD, S = this.scene, n = this.next;
    // raindrops on leaves / surface
    while (n.drop < horizon) {
      if (S.rain > 0.05) this._drop(n.drop, S.rain);
      n.drop += S.rain > 0.05 ? 0.02 + Math.random() * 0.07 / S.rain : 0.5;
    }
    // drops ticking on the pane right in front of you
    while (n.tick < horizon) {
      if (S.rain > 0.05 && S.winter < 0.5) this._tick(n.tick, S.rain);
      n.tick += S.rain > 0.05 ? 0.03 + Math.random() * 0.18 / S.rain : 0.5;
    }
    // fire crackles
    while (n.crackle < horizon) {
      const cluster = Math.random() < 0.18 ? 2 + Math.floor(Math.random() * 4) : 1;
      for (let i = 0; i < cluster; i++) this._crackle(n.crackle + i * (0.01 + Math.random() * 0.05), Math.random());
      n.crackle += 0.06 + Math.random() * Math.random() * 0.55 / (1 + S.fireBoost * 2);
    }
    // shoreline laps
    while (n.lap < horizon) {
      if (S.ice < 0.5) this._lap(n.lap);
      n.lap += 2.2 + Math.random() * 4.5;
    }
    const summer = 1 - S.winter, night = S.night, h = S.hour ?? 12;
    const wet = Math.max(S.rain, S.snowFall);
    const dawn = h >= 4.8 && h <= 8.5 ? 1 - Math.abs(h - 6.4) / 1.9 : 0;
    // songbirds: a dawn chorus, quieter through the day, hushed by heavy weather
    while (n.bird < horizon) {
      const k = (night < 0.5 ? 1 : 0) * (1 - Math.min(1, wet * 1.1)) * (summer * 0.85 + 0.15);
      if (Math.random() < k) this._bird(n.bird, Math.random() < 0.5 ? null : Math.floor(Math.random() * 4));
      n.bird += (dawn > 0 ? 1.2 + Math.random() * 3 : 5 + Math.random() * 12) / Math.max(0.3, 1 - wet * 0.6);
    }
    // crickets on warm nights, frogs by the water
    while (n.cricket < horizon) {
      if (summer > 0.5 && night > 0.3 && S.rain < 0.6) this._cricket(n.cricket, Math.floor(Math.random() * 3));
      n.cricket += 0.35 + Math.random() * 0.5;
    }
    while (n.frog < horizon) {
      if (summer > 0.5 && night > 0.35 && S.snowFall < 0.1) this._frog(n.frog);
      n.frog += 2.5 + Math.random() * 7;
    }
    // a loon across the lake at dusk and at night
    while (n.loon < horizon) {
      if (summer > 0.5 && night > 0.25) this._loon(n.loon);
      n.loon += 40 + Math.random() * 70;
    }
    // owls, any season, at night
    while (n.owl < horizon) {
      if (night > 0.5 && wet < 0.8) this._owl(n.owl);
      n.owl += 30 + Math.random() * 60;
    }
    // wolves, far off in the hills: rare, more in winter, sometimes a pack answers
    while (n.wolf < horizon) {
      if (night > 0.45 && wet < 0.85) {
        this._wolf(n.wolf, 0.6 + Math.random() * 0.4, (Math.random() - 0.5) * 1.4);
        if (Math.random() < 0.45 + S.winter * 0.3) { const k = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < k; i++) this._wolf(n.wolf + 1.5 + i * (1.2 + Math.random() * 2), 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 1.6, 1.08 + Math.random() * 0.2); }
      }
      n.wolf += (S.winter > 0.5 ? 70 : 110) + Math.random() * 120;
    }
  }

  // ---------- event voices ----------
  _drop(t, k) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.short;
    const f = this._biq('bandpass', 1800 + Math.random() * 5000, 3 + Math.random() * 6);
    const g = ctx.createGain(); g.gain.value = 0;
    const a = (0.02 + Math.random() * 0.08) * (0.5 + k * 0.5);
    g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.04);
    src.connect(f).connect(g).connect(this.rainBus);
    src.start(t, Math.random() * 0.4, 0.1);
  }
  _tick(t, k) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.short;
    const f = this._biq('bandpass', 2500 + Math.random() * 4500, 6 + Math.random() * 6);
    const g = ctx.createGain(); g.gain.value = 0;
    const a = (0.03 + Math.random() * 0.09) * (0.6 + 0.4 * k) * (Math.random() < 0.1 ? 2 : 1);
    g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012 + Math.random() * 0.02);
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.4;
    src.connect(f).connect(g).connect(pan).connect(this.paneBus);
    src.start(t, Math.random() * 0.4, 0.05);
  }
  _crackle(t, r) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.short;
    const f = this._biq(r > 0.85 ? 'bandpass' : 'highpass', r > 0.85 ? 900 + Math.random() * 900 : 1500 + Math.random() * 3500, r > 0.85 ? 1.5 : 0.7);
    const g = ctx.createGain(); g.gain.value = 0;
    const amp = (r > 0.85 ? 0.5 : 0.06 + Math.random() * 0.22);
    const len = r > 0.85 ? 0.04 : 0.004 + Math.random() * 0.02;
    g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const pan = ctx.createStereoPanner(); pan.pan.value = 0.35 + (Math.random() - 0.5) * 0.2;
    src.connect(f).connect(g).connect(pan).connect(this.fireBus);
    src.start(t, Math.random() * 0.4, len + 0.02);
  }
  _lap(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.pink;
    const f = this._biq('bandpass', 380 + Math.random() * 500, 1.1);
    const g = ctx.createGain(); g.gain.value = 0;
    const d = 0.9 + Math.random() * 1.2;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32 + Math.random() * 0.25, t + d * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.2;
    src.connect(f).connect(g).connect(pan).connect(this.waterBus);
    src.start(t, Math.random() * 5, d + 0.1);
  }
  _bird(t, species) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.6; pan.connect(this.lifeBus);
    const far = 0.035 + Math.random() * 0.05;
    const note = (tt, f0, f1, d, a = 1, vib = 0) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, tt); o.frequency.exponentialRampToValueAtTime(f1, tt + d);
      if (vib) { const l = ctx.createOscillator(); l.frequency.value = vib; const lg = ctx.createGain(); lg.gain.value = f0 * 0.06; l.connect(lg).connect(o.frequency); l.start(tt); l.stop(tt + d + 0.05); }
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(far * a, tt + Math.min(0.02, d * 0.25)); g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
      o.connect(g).connect(pan); o.start(tt); o.stop(tt + d + 0.05);
    };
    const sp = species ?? Math.floor(Math.random() * 4);
    let tt = t;
    if (sp === 0) { // clear two-note whistle, "fee-bee"
      const f = 3600 + Math.random() * 500; note(tt, f, f * 0.98, 0.32); note(tt + 0.42, f * 0.84, f * 0.8, 0.36);
    } else if (sp === 1) { // robin-like warble: short rising and falling phrases
      const base = 2400 + Math.random() * 600, n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) { const up = Math.random() < 0.5; const f = base * (0.85 + Math.random() * 0.35); note(tt, f, f * (up ? 1.3 : 0.75), 0.13 + Math.random() * 0.06); tt += 0.2 + Math.random() * 0.12; }
    } else if (sp === 2) { // wren-like trill
      const f = 4200 + Math.random() * 800, n = 10 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) { note(tt, f, f * 1.15, 0.04, 0.7); tt += 0.055; }
    } else { // soft, low dove-like coo
      const f = 520 + Math.random() * 60;
      [[0, 0.45], [0.6, 0.3], [1.0, 0.7]].forEach(([dt, d], i) => note(t + dt, f * (i === 1 ? 1.12 : 1), f * 0.92, d, 1.4));
    }
  }
  _frog(t) {
    // a burst of low croaks: pulsed reedy tone
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.2; pan.connect(this.lifeBus);
    const f = 140 + Math.random() * 120, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.32 + Math.random() * 0.1);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const bp = this._biq('bandpass', f * 3.2, 4);
      const am = ctx.createOscillator(); am.frequency.value = 38 + Math.random() * 20; const amg = ctx.createGain(); amg.gain.value = 0.5;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.025, tt + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.22);
      am.connect(amg).connect(g.gain);
      o.connect(bp).connect(g).connect(pan);
      o.start(tt); am.start(tt); o.stop(tt + 0.3); am.stop(tt + 0.3);
    }
  }
  _wolf(t, a = 1, panV = 0, pitch = 1) {
    // a long howl: rises, holds with a wavering vibrato, falls away; far off, in a big space
    const ctx = this.ctx;
    const dur = 3.2 + Math.random() * 2.2, f0 = (330 + Math.random() * 60) * pitch, peak = f0 * (1.55 + Math.random() * 0.2);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(peak, t + 0.7);
    o.frequency.setValueAtTime(peak, t + dur * 0.7); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 4.5 + Math.random(); const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(peak * 0.018, t + 1.2); vib.connect(vg).connect(o.frequency);
    // a rounded "oo" vowel
    const f1 = this._biq('bandpass', 700, 3), f2 = this._biq('bandpass', 1100, 5);
    const lp = this._biq('lowpass', 1600, 0.5);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * a, t + 0.5); g.gain.setValueAtTime(0.05 * a, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const mix = ctx.createGain(); mix.gain.value = 1;
    o.connect(f1).connect(mix); o.connect(f2).connect(mix);
    // breath
    const n = ctx.createBufferSource(); n.buffer = this.pink; const nb = this._biq('bandpass', 900, 1.5); const ng = ctx.createGain(); ng.gain.value = 0.25;
    n.connect(nb).connect(ng).connect(mix);
    const p = ctx.createStereoPanner(); p.pan.value = panV;
    mix.connect(lp).connect(g).connect(p); p.connect(this.lifeBus); p.connect(this.verbIn);
    o.start(t); vib.start(t); n.start(t, Math.random() * 3, dur + 0.1);
    o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }
  _cricket(t, voice) {
    const ctx = this.ctx;
    const f = [4300, 4750, 3950][voice];
    const pan = ctx.createStereoPanner(); pan.pan.value = [-0.6, 0.5, 0.1][voice]; pan.connect(this.lifeBus);
    const amp = [0.012, 0.008, 0.006][voice];
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.045;
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(amp, tt + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
      o.connect(g).connect(pan); o.start(tt); o.stop(tt + 0.04);
    }
  }
  _loon(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 6; vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.18; o2.connect(g2).connect(g);
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.4;
    const f0 = 560 + Math.random() * 60;
    // classic wail: rise, hold, drop
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.5, t + 0.8); o.frequency.setValueAtTime(f0 * 1.5, t + 1.9); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 2.6);
    o2.frequency.setValueAtTime(f0 * 2, t); o2.frequency.linearRampToValueAtTime(f0 * 3, t + 0.8); o2.frequency.setValueAtTime(f0 * 3, t + 1.9); o2.frequency.linearRampToValueAtTime(f0 * 2.5, t + 2.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 0.4); g.gain.setValueAtTime(0.03, t + 2.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
    o.connect(g); g.connect(pan).connect(this.lifeBus); this.verbIn && pan.connect(this.verbIn);
    [o, o2, vib].forEach(x => { x.start(t); x.stop(t + 3); });
  }
  _owl(t) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.4; pan.connect(this.lifeBus);
    [[0, 0.35], [0.55, 0.25], [0.9, 0.6]].forEach(([dt, d]) => {
      const tt = t + dt;
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(390, tt); o.frequency.linearRampToValueAtTime(360, tt + d);
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.025, tt + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
      o.connect(g).connect(pan); o.start(tt); o.stop(tt + d + 0.05);
    });
  }

  // ---------- interactive sfx ----------
  plop(strength = 1, pan = 0) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(this.sfx);
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = 700 + Math.random() * 500;
    o.frequency.setValueAtTime(f * 0.6, t); o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.05);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12 * strength, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(p); o.start(t); o.stop(t + 0.15);
    const src = ctx.createBufferSource(); src.buffer = this.short;
    const bf = this._biq('bandpass', 1200, 1.2);
    const ng = ctx.createGain(); ng.gain.value = 0;
    ng.gain.setValueAtTime(0.18 * strength, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bf).connect(ng).connect(p); src.start(t, 0, 0.2);
  }
  iceSkip(speed = 1, pan = 0) {
    // dispersion "pew": high frequencies arrive first on thin ice
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(this.sfx);
    for (let e = 0; e < 3; e++) {
      const tt = t + e * (0.13 + Math.random() * 0.05);
      const o = ctx.createOscillator(); o.type = 'sine';
      const d = 0.28 + e * 0.05;
      o.frequency.setValueAtTime(5200 * (0.9 + Math.random() * 0.2), tt); o.frequency.exponentialRampToValueAtTime(320, tt + d);
      const g = ctx.createGain(); g.gain.value = 0;
      const a = 0.06 * speed / (1 + e * 1.4);
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(a, tt + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
      o.connect(g).connect(p); o.start(tt); o.stop(tt + d + 0.05);
    }
    const src = ctx.createBufferSource(); src.buffer = this.short;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.2 * speed, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(this._biq('highpass', 3000, 0.7)).connect(ng).connect(p); src.start(t, 0, 0.05);
  }
  scrape(dur = 1.5, pan = 0) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource(); src.buffer = this.pink;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(this._biq('bandpass', 2600, 2)).connect(g).connect(p).connect(this.sfx); src.start(t, Math.random(), dur + 0.1);
  }
  sparks() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime + 0.01;
    for (let i = 0; i < 18; i++) this._crackle(t + Math.random() * 0.9, Math.random() < 0.25 ? 0.9 : Math.random() * 0.8);
    const src = this.ctx.createBufferSource(); src.buffer = this.brown;
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(this._biq('lowpass', 500, 0.7)).connect(g).connect(this.fireBus); src.start(t, Math.random() * 3, 1.5);
  }
  gust() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource(); src.buffer = this.pink;
    const f = this._biq('bandpass', 400, 0.8);
    f.frequency.setValueAtTime(350, t); f.frequency.linearRampToValueAtTime(900, t + 0.8); f.frequency.linearRampToValueAtTime(450, t + 2.2);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(f).connect(g).connect(this.sfx); src.start(t, Math.random() * 4, 2.5);
  }

  _env(node, t, a, att, dec) { const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec); node.connect(g); return g; }
  _noiseHit(t, buf, type, f, q, a, att, dec, out, off = 0) {
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this._env(src.connect(this._biq(type, f, q)), t, a, att, dec);
    g.connect(out || this.sfx); src.start(t, off || Math.random() * (buf.duration - att - dec - 0.1), att + dec + 0.05);
  }
  ok() { return this.ctx && this.on; }
  knock(x = 0) {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    const p = this.ctx.createStereoPanner(); p.pan.value = x; p.connect(this.sfx);
    for (const [dt, a] of [[0, 1], [0.09 + Math.random() * 0.03, 0.6]]) {
      const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(190, t + dt); o.frequency.exponentialRampToValueAtTime(110, t + dt + 0.08);
      this._env(o, t + dt, 0.35 * a, 0.002, 0.11).connect(p); o.start(t + dt); o.stop(t + dt + 0.15);
      this._noiseHit(t + dt, this.short, 'bandpass', 1800, 1.2, 0.25 * a, 0.001, 0.04, p);
      // the glass rings a little
      const r = this.ctx.createOscillator(); r.frequency.value = 2300 + Math.random() * 300;
      this._env(r, t + dt, 0.012 * a, 0.002, 0.35).connect(p); r.start(t + dt); r.stop(t + dt + 0.4);
    }
  }
  squeak(speed = 1, x = 0) {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    const f = 900 + speed * 900 + Math.random() * 200;
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.8 + Math.random() * 0.4), t + 0.12);
    const vib = this.ctx.createOscillator(); vib.frequency.value = 40 + Math.random() * 30; const vg = this.ctx.createGain(); vg.gain.value = 40; vib.connect(vg).connect(o.frequency);
    const p = this.ctx.createStereoPanner(); p.pan.value = x;
    this._env(o.connect(this._biq('bandpass', f, 3)), t, 0.03 * Math.min(1, speed), 0.02, 0.1).connect(p).connect(this.sfx);
    o.start(t); vib.start(t); o.stop(t + 0.16); vib.stop(t + 0.16);
    this._noiseHit(t, this.pink, 'highpass', 2500, 0.7, 0.02 * Math.min(1, speed), 0.01, 0.1, p);
  }
  breath() {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    this._noiseHit(t, this.pink, 'bandpass', 700, 0.6, 0.22, 0.25, 0.9);
    this._noiseHit(t, this.pink, 'bandpass', 2200, 1.5, 0.06, 0.3, 0.7);
  }
  match() {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    this._noiseHit(t, this.white, 'bandpass', 3500, 1.2, 0.3, 0.005, 0.18);
    this._noiseHit(t + 0.12, this.pink, 'lowpass', 900, 0.7, 0.35, 0.05, 0.6);
  }
  blow() {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    this._noiseHit(t, this.pink, 'bandpass', 1100, 0.8, 0.35, 0.06, 0.45);
  }
  clink() {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    for (const f of [2950, 4120, 5300]) { const o = this.ctx.createOscillator(); o.frequency.value = f * (0.98 + Math.random() * 0.04); this._env(o, t, 0.03, 0.001, 0.5 + Math.random() * 0.3).connect(this.sfx); o.start(t); o.stop(t + 0.9); }
  }
  sip() {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.25;
    this._noiseHit(t, this.pink, 'bandpass', 1500, 2, 0.12, 0.15, 0.35);
    setTimeout(() => this.clink(), 1300);
  }
  click(f = 1) {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    this._noiseHit(t, this.short, 'bandpass', 2600 * f, 2, 0.35, 0.001, 0.025);
    this._noiseHit(t + 0.03, this.short, 'bandpass', 1500 * f, 2, 0.2, 0.001, 0.03);
  }
  // metal: a click with a short bright ring
  _metalClick(t, a = 1, f = 1) {
    this._noiseHit(t, this.short, 'bandpass', 3800 * f, 2.5, 0.22 * a, 0.0008, 0.012);
    this._noiseHit(t + 0.004, this.short, 'highpass', 6000, 0.7, 0.08 * a, 0.0005, 0.008);
    [2870, 4630, 6950].forEach((fr, i) => { const o = this.ctx.createOscillator(); o.frequency.value = fr * f * (0.98 + Math.random() * 0.04); this._env(o, t, 0.012 * a / (i + 1), 0.0008, 0.09 + Math.random() * 0.05).connect(this.sfx); o.start(t); o.stop(t + 0.25); });
  }
  // wood: a dull knock where the sash meets the frame
  _woodThud(t, a = 1) {
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(85, t + 0.07);
    this._env(o, t, 0.3 * a, 0.002, 0.07).connect(this.sfx); o.start(t); o.stop(t + 0.15);
    this._noiseHit(t, this.pink, 'bandpass', 420, 1.2, 0.35 * a, 0.002, 0.06);
    this._noiseHit(t, this.short, 'bandpass', 1600, 1.5, 0.12 * a, 0.001, 0.02);
  }
  // hinge creak: stick-slip, a train of tiny irregular impulses through two wooden resonances
  _creak(t, dur, a = 1, pitch = 1) {
    const ctx = this.ctx, out = ctx.createGain(); out.gain.value = a;
    const r1 = this._biq('bandpass', 620 * pitch, 14), r2 = this._biq('bandpass', 1350 * pitch, 18), r3 = this._biq('bandpass', 2400 * pitch, 10);
    const mix = ctx.createGain(); mix.gain.value = 1;
    mix.connect(r1); mix.connect(r2); mix.connect(r3);
    const g1 = ctx.createGain(); g1.gain.value = 1; const g2 = ctx.createGain(); g2.gain.value = 0.6; const g3 = ctx.createGain(); g3.gain.value = 0.25;
    r1.connect(g1).connect(out); r2.connect(g2).connect(out); r3.connect(g3).connect(out);
    // the resonance drifts as the load on the hinge changes
    r1.frequency.setValueAtTime(620 * pitch, t); r1.frequency.linearRampToValueAtTime(560 * pitch, t + dur);
    r2.frequency.setValueAtTime(1350 * pitch, t); r2.frequency.linearRampToValueAtTime(1500 * pitch, t + dur);
    out.connect(this.sfx);
    const imp = ctx.createBuffer(1, 64, ctx.sampleRate); const d = imp.getChannelData(0); for (let i = 0; i < 64; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 9);
    let tt = t;
    while (tt < t + dur) {
      const k = (tt - t) / dur, env = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.7;
      const src = ctx.createBufferSource(); src.buffer = imp;
      const g = ctx.createGain(); g.gain.value = (0.5 + Math.random() * 0.8) * env * 0.9;
      src.connect(g).connect(mix); src.start(tt);
      // stick-slip rate wanders between ~25 and ~70 per second, sometimes catching
      const rate = 25 + 45 * (0.5 + 0.5 * Math.sin(k * 9 + Math.random())) ;
      tt += (1 / rate) * (0.6 + Math.random() * 0.8) + (Math.random() < 0.06 ? 0.03 : 0);
    }
  }
  latch(open) {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.01;
    if (open) {
      this._metalClick(t, 1, 1);                         // the cockspur lifts off its keep
      this._metalClick(t + 0.07, 0.5, 0.85);
      this._woodThud(t + 0.16, 0.45);                    // the sash unsticks from the frame
      this._noiseHit(t + 0.17, this.short, 'bandpass', 5200, 3, 0.04, 0.001, 0.05); // the glass ticks
      this._creak(t + 0.22, 0.55 + Math.random() * 0.2, 0.55, 0.95 + Math.random() * 0.1);
    } else {
      this._creak(t + 0.05, 0.55 + Math.random() * 0.15, 0.45, 1.05 + Math.random() * 0.1);
    }
  }
  /** the sash lands in the frame (called from the animation), then the handle drops into its keep */
  shut() {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    this._woodThud(t, 1);
    this._noiseHit(t + 0.004, this.short, 'bandpass', 5200, 3, 0.07, 0.001, 0.06);
    this._metalClick(t + 0.28, 1, 1.05);
    this._metalClick(t + 0.33, 0.4, 0.9);
  }
  thunder(dist = 1) {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.4 + dist * 2.5;
    const src = this.ctx.createBufferSource(); src.buffer = this.brown;
    const f = this._biq('lowpass', 180 + Math.random() * 120, 0.7);
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9 / (0.6 + dist), t + 0.3 + Math.random() * 0.4);
    for (let i = 1; i < 6; i++) g.gain.linearRampToValueAtTime((0.3 + Math.random() * 0.6) / (0.6 + dist), t + 0.4 + i * (0.4 + Math.random() * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5 + Math.random() * 3);
    src.connect(f).connect(g).connect(this.outFilter); src.start(t, Math.random() * 3, 9);
  }
  tick() {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    this._noiseHit(t, this.short, 'bandpass', 4200, 4, 0.06, 0.001, 0.015);
  }
  tape(on) {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.005;
    this._noiseHit(t, this.short, 'bandpass', 900, 1.5, 0.5, 0.001, 0.04);
    this._noiseHit(t + 0.05, this.short, 'bandpass', 2400, 2, 0.25, 0.001, 0.03);
    if (on) this._noiseHit(t + 0.12, this.brown, 'bandpass', 180, 1, 0.12, 0.1, 0.4);
  }

  // ---------- helpers ----------
  _biq(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _loop(buf, chain, gain, out) {
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = gain;
    let n = src; for (const c of chain) { n.connect(c); n = c; }
    n.connect(g).connect(out);
    src.start(0, Math.random() * buf.duration);
    return g;
  }
  _noise(kind, secs) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * secs);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const fade = Math.floor(sr * 0.05);
      const tmp = new Float32Array(len + fade);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len + fade; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') tmp[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          tmp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; tmp[i] = last * 3.5; }
      }
      // seamless loop: blend the tail past the end into the head
      for (let i = 0; i < len; i++) d[i] = tmp[i];
      for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = tmp[i] * k + tmp[len + i] * (1 - k); }
    }
    return buf;
  }
  _impulse(secs, decay) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * secs);
    const b = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
}
