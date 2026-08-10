// Synthesized Web Audio SFX — no external audio assets.
// Oscillator + noise bursts for every game moment.

class SoundEffects {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._lastPlayed = {};
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _throttle(key, ms = 120) {
    const now = Date.now();
    if (this._lastPlayed[key] && now - this._lastPlayed[key] < ms) return true;
    this._lastPlayed[key] = now;
    return false;
  }

  _tone({ type = 'sine', from = 440, to = null, dur = 0.2, vol = 0.2, delay = 0, attack = 0.005 }) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.2, vol = 0.2, delay = 0, freq = 1200, type = 'lowpass' }) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  // ---- game sounds ----

  draw() {
    if (this._throttle('draw')) return;
    this._noise({ dur: 0.22, vol: 0.18, freq: 2400, type: 'bandpass' });
    this._tone({ type: 'triangle', from: 220, to: 660, dur: 0.18, vol: 0.1 });
  }

  slap() {
    if (this._throttle('slap')) return;
    this._noise({ dur: 0.12, vol: 0.28, freq: 700, type: 'lowpass' });
    this._tone({ type: 'sine', from: 140, to: 60, dur: 0.14, vol: 0.3 });
  }

  flip() {
    if (this._throttle('flip')) return;
    this._noise({ dur: 0.16, vol: 0.14, freq: 1800, type: 'bandpass' });
  }

  buzzer() {
    if (this._throttle('buzzer', 200)) return;
    this._tone({ type: 'sawtooth', from: 200, to: 90, dur: 0.55, vol: 0.22 });
    this._tone({ type: 'square', from: 160, to: 70, dur: 0.55, vol: 0.16, delay: 0.02 });
  }

  heartbeat() {
    if (this._throttle('heartbeat', 350)) return;
    this._tone({ type: 'sine', from: 90, to: 50, dur: 0.18, vol: 0.24 });
    this._tone({ type: 'sine', from: 80, to: 45, dur: 0.16, vol: 0.18, delay: 0.22 });
  }

  uno() {
    this._tone({ type: 'square', from: 660, to: 660, dur: 0.12, vol: 0.16 });
    this._tone({ type: 'square', from: 880, to: 880, dur: 0.2, vol: 0.16, delay: 0.13 });
  }

  catchUno() {
    this._tone({ type: 'square', from: 520, to: 520, dur: 0.1, vol: 0.16 });
    this._tone({ type: 'square', from: 520, to: 520, dur: 0.1, vol: 0.16, delay: 0.14 });
    this._tone({ type: 'square', from: 780, to: 780, dur: 0.24, vol: 0.16, delay: 0.28 });
  }

  drawPenalty() {
    this._tone({ type: 'triangle', from: 300, to: 140, dur: 0.35, vol: 0.2 });
    this._noise({ dur: 0.2, vol: 0.12, freq: 500, type: 'lowpass' });
  }

  win() {
    this._tone({ type: 'triangle', from: 523, to: 523, dur: 0.12, vol: 0.18 });
    this._tone({ type: 'triangle', from: 659, to: 659, dur: 0.12, vol: 0.18, delay: 0.12 });
    this._tone({ type: 'triangle', from: 784, to: 784, dur: 0.12, vol: 0.18, delay: 0.24 });
    this._tone({ type: 'triangle', from: 1046, to: 1046, dur: 0.3, vol: 0.2, delay: 0.36 });
  }

  lose() {
    this._tone({ type: 'triangle', from: 400, to: 160, dur: 0.6, vol: 0.18 });
  }

  click() {
    if (this._throttle('click')) return;
    this._tone({ type: 'square', from: 1200, to: 1000, dur: 0.05, vol: 0.06 });
  }
}

const sfx = new SoundEffects();
export default sfx;