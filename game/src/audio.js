// audio.js — every sound is synthesized live with WebAudio. No audio files
// are shipped, so the game loads nothing over the network. The context is
// created on the first user gesture (the start click) and stays suspended
// until then, which browsers require.

import { clamp } from './util.js';

const CHORDS = [
  [110.0, 164.81, 261.63], // A minor
  [87.31, 130.81, 220.0], // F major
  [130.81, 196.0, 329.63], // C major
  [98.0, 146.83, 246.94], // G major
];

export class SoundBank {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenOn = false;
    this.musicOn = false;
    this.chordIndex = 0;
    this.nextChordAt = 0;
    this.noiseBuffer = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.sound ? this.settings.volume : 0;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  setVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.sound ? this.settings.volume : 0;
    this.musicGain.gain.value = this.settings.music ? 0.16 : 0;
  }

  // Engine drone whose pitch follows the player's speed, 0..1.
  engine(level, active) {
    if (!this.ctx) return;
    if (!active || level <= 0.02) {
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      return;
    }
    if (!this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.sfxGain);
      this.engineOsc.start();
    }
    this.engineOsc.frequency.setTargetAtTime(55 + level * 130, this.ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(0.05 + level * 0.1, this.ctx.currentTime, 0.08);
  }

  siren(active) {
    if (!this.ctx) return;
    if (active === this.sirenOn) return;
    this.sirenOn = active;
    if (!active) {
      if (this.sirenGain) this.sirenGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      return;
    }
    if (!this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.sfxGain);
      this.sirenOsc.start();
    }
    this.sirenGain.gain.setTargetAtTime(0.045, this.ctx.currentTime, 0.2);
  }

  // Called every frame while a siren is audible: alternate the two tones.
  updateSirenTone(time) {
    if (!this.ctx || !this.sirenOn || !this.sirenOsc) return;
    const phase = Math.floor(time * 2.4) % 2;
    this.sirenOsc.frequency.setTargetAtTime(phase === 0 ? 660 : 880, this.ctx.currentTime, 0.05);
  }

  blip(freq, duration, type, volume, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume || 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  noise(duration, volume, filterFreq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  shot(kind) {
    if (kind === 'shotgun') this.noise(0.28, 0.5, 900);
    else if (kind === 'rifle') this.noise(0.16, 0.4, 1600);
    else if (kind === 'smg') this.noise(0.08, 0.28, 2000);
    else this.noise(0.12, 0.34, 1400);
    this.blip(160, 0.08, 'square', 0.12, 60);
  }

  reload() {
    this.blip(900, 0.05, 'square', 0.1);
    setTimeout(() => this.blip(600, 0.05, 'square', 0.1), 120);
  }

  crash(intensity) {
    this.noise(0.25, clamp(intensity, 0.1, 0.5), 500);
    this.blip(90, 0.2, 'sine', 0.3, 40);
  }

  explosion() {
    this.noise(0.9, 0.6, 300);
    this.blip(70, 0.7, 'sine', 0.5, 30);
  }

  horn() {
    this.blip(370, 0.22, 'square', 0.12);
    this.blip(466, 0.22, 'square', 0.1);
  }

  pickup() {
    this.blip(880, 0.09, 'sine', 0.2);
    setTimeout(() => this.blip(1320, 0.12, 'sine', 0.2), 90);
  }

  click() {
    this.blip(700, 0.05, 'square', 0.08);
  }

  cash() {
    this.blip(1046, 0.08, 'sine', 0.18);
    setTimeout(() => this.blip(1568, 0.14, 'sine', 0.18), 80);
  }

  missionPass() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      setTimeout(() => this.blip(freq, 0.22, 'triangle', 0.22), i * 130);
    });
  }

  missionFail() {
    const notes = [392, 330, 262];
    notes.forEach((freq, i) => {
      setTimeout(() => this.blip(freq, 0.3, 'triangle', 0.2), i * 170);
    });
  }

  startMusic() {
    if (!this.ensure()) return;
    this.musicOn = true;
    this.nextChordAt = this.ctx.currentTime + 0.1;
  }

  stopMusic() {
    this.musicOn = false;
  }

  // Slow sunset pad: one soft chord every four seconds, plus a sparse pluck.
  updateMusic() {
    if (!this.ctx || !this.musicOn || !this.settings.music) return;
    if (this.ctx.currentTime < this.nextChordAt) return;
    const chord = CHORDS[this.chordIndex % CHORDS.length];
    this.chordIndex += 1;
    this.nextChordAt = this.ctx.currentTime + 4;
    const t = this.ctx.currentTime;
    chord.forEach((freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 1.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start(t);
      osc.stop(t + 4.1);
    });
    const pluck = this.ctx.createOscillator();
    pluck.type = 'sine';
    pluck.frequency.value = chord[2] * 2;
    const pluckGain = this.ctx.createGain();
    pluckGain.gain.setValueAtTime(0.25, t + 1);
    pluckGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    pluck.connect(pluckGain);
    pluckGain.connect(this.musicGain);
    pluck.start(t + 1);
    pluck.stop(t + 2.6);
  }
}
