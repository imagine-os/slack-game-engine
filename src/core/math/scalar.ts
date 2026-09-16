/** Scalar math helpers shared across the engine. */

export const EPSILON = 1e-6;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

/** Clamp `v` into `[min, max]`. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Clamp into `[0, 1]`. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Linear interpolation from `a` to `b` by `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp: where does `v` sit between `a` and `b`. */
export function inverseLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Remap `v` from `[inMin, inMax]` to `[outMin, outMax]`. */
export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, v));
}

/** Smoothstep easing between edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Exponential decay toward target, framerate independent (`rate` ~ 1..25). */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Wrap an angle into `(-PI, PI]`. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Shortest-path angular lerp in radians. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export function approximately(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) <= eps;
}

/** Signed floating modulo that always returns a value in `[0, n)`. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function degToRad(d: number): number {
  return d * DEG2RAD;
}

export function radToDeg(r: number): number {
  return r * RAD2DEG;
}
