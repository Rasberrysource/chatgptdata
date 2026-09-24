/*
 * audio.js — tiny synthesized sound effects (no audio files).
 * The AudioContext is created on the first user gesture, as browsers require.
 */
(function (root) {
  'use strict';
  const ZGR = root.ZGR;

  const Sfx = {
    ctx: null,
    master: null,
    noiseBuf: null,
    muted: false,
    lastShot: 0,

    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        this.ctx = null;
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.45;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    },

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.45;
    },

    ready() {
      return this.ctx && !this.muted && this.ctx.state === 'running';
    },

    tone(freq, dur, type, vol, slideTo, delay) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    },

    noise(dur, vol, freq, q, delay) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime + (delay || 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq || 1200;
      f.Q.value = q || 0.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 0.3);
      src.stop(t + dur + 0.02);
    },

    shot(lv) {
      if (!this.ready()) return;
      const now = this.ctx.currentTime;
      if (now - this.lastShot < 0.07) return;
      this.lastShot = now;
      if (lv === 6) this.tone(1400, 0.06, 'sawtooth', 0.025, 700);
      else if (lv === 5) this.noise(0.12, 0.06, 500, 1);
      else this.noise(0.05, 0.05, 2200 - lv * 200, 1.2);
    },

    gate(good) {
      if (good) {
        this.tone(520, 0.1, 'square', 0.08);
        this.tone(780, 0.14, 'square', 0.08, null, 0.08);
      } else {
        this.tone(300, 0.25, 'sawtooth', 0.09, 110);
      }
    },

    barrel(type) {
      this.noise(0.18, 0.18, 700, 0.7);
      if (type === 'weapon') {
        this.tone(400, 0.25, 'square', 0.07, 1200);
      } else if (type === 'troops') {
        this.tone(660, 0.08, 'triangle', 0.1);
        this.tone(990, 0.1, 'triangle', 0.1, null, 0.07);
      } else if (type === 'freeze') {
        this.tone(1800, 0.3, 'sine', 0.06, 900);
      } else if (type === 'rapid') {
        this.tone(900, 0.2, 'square', 0.05, 1500);
      }
    },

    bomb() {
      this.noise(0.6, 0.35, 180, 0.6);
      this.tone(90, 0.5, 'sine', 0.25, 40);
    },

    clash() {
      if (!this.ready()) return;
      const now = this.ctx.currentTime;
      if (now - (this.lastClash || 0) < 0.09) return;
      this.lastClash = now;
      this.noise(0.08, 0.12, 400, 0.9);
    },

    smash() {
      this.noise(0.3, 0.3, 220, 0.8);
      this.tone(120, 0.25, 'sine', 0.2, 50);
    },

    boss() {
      this.tone(110, 0.9, 'sawtooth', 0.12, 70);
      this.tone(165, 0.9, 'sawtooth', 0.08, 90, 0.05);
    },

    bossDown() {
      this.noise(0.9, 0.35, 160, 0.5);
      this.tone(200, 0.6, 'square', 0.1, 60);
    },

    win() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'square', 0.08, null, i * 0.11));
    },

    lose() {
      [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, null, i * 0.16));
    },

    click() {
      this.tone(880, 0.05, 'square', 0.05);
    },
  };

  ZGR.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
