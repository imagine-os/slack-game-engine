/**
 * Renderer-independent mesh construction for the low-poly look: triangles are
 * appended unwelded (three vertices each) with a colour and a material group,
 * so `build()` gives flat-shaded geometry with per-vertex colours and
 * `buildGroups()` splits the same geometry into one mesh per colour group for
 * renderers without vertex-colour support.
 */
import type { Vec3Like } from '../core/math/Vec3';
import type { Mat4 } from '../core/math/Mat4';
import type { Random } from '../core/math/Random';
import type { MeshData } from '../render/webgl/Mesh';

/** Colour with 0..1 float channels (no alpha). */
export interface RGB { r: number; g: number; b: number }

/** Axis-aligned bounds. */
export interface Bounds { min: Vec3Like; max: Vec3Like }

/**
 * Mesh data produced by the procgen library: the renderer's `MeshData` plus
 * per-vertex RGB colours, bounds and an optional per-vertex weight channel
 * (wind sway amount for foliage, `0` = rigid, `1` = tip of a branch).
 */
export interface ProcMeshData extends MeshData {
  colors: Float32Array;
  bounds: Bounds;
  weights?: Float32Array;
}

/** Material hints a group carries for the renderer (applied to `MeshRenderer` fields when present). */
export interface MaterialHint {
  emissive?: RGB;
  emissiveStrength?: number;
  opacity?: number;
  unlit?: boolean;
  /** Wind sway strength for the renderer's wind material (0 = rigid). */
  wind?: number;
  /** Render with the stylized water material when available. */
  water?: boolean;
  doubleSided?: boolean;
  roughness?: number;
  metallic?: number;
}

/** One colour group of a generated object: a mesh drawn with a single material colour. */
export interface MeshGroup extends MaterialHint {
  name: string;
  color: RGB;
  data: ProcMeshData;
  triangles: number;
}

/** Result of a generator: the merged coloured mesh plus per-material groups. */
export interface GeneratedMesh {
  mesh: ProcMeshData;
  groups: MeshGroup[];
}

interface GroupDef extends MaterialHint { name: string; color: RGB }

const _tmp = { x: 0, y: 0, z: 0 };

/** Parse `#rrggbb` into an {@link RGB}. */
export function rgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** `#rrggbb` from an {@link RGB}. */
export function rgbToHex(c: RGB): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Multiply brightness (`k < 1` darkens, `k > 1` lightens, clamped). */
export function shade(c: RGB, k: number): RGB {
  return { r: Math.min(1, c.r * k), g: Math.min(1, c.g * k), b: Math.min(1, c.b * k) };
}

/** Colour stop for {@link gradient}. */
export interface ColorStop { t: number; color: RGB }

/** Piecewise-linear gradient lookup (stops sorted by `t`). */
export function gradient(stops: readonly ColorStop[], t: number): RGB {
  if (stops.length === 0) return { r: 1, g: 1, b: 1 };
  if (t <= stops[0].t) return { ...stops[0].color };
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1], b = stops[i];
      return mixRGB(a.color, b.color, (t - a.t) / Math.max(1e-6, b.t - a.t));
    }
  }
  return { ...stops[stops.length - 1].color };
}

/** Random brightness / hue jitter per face, the signature of hand-painted low poly. */
export function jitterColor(c: RGB, rng: Random, amount = 0.08, hueAmount = amount * 0.4): RGB {
  const k = 1 + rng.range(-amount, amount);
  const hr = rng.range(-hueAmount, hueAmount), hb = rng.range(-hueAmount, hueAmount);
  return { r: Math.min(1, Math.max(0, c.r * k + hr)), g: Math.min(1, Math.max(0, c.g * k)), b: Math.min(1, Math.max(0, c.b * k + hb)) };
}

/** Remap a value from one range to another (unclamped). */
function remap(v: number, a: number, b: number, c: number, d: number): number {
  return c + ((v - a) / (b - a || 1)) * (d - c);
}

/**
 * Appends triangles and emits {@link ProcMeshData}. Triangles keep their
 * material group so the same geometry can be split per colour.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private wgt: number[] = [];
  /** Group index per triangle. */
  private grp: number[] = [];
  private groups: GroupDef[] = [];
  private current = 0;
  /** Weight written for vertices appended from now on. */
  weight = 0;

  constructor() {
    this.groups.push({ name: 'default', color: { r: 0.8, g: 0.8, b: 0.85 } });
  }

  /** Register a material group (or reuse one with the same name) and make it current. */
  group(name: string, color: RGB, hint: MaterialHint = {}): number {
    let i = this.groups.findIndex((g) => g.name === name);
    if (i < 0) { this.groups.push({ name, color, ...hint }); i = this.groups.length - 1; }
    else this.groups[i] = { ...this.groups[i], color, ...hint };
    this.current = i;
    return i;
  }

  /** Switch the current group by index or name. */
  useGroup(g: number | string): this {
    this.current = typeof g === 'number' ? g : Math.max(0, this.groups.findIndex((x) => x.name === g));
    return this;
  }

  get currentGroup(): number { return this.current; }
  get currentColor(): RGB { return this.groups[this.current].color; }
  get triangleCount(): number { return this.grp.length; }
  get vertexCount(): number { return this.pos.length / 3; }

  private push(p: Vec3Like, c: RGB): void {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    this.wgt.push(this.weight);
  }

  /** Append one triangle (counter-clockwise seen from outside). */
  tri(a: Vec3Like, b: Vec3Like, c: Vec3Like, color: RGB = this.currentColor): this {
    this.push(a, color); this.push(b, color); this.push(c, color);
    this.grp.push(this.current);
    return this;
  }

  /** Triangle with a colour per vertex (gradients across a face). */
  triColored(a: Vec3Like, b: Vec3Like, c: Vec3Like, ca: RGB, cb: RGB, cc: RGB): this {
    this.push(a, ca); this.push(b, cb); this.push(c, cc);
    this.grp.push(this.current);
    return this;
  }

  /** Append a quad as two triangles (a, b, c, d counter-clockwise from outside). */
  quad(a: Vec3Like, b: Vec3Like, c: Vec3Like, d: Vec3Like, color: RGB = this.currentColor): this {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
    return this;
  }

  /** Append indexed mesh data (unwelded), optionally transformed and recoloured. */
  addMesh(data: MeshData, opts: { matrix?: Mat4 | null; color?: RGB; group?: number } = {}): this {
    const g = opts.group ?? this.current;
    const prev = this.current;
    this.current = g;
    const p = data.positions, idx = data.indices;
    const colors = (data as Partial<ProcMeshData>).colors;
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 }, c = { x: 0, y: 0, z: 0 };
    const read = (i: number, out: Vec3Like) => {
      out.x = p[i * 3]; out.y = p[i * 3 + 1]; out.z = p[i * 3 + 2];
      if (opts.matrix) opts.matrix.transformPoint(out, out as never);
    };
    const colorOf = (i: number): RGB => opts.color ?? (colors ? { r: colors[i * 3], g: colors[i * 3 + 1], b: colors[i * 3 + 2] } : this.groups[g].color);
    for (let i = 0; i < idx.length; i += 3) {
      read(idx[i], a); read(idx[i + 1], b); read(idx[i + 2], c);
      this.triColored(a, b, c, colorOf(idx[i]), colorOf(idx[i + 1]), colorOf(idx[i + 2]));
    }
    this.current = prev;
    return this;
  }

  /** Merge another builder (its groups are re-created here by name). */
  addBuilder(other: MeshBuilder, matrix?: Mat4 | null): this {
    const map = other.groups.map((g) => { const { name, color, ...hint } = g; const prev = this.current; const id = this.group(name, color, hint); this.current = prev; return id; });
    const n = other.grp.length;
    const v = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = t * 3 + k;
        v.x = other.pos[vi * 3]; v.y = other.pos[vi * 3 + 1]; v.z = other.pos[vi * 3 + 2];
        if (matrix) matrix.transformPoint(v, v as never);
        this.pos.push(v.x, v.y, v.z);
        this.col.push(other.col[vi * 3], other.col[vi * 3 + 1], other.col[vi * 3 + 2]);
        this.wgt.push(other.wgt[vi]);
      }
      this.grp.push(map[other.grp[t]]);
    }
    return this;
  }

  // ------------------------------------------------------------ transforms

  /** Apply a matrix to every vertex appended so far. */
  transform(m: Mat4): this {
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) {
      _tmp.x = p[i]; _tmp.y = p[i + 1]; _tmp.z = p[i + 2];
      m.transformPoint(_tmp, _tmp as never);
      p[i] = _tmp.x; p[i + 1] = _tmp.y; p[i + 2] = _tmp.z;
    }
    return this;
  }

  translate(x: number, y: number, z: number): this {
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) { p[i] += x; p[i + 1] += y; p[i + 2] += z; }
    return this;
  }

  scale(x: number, y = x, z = x): this {
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) { p[i] *= x; p[i + 1] *= y; p[i + 2] *= z; }
    if (x * y * z < 0) this.flipWinding();
    return this;
  }

  rotateY(rad: number): this {
    const c = Math.cos(rad), s = Math.sin(rad), p = this.pos;
    for (let i = 0; i < p.length; i += 3) { const x = p[i], z = p[i + 2]; p[i] = x * c + z * s; p[i + 2] = -x * s + z * c; }
    return this;
  }

  rotateX(rad: number): this {
    const c = Math.cos(rad), s = Math.sin(rad), p = this.pos;
    for (let i = 0; i < p.length; i += 3) { const y = p[i + 1], z = p[i + 2]; p[i + 1] = y * c - z * s; p[i + 2] = y * s + z * c; }
    return this;
  }

  rotateZ(rad: number): this {
    const c = Math.cos(rad), s = Math.sin(rad), p = this.pos;
    for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1]; p[i] = x * c - y * s; p[i + 1] = x * s + y * c; }
    return this;
  }

  /** Displace every vertex through a function (in place). */
  displace(fn: (p: Vec3Like, index: number) => void): this {
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) {
      _tmp.x = p[i]; _tmp.y = p[i + 1]; _tmp.z = p[i + 2];
      fn(_tmp, i / 3);
      p[i] = _tmp.x; p[i + 1] = _tmp.y; p[i + 2] = _tmp.z;
    }
    return this;
  }

  /** Reverse triangle winding (after mirroring). */
  flipWinding(): this {
    const p = this.pos, c = this.col, w = this.wgt;
    for (let t = 0; t < this.grp.length; t++) {
      const i1 = (t * 3 + 1) * 3, i2 = (t * 3 + 2) * 3;
      for (let k = 0; k < 3; k++) { const tp = p[i1 + k]; p[i1 + k] = p[i2 + k]; p[i2 + k] = tp; const tc = c[i1 + k]; c[i1 + k] = c[i2 + k]; c[i2 + k] = tc; }
      const tw = w[t * 3 + 1]; w[t * 3 + 1] = w[t * 3 + 2]; w[t * 3 + 2] = tw;
    }
    return this;
  }

  /** Flip triangles whose normal points toward `center` (fix winding of closed shapes). */
  ensureOutward(center: Vec3Like = { x: 0, y: 0, z: 0 }): this {
    const p = this.pos;
    for (let t = 0; t < this.grp.length; t++) {
      const o = t * 9;
      const ax = p[o], ay = p[o + 1], az = p[o + 2];
      const bx = p[o + 3] - ax, by = p[o + 4] - ay, bz = p[o + 5] - az;
      const cx = p[o + 6] - ax, cy = p[o + 7] - ay, cz = p[o + 8] - az;
      const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const mx = (ax + p[o + 3] + p[o + 6]) / 3 - center.x, my = (ay + p[o + 4] + p[o + 7]) / 3 - center.y, mz = (az + p[o + 5] + p[o + 8]) / 3 - center.z;
      if (nx * mx + ny * my + nz * mz < 0) {
        for (let k = 0; k < 3; k++) { const tp = p[o + 3 + k]; p[o + 3 + k] = p[o + 6 + k]; p[o + 6 + k] = tp; }
        const c = this.col;
        for (let k = 0; k < 3; k++) { const tc = c[o + 3 + k]; c[o + 3 + k] = c[o + 6 + k]; c[o + 6 + k] = tc; }
      }
    }
    return this;
  }

  // --------------------------------------------------------------- colours

  /** Per-face colour jitter (all three vertices of a face get the same offset). */
  jitter(rng: Random, amount = 0.08, hueAmount = amount * 0.4, fromTriangle = 0): this {
    const c = this.col;
    for (let t = fromTriangle; t < this.grp.length; t++) {
      const k = 1 + rng.range(-amount, amount);
      const hr = rng.range(-hueAmount, hueAmount), hb = rng.range(-hueAmount, hueAmount);
      for (let v = 0; v < 3; v++) {
        const o = (t * 3 + v) * 3;
        c[o] = Math.min(1, Math.max(0, c[o] * k + hr));
        c[o + 1] = Math.min(1, Math.max(0, c[o + 1] * k));
        c[o + 2] = Math.min(1, Math.max(0, c[o + 2] * k + hb));
      }
    }
    return this;
  }

  /** Recolour vertices by height through a gradient (`t` = 0 at `minY`, 1 at `maxY`). */
  gradientByHeight(stops: readonly ColorStop[], minY?: number, maxY?: number, fromTriangle = 0): this {
    const b = this.bounds();
    const lo = minY ?? b.min.y, hi = maxY ?? b.max.y;
    const p = this.pos, c = this.col;
    for (let v = fromTriangle * 3; v < p.length / 3; v++) {
      const t = Math.min(1, Math.max(0, remap(p[v * 3 + 1], lo, hi, 0, 1)));
      const g = gradient(stops, t);
      c[v * 3] = g.r; c[v * 3 + 1] = g.g; c[v * 3 + 2] = g.b;
    }
    return this;
  }

  /** Recolour faces by a function of the face normal and centroid (slope-based grass/rock). */
  colorFaces(fn: (normal: Vec3Like, centroid: Vec3Like, group: number) => RGB | null, fromTriangle = 0): this {
    const p = this.pos, c = this.col;
    const n = { x: 0, y: 0, z: 0 }, m = { x: 0, y: 0, z: 0 };
    for (let t = fromTriangle; t < this.grp.length; t++) {
      this.faceNormal(t, n);
      const o = t * 9;
      m.x = (p[o] + p[o + 3] + p[o + 6]) / 3; m.y = (p[o + 1] + p[o + 4] + p[o + 7]) / 3; m.z = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
      const col = fn(n, m, this.grp[t]);
      if (!col) continue;
      for (let v = 0; v < 3; v++) { const q = (t * 3 + v) * 3; c[q] = col.r; c[q + 1] = col.g; c[q + 2] = col.b; }
    }
    return this;
  }

  /** Reassign the group of faces selected by a predicate (e.g. steep faces → rock). */
  regroupFaces(fn: (normal: Vec3Like, centroid: Vec3Like, group: number) => number | null, fromTriangle = 0): this {
    const p = this.pos;
    const n = { x: 0, y: 0, z: 0 }, m = { x: 0, y: 0, z: 0 };
    for (let t = fromTriangle; t < this.grp.length; t++) {
      this.faceNormal(t, n);
      const o = t * 9;
      m.x = (p[o] + p[o + 3] + p[o + 6]) / 3; m.y = (p[o + 1] + p[o + 4] + p[o + 7]) / 3; m.z = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
      const g = fn(n, m, this.grp[t]);
      if (g !== null) this.grp[t] = g;
    }
    return this;
  }

  private faceNormal(t: number, out: Vec3Like): void {
    const p = this.pos, o = t * 9;
    const bx = p[o + 3] - p[o], by = p[o + 4] - p[o + 1], bz = p[o + 5] - p[o + 2];
    const cx = p[o + 6] - p[o], cy = p[o + 7] - p[o + 1], cz = p[o + 8] - p[o + 2];
    let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    out.x = nx; out.y = ny; out.z = nz;
  }

  // ----------------------------------------------------------------- output

  bounds(): Bounds {
    const p = this.pos;
    const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < min.x) min.x = p[i]; if (p[i] > max.x) max.x = p[i];
      if (p[i + 1] < min.y) min.y = p[i + 1]; if (p[i + 1] > max.y) max.y = p[i + 1];
      if (p[i + 2] < min.z) min.z = p[i + 2]; if (p[i + 2] > max.z) max.z = p[i + 2];
    }
    if (p.length === 0) { min.x = min.y = min.z = 0; max.x = max.y = max.z = 0; }
    return { min, max };
  }

  /**
   * Emit mesh data. Flat shading by default (one normal per face); `smooth`
   * averages normals across vertices that share a position.
   */
  build(opts: { smooth?: boolean; name?: string; smoothAngle?: number } = {}): ProcMeshData {
    return this.emit(this.grp.map((_, i) => i), opts);
  }

  /** One mesh per material group (groups without triangles are skipped). */
  buildGroups(opts: { smooth?: boolean } = {}): MeshGroup[] {
    const out: MeshGroup[] = [];
    for (let g = 0; g < this.groups.length; g++) {
      const tris: number[] = [];
      for (let t = 0; t < this.grp.length; t++) if (this.grp[t] === g) tris.push(t);
      if (tris.length === 0) continue;
      const { name, color, ...hint } = this.groups[g];
      out.push({ name, color, ...hint, data: this.emit(tris, { ...opts, name }), triangles: tris.length });
    }
    return out;
  }

  /** Merged mesh plus groups. */
  buildAll(opts: { smooth?: boolean; name?: string } = {}): GeneratedMesh {
    return { mesh: this.build(opts), groups: this.buildGroups(opts) };
  }

  private emit(tris: readonly number[], opts: { smooth?: boolean; name?: string }): ProcMeshData {
    const n = tris.length * 3;
    const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), colors = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
    const weights = new Float32Array(n);
    const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
    let hasWeights = false;
    for (let k = 0; k < tris.length; k++) {
      const t = tris[k], src = t * 9, dst = k * 9;
      for (let i = 0; i < 9; i++) { positions[dst + i] = this.pos[src + i]; colors[dst + i] = this.col[src + i]; }
      for (let v = 0; v < 3; v++) { const w = this.wgt[t * 3 + v]; weights[k * 3 + v] = w; if (w !== 0) hasWeights = true; }
      const ax = positions[dst], ay = positions[dst + 1], az = positions[dst + 2];
      const bx = positions[dst + 3] - ax, by = positions[dst + 4] - ay, bz = positions[dst + 5] - az;
      const cx = positions[dst + 6] - ax, cy = positions[dst + 7] - ay, cz = positions[dst + 8] - az;
      let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let v = 0; v < 3; v++) {
        normals[dst + v * 3] = nx; normals[dst + v * 3 + 1] = ny; normals[dst + v * 3 + 2] = nz;
        const px = positions[dst + v * 3], py = positions[dst + v * 3 + 1], pz = positions[dst + v * 3 + 2];
        if (px < min.x) min.x = px; if (px > max.x) max.x = px;
        if (py < min.y) min.y = py; if (py > max.y) max.y = py;
        if (pz < min.z) min.z = pz; if (pz > max.z) max.z = pz;
        // Planar UVs (XZ) so textured materials have something to sample.
        uvs[(k * 3 + v) * 2] = px; uvs[(k * 3 + v) * 2 + 1] = pz;
      }
    }
    if (n === 0) { min.x = min.y = min.z = 0; max.x = max.y = max.z = 0; }
    if (opts.smooth) smoothNormals(positions, normals);
    const indices = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    const data: ProcMeshData = { name: opts.name, positions, normals, colors, uvs, indices, bounds: { min, max } };
    if (hasWeights) data.weights = weights;
    return data;
  }
}

/** Average normals of vertices sharing a position (unwelded arrays, in place). */
export function smoothNormals(positions: Float32Array, normals: Float32Array, eps = 1e-4): void {
  const acc = new Map<string, number[]>();
  const key = (i: number) => `${Math.round(positions[i * 3] / eps)},${Math.round(positions[i * 3 + 1] / eps)},${Math.round(positions[i * 3 + 2] / eps)}`;
  const n = positions.length / 3;
  const keys: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = keys[i] = key(i);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = [0, 0, 0]));
    a[0] += normals[i * 3]; a[1] += normals[i * 3 + 1]; a[2] += normals[i * 3 + 2];
  }
  for (let i = 0; i < n; i++) {
    const a = acc.get(keys[i])!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    normals[i * 3] = a[0] / l; normals[i * 3 + 1] = a[1] / l; normals[i * 3 + 2] = a[2] / l;
  }
}

/** Compute bounds of any mesh data. */
export function computeBounds(positions: ArrayLike<number>): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < min.x) min.x = x; if (x > max.x) max.x = x;
    if (y < min.y) min.y = y; if (y > max.y) max.y = y;
    if (z < min.z) min.z = z; if (z > max.z) max.z = z;
  }
  if (positions.length === 0) { min.x = min.y = min.z = 0; max.x = max.y = max.z = 0; }
  return { min, max };
}

/** Weld vertices sharing a position (and colour) into an indexed mesh; normals are averaged. */
export function weld(data: MeshData, eps = 1e-4): ProcMeshData {
  const p = data.positions, c = (data as Partial<ProcMeshData>).colors;
  const map = new Map<string, number>();
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  const remapIdx = new Uint32Array(p.length / 3);
  const normals = data.normals;
  for (let i = 0; i < p.length / 3; i++) {
    const k = `${Math.round(p[i * 3] / eps)},${Math.round(p[i * 3 + 1] / eps)},${Math.round(p[i * 3 + 2] / eps)}` + (c ? `|${c[i * 3].toFixed(3)},${c[i * 3 + 1].toFixed(3)},${c[i * 3 + 2].toFixed(3)}` : '');
    let j = map.get(k);
    if (j === undefined) {
      j = pos.length / 3;
      map.set(k, j);
      pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      col.push(c ? c[i * 3] : 1, c ? c[i * 3 + 1] : 1, c ? c[i * 3 + 2] : 1);
      nrm.push(0, 0, 0);
    }
    if (normals) { nrm[j * 3] += normals[i * 3]; nrm[j * 3 + 1] += normals[i * 3 + 1]; nrm[j * 3 + 2] += normals[i * 3 + 2]; }
    remapIdx[i] = j;
  }
  for (let j = 0; j < nrm.length; j += 3) { const l = Math.hypot(nrm[j], nrm[j + 1], nrm[j + 2]) || 1; nrm[j] /= l; nrm[j + 1] /= l; nrm[j + 2] /= l; }
  const src = data.indices;
  const idx = pos.length / 3 > 65535 ? new Uint32Array(src.length) : new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) idx[i] = remapIdx[src[i]];
  const positions = new Float32Array(pos);
  return { name: data.name, positions, normals: new Float32Array(nrm), colors: new Float32Array(col), uvs: new Float32Array((pos.length / 3) * 2), indices: idx, bounds: computeBounds(positions) };
}

/** Expand an indexed mesh so every triangle has its own vertices (flat shading). */
export function unweld(data: MeshData): ProcMeshData {
  const b = new MeshBuilder();
  b.addMesh(data);
  return b.build({ name: data.name });
}

/** Midpoint subdivision of every triangle (4x triangles). Colours are interpolated. */
export function subdivide(data: MeshData, times = 1): ProcMeshData {
  let cur = unweld(data);
  for (let n = 0; n < times; n++) {
    const b = new MeshBuilder();
    const p = cur.positions, c = cur.colors;
    const P = (i: number) => ({ x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] });
    const C = (i: number): RGB => ({ r: c[i * 3], g: c[i * 3 + 1], b: c[i * 3 + 2] });
    const mid = (a: Vec3Like, q: Vec3Like) => ({ x: (a.x + q.x) / 2, y: (a.y + q.y) / 2, z: (a.z + q.z) / 2 });
    for (let t = 0; t < p.length / 9; t++) {
      const a = P(t * 3), bb = P(t * 3 + 1), cc = P(t * 3 + 2);
      const ca = C(t * 3), cb = C(t * 3 + 1), ccc = C(t * 3 + 2);
      const ab = mid(a, bb), bc = mid(bb, cc), caM = mid(cc, a);
      const cab = mixRGB(ca, cb, 0.5), cbc = mixRGB(cb, ccc, 0.5), cca = mixRGB(ccc, ca, 0.5);
      b.triColored(a, ab, caM, ca, cab, cca);
      b.triColored(ab, bb, bc, cab, cb, cbc);
      b.triColored(caM, bc, cc, cca, cbc, ccc);
      b.triColored(ab, bc, caM, cab, cbc, cca);
    }
    cur = b.build({ name: data.name });
  }
  return cur;
}

// ------------------------------------------------------------- primitives

/** Axis-aligned box centred at `center`. */
export function addBox(b: MeshBuilder, size: Vec3Like, center: Vec3Like = { x: 0, y: 0, z: 0 }, color?: RGB): void {
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
  const v = (sx: number, sy: number, sz: number) => ({ x: center.x + sx * hx, y: center.y + sy * hy, z: center.z + sz * hz });
  b.quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), color);       // +z
  b.quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), color);   // -z
  b.quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), color);       // +x
  b.quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), color);   // -x
  b.quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1), color);       // +y
  b.quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), color);   // -y
}

/**
 * Surface of revolution around Y. `profile` is a list of `(radius, height)`
 * points from bottom to top; a radius of 0 makes a pole. `twist` rotates the
 * profile progressively (spiral shells), `wobble(angle, i)` perturbs radii.
 */
export function addLathe(
  b: MeshBuilder,
  profile: readonly { x: number; y: number }[],
  segments = 12,
  color?: RGB,
  opts: { twist?: number; wobble?: (angle: number, i: number) => number; capTop?: boolean; capBottom?: boolean; phase?: number } = {},
): void {
  const twist = opts.twist ?? 0, phase = opts.phase ?? 0;
  const pt = (i: number, s: number): Vec3Like => {
    const a = phase + (s / segments) * Math.PI * 2 + twist * (i / Math.max(1, profile.length - 1));
    const r = profile[i].x * (opts.wobble ? opts.wobble(a, i) : 1);
    return { x: Math.cos(a) * r, y: profile[i].y, z: Math.sin(a) * r };
  };
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a0 = pt(i, s), a1 = pt(i, s + 1), b0 = pt(i + 1, s), b1 = pt(i + 1, s + 1);
      const r0 = profile[i].x, r1 = profile[i + 1].x;
      if (r0 <= 1e-6 && r1 <= 1e-6) continue;
      if (r1 <= 1e-6) b.tri(a0, b0, a1, color);
      else if (r0 <= 1e-6) b.tri(a0, b1, a1, color);
      else b.quad(a0, b0, b1, a1, color);
    }
  }
  if (opts.capTop && profile[profile.length - 1].x > 1e-6) {
    const top = profile.length - 1, c = { x: 0, y: profile[top].y, z: 0 };
    for (let s = 0; s < segments; s++) b.tri(c, pt(top, s), pt(top, s + 1), color);
  }
  if (opts.capBottom && profile[0].x > 1e-6) {
    const c = { x: 0, y: profile[0].y, z: 0 };
    for (let s = 0; s < segments; s++) b.tri(c, pt(0, s + 1), pt(0, s), color);
  }
}

/** Cylinder / truncated cone along Y from `y0` to `y1`. */
export function addCylinder(b: MeshBuilder, rBottom: number, rTop: number, y0: number, y1: number, segments = 8, color?: RGB, caps = true): void {
  addLathe(b, [{ x: rBottom, y: y0 }, { x: rTop, y: y1 }], segments, color, { capTop: caps, capBottom: caps });
}

/** Cone with its apex up. */
export function addCone(b: MeshBuilder, radius: number, y0: number, y1: number, segments = 8, color?: RGB, capBottom = true): void {
  addLathe(b, [{ x: radius, y: y0 }, { x: 0, y: y1 }], segments, color, { capBottom });
}

/**
 * Loft: stitch consecutive rings of points (same count per ring) with quads.
 * `closeRings` connects the last point to the first; `capEnds` fans the
 * first/last ring around their centroids.
 */
export function addLoft(b: MeshBuilder, rings: readonly (readonly Vec3Like[])[], color?: RGB, opts: { closeRings?: boolean; capEnds?: boolean } = {}): void {
  const close = opts.closeRings !== false;
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    const n = Math.min(r0.length, r1.length);
    const count = close ? n : n - 1;
    for (let s = 0; s < count; s++) {
      const s1 = (s + 1) % n;
      b.quad(r0[s], r1[s], r1[s1], r0[s1], color);
    }
  }
  if (opts.capEnds) {
    const cap = (ring: readonly Vec3Like[], flip: boolean) => {
      const c = { x: 0, y: 0, z: 0 };
      for (const p of ring) { c.x += p.x / ring.length; c.y += p.y / ring.length; c.z += p.z / ring.length; }
      for (let s = 0; s < ring.length; s++) {
        const s1 = (s + 1) % ring.length;
        if (flip) b.tri(c, ring[s1], ring[s], color); else b.tri(c, ring[s], ring[s1], color);
      }
    };
    cap(rings[0], true);
    cap(rings[rings.length - 1], false);
  }
}

/** Extrude a 2D polygon (counter-clockwise in XZ) from `y0` to `y1` with caps. */
export function addExtrude(b: MeshBuilder, polygon: readonly { x: number; z: number }[], y0: number, y1: number, color?: RGB): void {
  const n = polygon.length;
  const lo = polygon.map((p) => ({ x: p.x, y: y0, z: p.z })), hi = polygon.map((p) => ({ x: p.x, y: y1, z: p.z }));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.quad(lo[j], lo[i], hi[i], hi[j], color);
  }
  const c0 = { x: 0, y: y0, z: 0 }, c1 = { x: 0, y: y1, z: 0 };
  for (const p of polygon) { c0.x += p.x / n; c0.z += p.z / n; c1.x += p.x / n; c1.z += p.z / n; }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.tri(c1, hi[j], hi[i], color);
    b.tri(c0, lo[i], lo[j], color);
  }
}

/**
 * Icosphere. `deform(dir)` returns the radius along a unit direction so rocks
 * and clouds can be shaped without touching the topology.
 */
export function addIcosphere(b: MeshBuilder, radius: number, subdivisions = 1, color?: RGB, deform?: (dir: Vec3Like) => number): void {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: Vec3Like[] = [
    { x: -1, y: t, z: 0 }, { x: 1, y: t, z: 0 }, { x: -1, y: -t, z: 0 }, { x: 1, y: -t, z: 0 },
    { x: 0, y: -1, z: t }, { x: 0, y: 1, z: t }, { x: 0, y: -1, z: -t }, { x: 0, y: 1, z: -t },
    { x: t, y: 0, z: -1 }, { x: t, y: 0, z: 1 }, { x: -t, y: 0, z: -1 }, { x: -t, y: 0, z: 1 },
  ].map(norm);
  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, c: number) => {
      const k = a < c ? `${a}_${c}` : `${c}_${a}`;
      let i = cache.get(k);
      if (i === undefined) { i = verts.length; verts.push(norm({ x: (verts[a].x + verts[c].x) / 2, y: (verts[a].y + verts[c].y) / 2, z: (verts[a].z + verts[c].z) / 2 })); cache.set(k, i); }
      return i;
    };
    const next: number[][] = [];
    for (const [a, c, d] of faces) {
      const ab = mid(a, c), bc = mid(c, d), ca = mid(d, a);
      next.push([a, ab, ca], [c, bc, ab], [d, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const placed = verts.map((v) => { const r = deform ? deform(v) : radius; return { x: v.x * r, y: v.y * r, z: v.z * r }; });
  for (const [a, c, d] of faces) b.tri(placed[a], placed[c], placed[d], color);
  verts = [];
}

function norm(v: Vec3Like): Vec3Like {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Flat disc / polygon fan facing +Y (or -Y when `down`). */
export function addDisc(b: MeshBuilder, radius: number, y: number, segments = 12, color?: RGB, down = false, radiusFn?: (angle: number) => number): void {
  const c = { x: 0, y, z: 0 };
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2, a1 = ((s + 1) / segments) * Math.PI * 2;
    const r0 = radiusFn ? radiusFn(a0) : radius, r1 = radiusFn ? radiusFn(a1) : radius;
    const p0 = { x: Math.cos(a0) * r0, y, z: Math.sin(a0) * r0 }, p1 = { x: Math.cos(a1) * r1, y, z: Math.sin(a1) * r1 };
    if (down) b.tri(c, p0, p1, color); else b.tri(c, p1, p0, color);
  }
}

/** Validate mesh data: finite values, indices in range, matching array sizes. Returns problems (empty = ok). */
export function validateMesh(data: MeshData & Partial<ProcMeshData>): string[] {
  const out: string[] = [];
  const n = data.positions.length / 3;
  if (data.positions.length % 3 !== 0) out.push('positions not a multiple of 3');
  if (data.normals && data.normals.length !== data.positions.length) out.push('normals length mismatch');
  if (data.colors && data.colors.length !== data.positions.length) out.push('colors length mismatch');
  if (data.uvs && data.uvs.length !== n * 2) out.push('uvs length mismatch');
  if (data.indices.length % 3 !== 0) out.push('indices not a multiple of 3');
  for (let i = 0; i < data.indices.length; i++) if (data.indices[i] >= n) { out.push(`index ${data.indices[i]} out of range (${n} vertices)`); break; }
  for (let i = 0; i < data.positions.length; i++) if (!Number.isFinite(data.positions[i])) { out.push('non-finite position'); break; }
  if (data.normals) for (let i = 0; i < data.normals.length; i++) if (!Number.isFinite(data.normals[i])) { out.push('non-finite normal'); break; }
  if (data.colors) for (let i = 0; i < data.colors.length; i++) if (!Number.isFinite(data.colors[i]) || data.colors[i] < 0 || data.colors[i] > 1.0001) { out.push('colour out of range'); break; }
  if (n > 0 && data.indices.length === 0) out.push('no triangles');
  return out;
}
