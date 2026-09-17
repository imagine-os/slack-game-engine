/**
 * Low-poly trees: layered-cone pines, blob-cluster broadleaf, palms with bent
 * fronds and dead trees. Two colour groups (`trunk`, `canopy`) so renderers
 * without vertex colours still get a readable silhouette. Canopy vertices
 * carry a wind weight (0 at the trunk, 1 at the tips) in `weights`, and the
 * canopy group asks for the wind material (`wind: 1`).
 */
import { Random } from '../core/math/Random';
import type { Vec3Like } from '../core/math/Vec3';
import { type GeneratedMesh, MeshBuilder, type RGB, addCone, addCylinder, addIcosphere, mixRGB, shade } from './MeshBuilder';
import { Noise } from './noise';
import { PALETTES, type Palette, type TreeSpecies } from './palettes';

export interface TreeOptions {
  species?: TreeSpecies;
  palette?: Palette;
  /** Overall height. Default depends on species (3..5). */
  height?: number;
  /** 0 = full detail, 1 = fewer segments. */
  lod?: 0 | 1;
}

/** Generate one tree. Trunk base sits at the origin, growing along +Y. */
export function generateTree(seed: number, opts: TreeOptions = {}): GeneratedMesh {
  const rng = new Random(seed);
  const palette = opts.palette ?? PALETTES.meadow;
  const species = opts.species ?? 'broadleaf';
  const lod = opts.lod ?? 0;
  const b = new MeshBuilder();
  const gTrunk = b.group('trunk', palette.trunk, { roughness: 0.95 });
  const canopyBase = palette.canopy[rng.int(0, palette.canopy.length - 1)];
  const gCanopy = b.group('canopy', canopyBase, { roughness: 0.9, wind: 1 });
  const gCanopyLight = b.group('canopy-light', mixRGB(canopyBase, { r: 1, g: 1, b: 0.85 }, 0.22), { roughness: 0.9, wind: 1 });
  const sides = lod ? 4 : 6;

  switch (species) {
    case 'pine': {
      const h = opts.height ?? rng.range(3.2, 5.2);
      b.useGroup(gTrunk);
      addCylinder(b, 0.16, 0.08, 0, h * 0.42, lod ? 4 : 5, palette.trunk, false);
      const layers = lod ? 3 : 4;
      for (let i = 0; i < layers; i++) {
        const t = i / (layers - 1);
        const y0 = h * (0.3 + t * 0.5), y1 = y0 + h * (0.34 - t * 0.12);
        const r = (0.95 - t * 0.55) * h * 0.26 * rng.range(0.92, 1.08);
        b.useGroup(i % 2 === 0 ? gCanopy : gCanopyLight);
        b.weight = 0.3 + t * 0.7;
        const start = b.triangleCount;
        addCone(b, r, y0, y1, sides, undefined, true);
        // Nudge layers off-centre so the tree is not perfectly symmetric.
        const ox = rng.range(-0.1, 0.1) * h * 0.1, oz = rng.range(-0.1, 0.1) * h * 0.1;
        b.displace((p, idx) => { if (idx >= start * 3) { p.x += ox; p.z += oz; } });
        b.weight = 0;
      }
      break;
    }
    case 'broadleaf': {
      const h = opts.height ?? rng.range(2.6, 4.2);
      const lean = rng.range(-0.12, 0.12);
      b.useGroup(gTrunk);
      const start = b.triangleCount;
      addCylinder(b, 0.2, 0.11, 0, h * 0.55, lod ? 4 : 5, palette.trunk, false);
      b.displace((p, idx) => { if (idx >= start * 3) p.x += lean * p.y; });
      const noise = new Noise(seed);
      const puffs = lod ? 2 : rng.int(3, 5);
      const cy = h * 0.68, cr = h * 0.28;
      for (let i = 0; i < puffs; i++) {
        const a = (i / puffs) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const off = i === 0 ? 0 : cr * rng.range(0.45, 0.8);
        const cx = Math.cos(a) * off + lean * cy, cz = Math.sin(a) * off, py = cy + rng.range(-0.15, 0.35) * cr;
        const pr = cr * (i === 0 ? 1.1 : rng.range(0.6, 0.85));
        b.useGroup(i % 2 === 1 ? gCanopyLight : gCanopy);
        const s0 = b.triangleCount;
        b.weight = 0.6;
        addIcosphere(b, pr, lod ? 0 : 1, undefined, (d) => pr * (0.82 + 0.25 * noise.simplex3(d.x * 1.8 + i, d.y * 1.8, d.z * 1.8)));
        b.displace((p, idx) => { if (idx >= s0 * 3) { p.x += cx; p.y += py; p.z += cz; } });
      }
      b.weight = 0;
      // Lighter tops, darker undersides.
      b.colorFaces((n, c, g) => {
        if (g !== gCanopy && g !== gCanopyLight) return null;
        const base = g === gCanopy ? canopyBase : mixRGB(canopyBase, { r: 1, g: 1, b: 0.85 }, 0.22);
        return shade(base, 0.8 + Math.max(0, n.y) * 0.35 + (c.y - cy) / Math.max(1, h) * 0.2);
      });
      break;
    }
    case 'palm': {
      const h = opts.height ?? rng.range(3.5, 5.5);
      const bend = rng.range(0.15, 0.4), bendDir = rng.range(0, Math.PI * 2);
      const segs = lod ? 3 : 5;
      const curve = (t: number): Vec3Like => ({ x: Math.cos(bendDir) * bend * t * t * h, y: t * h, z: Math.sin(bendDir) * bend * t * t * h });
      b.useGroup(gTrunk);
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const p0 = curve(t0), p1 = curve(t1);
        const r0 = 0.16 * (1 - t0 * 0.35), r1 = 0.16 * (1 - t1 * 0.35);
        const ring = (c: Vec3Like, r: number) => { const out: Vec3Like[] = []; for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; out.push({ x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r }); } return out; };
        const A = ring(p0, r0), B = ring(p1, r1 * (s % 2 ? 1.15 : 1));
        for (let k = 0; k < 5; k++) { const k1 = (k + 1) % 5; b.quad(A[k], B[k], B[k1], A[k1], shade(palette.trunk, s % 2 ? 1.1 : 0.95)); }
      }
      const top = curve(1);
      const fronds = lod ? 5 : 7;
      for (let f = 0; f < fronds; f++) {
        const a = (f / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const len = h * rng.range(0.4, 0.55), width = 0.32;
        const dx = Math.cos(a), dz = Math.sin(a);
        const tx = -dz, tz = dx;
        b.useGroup(f % 2 ? gCanopyLight : gCanopy);
        const steps = lod ? 2 : 3;
        let prevL = { x: top.x, y: top.y, z: top.z }, prevR = { x: top.x, y: top.y, z: top.z };
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const droop = -t * t * len * 0.65 + t * len * 0.25;
          const w = width * (1 - t * 0.7);
          const c = { x: top.x + dx * len * t, y: top.y + droop, z: top.z + dz * len * t };
          const L = { x: c.x + tx * w, y: c.y, z: c.z + tz * w }, R = { x: c.x - tx * w, y: c.y, z: c.z - tz * w };
          b.weight = t;
          b.quad(prevL, L, R, prevR);
          b.quad(prevR, R, L, prevL); // underside
          prevL = L; prevR = R;
        }
        b.weight = 0;
      }
      // Coconut cluster.
      b.useGroup(gTrunk);
      for (let k = 0; k < 3; k++) { const s0 = b.triangleCount; addIcosphere(b, 0.14, 0, shade(palette.trunk, 0.7)); b.displace((p, idx) => { if (idx >= s0 * 3) { p.x += top.x + Math.cos(k * 2.1) * 0.15; p.y += top.y - 0.15; p.z += top.z + Math.sin(k * 2.1) * 0.15; } }); }
      break;
    }
    case 'dead': {
      const h = opts.height ?? rng.range(2.4, 3.8);
      const dark = shade(palette.trunk, 0.75);
      b.useGroup(gTrunk);
      const s0 = b.triangleCount;
      addCylinder(b, 0.17, 0.06, 0, h, lod ? 4 : 5, dark, false);
      const lean = rng.range(-0.15, 0.15);
      b.displace((p, idx) => { if (idx >= s0 * 3) p.x += lean * p.y; });
      const branches = lod ? 2 : rng.int(3, 5);
      for (let k = 0; k < branches; k++) {
        const y = h * rng.range(0.35, 0.85);
        const a = rng.range(0, Math.PI * 2), tilt = rng.range(0.5, 1.1), len = h * rng.range(0.25, 0.45);
        const base = { x: lean * y, y, z: 0 };
        const dir = { x: Math.cos(a) * Math.sin(tilt), y: Math.cos(tilt), z: Math.sin(a) * Math.sin(tilt) };
        const tip = { x: base.x + dir.x * len, y: base.y + dir.y * len, z: base.z + dir.z * len };
        const r = 0.06;
        const ox = -dir.z, oz = dir.x;
        b.tri({ x: base.x + ox * r, y: base.y, z: base.z + oz * r }, { x: base.x - ox * r, y: base.y, z: base.z - oz * r }, tip, dark);
        b.tri({ x: base.x - ox * r, y: base.y, z: base.z - oz * r }, { x: base.x + ox * r, y: base.y, z: base.z + oz * r }, tip, dark);
        b.tri({ x: base.x, y: base.y + r, z: base.z }, { x: base.x, y: base.y - r, z: base.z }, tip, shade(dark, 0.85));
        b.tri({ x: base.x, y: base.y - r, z: base.z }, { x: base.x, y: base.y + r, z: base.z }, tip, shade(dark, 0.85));
      }
      break;
    }
  }
  b.jitter(rng, 0.06, 0.01);
  return b.buildAll({ name: `tree-${species}-${seed}` });
}

/** Pick a species for a palette by its weights. */
export function pickSpecies(palette: Palette, rng: Random): TreeSpecies {
  let total = 0;
  for (const t of palette.trees) total += t.weight;
  let r = rng.range(0, total);
  for (const t of palette.trees) { r -= t.weight; if (r <= 0) return t.species; }
  return palette.trees[0].species;
}

/** Colour of the canopy group of a generated tree (for material fallback). */
export function canopyColor(tree: GeneratedMesh): RGB {
  return tree.groups.find((g) => g.name === 'canopy')?.color ?? { r: 0.4, g: 0.7, b: 0.3 };
}
