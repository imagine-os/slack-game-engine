import { EPSILON } from './scalar';

/** Plain serializable 3D vector shape. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Mutable 3D vector. Same conventions as {@link Vec2}. */
export class Vec3 implements Vec3Like {
  constructor(public x = 0, public y = 0, public z = 0) {}

  static readonly ZERO: Readonly<Vec3> = Object.freeze(new Vec3(0, 0, 0));
  static readonly ONE: Readonly<Vec3> = Object.freeze(new Vec3(1, 1, 1));
  static readonly UP: Readonly<Vec3> = Object.freeze(new Vec3(0, 1, 0));
  static readonly RIGHT: Readonly<Vec3> = Object.freeze(new Vec3(1, 0, 0));
  static readonly FORWARD: Readonly<Vec3> = Object.freeze(new Vec3(0, 0, -1));

  static from(v: Vec3Like): Vec3 {
    return new Vec3(v.x, v.y, v.z);
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3Like): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addScaled(v: Vec3Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v: Vec3Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  multiply(v: Vec3Like): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  dot(v: Vec3Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** `this = this x v`. */
  cross(v: Vec3Like): this {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return this.set(x, y, z);
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  distanceTo(v: Vec3Like): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  distanceToSq(v: Vec3Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  normalize(): this {
    const l = this.length();
    if (l > EPSILON) {
      this.x /= l;
      this.y /= l;
      this.z /= l;
    } else {
      this.x = this.y = this.z = 0;
    }
    return this;
  }

  limit(max: number): this {
    const l2 = this.lengthSq();
    if (l2 > max * max) this.scale(max / Math.sqrt(l2));
    return this;
  }

  lerp(v: Vec3Like, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  equals(v: Vec3Like, eps = EPSILON): boolean {
    return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps && Math.abs(this.z - v.z) <= eps;
  }

  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  toJSON(): Vec3Like {
    return { x: this.x, y: this.y, z: this.z };
  }

  toString(): string {
    return `Vec3(${this.x}, ${this.y}, ${this.z})`;
  }

  static add(a: Vec3Like, b: Vec3Like, out: Vec3): Vec3 {
    return out.set(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  static sub(a: Vec3Like, b: Vec3Like, out: Vec3): Vec3 {
    return out.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  static scale(a: Vec3Like, s: number, out: Vec3): Vec3 {
    return out.set(a.x * s, a.y * s, a.z * s);
  }

  static cross(a: Vec3Like, b: Vec3Like, out: Vec3): Vec3 {
    return out.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }

  static dot(a: Vec3Like, b: Vec3Like): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static lerp(a: Vec3Like, b: Vec3Like, t: number, out: Vec3): Vec3 {
    return out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }

  static distance(a: Vec3Like, b: Vec3Like): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
}
