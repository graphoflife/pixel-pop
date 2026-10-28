// All sound is synthesised with WebAudio: no audio files. Each theme gets its
// own instrument and scale, and matches climb the scale as cascades chain up.

const PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];

const VOICES = {
  bell: { root: 72, scale: PENTA, pad: 'sine', chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]] },
  synth: { root: 69, scale: MINOR_PENTA, pad: 'sawtooth', chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]] },
  marimba: { root: 65, scale: PENTA, pad: 'triangle', chords: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [2, 7, 11]] },
  bloop: { root: 67, scale: PENTA, pad: 'square', chords: [[0, 4, 7], [-5, -1, 2], [-3, 0, 4], [-7, -3, 0]] },
};

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.voice = VOICES.bell;
    this.voiceName = 'bell';
    this.lastLand = 0;
    this.musicTimer = null;
  }

  setVoice(name) {
    this.voiceName = name;
    this.voice = VOICES[name] || VOICES.bell;
  }

  // Browsers only allow audio after a user gesture, so this runs on first tap.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.applyMusic();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  build() {
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxOn ? 0.8 : 0; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(this.master);

    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    this.reverb.connect(wet); wet.connect(this.master);

    this.echo = ctx.createDelay(1); this.echo.delayTime.value = 0.27;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2400;
    this.echo.connect(tone); tone.connect(fb); fb.connect(this.echo); tone.connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  get ready() { return !!this.ctx && this.sfxOn; }
  get now() { return this.ctx.currentTime; }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.8 : 0, this.now, 0.02);
  }

  setMusic(on) { this.musicOn = on; this.applyMusic(); }

  applyMusic() {
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, this.now, 0.4);
    if (this.musicOn && !this.musicTimer) {
      this.nextBar = this.now + 0.2;
      this.bar = 0;
      this.musicTimer = setInterval(() => this.scheduleMusic(), 250);
    } else if (!this.musicOn && this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  // ------------------------------------------------------- primitives

  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  osc(type, freq, t, { gain = 0.2, attack = 0.004, decay = 0.3, to = null, toTime = 0.1, dest = this.sfx, send = 0.2, echo = 0, filter = null } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + toTime);
    const g = ctx.createGain();
    this.env(g, t, gain, attack, decay);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.from, t);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + (filter.time || decay));
      f.Q.value = filter.q || 1;
      o.connect(f); node = f;
    }
    node.connect(g);
    g.connect(dest);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.reverb); }
    if (echo) { const s = ctx.createGain(); s.gain.value = echo; g.connect(s); s.connect(this.echo); }
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  noise(t, dur, { gain = 0.2, type = 'bandpass', from = 1000, to = null, q = 1, dest = this.sfx, send = 0.15, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    this.env(g, t, gain, attack, dur);
    src.connect(f); f.connect(g); g.connect(dest);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.reverb); }
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  note(i, octave = 0) {
    const { root, scale } = this.voice;
    const n = scale.length;
    const oct = Math.floor(i / n);
    return mtof(root + 12 * (oct + octave) + scale[((i % n) + n) % n]);
  }

  // the theme's instrument
  pluck(freq, t, vel = 1, dest = this.sfx) {
    switch (this.voiceName) {
      case 'synth':
        this.osc('square', freq, t, { gain: 0.09 * vel, decay: 0.32, dest, send: 0.25, echo: 0.35, filter: { from: 3200, to: 500, time: 0.3 } });
        this.osc('sine', freq / 2, t, { gain: 0.1 * vel, decay: 0.25, dest, send: 0.1 });
        break;
      case 'marimba':
        this.osc('sine', freq, t, { gain: 0.3 * vel, decay: 0.45, dest, send: 0.2 });
        this.osc('sine', freq * 4, t, { gain: 0.1 * vel, decay: 0.05, dest, send: 0 });
        this.osc('triangle', freq * 2, t, { gain: 0.05 * vel, decay: 0.15, dest, send: 0.1 });
        break;
      case 'bloop':
        this.osc('sine', freq * 0.55, t, { gain: 0.3 * vel, decay: 0.25, to: freq, toTime: 0.06, dest, send: 0.15 });
        this.osc('triangle', freq * 1.01, t + 0.01, { gain: 0.06 * vel, decay: 0.18, dest, send: 0.1 });
        break;
      default: // bell
        this.osc('sine', freq, t, { gain: 0.22 * vel, decay: 0.9, dest, send: 0.35 });
        this.osc('sine', freq * 2.756, t, { gain: 0.07 * vel, decay: 0.35, dest, send: 0.3 });
        this.osc('sine', freq * 5.4, t, { gain: 0.025 * vel, decay: 0.14, dest, send: 0.2 });
    }
  }

  // ----------------------------------------------------------- events

  select() {
    if (!this.ready) return;
    this.pluck(this.note(9), this.now, 0.3);
  }

  swap() {
    if (!this.ready) return;
    this.noise(this.now, 0.12, { gain: 0.1, from: 500, to: 2600, q: 1.5, send: 0.05 });
  }

  invalid() {
    if (!this.ready) return;
    const t = this.now;
    this.osc('triangle', 230, t, { gain: 0.16, decay: 0.12, send: 0.05 });
    this.osc('triangle', 180, t + 0.1, { gain: 0.16, decay: 0.16, send: 0.05 });
  }

  // a queued swap got undone by the board changing under it
  cancel() {
    if (!this.ready) return;
    const t = this.now;
    this.pluck(this.note(7), t, 0.3);
    this.pluck(this.note(4), t + 0.07, 0.25);
  }

  match(chain, size) {
    if (!this.ready) return;
    const t = this.now;
    const base = Math.min(3 + (chain - 1) * 2, 15);
    this.pluck(this.note(base), t, 1);
    if (size >= 4) this.pluck(this.note(base + 2), t + 0.05, 0.8);
    if (size >= 5) this.pluck(this.note(base + 4), t + 0.1, 0.8);
    this.noise(t, 0.05, { gain: 0.1, type: 'highpass', from: 3000, send: 0.05 });
    if (this.voiceName === 'bloop') this.noise(t, 0.09, { gain: 0.12, type: 'lowpass', from: 900, to: 300, send: 0.05 });
    if (chain >= 3) this.noise(t + 0.02, 0.4, { gain: 0.06 + Math.min(chain, 8) * 0.01, type: 'highpass', from: 5000, send: 0.3, attack: 0.02 });
  }

  create() {
    if (!this.ready) return;
    const t = this.now;
    [7, 9, 11, 14].forEach((n, i) => this.pluck(this.note(n), t + i * 0.06, 0.7));
  }

  nova(power = 1) {
    if (!this.ready) return;
    const t = this.now;
    this.noise(t, 0.5 + power * 0.25, { gain: 0.45, type: 'lowpass', from: 4000, to: 120, q: 0.7, send: 0.25 });
    this.osc('sine', 160, t, { gain: 0.6, decay: 0.32 + power * 0.1, to: 38, toTime: 0.3, send: 0.1 });
    if (this.voiceName === 'bloop') this.noise(t + 0.02, 0.18, { gain: 0.25, from: 900, to: 400, q: 3 });
    if (this.voiceName === 'synth') this.osc('sawtooth', 900, t, { gain: 0.06, decay: 0.5, to: 60, toTime: 0.5, echo: 0.5, filter: { from: 2000, to: 200 } });
    if (this.voiceName === 'marimba') this.noise(t, 0.6, { gain: 0.12, from: 1800, to: 500, q: 0.8, send: 0.4 });
  }

  zap() {
    if (!this.ready) return;
    const t = this.now;
    this.osc('sawtooth', 1800, t, { gain: 0.1, decay: 0.3, to: 110, toTime: 0.28, echo: 0.2, filter: { type: 'bandpass', from: 2500, to: 400, q: 2 } });
    this.noise(t, 0.28, { gain: 0.12, type: 'highpass', from: 2500, send: 0.15 });
    this.pluck(this.note(12), t + 0.02, 0.5);
  }

  prism() {
    if (!this.ready) return;
    const t = this.now;
    for (let i = 0; i < 12; i++) this.pluck(this.note(4 + i), t + i * 0.035, 0.55);
    this.noise(t, 0.6, { gain: 0.12, from: 400, to: 6000, q: 2, send: 0.4 });
  }

  mega() {
    if (!this.ready) return;
    this.nova(2);
    this.prism();
  }

  land() {
    if (!this.ready || this.now - this.lastLand < 0.07) return;
    this.lastLand = this.now;
    const t = this.now;
    if (this.voiceName === 'bloop') this.osc('sine', 260, t, { gain: 0.08, decay: 0.08, to: 140, toTime: 0.06, send: 0 });
    else this.osc('sine', 130, t, { gain: 0.07, decay: 0.06, to: 70, toTime: 0.05, send: 0 });
  }

  shuffle() {
    if (!this.ready) return;
    const t = this.now;
    this.noise(t, 0.35, { gain: 0.14, from: 300, to: 3000, q: 2 });
    this.noise(t + 0.3, 0.35, { gain: 0.12, from: 3000, to: 300, q: 2 });
    for (let i = 0; i < 6; i++) this.pluck(this.note(10 - i), t + i * 0.06, 0.4);
  }

  levelUp() {
    if (!this.ready) return;
    const t = this.now;
    [0, 2, 4, 5, 7, 10].forEach((n, i) => this.pluck(this.note(n + 5), t + i * 0.08, 0.8));
    [10, 12, 14].forEach((n) => this.pluck(this.note(n + 5), t + 0.55, 0.7));
  }

  highscore() {
    if (!this.ready) return;
    const t = this.now;
    for (let i = 0; i < 8; i++) this.pluck(this.note(10 + i), t + i * 0.05, 0.6);
    this.noise(t, 0.9, { gain: 0.08, type: 'highpass', from: 6000, send: 0.5 });
  }

  // ------------------------------------------------------------ music

  scheduleMusic() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    while (this.nextBar < this.now + 1.2) {
      this.playBar(this.nextBar, this.bar++);
      this.nextBar += 4;
    }
  }

  playBar(t, bar) {
    const v = this.voice;
    const chord = v.chords[bar % v.chords.length];
    const base = v.root - 12;
    for (const semi of chord) {
      const f = mtof(base + semi);
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = v.pad;
        o.frequency.value = f;
        o.detune.value = det;
        const flt = this.ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = v.pad === 'sine' ? 4000 : 900;
        const g = this.ctx.createGain();
        const peak = v.pad === 'sine' ? 0.05 : v.pad === 'triangle' ? 0.045 : 0.022;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 1.4);
        g.gain.setValueAtTime(peak, t + 3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 5.2);
        o.connect(flt); flt.connect(g); g.connect(this.music);
        const s = this.ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(this.reverb);
        o.start(t); o.stop(t + 5.3);
      }
    }
    // a few soft melody notes over the pad
    const count = 2 + (bar % 3);
    for (let i = 0; i < count; i++) {
      const at = t + 0.5 * Math.floor(Math.random() * 8);
      this.pluck(this.note(5 + Math.floor(Math.random() * 7)), at, 0.32, this.music);
    }
  }
}
