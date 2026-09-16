/**
 * Tiny procedural sound synthesizer producing 16-bit mono WAV files. Used by
 * the demo build to ship a few small sound effects without binary sources.
 * All generators are deterministic (seeded noise) so builds are reproducible.
 */

export const SAMPLE_RATE = 22050;

export interface Tone {
  /** Seconds. */
  duration: number;
  /** Start / end frequency in Hz (linear sweep). */
  from: number;
  to: number;
  wave?: 'sine' | 'square' | 'saw' | 'triangle' | 'noise';
  /** 0..1 amplitude. */
  volume?: number;
  /** Attack and release in seconds. */
  attack?: number;
  release?: number;
  /** Vibrato depth (Hz) and rate (Hz). */
  vibrato?: number;
  vibratoRate?: number;
}

function noiseSource(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Render one tone into float samples. */
export function renderTone(t: Tone, seed = 1): Float32Array {
  const n = Math.floor(t.duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  const noise = noiseSource(seed);
  const vol = t.volume ?? 0.6;
  const attack = t.attack ?? 0.005;
  const release = t.release ?? Math.min(0.1, t.duration / 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const time = i / SAMPLE_RATE;
    const k = time / t.duration;
    let f = t.from + (t.to - t.from) * k;
    if (t.vibrato) f += Math.sin(time * (t.vibratoRate ?? 8) * Math.PI * 2) * t.vibrato;
    phase += f / SAMPLE_RATE;
    const p = phase - Math.floor(phase);
    let v: number;
    switch (t.wave ?? 'sine') {
      case 'square': v = p < 0.5 ? 1 : -1; break;
      case 'saw': v = p * 2 - 1; break;
      case 'triangle': v = 1 - 4 * Math.abs(p - 0.5); break;
      case 'noise': v = noise(); break;
      default: v = Math.sin(p * Math.PI * 2);
    }
    let env = 1;
    if (time < attack) env = time / attack;
    const rem = t.duration - time;
    if (rem < release) env *= rem / release;
    out[i] = v * env * vol;
  }
  return out;
}

/** Mix several tones (they may have different lengths). */
export function mix(...parts: Float32Array[]): Float32Array {
  const n = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(n);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < n; i++) out[i] *= 0.95 / peak;
  return out;
}

/** Play tones one after another. */
export function sequence(...parts: Float32Array[]): Float32Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Encode float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = 44 + samples.length * 2;
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return new Uint8Array(buf);
}

/** Ready-made effects shared by the demos. */
export const SFX = {
  laser: () => encodeWav(mix(renderTone({ duration: 0.18, from: 1200, to: 300, wave: 'square', volume: 0.35, release: 0.08 }), renderTone({ duration: 0.18, from: 1800, to: 500, wave: 'saw', volume: 0.15 }))),
  explosion: () => encodeWav(mix(renderTone({ duration: 0.6, from: 400, to: 40, wave: 'noise', volume: 0.7, release: 0.4 }, 7), renderTone({ duration: 0.5, from: 160, to: 30, wave: 'triangle', volume: 0.5, release: 0.3 }))),
  hit: () => encodeWav(mix(renderTone({ duration: 0.12, from: 500, to: 120, wave: 'noise', volume: 0.5, release: 0.08 }, 3), renderTone({ duration: 0.12, from: 300, to: 80, wave: 'square', volume: 0.3 }))),
  coin: () => encodeWav(sequence(renderTone({ duration: 0.07, from: 988, to: 988, wave: 'square', volume: 0.3 }), renderTone({ duration: 0.22, from: 1319, to: 1319, wave: 'square', volume: 0.3, release: 0.15 }))),
  jump: () => encodeWav(renderTone({ duration: 0.18, from: 300, to: 700, wave: 'square', volume: 0.3, release: 0.1 })),
  bounce: () => encodeWav(renderTone({ duration: 0.08, from: 700, to: 500, wave: 'triangle', volume: 0.5, release: 0.05 })),
  goal: () => encodeWav(sequence(renderTone({ duration: 0.1, from: 523, to: 523, wave: 'square', volume: 0.35 }), renderTone({ duration: 0.1, from: 659, to: 659, wave: 'square', volume: 0.35 }), renderTone({ duration: 0.3, from: 784, to: 784, wave: 'square', volume: 0.35, release: 0.2 }))),
  place: () => encodeWav(renderTone({ duration: 0.1, from: 400, to: 800, wave: 'triangle', volume: 0.4, release: 0.05 })),
  shoot: () => encodeWav(renderTone({ duration: 0.09, from: 900, to: 400, wave: 'triangle', volume: 0.3, release: 0.05 })),
  lose: () => encodeWav(sequence(renderTone({ duration: 0.2, from: 400, to: 380, wave: 'saw', volume: 0.35 }), renderTone({ duration: 0.4, from: 300, to: 150, wave: 'saw', volume: 0.35, release: 0.3 }))),
  checkpoint: () => encodeWav(sequence(renderTone({ duration: 0.08, from: 660, to: 660, wave: 'triangle', volume: 0.4 }), renderTone({ duration: 0.16, from: 880, to: 880, wave: 'triangle', volume: 0.4, release: 0.1 }))),
  engine: () => encodeWav(renderTone({ duration: 0.4, from: 90, to: 110, wave: 'saw', volume: 0.25, attack: 0.05, release: 0.05, vibrato: 4, vibratoRate: 30 })),
};

export type SfxName = keyof typeof SFX;
