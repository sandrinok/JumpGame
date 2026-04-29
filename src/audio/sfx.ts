/**
 * Tiny WebAudio synth for game SFX. No assets, all envelope-shaped oscillators / noise.
 * Designed to be triggered from gameplay events (jump, land, wind).
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureCtx(): { ctx: AudioContext; master: GainNode } | null {
  if (ctx && master) return { ctx, master };
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return { ctx, master };
  } catch {
    return null;
  }
}

/** Resume audio after user gesture (browsers require this). */
export function unlockAudio(): void {
  const a = ensureCtx();
  if (!a) return;
  if (a.ctx.state === 'suspended') a.ctx.resume();
}

export function playJump(): void {
  const a = ensureCtx();
  if (!a) return;
  const t = a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.08);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(g).connect(a.master);
  osc.start(t);
  osc.stop(t + 0.2);
}

export function playLand(intensity = 1): void {
  const a = ensureCtx();
  if (!a) return;
  const t = a.ctx.currentTime;
  const dur = 0.25;
  const buf = a.ctx.createBuffer(1, Math.floor(a.ctx.sampleRate * dur), a.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const e = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * e * e;
  }
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const lp = a.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320 + intensity * 200;
  const g = a.ctx.createGain();
  g.gain.value = Math.min(0.35, 0.12 * intensity);
  src.connect(lp).connect(g).connect(a.master);
  src.start(t);
}

export function playWindBurst(): void {
  const a = ensureCtx();
  if (!a) return;
  const t = a.ctx.currentTime;
  const dur = 0.5;
  const buf = a.ctx.createBuffer(1, Math.floor(a.ctx.sampleRate * dur), a.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const e = i < data.length * 0.2 ? i / (data.length * 0.2) : 1 - (i - data.length * 0.2) / (data.length * 0.8);
    data[i] = (Math.random() * 2 - 1) * e;
  }
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const bp = a.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 0.7;
  const g = a.ctx.createGain();
  g.gain.value = 0.18;
  src.connect(bp).connect(g).connect(a.master);
  src.start(t);
}
