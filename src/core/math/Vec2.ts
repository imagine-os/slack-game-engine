import { EPSILON } from './scalar';

/** Plain serializable 2D vector shape. */
export interface Vec2Like {
  x: number;
  y: number;
}

/**
 * Mutable 2D vector. Methods ending without `To` mutate `this` and return it
 * for chaining; static helpers write into an `out` parameter to avoid
 * allocations in hot loops.
 */
export class Vec2 implements Vec2Like {
  constructor(public x = 0, public y = 0) {}

  static readonly ZERO: Readonly<Vec2> = Object.freeze(new Vec2(0, 0));
  static readonly ONE: Readonly<Vec2> = Object.freeze(new Vec2(1, 1));
  static readonly UP: Readonly<Vec2> = Object.freeze(new Vec2(0, 1));
  static readonly RIGHT: Readonly<Vec2> = Object.freeze(new Vec2(1, 0));

  static from(v: Vec2Like): Vec2 {
    return new Vec2(v.x, v.y);
  }

  static fromAngle(rad: number, length = 1): Vec2 {
    return new Vec2(Math.cos(rad) * length, Math.sin(rad) * length);
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(v: Vec2Like): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  add(v: Vec2Like): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  addScaled(v: Vec2Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  sub(v: Vec2Like): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  multiply(v: Vec2Like): this {
    this.x *= v.x;
    this.y *= v.y;
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  }

  dot(v: Vec2Like): number {
    return this.x * v.x + this.y * v.y;
  }

  /** 2D cross product (z component of the 3D cross). */
  cross(v: Vec2Like): number {
    return this.x * v.y - this.y * v.x;
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  distanceTo(v: Vec2Like): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  distanceToSq(v: Vec2Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  normalize(): this {
    const l = this.length();
    if (l > EPSILON) {
      this.x /= l;
      this.y /= l;
    } else {
      this.x = 0;
      this.y = 0;
    }
    return this;
  }

  /** Clamp length to at most `max`. */
  limit(max: number): this {
    const l2 = this.lengthSq();
    if (l2 > max * max) {
      const s = max / Math.sqrt(l2);
      this.x *= s;
      this.y *= s;
    }
    return this;
  }

  /** Perpendicular (rotated +90 degrees). */
  perp(): this {
    const x = this.x;
    this.x = -this.y;
    this.y = x;
    return this;
  }

  rotate(rad: number): this {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const x = this.x * c - this.y * s;
    const y = this.x * s + this.y * c;
    this.x = x;
    this.y = y;
    return this;
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  lerp(v: Vec2Like, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    return this;
  }

  equals(v: Vec2Like, eps = EPSILON): boolean {
    return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps;
  }

  toArray(): [number, number] {
    return [this.x, this.y];
  }

  toJSON(): Vec2Like {
    return { x: this.x, y: this.y };
  }

  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }

  // ---- allocation-free statics ----

  static add(a: Vec2Like, b: Vec2Like, out: Vec2): Vec2 {
    return out.set(a.x + b.x, a.y + b.y);
  }

  static sub(a: Vec2Like, b: Vec2Like, out: Vec2): Vec2 {
    return out.set(a.x - b.x, a.y - b.y);
  }

  static scale(a: Vec2Like, s: number, out: Vec2): Vec2 {
    return out.set(a.x * s, a.y * s);
  }

  static lerp(a: Vec2Like, b: Vec2Like, t: number, out: Vec2): Vec2 {
    return out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  static dot(a: Vec2Like, b: Vec2Like): number {
    return a.x * b.x + a.y * b.y;
  }

  static cross(a: Vec2Like, b: Vec2Like): number {
    return a.x * b.y - a.y * b.x;
  }

  static distance(a: Vec2Like, b: Vec2Like): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Reflect `v` about normal `n` (n must be unit). */
  static reflect(v: Vec2Like, n: Vec2Like, out: Vec2): Vec2 {
    const d = 2 * (v.x * n.x + v.y * n.y);
    return out.set(v.x - n.x * d, v.y - n.y * d);
  }
}
