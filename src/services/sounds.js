// Web Audio API generator for zero-latency, reliable trading sound effects & custom ringtones
class SoundService {
  constructor() {
    this.ctx = null;
    this.currentTone = typeof window !== 'undefined' ? (localStorage.getItem('sharemarket:alert_tone') || 'cash') : 'cash';
  }

  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
  }

  setTone(tone) {
    this.currentTone = tone;
    if (typeof window !== 'undefined') {
      localStorage.setItem('sharemarket:alert_tone', tone);
    }
  }

  getTone() {
    return this.currentTone;
  }

  // Play currently selected ringtone / chime
  playAlert(toneType = this.currentTone) {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      switch (toneType) {
        case 'cash':
          this.playCashRegister();
          break;
        case 'bell':
          this.playTempleBell();
          break;
        case 'chime':
          this.playOrderSuccess();
          break;
        case 'digital':
          this.playDigitalBeep();
          break;
        case 'marimba':
          this.playMarimbaTone();
          break;
        default:
          this.playCashRegister();
      }
    } catch (e) {}
  }

  // Crisp terminal execution double chime
  playOrderSuccess() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1760, now + 0.08);
      gain2.gain.setValueAtTime(0.22, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.38);
    } catch (e) {}
  }

  // Ringing Brass Bell / Notification Ringtone
  playTempleBell() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      const freqs = [1046.5, 1318.5, 1567.98, 2093.0];
      freqs.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.04);
        gain.gain.setValueAtTime(0.12 / (i + 1), now + i * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.04);
        osc.stop(now + 0.65);
      });
    } catch (e) {}
  }

  // Modern Electronic Trading Terminal Beep
  playDigitalBeep() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      [1200, 1600, 2400].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);
        gain.gain.setValueAtTime(0.05, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.06);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.06);
      });
    } catch (e) {}
  }

  // Realistic Classic Cash Register Bell (Metallic "Cha-Ching" Ding)
  playCashRegister() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;

      // 1. Initial mechanical register slide sound (drawer click)
      const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseBuffer.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1800, now);
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.12, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      noise.start(now);

      // 2. Bright primary brass bell tone ("Ching" fundamental)
      const bell1 = this.ctx.createOscillator();
      const gainBell1 = this.ctx.createGain();
      bell1.type = 'sine';
      bell1.frequency.setValueAtTime(2637, now + 0.03); // E7
      gainBell1.gain.setValueAtTime(0.24, now + 0.03);
      gainBell1.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
      bell1.connect(gainBell1);
      gainBell1.connect(this.ctx.destination);
      bell1.start(now + 0.03);
      bell1.stop(now + 0.75);

      // 3. High metallic harmonic shimmer
      const bell2 = this.ctx.createOscillator();
      const gainBell2 = this.ctx.createGain();
      bell2.type = 'sine';
      bell2.frequency.setValueAtTime(3951, now + 0.035); // B7 harmonic
      gainBell2.gain.setValueAtTime(0.15, now + 0.035);
      gainBell2.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      bell2.connect(gainBell2);
      gainBell2.connect(this.ctx.destination);
      bell2.start(now + 0.035);
      bell2.stop(now + 0.6);

      // 4. Resonant acoustic decay body
      const bell3 = this.ctx.createOscillator();
      const gainBell3 = this.ctx.createGain();
      bell3.type = 'triangle';
      bell3.frequency.setValueAtTime(1318.5, now + 0.03); // E6
      gainBell3.gain.setValueAtTime(0.1, now + 0.03);
      gainBell3.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      bell3.connect(gainBell3);
      gainBell3.connect(this.ctx.destination);
      bell3.start(now + 0.03);
      bell3.stop(now + 0.85);
    } catch (e) {}
  }

  // Soft Wooden Marimba / Notification Tone
  playMarimbaTone() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + idx * 0.08);
        gain.gain.setValueAtTime(0.18, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.3);
      });
    } catch (e) {}
  }

  // Gentle alert / warning tone
  playOrderCancel() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {}
  }
}

export const soundEffects = new SoundService();
