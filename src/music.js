// A generative tape: slow jazzy chords, a sparse electric-piano melody, warm and a little worn.
const CHORDS = [
  [50, 57, 61, 64, 69], // Dmaj9-ish
  [47, 54, 57, 62, 66], // Bm9
  [43, 50, 54, 57, 62], // Gmaj7
  [45, 52, 55, 61, 64], // A6/9
  [42, 49, 52, 57, 61], // F#m7
  [43, 50, 55, 59, 62], // Gmaj7 (2)
];
const PROG = [0, 1, 2, 3, 0, 4, 5, 3];
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Tape {
  constructor(audio) { this.audio = audio; this.on = false; }
  ensure() {
    const a = this.audio; if (!a.ctx) return false;
    if (this.out) return true;
    const ctx = a.ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600; tone.Q.value = 0.5;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.gain.value = 3;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.5;
    // tape wow: a slowly wandering delay
    this.wow = ctx.createDelay(0.05); this.wow.delayTime.value = 0.012;
    const w1 = ctx.createOscillator(); w1.frequency.value = 0.42; const wg = ctx.createGain(); wg.gain.value = 0.0012; w1.connect(wg).connect(this.wow.delayTime); w1.start();
    const w2 = ctx.createOscillator(); w2.frequency.value = 5.3; const wg2 = ctx.createGain(); wg2.gain.value = 0.00006; w2.connect(wg2).connect(this.wow.delayTime); w2.start();
    this.bus.connect(this.wow).connect(body).connect(tone).connect(this.out);
    // a little room around the tiny speaker
    this.out.connect(a.master); this.out.connect(a.room);
    // hiss
    const hs = ctx.createBufferSource(); hs.buffer = a.white; hs.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 5000;
    const hg = ctx.createGain(); hg.gain.value = 0.006;
    hs.connect(hf).connect(hg).connect(this.out); hs.start();
    return true;
  }
  toggle() {
    if (!this.ensure()) return this.on;
    this.on = !this.on;
    const ctx = this.audio.ctx, t = ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(this.on ? (this.vol ?? 0.55) : 0, t, this.on ? 0.8 : 0.25);
    if (this.on) {
      this.bar = 0; this.nextBar = t + 0.3;
      clearInterval(this.timer);
      this.timer = setInterval(() => this.schedule(), 500);
      this.schedule();
    } else {
      setTimeout(() => { if (!this.on) clearInterval(this.timer); }, 1500);
    }
    return this.on;
  }
  setVolume(v) { this.vol = v; if (this.on && this.out) this.out.gain.setTargetAtTime(v, this.audio.ctx.currentTime, 0.3); }
  schedule() {
    const ctx = this.audio.ctx; if (!ctx || !this.on) return;
    const BAR = 4.8; // ~50 bpm, four beats
    while (this.nextBar < ctx.currentTime + 6) {
      const t = this.nextBar, ch = CHORDS[PROG[this.bar % PROG.length]];
      this.chord(t, ch, BAR);
      // sparse melody, a few notes per bar, sometimes nothing
      const notes = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < notes; i++) {
        const beat = Math.floor(Math.random() * 8) * (BAR / 8);
        const m = SCALE[Math.floor(Math.random() * SCALE.length)];
        if (ch.some(c => (c - m) % 12 === 0) || Math.random() < 0.6) this.ep(t + beat + Math.random() * 0.03, m, 0.05 + Math.random() * 0.03, 2.5);
      }
      this.nextBar += BAR; this.bar++;
    }
  }
  // soft pad + electric piano voicing
  chord(t, notes, len) {
    const ctx = this.audio.ctx;
    notes.forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m); o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain(); g.gain.value = 0;
      const a = i === 0 ? 0.035 : 0.018;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + 1.2); g.gain.setValueAtTime(a, t + len - 0.6); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.6);
      o.connect(g).connect(this.bus); o.start(t); o.stop(t + len + 0.7);
      if (i > 0) this.ep(t + i * 0.035, m, 0.03, len * 0.9);
    });
  }
  ep(t, m, a, dur) {
    const ctx = this.audio.ctx, f = hz(m);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * 2;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 1.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.2);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(this.bus);
    car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }
}
