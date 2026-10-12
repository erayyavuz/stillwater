import { renderSong, SONG_TITLES } from './songs.js';

// A cassette transport: leader hiss, motor, wow & flutter, a small speaker, FF/REW between songs.
export class Tape {
  constructor(audio) {
    this.audio = audio;
    this.on = false;          // PLAY engaged
    this.state = 'stop';      // stop | leader | play | wind
    this.song = 0;
    this.pos = new Array(SONG_TITLES.length).fill(0);
    this.buffers = [];
    this.rendering = [];
    this.vol = 0.6;
    this.titles = SONG_TITLES;
    this.speed = 0;           // 0 = stopped, 1 = play, 8 = winding (for the reels)
  }
  ensure() {
    const a = this.audio; if (!a.ctx) return false;
    if (this.out) return true;
    const ctx = a.ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    // tiny speaker in a plastic box
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6200; lp.Q.value = 0.4;
    const box = ctx.createBiquadFilter(); box.type = 'peaking'; box.frequency.value = 900; box.gain.value = 3; box.Q.value = 0.8;
    const sat = ctx.createWaveShaper();
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    sat.curve = curve;
    this.input = ctx.createGain(); this.input.gain.value = 1;
    this.input.connect(sat).connect(hp).connect(box).connect(lp).connect(this.out);
    this.out.connect(a.master); this.out.connect(a.room);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512; lp.connect(this.analyser);
    this.vuBuf = new Float32Array(512);
    // wow & flutter, applied to every source's playbackRate
    this.wow = ctx.createGain(); this.wow.gain.value = 1;
    const w1 = ctx.createOscillator(); w1.frequency.value = 0.55; const g1 = ctx.createGain(); g1.gain.value = 0.0028; w1.connect(g1).connect(this.wow); w1.start();
    const w2 = ctx.createOscillator(); w2.frequency.value = 7.1; const g2 = ctx.createGain(); g2.gain.value = 0.0009; w2.connect(g2).connect(this.wow); w2.start();
    this.wowOut = ctx.createGain(); this.wowOut.gain.value = 1;
    w1.disconnect(); w2.disconnect(); w1.connect(g1).connect(this.wowOut); w2.connect(g2).connect(this.wowOut);
    // tape hiss and mains hum, under the music while the tape runs
    const hs = ctx.createBufferSource(); hs.buffer = a.white; hs.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 3500;
    this.hiss = ctx.createGain(); this.hiss.gain.value = 0;
    hs.connect(hf).connect(this.hiss).connect(this.input); hs.start();
    const hum = ctx.createOscillator(); hum.frequency.value = 50; const hg = ctx.createGain(); hg.gain.value = 0;
    hum.connect(hg).connect(this.input); hum.start(); this.hum = hg;
    // motor whine
    const mo = ctx.createOscillator(); mo.type = 'triangle'; mo.frequency.value = 180;
    const mf = ctx.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 180; mf.Q.value = 6;
    this.motor = ctx.createGain(); this.motor.gain.value = 0;
    mo.connect(mf).connect(this.motor).connect(this.out); mo.start(); this.motorOsc = mo;
    this.setVolume(this.vol);
    return true;
  }
  /** render all songs one after another, starting with the current one */
  preload() {
    if (this.preloading) return; this.preloading = true;
    const order = [...this.titles.keys()];
    const next = () => { const i = order.find(k => !this.buffers[k] && !this.rendering[k]); if (i !== undefined) this.load(i).then(() => setTimeout(next, 300)); };
    next();
  }
  load(i) {
    if (this.buffers[i] || this.rendering[i]) return this.rendering[i] || Promise.resolve(this.buffers[i]);
    this.rendering[i] = renderSong(i).then(b => { this.buffers[i] = b; return b; });
    return this.rendering[i];
  }
  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.out) this.out.gain.setTargetAtTime(this.vol * this.vol * 1.4, this.audio.ctx.currentTime, 0.08);
  }
  title() { return `Side A · ${this.song + 1} — ${this.titles[this.song]}`; }
  level() {
    if (!this.analyser || this.state !== 'play') return 0;
    this.analyser.getFloatTimeDomainData(this.vuBuf);
    let s = 0; for (let i = 0; i < this.vuBuf.length; i++) s += this.vuBuf[i] * this.vuBuf[i];
    return Math.sqrt(s / this.vuBuf.length);
  }
  progress() {
    const b = this.buffers[this.song]; if (!b) return this.pos[this.song] / 120;
    return Math.min(1, this.position() / b.duration);
  }
  position() {
    if (this.state === 'play' && this.src) return this.startOffset + (this.audio.ctx.currentTime - this.startAt);
    return this.pos[this.song];
  }
  // ------------------------------------------------------------------ transport
  play() {
    if (!this.ensure() || this.on) return;
    this.on = true;
    this.audio.ctx.resume();
    const ctx = this.audio.ctx, t = ctx.currentTime;
    this.hiss.gain.setTargetAtTime(0.012, t + 0.12, 0.08);
    this.hum.gain.setTargetAtTime(0.0025, t + 0.12, 0.1);
    this.motor.gain.setTargetAtTime(0.004, t + 0.08, 0.05);
    this.motorOsc.frequency.setValueAtTime(90, t); this.motorOsc.frequency.setTargetAtTime(180, t + 0.05, 0.12);
    this.state = 'leader';
    this.speed = 1;
    // leader tape: hiss, a few crackles, then the music
    this.crackle(t + 0.3, 6);
    const token = this.token = Symbol();
    const ready = !!this.buffers[this.song];
    if (!ready) {
      // not rendered yet: the deck rewinds to the start of the song meanwhile
      this.state = 'wind'; this.speed = -9;
      this.motor.gain.setTargetAtTime(0.01, t, 0.05); this.motorOsc.frequency.setTargetAtTime(380, t, 0.15);
      this.onWait && this.onWait();
      this.windNoise(true);
    }
    const leader = this.pos[this.song] < 0.5 ? 1.4 : 0.35;
    this.load(this.song).then(() => {
      if (this.token !== token || !this.on) return;
      if (!ready) {
        this.windNoise(false);
        const n = this.audio.ctx.currentTime;
        this.motor.gain.setTargetAtTime(0.004, n, 0.05); this.motorOsc.frequency.setTargetAtTime(180, n, 0.1);
        this.state = 'leader'; this.speed = 1; this.crackle(n + 0.1, 4);
        this.audio.tape && this.audio.tape(true);
      }
      setTimeout(() => { if (this.token === token && this.on) this.startSource(true); }, leader * 1000);
    });
  }
  windNoise(on) {
    const ctx = this.audio.ctx, t = ctx.currentTime;
    if (on && !this.windSrc) {
      const s = ctx.createBufferSource(); s.buffer = this.audio.pink; s.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 600; lfo.connect(lg).connect(bp.frequency); lfo.start();
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.05, t, 0.1);
      s.connect(bp).connect(g).connect(this.input); s.start();
      this.windSrc = { s, g, lfo };
    } else if (!on && this.windSrc) {
      const w = this.windSrc; this.windSrc = null;
      w.g.gain.setTargetAtTime(0, t, 0.05); w.s.stop(t + 0.3); w.lfo.stop(t + 0.3);
    }
  }
  stop() {
    if (!this.on) return;
    this.on = false;
    const ctx = this.audio.ctx, t = ctx.currentTime;
    this.token = null;
    this.pos[this.song] = Math.max(0, this.position());
    if (this.src) {
      // the tape winds down
      const s = this.src; this.src = null;
      s.playbackRate.cancelScheduledValues(t); s.playbackRate.setValueAtTime(s.playbackRate.value, t); s.playbackRate.linearRampToValueAtTime(0.35, t + 0.18);
      const g = s.__g; g.gain.setTargetAtTime(0, t + 0.06, 0.05);
      s.stop(t + 0.4);
    }
    this.hiss.gain.setTargetAtTime(0, t + 0.1, 0.05);
    this.hum.gain.setTargetAtTime(0, t + 0.1, 0.05);
    this.motor.gain.setTargetAtTime(0, t, 0.05);
    this.windNoise(false);
    this.state = 'stop';
    this.speed = 0;
  }
  toggle() { this.on ? this.stop() : this.play(); return this.on; }
  startSource(fresh) {
    const ctx = this.audio.ctx, t = ctx.currentTime;
    const buf = this.buffers[this.song];
    const off = this.pos[this.song] >= buf.duration - 1 ? 0 : this.pos[this.song];
    const s = ctx.createBufferSource(); s.buffer = buf;
    this.wowOut.connect(s.playbackRate);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(1, t, fresh ? 0.6 : 0.05);
    s.connect(g).connect(this.input);
    s.__g = g;
    s.start(t, off);
    s.onended = () => { if (this.src === s && this.on) { this.pos[this.song] = 0; this.song = (this.song + 1) % this.titles.length; this.pos[this.song] = 0; this.state = 'leader'; this.onSong && this.onSong(this.title()); this.crackle(ctx.currentTime, 3); this.load(this.song).then(() => { if (this.on && this.state === 'leader') this.startSource(true); }); } };
    this.src = s; this.startAt = t; this.startOffset = off;
    this.state = 'play';
  }
  /** fast-forward (+1) or rewind (-1) to the next/previous song */
  wind(dir) {
    if (!this.ensure()) return;
    const ctx = this.audio.ctx, t = ctx.currentTime;
    const wasOn = this.on;
    if (this.src) { const s = this.src; this.src = null; s.__g.gain.setTargetAtTime(0, t, 0.02); s.stop(t + 0.2); }
    this.token = null;
    this.state = 'wind'; this.speed = 9 * dir;
    // the chipmunk zip of tape across the heads
    const buf = this.buffers[this.song];
    if (buf) {
      const z = ctx.createBufferSource(); z.buffer = buf; z.playbackRate.value = 9;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.15); g.gain.setTargetAtTime(0, t + 1.0, 0.08);
      z.connect(hp).connect(g).connect(this.input);
      z.start(t, Math.min(buf.duration - 12, Math.max(0, this.position())), 1.4);
    }
    this.motor.gain.setTargetAtTime(0.012, t, 0.05); this.motorOsc.frequency.setTargetAtTime(420, t, 0.15);
    this.hiss.gain.setTargetAtTime(0.02, t, 0.05);
    setTimeout(() => {
      this.pos[this.song] = 0;
      this.song = (this.song + dir + this.titles.length) % this.titles.length;
      this.pos[this.song] = 0;
      this.onSong && this.onSong(this.title());
      const now = ctx.currentTime;
      this.motorOsc.frequency.setTargetAtTime(180, now, 0.1);
      if (wasOn) { this.on = false; this.play(); }
      else { this.state = 'stop'; this.speed = 0; this.motor.gain.setTargetAtTime(0, now, 0.05); this.hiss.gain.setTargetAtTime(0, now, 0.05); }
    }, 1200);
  }
  crackle(t, n) {
    const a = this.audio, ctx = a.ctx;
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * 1.2;
      const src = ctx.createBufferSource(); src.buffer = a.short;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.05 + Math.random() * 0.12, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.006 + Math.random() * 0.01);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 3000;
      src.connect(f).connect(g).connect(this.input); src.start(tt, Math.random() * 0.3, 0.03);
    }
  }
}
