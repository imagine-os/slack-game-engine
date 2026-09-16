import type { Vec3Like } from './Vec3';
import { Vec3 } from './Vec3';
import type { QuatLike } from './Quat';
import { Quat } from './Quat';

/**
 * 4x4 column-major matrix backed by a `Float32Array` (WebGL-ready).
 * Element (row r, col c) lives at index `c * 4 + r`.
 */
export class Mat4 {
  readonly m: Float32Array;

  constructor(values?: ArrayLike<number>) {
    this.m = new Float32Array(16);
    if (values) this.m.set(values);
    else this.identity();
  }

  static identity(): Mat4 {
    return new Mat4();
  }

  identity(): this {
    const m = this.m;
    m.fill(0);
    m[0] = m[5] = m[10] = m[15] = 1;
    return this;
  }

  copy(o: Mat4): this {
    this.m.set(o.m);
    return this;
  }

  clone(): Mat4 {
    return new Mat4(this.m);
  }

  /** `this = a * b`. `out` may alias either operand. */
  static multiply(a: Mat4, b: Mat4, out: Mat4): Mat4 {
    const am = a.m;
    const bm = b.m;
    const o = out.m;
    const a00 = am[0], a01 = am[1], a02 = am[2], a03 = am[3];
    const a10 = am[4], a11 = am[5], a12 = am[6], a13 = am[7];
    const a20 = am[8], a21 = am[9], a22 = am[10], a23 = am[11];
    const a30 = am[12], a31 = am[13], a32 = am[14], a33 = am[15];
    for (let c = 0; c < 4; c++) {
      const b0 = bm[c * 4];
      const b1 = bm[c * 4 + 1];
      const b2 = bm[c * 4 + 2];
      const b3 = bm[c * 4 + 3];
      o[c * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[c * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return out;
  }

  /** `this = this * o`. */
  multiply(o: Mat4): this {
    Mat4.multiply(this, o, this);
    return this;
  }

  /** `this = o * this`. */
  premultiply(o: Mat4): this {
    Mat4.multiply(o, this, this);
    return this;
  }

  /** Compose translation * rotation * scale. */
  compose(pos: Vec3Like, rot: QuatLike, scale: Vec3Like): this {
    const { x, y, z, w } = rot;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    const m = this.m;
    m[0] = (1 - (yy + zz)) * sx;
    m[1] = (xy + wz) * sx;
    m[2] = (xz - wy) * sx;
    m[3] = 0;
    m[4] = (xy - wz) * sy;
    m[5] = (1 - (xx + zz)) * sy;
    m[6] = (yz + wx) * sy;
    m[7] = 0;
    m[8] = (xz + wy) * sz;
    m[9] = (yz - wx) * sz;
    m[10] = (1 - (xx + yy)) * sz;
    m[11] = 0;
    m[12] = pos.x;
    m[13] = pos.y;
    m[14] = pos.z;
    m[15] = 1;
    return this;
  }

  /** Decompose into translation, rotation and scale. */
  decompose(pos: Vec3, rot: Quat, scale: Vec3): this {
    const m = this.m;
    let sx = Math.hypot(m[0], m[1], m[2]);
    const sy = Math.hypot(m[4], m[5], m[6]);
    const sz = Math.hypot(m[8], m[9], m[10]);
    if (this.determinant() < 0) sx = -sx;
    pos.set(m[12], m[13], m[14]);
    scale.set(sx, sy, sz);
    const isx = sx === 0 ? 0 : 1 / sx;
    const isy = sy === 0 ? 0 : 1 / sy;
    const isz = sz === 0 ? 0 : 1 / sz;
    const r00 = m[0] * isx, r01 = m[4] * isy, r02 = m[8] * isz;
    const r10 = m[1] * isx, r11 = m[5] * isy, r12 = m[9] * isz;
    const r20 = m[2] * isx, r21 = m[6] * isy, r22 = m[10] * isz;
    const trace = r00 + r11 + r22;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      rot.set((r21 - r12) * s, (r02 - r20) * s, (r10 - r01) * s, 0.25 / s);
    } else if (r00 > r11 && r00 > r22) {
      const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
      rot.set(0.25 * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s);
    } else if (r11 > r22) {
      const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
      rot.set((r01 + r10) / s, 0.25 * s, (r12 + r21) / s, (r02 - r20) / s);
    } else {
      const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
      rot.set((r02 + r20) / s, (r12 + r21) / s, 0.25 * s, (r10 - r01) / s);
    }
    return this;
  }

  determinant(): number {
    const m = this.m;
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  }

  /** Invert in place. Leaves identity when singular. */
  invert(): this {
    const m = this.m;
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return this.identity();
    det = 1 / det;
    m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return this;
  }

  transpose(): this {
    const m = this.m;
    let t: number;
    t = m[1]; m[1] = m[4]; m[4] = t;
    t = m[2]; m[2] = m[8]; m[8] = t;
    t = m[3]; m[3] = m[12]; m[12] = t;
    t = m[6]; m[6] = m[9]; m[9] = t;
    t = m[7]; m[7] = m[13]; m[13] = t;
    t = m[11]; m[11] = m[14]; m[14] = t;
    return this;
  }

  setTranslation(v: Vec3Like): this {
    this.identity();
    this.m[12] = v.x;
    this.m[13] = v.y;
    this.m[14] = v.z;
    return this;
  }

  setScale(v: Vec3Like): this {
    this.identity();
    this.m[0] = v.x;
    this.m[5] = v.y;
    this.m[10] = v.z;
    return this;
  }

  setRotation(q: QuatLike): this {
    return this.compose(Vec3.ZERO, q, Vec3.ONE);
  }

  getTranslation(out: Vec3): Vec3 {
    return out.set(this.m[12], this.m[13], this.m[14]);
  }

  /** Right-handed perspective projection (OpenGL clip space, -1..1 depth). */
  perspective(fovYRad: number, aspect: number, near: number, far: number): this {
    const f = 1 / Math.tan(fovYRad / 2);
    const nf = 1 / (near - far);
    const m = this.m;
    m.fill(0);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return this;
  }

  orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): this {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    const m = this.m;
    m.fill(0);
    m[0] = -2 * lr;
    m[5] = -2 * bt;
    m[10] = 2 * nf;
    m[12] = (left + right) * lr;
    m[13] = (top + bottom) * bt;
    m[14] = (far + near) * nf;
    m[15] = 1;
    return this;
  }

  /** View matrix looking from `eye` toward `target`. */
  lookAt(eye: Vec3Like, target: Vec3Like, up: Vec3Like = Vec3.UP): this {
    const zx0 = eye.x - target.x;
    const zy0 = eye.y - target.y;
    const zz0 = eye.z - target.z;
    let len = Math.hypot(zx0, zy0, zz0);
    if (len === 0) return this.identity();
    const zx = zx0 / len, zy = zy0 / len, zz = zz0 / len;
    let xx = up.y * zz - up.z * zy;
    let xy = up.z * zx - up.x * zz;
    let xz = up.x * zy - up.y * zx;
    len = Math.hypot(xx, xy, xz);
    if (len === 0) {
      xx = 1; xy = 0; xz = 0;
    } else {
      xx /= len; xy /= len; xz /= len;
    }
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const m = this.m;
    m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
    m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
    m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
    m[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
    m[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
    m[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
    m[15] = 1;
    return this;
  }

  /** Transform a point (w = 1) writing into `out`. */
  transformPoint(v: Vec3Like, out: Vec3): Vec3 {
    const m = this.m;
    const x = v.x, y = v.y, z = v.z;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    out.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    out.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return out;
  }

  /** Transform a direction (w = 0). */
  transformDirection(v: Vec3Like, out: Vec3): Vec3 {
    const m = this.m;
    const x = v.x, y = v.y, z = v.z;
    out.x = m[0] * x + m[4] * y + m[8] * z;
    out.y = m[1] * x + m[5] * y + m[9] * z;
    out.z = m[2] * x + m[6] * y + m[10] * z;
    return out;
  }

  /** Upper 3x3 as a normal matrix (inverse-transpose) into a 9-float array. */
  normalMatrix(out: Float32Array): Float32Array {
    const inv = _tmp.copy(this).invert();
    const m = inv.m;
    out[0] = m[0]; out[1] = m[4]; out[2] = m[8];
    out[3] = m[1]; out[4] = m[5]; out[5] = m[9];
    out[6] = m[2]; out[7] = m[6]; out[8] = m[10];
    return out;
  }

  equals(o: Mat4, eps = 1e-5): boolean {
    for (let i = 0; i < 16; i++) if (Math.abs(this.m[i] - o.m[i]) > eps) return false;
    return true;
  }

  toArray(): number[] {
    return Array.from(this.m);
  }
}

const _tmp = new Mat4();
