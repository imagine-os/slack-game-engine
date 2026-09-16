/**
 * Seedable pseudo-random number generator (Mulberry32).
 *
 * Deterministic given the same seed, which makes it suitable for lockstep
 * multiplayer and reproducible tests. All engine systems that need randomness
 * should accept a `Random` instance rather than calling `Math.random()`.
 */
export class Random {
  private state: number;

  constructor(seed: number = Date.now() >>> 0) {
    this.state = seed >>> 0;
  }

  /** Reseed the generator. */
  seed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Current internal state; store and restore for rollback/replay. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Next unsigned 32-bit integer. */
  nextUint32(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in `[0, 1)`. */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Float in `[min, max)`. */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in `[min, max]` inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** `true` with probability `p`. */
  chance(p = 0.5): boolean {
    return this.next() < p;
  }

  /** -1 or 1. */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Random element of an array (undefined when empty). */
  pick<T>(arr: readonly T[]): T | undefined {
    return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined;
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Approximately normal distribution via Box-Muller. */
  gaussian(mean = 0, stdDev = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** Shared default generator (non-deterministic seed). */
export const defaultRandom = new Random();
