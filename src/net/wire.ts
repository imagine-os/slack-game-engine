/**
 * Binary wire helpers shared by transports and sync implementations: a
 * growable little-endian writer, a matching reader, quantization helpers and
 * smallest-three quaternion packing. Writers are meant to be reused across
 * ticks (`reset()`) so the hot path does not allocate.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Growable little-endian byte writer. Reuse one instance per stream. */
export class ByteWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  /** Current write offset. */
  offset = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  /** Rewind to the start (keeps the allocated buffer). */
  reset(): this {
    this.offset = 0;
    return this;
  }

  get capacity(): number {
    return this.buffer.byteLength;
  }

  private ensure(extra: number): void {
    const need = this.offset + extra;
    if (need <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength * 2;
    while (size < need) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.bytes.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  u8(v: number): this { this.ensure(1); this.view.setUint8(this.offset, v); this.offset += 1; return this; }
  i8(v: number): this { this.ensure(1); this.view.setInt8(this.offset, v); this.offset += 1; return this; }
  u16(v: number): this { this.ensure(2); this.view.setUint16(this.offset, v, true); this.offset += 2; return this; }
  i16(v: number): this { this.ensure(2); this.view.setInt16(this.offset, v, true); this.offset += 2; return this; }
  u32(v: number): this { this.ensure(4); this.view.setUint32(this.offset, v >>> 0, true); this.offset += 4; return this; }
  i32(v: number): this { this.ensure(4); this.view.setInt32(this.offset, v | 0, true); this.offset += 4; return this; }
  f32(v: number): this { this.ensure(4); this.view.setFloat32(this.offset, v, true); this.offset += 4; return this; }
  f64(v: number): this { this.ensure(8); this.view.setFloat64(this.offset, v, true); this.offset += 8; return this; }

  /** Unsigned LEB128 varint (values up to 2^53). */
  varint(v: number): this {
    v = Math.max(0, Math.floor(v));
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    return this.u8(v);
  }

  /** Signed varint (zig-zag). */
  svarint(v: number): this {
    v = Math.trunc(v);
    return this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  /** UTF-8 string with a varint length prefix (max ~4 GB, practically short). */
  string(s: string): this {
    const enc = textEncoder.encode(s);
    this.varint(enc.length);
    this.ensure(enc.length);
    this.bytes.set(enc, this.offset);
    this.offset += enc.length;
    return this;
  }

  /** Raw bytes with a varint length prefix. */
  blob(b: Uint8Array): this {
    this.varint(b.byteLength);
    return this.raw(b);
  }

  /** Raw bytes, no prefix. */
  raw(b: Uint8Array): this {
    this.ensure(b.byteLength);
    this.bytes.set(b, this.offset);
    this.offset += b.byteLength;
    return this;
  }

  /** Overwrite a previously written u16 at `at` (for length back-patching). */
  patchU16(at: number, v: number): void {
    this.view.setUint16(at, v, true);
  }

  patchU32(at: number, v: number): void {
    this.view.setUint32(at, v >>> 0, true);
  }

  /** View of the written bytes (shares the buffer; copy with {@link toBytes} to keep it). */
  view8(): Uint8Array {
    return this.bytes.subarray(0, this.offset);
  }

  /** Copy of the written bytes. */
  toBytes(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }
}

/** Little-endian reader over a byte array. */
export class ByteReader {
  private view: DataView;
  private bytes: Uint8Array;
  offset = 0;

  constructor(data: Uint8Array | ArrayBuffer) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  /** Point the reader at a new buffer (reuse the instance). */
  reset(data: Uint8Array | ArrayBuffer): this {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
    return this;
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  u8(): number { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  i8(): number { const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  i32(): number { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  f32(): number { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  f64(): number { const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }

  varint(): number {
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = this.u8();
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 128;
    }
  }

  svarint(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  string(): string {
    const len = this.varint();
    const s = textDecoder.decode(this.bytes.subarray(this.offset, this.offset + len));
    this.offset += len;
    return s;
  }

  blob(): Uint8Array {
    const len = this.varint();
    const b = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return b;
  }

  /** Remaining bytes (shared view). */
  rest(): Uint8Array {
    const b = this.bytes.subarray(this.offset);
    this.offset = this.bytes.byteLength;
    return b;
  }
}

// ----------------------------------------------------------------- quantize

/** Quantize a float to an integer with `step` units (e.g. 0.001). */
export function quantize(v: number, step: number): number {
  return Math.round(v / step);
}

export function dequantize(q: number, step: number): number {
  return q * step;
}

/** Clamp to the i16 range. */
export function clampI16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0;
}

/**
 * Smallest-three quaternion packing: drop the largest component (its sign is
 * normalised positive) and store the other three as i16 in −1/√2..1/√2.
 * Returns the number of ints written into `out` (always 4: index + 3).
 */
export function packQuat(x: number, y: number, z: number, w: number, out: Int32Array, at = 0): void {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z), aw = Math.abs(w);
  let idx = 3, max = aw;
  if (ax > max) { idx = 0; max = ax; }
  if (ay > max) { idx = 1; max = ay; }
  if (az > max) { idx = 2; max = az; }
  const c = [x, y, z, w];
  const sign = c[idx] < 0 ? -1 : 1;
  const scale = 32767 / 0.7071068;
  out[at] = idx;
  let k = at + 1;
  for (let i = 0; i < 4; i++) {
    if (i === idx) continue;
    out[k++] = clampI16(Math.round(c[i] * sign * scale));
  }
}

/** Inverse of {@link packQuat}; writes x,y,z,w into `out` at `at`. */
export function unpackQuat(ints: ArrayLike<number>, at: number, out: { x: number; y: number; z: number; w: number }): void {
  const idx = ints[at];
  const scale = 0.7071068 / 32767;
  const c = [0, 0, 0, 0];
  let k = at + 1;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === idx) continue;
    const v = ints[k++] * scale;
    c[i] = v;
    sum += v * v;
  }
  c[idx] = Math.sqrt(Math.max(0, 1 - sum));
  out.x = c[0]; out.y = c[1]; out.z = c[2]; out.w = c[3];
}

/** Encode a UTF-8 string to bytes. */
export function utf8Encode(s: string): Uint8Array {
  return textEncoder.encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return textDecoder.decode(b);
}

/** Normalise any binary payload to a Uint8Array view (no copy when possible). */
export function toU8(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** True for binary payloads (ArrayBuffer or typed array view). */
export function isBinary(data: unknown): data is ArrayBuffer | Uint8Array {
  return data instanceof ArrayBuffer || data instanceof Uint8Array;
}
