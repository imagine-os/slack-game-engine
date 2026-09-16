import { EPSILON } from './scalar';
import type { Vec3Like } from './Vec3';
import { Vec3 } from './Vec3';

/** Plain serializable quaternion shape. */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Unit quaternion representing a 3D rotation. Identity is (0,0,0,1). */
export class Quat implements QuatLike {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}

  static readonly IDENTITY: Readonly<Quat> = Object.freeze(new Quat());

  static from(q: QuatLike): Quat {
    return new Quat(q.x, q.y, q.z, q.w);
  }

  /** Quaternion from an axis (unit) and angle in radians. */
  static fromAxisAngle(axis: Vec3Like, rad: number): Quat {
    return new Quat().setAxisAngle(axis, rad);
  }

  /** Quaternion from Euler angles (radians) applied in ZYX order (yaw-pitch-roll). */
  static fromEuler(x: number, y: number, z: number): Quat {
    return new Quat().setEuler(x, y, z);
  }

  /** Rotation around the Z axis only (the natural 2D rotation). */
  static fromAngle2D(rad: number): Quat {
    return new Quat(0, 0, Math.sin(rad / 2), Math.cos(rad / 2));
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(q: QuatLike): this {
    return this.set(q.x, q.y, q.z, q.w);
  }

  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w);
  }

  identity(): this {
    return this.set(0, 0, 0, 1);
  }

  setAxisAngle(axis: Vec3Like, rad: number): this {
    const h = rad / 2;
    const s = Math.sin(h);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(h));
  }

  setEuler(x: number, y: number, z: number): this {
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);
    // XYZ intrinsic order.
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }

  /** Euler angles (radians, XYZ order) equivalent to this rotation. */
  toEuler(out = new Vec3()): Vec3 {
    const { x, y, z, w } = this;
    const sinrCosp = 2 * (w * x + y * z);
    const cosrCosp = 1 - 2 * (x * x + y * y);
    out.x = Math.atan2(sinrCosp, cosrCosp);
    const sinp = 2 * (w * y - z * x);
    out.y = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
    const sinyCosp = 2 * (w * z + x * y);
    const cosyCosp = 1 - 2 * (y * y + z * z);
    out.z = Math.atan2(sinyCosp, cosyCosp);
    return out;
  }

  /** Rotation angle about Z, useful for 2D. */
  angle2D(): number {
    return Math.atan2(2 * (this.w * this.z + this.x * this.y), 1 - 2 * (this.y * this.y + this.z * this.z));
  }

  /** `this = this * q` (apply q first, then this). */
  multiply(q: QuatLike): this {
    const ax = this.x;
    const ay = this.y;
    const az = this.z;
    const aw = this.w;
    this.x = ax * q.w + aw * q.x + ay * q.z - az * q.y;
    this.y = ay * q.w + aw * q.y + az * q.x - ax * q.z;
    this.z = az * q.w + aw * q.z + ax * q.y - ay * q.x;
    this.w = aw * q.w - ax * q.x - ay * q.y - az * q.z;
    return this;
  }

  /** `this = q * this`. */
  premultiply(q: QuatLike): this {
    const bx = this.x;
    const by = this.y;
    const bz = this.z;
    const bw = this.w;
    this.x = q.x * bw + q.w * bx + q.y * bz - q.z * by;
    this.y = q.y * bw + q.w * by + q.z * bx - q.x * bz;
    this.z = q.z * bw + q.w * bz + q.x * by - q.y * bx;
    this.w = q.w * bw - q.x * bx - q.y * by - q.z * bz;
    return this;
  }

  conjugate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  /** Inverse (for unit quaternions equals conjugate). */
  invert(): this {
    const l2 = this.lengthSq();
    if (l2 < EPSILON) return this.identity();
    const inv = 1 / l2;
    return this.set(-this.x * inv, -this.y * inv, -this.z * inv, this.w * inv);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const l = this.length();
    if (l < EPSILON) return this.identity();
    return this.set(this.x / l, this.y / l, this.z / l, this.w / l);
  }

  dot(q: QuatLike): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  /** Spherical linear interpolation toward `q`. */
  slerp(q: QuatLike, t: number): this {
    let cos = this.dot(q);
    let bx = q.x;
    let by = q.y;
    let bz = q.z;
    let bw = q.w;
    if (cos < 0) {
      cos = -cos;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    let s0: number;
    let s1: number;
    if (1 - cos > EPSILON) {
      const omega = Math.acos(cos);
      const sinO = Math.sin(omega);
      s0 = Math.sin((1 - t) * omega) / sinO;
      s1 = Math.sin(t * omega) / sinO;
    } else {
      s0 = 1 - t;
      s1 = t;
    }
    return this.set(s0 * this.x + s1 * bx, s0 * this.y + s1 * by, s0 * this.z + s1 * bz, s0 * this.w + s1 * bw);
  }

  /** Rotate a vector by this quaternion, writing into `out` (may alias `v`). */
  rotateVec3(v: Vec3Like, out: Vec3): Vec3 {
    const { x: qx, y: qy, z: qz, w: qw } = this;
    const vx = v.x;
    const vy = v.y;
    const vz = v.z;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    // v' = v + w*t + cross(q.xyz, t)
    out.x = vx + qw * tx + (qy * tz - qz * ty);
    out.y = vy + qw * ty + (qz * tx - qx * tz);
    out.z = vz + qw * tz + (qx * ty - qy * tx);
    return out;
  }

  /** Orient so that -Z looks along `dir` with the given up vector. */
  lookRotation(dir: Vec3Like, up: Vec3Like = Vec3.UP): this {
    const f = new Vec3().copy(dir).normalize();
    const r = new Vec3().copy(up).cross(f).normalize();
    if (r.lengthSq() < EPSILON) r.set(1, 0, 0);
    const u = new Vec3().copy(f).cross(r);
    // Build rotation matrix columns: right=r, up=u, back=-f
    const m00 = r.x;
    const m01 = u.x;
    const m02 = -f.x;
    const m10 = r.y;
    const m11 = u.y;
    const m12 = -f.y;
    const m20 = r.z;
    const m21 = u.z;
    const m22 = -f.z;
    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      return this.set((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      return this.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      return this.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
    }
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    return this.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }

  equals(q: QuatLike, eps = EPSILON): boolean {
    return (
      Math.abs(this.x - q.x) <= eps &&
      Math.abs(this.y - q.y) <= eps &&
      Math.abs(this.z - q.z) <= eps &&
      Math.abs(this.w - q.w) <= eps
    );
  }

  toJSON(): QuatLike {
    return { x: this.x, y: this.y, z: this.z, w: this.w };
  }

  toString(): string {
    return `Quat(${this.x}, ${this.y}, ${this.z}, ${this.w})`;
  }
}
