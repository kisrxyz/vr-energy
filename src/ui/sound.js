// Звуки синтезируются на лету: щелчок выключателя, скрип разъединителя, дуга, сигнал указателя
const Sound = {
  ctx: null, on: true,
  init() {
    if (!this.ctx) { try { const C = window.AudioContext || window.webkitAudioContext; if (C) this.ctx = new C(); } catch (e) { this.ctx = null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  env(node, t0, a, d, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(this.ctx.destination);
  },
  tone(f1, f2, dur, peak, type = 'sine', delay = 0) {
    const c = this.ctx, t0 = c.currentTime + delay, o = c.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f1, t0); o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    this.env(o, t0, 0.005, dur, peak); o.start(t0); o.stop(t0 + dur + 0.05);
  },
  noise(dur, freq, q, peak, delay = 0) {
    const c = this.ctx, t0 = c.currentTime + delay, n = Math.floor(c.sampleRate * dur);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.02 ? 3 : 1);
    const s = c.createBufferSource(); s.buffer = b;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); this.env(f, t0, 0.004, dur, peak); s.start(t0);
  },
  play(kind) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    try {
      if (kind === 'breaker') { this.tone(140, 55, 0.18, 0.5); this.noise(0.09, 2400, 0.8, 0.25); }
      else if (kind === 'disc') { this.noise(0.35, 700, 0.7, 0.18); this.tone(180, 90, 0.12, 0.2, 'triangle', 0.25); }
      else if (kind === 'arc') { this.noise(1.1, 1600, 0.4, 0.9); this.noise(0.7, 260, 0.6, 0.9); this.tone(90, 40, 0.5, 0.6, 'sawtooth'); }
      else if (kind === 'blocked') { this.tone(520, 520, 0.12, 0.16, 'square'); this.tone(390, 390, 0.16, 0.16, 'square', 0.14); }
      else if (kind === 'check') { this.tone(1400, 1400, 0.06, 0.12); this.tone(1400, 1400, 0.06, 0.12, 'sine', 0.1); }
      else if (kind === 'checklive') { for (let i = 0; i < 4; i++) this.tone(1800, 1800, 0.05, 0.14, 'square', i * 0.09); }
      else if (kind === 'ok') { this.tone(660, 660, 0.12, 0.2); this.tone(880, 880, 0.18, 0.2, 'sine', 0.12); }
      else if (kind === 'fail') { this.tone(330, 220, 0.4, 0.22, 'triangle'); }
      // VR-полигон: взять предмет, повесить плакат, надеть СИЗ, щёлкнуть замком, коснуться указателем без напряжения
      else if (kind === 'grab') { this.noise(0.06, 900, 1.2, 0.12); }
      else if (kind === 'hang') { this.noise(0.12, 3200, 0.9, 0.12); this.tone(420, 380, 0.05, 0.08, 'triangle', 0.06); }
      else if (kind === 'wear') { this.noise(0.28, 1400, 0.6, 0.1); }
      else if (kind === 'lock') { this.tone(1900, 1500, 0.04, 0.14, 'square'); this.tone(1300, 1100, 0.05, 0.12, 'square', 0.07); }
      else if (kind === 'touch') { this.tone(240, 200, 0.05, 0.08, 'triangle'); }
    } catch (e) { /* звук не обязателен */ }
  },
};

export { Sound };
