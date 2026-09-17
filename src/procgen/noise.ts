/**
 * Seeded coherent noise for procedural content: 2D/3D simplex, fractal
 * Brownian motion, ridged multifractal, domain warping and Worley (cellular)
 * noise. Every function is deterministic for a given seed, so a world seed
 * produces the same geometry on every machine (what shareable seeds and
 * multiplayer need).
 */
import { Random } from '../core/math/Random';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD3: readonly number[][] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

/** Options for fractal noise. */
export interface FbmOptions {
  /** Number of octaves. Default 4. */
  octaves?: number;
  /** Frequency multiplier per octave. Default 2. */
  lacunarity?: number;
  /** Amplitude multiplier per octave. Default 0.5. */
  gain?: number;
  /** Base frequency. Default 1. */
  frequency?: number;
}

/** FNV-1a hash of a string to an unsigned 32-bit integer (stable seed from a seed phrase). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix two integers into a well-distributed unsigned 32-bit hash. */
export function hash2i(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** `hash2i` mapped to `[0, 1)`. */
export function hash2f(x: number, y: number, seed = 0): number {
  return hash2i(x, y, seed) / 4294967296;
}

/**
 * Seeded simplex noise. Values are in `[-1, 1]`. Instances are cheap; make one
 * per feature (terrain, colour jitter, wind) with derived seeds so tweaking
 * one does not reshuffle the others.
 */
export class Noise {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);

  constructor(readonly seed: number) {
    const rng = new Random(seed >>> 0);
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p.push(i);
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** 2D simplex noise in `[-1, 1]`. */
  simplex2(xin: number, yin: number): number {
    const perm = this.perm, permMod12 = this.permMod12;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { const g = GRAD3[permMod12[ii + perm[jj]]]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { const g = GRAD3[permMod12[ii + i1 + perm[jj + j1]]]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { const g = GRAD3[permMod12[ii + 1 + perm[jj + 1]]]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  /** 3D simplex noise in `[-1, 1]`. */
  simplex3(xin: number, yin: number, zin: number): number {
    const perm = this.perm, permMod12 = this.permMod12;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = GRAD3[permMod12[ii + perm[jj + perm[kk]]]]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = GRAD3[permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = GRAD3[permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = GRAD3[permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]]; t3 *= t3; n += t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3); }
    return 32 * n;
  }

  /** Fractal Brownian motion (sum of octaves), normalized to roughly `[-1, 1]`. */
  fbm2(x: number, y: number, opts: FbmOptions = {}): number {
    const octaves = opts.octaves ?? 4, lac = opts.lacunarity ?? 2, gain = opts.gain ?? 0.5;
    let f = opts.frequency ?? 1, a = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.simplex2(x * f + o * 17.3, y * f - o * 9.1) * a;
      norm += a;
      f *= lac;
      a *= gain;
    }
    return sum / norm;
  }

  fbm3(x: number, y: number, z: number, opts: FbmOptions = {}): number {
    const octaves = opts.octaves ?? 4, lac = opts.lacunarity ?? 2, gain = opts.gain ?? 0.5;
    let f = opts.frequency ?? 1, a = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.simplex3(x * f + o * 17.3, y * f - o * 9.1, z * f + o * 5.7) * a;
      norm += a;
      f *= lac;
      a *= gain;
    }
    return sum / norm;
  }

  /** Ridged multifractal in `[0, 1]`: sharp crests, good for cliffs and mountain ridges. */
  ridged2(x: number, y: number, opts: FbmOptions = {}): number {
    const octaves = opts.octaves ?? 4, lac = opts.lacunarity ?? 2, gain = opts.gain ?? 0.5;
    let f = opts.frequency ?? 1, a = 1, sum = 0, norm = 0, weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.simplex2(x * f + o * 31.7, y * f + o * 13.3));
      n *= n * weight;
      weight = Math.min(1, Math.max(0, n * 2));
      sum += n * a;
      norm += a;
      f *= lac;
      a *= gain;
    }
    return sum / norm;
  }

  /**
   * Domain-warped fbm: offsets the sample position by another noise field,
   * producing the flowing, organic look of eroded terrain.
   */
  warp2(x: number, y: number, strength = 0.5, opts: FbmOptions = {}): number {
    const qx = this.fbm2(x + 5.2, y + 1.3, opts), qy = this.fbm2(x + 9.7, y + 2.8, opts);
    return this.fbm2(x + strength * qx, y + strength * qy, opts);
  }

  /**
   * Worley (cellular) noise: distances to the nearest (`f1`) and second
   * nearest (`f2`) feature points, plus the nearest cell id. `f2 - f1` gives
   * cell borders, `f1` gives bubbles.
   */
  worley2(x: number, y: number): { f1: number; f2: number; id: number } {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i, cy = yi + j;
        const h = hash2i(cx, cy, this.seed);
        const px = cx + (h & 0xffff) / 65536, py = cy + ((h >>> 16) & 0xffff) / 65536;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < f1) { f2 = f1; f1 = d; id = h; }
        else if (d < f2) f2 = d;
      }
    }
    return { f1: Math.sqrt(f1), f2: Math.sqrt(f2), id };
  }
}
