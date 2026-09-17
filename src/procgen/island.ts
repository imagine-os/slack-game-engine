/**
 * Floating island generator: a polar heightfield top (terraces, a cliff lip),
 * an undercut rock bottom tapering to stalactite points, colours by slope and
 * height, optional waterfall ribbons, plus an analytic {@link IslandShape}
 * for cheap collision and decoration placement.
 */
import { Random } from '../core/math/Random';
import type { Vec3Like } from '../core/math/Vec3';
import { type GeneratedMesh, MeshBuilder, type RGB, mixRGB, shade } from './MeshBuilder';
import { Noise } from './noise';
import { PALETTES, type Palette } from './palettes';

export interface IslandOptions {
  /** Nominal outline radius. Default 18. */
  radius?: number;
  /** Vertical relief of the top surface. Default `radius * 0.35`. */
  height?: number;
  /** Depth of the undercut below the rim. Default `radius * 0.9`. */
  depth?: number;
  palette?: Palette;
  /** Number of terrace steps (0 = rolling hills). Default 3. */
  terraces?: number;
  /** 0 = smooth mound, 1 = jagged. Default 0.5. */
  ruggedness?: number;
  /** Waterfall ribbons hanging from the lip. Default 1. */
  waterfalls?: number;
  /** 0 = full detail, 1 = distant/low-poly variant. Default 0. */
  lod?: 0 | 1;
  /** Override ring / segment counts. */
  rings?: number;
  segments?: number;
}

/** Surface sample used for decoration placement. */
export interface SurfaceSample {
  position: Vec3Like;
  normal: Vec3Like;
  /** 0 flat .. 1 vertical. */
  slope: number;
  /** Radial fraction 0 centre .. 1 rim. */
  u: number;
}

/** Result of a collision query against an island. */
export interface IslandHit {
  /** Minimum translation to leave the island volume. */
  push: Vec3Like;
  /** Surface normal at the exit point. */
  normal: Vec3Like;
  /** Penetration depth (including margin). */
  depth: number;
}

/**
 * Analytic description of an island's volume in island-local space (centre
 * at the origin, rim at `y = rimY`). Used for landing, soft collision and
 * placing trees without touching the mesh.
 */
export class IslandShape {
  constructor(
    readonly radius: number,
    readonly rimY: number,
    /** Radial fractions of the rings (0 .. 1). */
    readonly us: readonly number[],
    /** Outline radius per segment. */
    readonly outline: readonly number[],
    /** Top heights `[ring][segment]`. */
    readonly top: readonly (readonly number[])[],
    /** Bottom heights `[ring][segment]`. */
    readonly bottom: readonly (readonly number[])[],
    readonly maxHeight: number,
    readonly minDepth: number,
  ) {}

  get segments(): number { return this.outline.length; }

  /** Outline radius in direction `angle`. */
  outlineAt(angle: number): number {
    const S = this.segments;
    const f = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * S;
    const j = Math.floor(f), t = f - j;
    return this.outline[j % S] * (1 - t) + this.outline[(j + 1) % S] * t;
  }

  private sample(grid: readonly (readonly number[])[], u: number, angle: number): number {
    const S = this.segments;
    const f = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * S;
    const j = Math.floor(f), tj = f - j;
    const us = this.us;
    let i = 0;
    while (i < us.length - 2 && us[i + 1] < u) i++;
    const ti = Math.min(1, Math.max(0, (u - us[i]) / Math.max(1e-6, us[i + 1] - us[i])));
    const a = grid[i][j % S] * (1 - tj) + grid[i][(j + 1) % S] * tj;
    const b = grid[i + 1][j % S] * (1 - tj) + grid[i + 1][(j + 1) % S] * tj;
    return a * (1 - ti) + b * ti;
  }

  /** Height of the top surface at a local XZ point, or `-Infinity` outside the outline. */
  heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const out = this.outlineAt(a);
    if (r > out) return -Infinity;
    return this.sample(this.top, r / out, a);
  }

  /** Height of the underside at a local XZ point, or `Infinity` outside. */
  bottomAt(x: number, z: number): number {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const out = this.outlineAt(a);
    if (r > out) return Infinity;
    return this.sample(this.bottom, r / out, a);
  }

  /** Surface normal of the top at a local point (finite differences). */
  normalAt(x: number, z: number, out: Vec3Like = { x: 0, y: 1, z: 0 }): Vec3Like {
    const e = Math.max(0.25, this.radius * 0.02);
    const h = (px: number, pz: number) => { const v = this.heightAt(px, pz); return Number.isFinite(v) ? v : this.rimY; };
    const dx = h(x + e, z) - h(x - e, z), dz = h(x, z + e) - h(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  /** Is the local point inside the island (with a safety margin)? */
  contains(x: number, y: number, z: number, margin = 0): boolean {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const out = this.outlineAt(a) + margin;
    if (r > out) return false;
    const u = Math.min(1, r / Math.max(1e-6, out - margin));
    const top = this.sample(this.top, u, a) + margin, bottom = this.sample(this.bottom, u, a) - margin;
    return y <= top && y >= bottom;
  }

  /**
   * Resolve a sphere of radius `margin` at a local point: the smallest push
   * that leaves the volume (up through the top, down through the bottom or
   * out through the side), or `null` when not touching.
   */
  resolve(x: number, y: number, z: number, margin = 0): IslandHit | null {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const out = this.outlineAt(a);
    if (r > out + margin) return null;
    const u = Math.min(1, r / Math.max(1e-6, out));
    const top = this.sample(this.top, u, a), bottom = this.sample(this.bottom, u, a);
    if (y > top + margin || y < bottom - margin) return null;
    const dTop = top + margin - y, dBottom = y - (bottom - margin), dSide = out + margin - r;
    // Near the rim the side exit is cheap; deep under the top surface only the top or bottom make sense.
    if (dTop <= dBottom && dTop <= dSide) {
      const n = this.normalAt(x, z);
      return { push: { x: 0, y: dTop, z: 0 }, normal: n, depth: dTop };
    }
    if (dBottom <= dSide) return { push: { x: 0, y: -dBottom, z: 0 }, normal: { x: 0, y: -1, z: 0 }, depth: dBottom };
    const nx = r > 1e-6 ? x / r : 1, nz = r > 1e-6 ? z / r : 0;
    return { push: { x: nx * dSide, y: 0, z: nz * dSide }, normal: { x: nx, y: 0, z: nz }, depth: dSide };
  }

  /** Random points on the top surface with their normals (for decorations). */
  samplePoints(rng: Random, count: number, opts: { maxU?: number; minU?: number; maxSlope?: number } = {}): SurfaceSample[] {
    const out: SurfaceSample[] = [];
    const maxU = opts.maxU ?? 0.86, minU = opts.minU ?? 0.05, maxSlope = opts.maxSlope ?? 0.45;
    for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
      const u = Math.sqrt(rng.range(minU * minU, maxU * maxU)), a = rng.range(0, Math.PI * 2);
      const ro = this.outlineAt(a) * u;
      const x = Math.cos(a) * ro, z = Math.sin(a) * ro;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const normal = this.normalAt(x, z);
      const slope = 1 - normal.y;
      if (slope > maxSlope) continue;
      out.push({ position: { x, y, z }, normal, slope, u });
      n++;
    }
    return out;
  }
}

export interface IslandResult extends GeneratedMesh {
  shape: IslandShape;
  /** Lip points where waterfalls start (local space), for splash effects. */
  waterfalls: Vec3Like[];
}

/** Generate a floating island. `seed` drives every random choice. */
export function generateIsland(seed: number, opts: IslandOptions = {}): IslandResult {
  const rng = new Random(seed);
  const palette = opts.palette ?? PALETTES.meadow;
  const radius = opts.radius ?? 18;
  const height = opts.height ?? radius * 0.35;
  const depth = opts.depth ?? radius * 0.9;
  const terraces = opts.terraces ?? 3;
  const rugged = opts.ruggedness ?? 0.5;
  const lod = opts.lod ?? 0;
  const R = opts.rings ?? (lod ? 5 : Math.max(7, Math.round(radius / 2.2)));
  const S = opts.segments ?? (lod ? 16 : Math.max(20, Math.round(radius * 2.2)));
  const nOutline = new Noise(seed ^ 0x51ed), nTop = new Noise(seed ^ 0x7a11), nBottom = new Noise(seed ^ 0xb0b0), nColor = new Noise(seed ^ 0xc010);
  const rimY = -radius * 0.04;

  // Radial fractions: interior rings uniform, then a cliff-top ring and the rim.
  const us: number[] = [];
  for (let i = 0; i <= R - 2; i++) us.push((i / (R - 2)) * 0.86);
  us.push(0.95, 1);

  // Outline: a few lobes plus fine wobble, sampled on a circle so it is periodic.
  const outline: number[] = [];
  for (let j = 0; j < S; j++) {
    const a = (j / S) * Math.PI * 2;
    const lobes = nOutline.simplex2(Math.cos(a) * 0.9 + 3.1, Math.sin(a) * 0.9 - 1.7);
    const fine = nOutline.simplex2(Math.cos(a) * 2.6 + 11.2, Math.sin(a) * 2.6 + 7.4);
    outline.push(radius * (0.78 + 0.18 * lobes + 0.06 * fine * rugged));
  }

  const terrain = (x: number, z: number, u: number): number => {
    const s = 1 / (radius * 0.9);
    let h = nTop.warp2(x * s + 1.3, z * s - 2.1, 0.6, { octaves: lod ? 2 : 4 }) * 0.5 + 0.5;
    h = Math.pow(h, 1.15);
    const dome = 1 - u * u * 0.55;                    // higher toward the centre
    const rim = 1 - Math.pow(Math.max(0, (u - 0.7) / 0.3), 2); // fall off toward the lip
    let y = h * dome * rim;
    if (terraces > 0) {
      const q = y * terraces;
      const f = Math.floor(q), fr = q - f;
      const step = fr < 0.55 ? 0 : (fr - 0.55) / 0.45;
      y = (f + step * step * (3 - 2 * step)) / terraces;
    }
    return y * height + height * 0.08 * nTop.simplex2(x * s * 4, z * s * 4) * rugged;
  };

  const top: number[][] = [], bottom: number[][] = [];
  const px: number[][] = [], pz: number[][] = [];
  for (let i = 0; i <= R; i++) {
    const u = us[i];
    top.push([]); bottom.push([]); px.push([]); pz.push([]);
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2;
      const ro = outline[j] * u;
      const x = Math.cos(a) * ro, z = Math.sin(a) * ro;
      px[i].push(x); pz[i].push(z);
      let y: number;
      if (i === R) y = rimY;
      else if (i === R - 1) y = Math.max(rimY + radius * 0.05, terrain(x, z, u) * 0.6);
      else y = Math.max(rimY + radius * 0.06, terrain(x, z, u));
      top[i].push(y);
      // Underside: bowl that deepens toward the centre with lumpy noise.
      const bowl = Math.pow(Math.max(0, 1 - u), 0.85);
      const lump = 0.75 + 0.5 * (nBottom.fbm3(x / radius * 2.2, 0.3, z / radius * 2.2, { octaves: 3 }) * 0.5 + 0.5);
      const spike = Math.max(0, nBottom.ridged2(x / radius * 3.1 + 5, z / radius * 3.1) - 0.55) * 2.2 * rugged;
      let yb = rimY - depth * bowl * lump * (1 + spike * bowl);
      if (i === R) yb = rimY;
      bottom[i].push(Math.min(yb, rimY));
    }
  }
  let maxHeight = -Infinity, minDepth = Infinity;
  for (const row of top) for (const v of row) if (v > maxHeight) maxHeight = v;
  for (const row of bottom) for (const v of row) if (v < minDepth) minDepth = v;
  const shape = new IslandShape(radius, rimY, us, outline, top, bottom, maxHeight, minDepth);

  // ------------------------------------------------------------- geometry
  const b = new MeshBuilder();
  const gGrass = b.group('grass', palette.grass[1], { roughness: 0.95 });
  const gGrassLight = b.group('grass-light', palette.grass[0], { roughness: 0.95 });
  const gGrassDark = b.group('grass-dark', palette.grass[2], { roughness: 0.95 });
  const gSand = b.group('sand', palette.sand, { roughness: 1 });
  const gCliff = b.group('cliff', palette.cliff, { roughness: 0.9 });
  const gCliffDark = b.group('cliff-dark', palette.cliffDark, { roughness: 0.9 });
  const gRock = b.group('rock', palette.rock, { roughness: 0.85 });
  const gRockDark = b.group('rock-dark', palette.rockDark, { roughness: 0.85 });
  const gWater = b.group('water', palette.water, { water: true, opacity: 0.85, emissive: shade(palette.water, 0.25), emissiveStrength: 0.4, roughness: 0.2, doubleSided: true });
  const gFoam = b.group('foam', palette.foam, { unlit: true, opacity: 0.9, doubleSided: true });

  const P = (i: number, j: number, grid: number[][]): Vec3Like => ({ x: px[i][j % S], y: grid[i][j % S], z: pz[i][j % S] });
  b.useGroup(gGrass);
  // Top: centre fan then quads (alternating diagonal for a hand-made look).
  for (let j = 0; j < S; j++) b.tri(P(0, 0, top), P(1, j + 1, top), P(1, j, top));
  for (let i = 1; i < R; i++) {
    for (let j = 0; j < S; j++) {
      const a = P(i, j, top), c = P(i, j + 1, top), d = P(i + 1, j + 1, top), e = P(i + 1, j, top);
      if ((i + j) % 2 === 0) { b.tri(a, c, d); b.tri(a, d, e); } else { b.tri(a, c, e); b.tri(c, d, e); }
    }
  }
  // Bottom: rim to centre (winding reversed so normals face down/out).
  b.useGroup(gRock);
  for (let i = 1; i < R; i++) {
    for (let j = 0; j < S; j++) {
      const a = P(i, j, bottom), c = P(i, j + 1, bottom), d = P(i + 1, j + 1, bottom), e = P(i + 1, j, bottom);
      if ((i + j) % 2 === 0) { b.tri(a, d, c); b.tri(a, e, d); } else { b.tri(a, e, c); b.tri(c, e, d); }
    }
  }
  for (let j = 0; j < S; j++) b.tri(P(0, 0, bottom), P(1, j, bottom), P(1, j + 1, bottom));

  // Stalactite spikes hanging from the underside.
  const spikes = lod ? 1 : 2 + Math.floor(rng.range(0, 3) * rugged);
  for (let k = 0; k < spikes; k++) {
    const u = rng.range(0.15, 0.6), a = rng.range(0, Math.PI * 2);
    const ro = shape.outlineAt(a) * u;
    const x = Math.cos(a) * ro, z = Math.sin(a) * ro;
    const yb = shape.bottomAt(x, z);
    const len = depth * rng.range(0.25, 0.55), rad = radius * rng.range(0.08, 0.16);
    const sides = 5;
    const tip = { x: x + rng.range(-1, 1), y: yb - len, z: z + rng.range(-1, 1) };
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2, a1 = ((s + 1) / sides) * Math.PI * 2;
      const p0 = { x: x + Math.cos(a0) * rad, y: yb + rad * 0.6, z: z + Math.sin(a0) * rad };
      const p1 = { x: x + Math.cos(a1) * rad, y: yb + rad * 0.6, z: z + Math.sin(a1) * rad };
      b.tri(p0, p1, tip, palette.rockDark);
    }
  }

  // Colours by slope and height; steep faces become cliff groups.
  const grassStops = palette.grass;
  b.regroupFaces((n, c) => {
    if (n.y < -0.15) return c.y < rimY - depth * 0.45 ? gRockDark : gRock;
    if (n.y < 0.4) return c.y < rimY + radius * 0.08 ? gCliffDark : gCliff;
    if (n.y < 0.74) return gCliff;
    const r = Math.hypot(c.x, c.z), a = Math.atan2(c.z, c.x);
    const u = r / shape.outlineAt(a);
    if (u > 0.9 && c.y < rimY + height * 0.25) return gSand;
    const tone = nColor.simplex2(c.x * 0.35 + 7, c.z * 0.35 - 3) + (c.y - rimY) / Math.max(1, height) * 0.6 - 0.3;
    return tone > 0.35 ? gGrassLight : tone < -0.25 ? gGrassDark : gGrass;
  });
  b.colorFaces((n, c, g) => {
    const base: RGB =
      g === gGrass ? grassStops[1] : g === gGrassLight ? grassStops[0] : g === gGrassDark ? grassStops[2] :
      g === gSand ? palette.sand : g === gCliff ? palette.cliff : g === gCliffDark ? palette.cliffDark :
      g === gRock ? palette.rock : g === gRockDark ? palette.rockDark : palette.water;
    if (g === gWater || g === gFoam) return null;
    // Gentle height gradient: lower faces darker, sunlit tops lighter.
    const t = Math.min(1, Math.max(0, (c.y - (rimY - depth)) / Math.max(1, depth + height)));
    const lit = 0.85 + t * 0.3 + n.y * 0.05;
    return mixRGB(shade(base, lit), base, 0.4);
  });
  b.jitter(rng, lod ? 0.03 : 0.06, 0.015);

  // Waterfalls: a pool at the lip and a ribbon that hangs down the cliff and fades to a point.
  const waterfalls: Vec3Like[] = [];
  const nFalls = lod ? 0 : Math.min(2, Math.max(0, opts.waterfalls ?? 1));
  for (let k = 0; k < nFalls; k++) {
    const a = rng.range(0, Math.PI * 2);
    const ro = shape.outlineAt(a);
    const lipX = Math.cos(a) * ro * 0.955, lipZ = Math.sin(a) * ro * 0.955;
    const lipY = shape.heightAt(lipX, lipZ) + 0.15;
    waterfalls.push({ x: lipX, y: lipY, z: lipZ });
    const w = radius * 0.09;
    const tx = -Math.sin(a), tz = Math.cos(a);     // tangent along the rim
    const nx = Math.cos(a), nz = Math.sin(a);      // outward
    b.useGroup(gWater);
    // Pool: small disc on the lip.
    const pc = { x: lipX - nx * w * 0.8, y: lipY, z: lipZ - nz * w * 0.8 };
    for (let s = 0; s < 8; s++) {
      const a0 = (s / 8) * Math.PI * 2, a1 = ((s + 1) / 8) * Math.PI * 2;
      b.tri(pc, { x: pc.x + Math.cos(a1) * w * 1.3, y: pc.y, z: pc.z + Math.sin(a1) * w * 1.3 }, { x: pc.x + Math.cos(a0) * w * 1.3, y: pc.y, z: pc.z + Math.sin(a0) * w * 1.3 });
    }
    // Ribbon: segments following the cliff then curving under, tapering.
    const steps = 6;
    let prevL = { x: lipX + tx * w, y: lipY, z: lipZ + tz * w }, prevR = { x: lipX - tx * w, y: lipY, z: lipZ - tz * w };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const drop = (rimY - lipY) * Math.min(1, t * 1.6) - depth * 0.55 * Math.max(0, t - 0.4);
      const outward = ro * (0.955 + 0.06 * Math.min(1, t * 2) - 0.12 * Math.max(0, t - 0.5));
      const ww = w * (1 - t * 0.85);
      const cx = Math.cos(a) * outward, cz = Math.sin(a) * outward, cy = lipY + drop;
      const L = { x: cx + tx * ww, y: cy, z: cz + tz * ww }, Rr = { x: cx - tx * ww, y: cy, z: cz - tz * ww };
      b.quad(prevR, prevL, L, Rr, mixRGB(palette.water, palette.foam, t * 0.5));
      prevL = L; prevR = Rr;
    }
    b.useGroup(gFoam);
    for (let s = 0; s < 3; s++) {
      const fx = lipX + nx * w * (0.2 + s * 0.35) + tx * rng.range(-w, w) * 0.6, fz = lipZ + nz * w * (0.2 + s * 0.35) + tz * rng.range(-w, w) * 0.6;
      const fy = lipY + 0.05 - s * 0.25;
      const fr = w * 0.35;
      b.tri({ x: fx - fr, y: fy, z: fz - fr }, { x: fx + fr, y: fy, z: fz + fr }, { x: fx + fr, y: fy, z: fz - fr });
      b.tri({ x: fx - fr, y: fy, z: fz - fr }, { x: fx - fr, y: fy, z: fz + fr }, { x: fx + fr, y: fy, z: fz + fr });
    }
  }

  const built = b.buildAll({ name: `island-${seed}` });
  return { ...built, shape, waterfalls };
}
