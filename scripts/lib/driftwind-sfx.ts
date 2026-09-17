/**
 * Procedural sounds for Driftwind built on the demo WAV synthesizer: a
 * seamless wind loop, ring chimes, boost whoosh, soft collision thud, mote
 * sparkle, an island-discovery arpeggio and a slow music pad loop.
 */
import { SAMPLE_RATE, encodeWav, mix, renderTone, sequence } from './wav';

/** One-pole low-pass filter (cutoff in Hz), optionally sweeping to `cutoffEnd`. */
export function lowpass(samples: Float32Array, cutoff: number, cutoffEnd = cutoff): Float32Array {
  const out = new Float32Array(samples.length);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    const fc = cutoff + (cutoffEnd - cutoff) * (i / samples.length);
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SAMPLE_RATE);
    y += a * (samples[i] - y);
    out[i] = y;
  }
  return out;
}

/** Multiply by a slow sine LFO in `[1 - depth, 1]`. */
export function tremolo(samples: Float32Array, rateHz: number, depth: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * (1 - depth * (0.5 + 0.5 * Math.sin((i / SAMPLE_RATE) * rateHz * Math.PI * 2)));
  return out;
}

/** Make a loop seamless by cross-fading its tail into its head over `seconds`. */
export function loopable(samples: Float32Array, seconds = 0.4): Float32Array {
  const n = Math.min(samples.length >> 1, Math.floor(seconds * SAMPLE_RATE));
  const out = new Float32Array(samples.length - n);
  for (let i = 0; i < out.length; i++) {
    if (i < n) {
      const t = i / n;
      out[i] = samples[i] * t + samples[samples.length - n + i] * (1 - t);
    } else out[i] = samples[i];
  }
  return out;
}

function gain(samples: Float32Array, k: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * k;
  return out;
}

export const DRIFTWIND_SFX = {
  /** Airflow loop (3 s): filtered noise with a slow swell. */
  wind: () => encodeWav(loopable(tremolo(lowpass(renderTone({ duration: 3.4, from: 0, to: 0, wave: 'noise', volume: 0.9, attack: 0, release: 0 }, 11), 520, 620), 0.35, 0.35), 0.5)),
  /** Ring chime: two bell partials. */
  chime: () => encodeWav(mix(
    renderTone({ duration: 0.7, from: 880, to: 880, volume: 0.35, release: 0.55 }),
    renderTone({ duration: 0.7, from: 1320, to: 1318, volume: 0.18, release: 0.5 }),
    renderTone({ duration: 0.45, from: 2640, to: 2640, volume: 0.06, release: 0.4 }),
  )),
  /** Boost whoosh: noise with a rising then falling filter sweep. */
  whoosh: () => encodeWav(gain(lowpass(renderTone({ duration: 0.8, from: 0, to: 0, wave: 'noise', volume: 0.8, attack: 0.15, release: 0.45 }, 5), 300, 2400), 0.7)),
  /** Soft collision: low thump plus a puff. */
  thud: () => encodeWav(mix(
    renderTone({ duration: 0.28, from: 110, to: 45, wave: 'sine', volume: 0.7, release: 0.2 }),
    lowpass(renderTone({ duration: 0.18, from: 0, to: 0, wave: 'noise', volume: 0.35, release: 0.14 }, 9), 900),
  )),
  /** Mote sparkle. */
  mote: () => encodeWav(sequence(
    renderTone({ duration: 0.08, from: 1568, to: 1568, wave: 'triangle', volume: 0.25 }),
    renderTone({ duration: 0.22, from: 2349, to: 2349, wave: 'sine', volume: 0.25, release: 0.18 }),
  )),
  /** Island discovered: a gentle rising arpeggio. */
  discover: () => encodeWav(sequence(
    renderTone({ duration: 0.16, from: 523, to: 523, wave: 'triangle', volume: 0.28, release: 0.1 }),
    renderTone({ duration: 0.16, from: 659, to: 659, wave: 'triangle', volume: 0.28, release: 0.1 }),
    renderTone({ duration: 0.5, from: 784, to: 784, wave: 'sine', volume: 0.3, release: 0.4 }),
  )),
  /** Countdown tick and go. */
  tick: () => encodeWav(renderTone({ duration: 0.12, from: 660, to: 660, wave: 'triangle', volume: 0.35, release: 0.08 })),
  go: () => encodeWav(mix(renderTone({ duration: 0.5, from: 988, to: 988, wave: 'triangle', volume: 0.35, release: 0.35 }), renderTone({ duration: 0.5, from: 1319, to: 1319, wave: 'sine', volume: 0.2, release: 0.35 }))),
  /** Music pad (8 s loop): a soft major-seventh chord with slow movement. */
  pad: () => {
    const notes = [130.8, 196, 261.6, 329.6, 392, 493.9];
    const parts = notes.map((f, i) => renderTone({ duration: 8.4, from: f, to: f * (1 + (i % 2 ? 0.0015 : -0.001)), wave: i < 2 ? 'triangle' : 'sine', volume: i < 2 ? 0.16 : 0.13, attack: 0.02, release: 0.02, vibrato: f * 0.003, vibratoRate: 0.35 + i * 0.07 }));
    return encodeWav(loopable(tremolo(lowpass(mix(...parts), 1400), 0.12, 0.3), 0.8));
  },
};
