/**
 * Ancient-ruin props: arches, broken columns, stone rings and stone lanterns.
 * Groups: `stone`, `stone-dark`, `moss`, `glow`.
 */
import { Random } from '../core/math/Random';
import { type GeneratedMesh, MeshBuilder, addBox, addCylinder, addLathe, mixRGB, shade } from './MeshBuilder';
import { PALETTES, type Palette } from './palettes';

function stoneGroups(b: MeshBuilder, palette: Palette): { stone: number; dark: number; moss: number } {
  return {
    stone: b.group('stone', palette.stone, { roughness: 0.95 }),
    dark: b.group('stone-dark', palette.stoneDark, { roughness: 0.95 }),
    moss: b.group('moss', mixRGB(palette.grass[1], palette.stone, 0.35), { roughness: 1 }),
  };
}

/** A weathered arch: two pillars and a keystone span with a chipped top. */
export function generateArch(seed: number, palette: Palette = PALETTES.meadow, opts: { width?: number; height?: number } = {}): GeneratedMesh {
  const rng = new Random(seed);
  const width = opts.width ?? rng.range(4, 6), height = opts.height ?? rng.range(4, 6);
  const b = new MeshBuilder();
  const g = stoneGroups(b, palette);
  const post = 0.7;
  for (const side of [-1, 1]) {
    b.useGroup(g.stone);
    const blocks = 4;
    for (let k = 0; k < blocks; k++) {
      const y0 = (k / blocks) * (height - 0.6), y1 = ((k + 1) / blocks) * (height - 0.6);
      const w = post * rng.range(0.9, 1.08);
      addBox(b, { x: w, y: y1 - y0 - 0.04, z: w }, { x: side * width / 2 + rng.range(-0.04, 0.04), y: (y0 + y1) / 2, z: rng.range(-0.04, 0.04) }, k % 2 ? shade(palette.stone, 0.92) : palette.stone);
    }
  }
  // Span: a shallow arch of wedge blocks.
  const segs = 7;
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs, t1 = (s + 1) / segs;
    const x0 = -width / 2 + t0 * width, x1 = -width / 2 + t1 * width;
    const lift = (t: number) => Math.sin(t * Math.PI) * 0.5;
    const y0 = height - 0.6 + lift(t0), y1 = height - 0.6 + lift(t1);
    const missing = s === segs - 2 && rng.chance(0.5);
    if (missing) continue;
    const top = 0.75 - (s === 3 ? 0 : rng.range(0, 0.1));
    b.useGroup(s % 2 ? g.dark : g.stone);
    b.quad({ x: x0, y: y0, z: -0.4 }, { x: x1, y: y1, z: -0.4 }, { x: x1, y: y1 + top, z: -0.4 }, { x: x0, y: y0 + top, z: -0.4 });
    b.quad({ x: x1, y: y1, z: 0.4 }, { x: x0, y: y0, z: 0.4 }, { x: x0, y: y0 + top, z: 0.4 }, { x: x1, y: y1 + top, z: 0.4 });
    b.quad({ x: x0, y: y0 + top, z: -0.4 }, { x: x1, y: y1 + top, z: -0.4 }, { x: x1, y: y1 + top, z: 0.4 }, { x: x0, y: y0 + top, z: 0.4 });
    b.quad({ x: x1, y: y1, z: -0.4 }, { x: x0, y: y0, z: -0.4 }, { x: x0, y: y0, z: 0.4 }, { x: x1, y: y1, z: 0.4 });
  }
  b.regroupFaces((n, c, grp) => (n.y > 0.7 && c.y < height * 0.6 && rng.chance(0.4) ? g.moss : grp));
  b.jitter(rng, 0.05, 0.005);
  return b.buildAll({ name: `arch-${seed}` });
}

/** A column, optionally broken (jagged top) with fallen drums nearby. */
export function generateColumn(seed: number, palette: Palette = PALETTES.meadow, opts: { height?: number; broken?: boolean } = {}): GeneratedMesh {
  const rng = new Random(seed);
  const height = opts.height ?? rng.range(3, 5.5);
  const broken = opts.broken ?? rng.chance(0.6);
  const b = new MeshBuilder();
  const g = stoneGroups(b, palette);
  b.useGroup(g.dark);
  addBox(b, { x: 1.3, y: 0.3, z: 1.3 }, { x: 0, y: 0.15, z: 0 });
  b.useGroup(g.stone);
  const h = broken ? height * rng.range(0.35, 0.7) : height;
  addLathe(b, [{ x: 0.42, y: 0.3 }, { x: 0.36, y: h * 0.5 }, { x: 0.34, y: h }], 7, undefined, { wobble: (a) => 1 + 0.06 * Math.cos(a * 7) });
  if (broken) {
    // Jagged top: raise alternate rim points.
    addLathe(b, [{ x: 0.34, y: h }, { x: 0.2, y: h + 0.25 }, { x: 0, y: h + 0.3 }], 7, shade(palette.stone, 0.85), { wobble: (a, i) => (i === 1 ? 1 + 0.5 * Math.sin(a * 3.5) : 1) });
    // Fallen drum.
    const drum = new MeshBuilder();
    drum.group('stone', palette.stone);
    addCylinder(drum, 0.33, 0.33, -0.45, 0.45, 7, undefined, true);
    drum.rotateZ(Math.PI / 2).translate(1.4 + rng.range(0, 0.6), 0.33, rng.range(-0.8, 0.8));
    b.addBuilder(drum);
  } else {
    b.useGroup(g.dark);
    addBox(b, { x: 1.0, y: 0.25, z: 1.0 }, { x: 0, y: h + 0.12, z: 0 });
  }
  b.regroupFaces((n, c, grp) => (grp === g.stone && n.y < 0.2 && c.y < 1.2 && rng.chance(0.35) ? g.moss : grp));
  b.jitter(rng, 0.05, 0.005);
  return b.buildAll({ name: `column-${seed}` });
}

/** A ring of standing stones around a low altar. */
export function generateStoneRing(seed: number, palette: Palette = PALETTES.meadow, opts: { radius?: number; stones?: number } = {}): GeneratedMesh {
  const rng = new Random(seed);
  const radius = opts.radius ?? rng.range(3, 4.5), stones = opts.stones ?? rng.int(5, 8);
  const b = new MeshBuilder();
  const g = stoneGroups(b, palette);
  for (let i = 0; i < stones; i++) {
    if (rng.chance(0.15)) continue; // a missing stone reads as age
    const a = (i / stones) * Math.PI * 2;
    const h = rng.range(1.6, 2.8), w = rng.range(0.6, 0.9), d = rng.range(0.35, 0.5);
    const s = new MeshBuilder();
    s.group('stone', palette.stone);
    addBox(s, { x: w, y: h, z: d }, { x: 0, y: h / 2, z: 0 });
    s.displace((p) => { if (p.y > h * 0.9) { p.x *= 0.8; p.z *= 0.8; } });
    s.rotateX(rng.range(-0.08, 0.08)).rotateZ(rng.range(-0.1, 0.1)).rotateY(a + Math.PI / 2 + rng.range(-0.2, 0.2)).translate(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    b.addBuilder(s);
  }
  b.useGroup(g.dark);
  addCylinder(b, 1.1, 0.9, 0, 0.5, 8, undefined, true);
  b.regroupFaces((n, c, grp) => (grp === g.stone && n.y < 0.3 && c.y < 0.8 && rng.chance(0.4) ? g.moss : grp));
  b.jitter(rng, 0.05, 0.005);
  return b.buildAll({ name: `stonering-${seed}` });
}

/** A stone lantern with a glowing core. */
export function generateStoneLantern(palette: Palette = PALETTES.meadow): GeneratedMesh {
  const b = new MeshBuilder();
  const g = stoneGroups(b, palette);
  const gGlow = b.group('glow', palette.lantern, { unlit: true, emissive: palette.lantern, emissiveStrength: 1.5 });
  b.useGroup(g.dark);
  addBox(b, { x: 0.9, y: 0.25, z: 0.9 }, { x: 0, y: 0.12, z: 0 });
  b.useGroup(g.stone);
  addCylinder(b, 0.14, 0.12, 0.25, 1.4, 6, undefined, false);
  addBox(b, { x: 0.7, y: 0.12, z: 0.7 }, { x: 0, y: 1.46, z: 0 });
  b.useGroup(gGlow);
  addBox(b, { x: 0.42, y: 0.5, z: 0.42 }, { x: 0, y: 1.78, z: 0 });
  b.useGroup(g.stone);
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) addBox(b, { x: 0.09, y: 0.5, z: 0.09 }, { x, y: 1.78, z });
  addLathe(b, [{ x: 0.55, y: 2.04 }, { x: 0.2, y: 2.34 }, { x: 0, y: 2.44 }], 4, shade(palette.stone, 0.9), { phase: 0.125, capBottom: true });
  return b.buildAll({ name: 'stone-lantern' });
}
