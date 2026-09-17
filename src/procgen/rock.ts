/**
 * Boulders (noise-deformed icospheres) and crystal clusters with glowing tips.
 */
import { Random } from '../core/math/Random';
import { type GeneratedMesh, MeshBuilder, addIcosphere, addLathe, mixRGB, shade } from './MeshBuilder';
import { Noise } from './noise';
import { PALETTES, type Palette } from './palettes';

export interface RockOptions {
  radius?: number;
  palette?: Palette;
  lod?: 0 | 1;
  /** 0 = round pebble, 1 = jagged shard. Default 0.5. */
  sharpness?: number;
}

/** A boulder resting on the origin plane (its base is flattened). */
export function generateRock(seed: number, opts: RockOptions = {}): GeneratedMesh {
  const rng = new Random(seed);
  const palette = opts.palette ?? PALETTES.meadow;
  const radius = opts.radius ?? rng.range(0.6, 1.4);
  const sharp = opts.sharpness ?? 0.5;
  const noise = new Noise(seed);
  const b = new MeshBuilder();
  const gRock = b.group('rock', palette.rock, { roughness: 0.9 });
  const gDark = b.group('rock-dark', palette.rockDark, { roughness: 0.9 });
  const sx = rng.range(0.8, 1.3), sz = rng.range(0.8, 1.3), sy = rng.range(0.55, 0.9);
  b.useGroup(gRock);
  addIcosphere(b, radius, opts.lod ? 0 : 1, undefined, (d) => {
    const n = noise.fbm3(d.x * 1.6 + 3, d.y * 1.6, d.z * 1.6, { octaves: 2 });
    return radius * (0.85 + 0.3 * n * (0.5 + sharp));
  });
  b.scale(sx, sy, sz);
  // Sink the bottom so it sits in the ground and looks heavy.
  b.displace((p) => { if (p.y < -radius * sy * 0.35) p.y = -radius * sy * 0.35 + (p.y + radius * sy * 0.35) * 0.2; });
  b.translate(0, radius * sy * 0.35, 0);
  b.regroupFaces((n) => (n.y < 0.15 ? gDark : gRock));
  b.colorFaces((n, _c, g) => {
    const base = g === gDark ? palette.rockDark : palette.rock;
    return mixRGB(shade(base, 0.85 + Math.max(0, n.y) * 0.35), base, 0.3);
  });
  b.jitter(rng, 0.07, 0.01);
  return b.buildAll({ name: `rock-${seed}` });
}

export interface CrystalOptions {
  palette?: Palette;
  /** Number of shards. Default 3..6. */
  count?: number;
  height?: number;
  lod?: 0 | 1;
}

/** Cluster of tilted hexagonal shards with emissive tips on a small rock base. */
export function generateCrystal(seed: number, opts: CrystalOptions = {}): GeneratedMesh {
  const rng = new Random(seed);
  const palette = opts.palette ?? PALETTES.dusk;
  const count = opts.count ?? rng.int(3, 6);
  const height = opts.height ?? rng.range(1.4, 2.6);
  const b = new MeshBuilder();
  const gBase = b.group('rock-dark', palette.rockDark, { roughness: 0.9 });
  const gBody = b.group('crystal', palette.crystal, { roughness: 0.25, metallic: 0.2, opacity: 0.92, emissive: shade(palette.crystal, 0.35), emissiveStrength: 0.5 });
  const gTip = b.group('crystal-glow', palette.crystalGlow, { unlit: true, emissive: palette.crystalGlow, emissiveStrength: 1.5 });
  b.useGroup(gBase);
  const noise = new Noise(seed ^ 0xc5);
  addIcosphere(b, height * 0.32, 0, undefined, (d) => height * 0.32 * (0.8 + 0.3 * noise.simplex3(d.x * 2, d.y * 2, d.z * 2)));
  b.scale(1.2, 0.5, 1.2);
  for (let i = 0; i < count; i++) {
    const h = height * (i === 0 ? 1 : rng.range(0.45, 0.85));
    const r = h * rng.range(0.13, 0.2);
    const sides = opts.lod ? 5 : 6;
    const shard = new MeshBuilder();
    shard.group('crystal', palette.crystal);
    shard.group('crystal-glow', palette.crystalGlow);
    shard.useGroup('crystal');
    addLathe(shard, [{ x: r * 0.7, y: -h * 0.2 }, { x: r, y: h * 0.55 }, { x: r * 0.55, y: h * 0.82 }], sides, undefined, { phase: rng.range(0, 1) });
    shard.useGroup('crystal-glow');
    addLathe(shard, [{ x: r * 0.55, y: h * 0.82 }, { x: 0, y: h }], sides, undefined, { phase: rng.range(0, 1) });
    const tilt = i === 0 ? rng.range(0, 0.15) : rng.range(0.25, 0.7), dir = rng.range(0, Math.PI * 2);
    shard.rotateZ(tilt).rotateY(dir);
    const off = i === 0 ? 0 : height * rng.range(0.12, 0.3);
    shard.translate(Math.cos(dir + 1) * off, 0, Math.sin(dir + 1) * off);
    b.addBuilder(shard);
  }
  // Faceted shading: faces facing up glow more.
  b.colorFaces((n, _c, g) => (g === gBody ? mixRGB(palette.crystal, palette.crystalGlow, Math.max(0, n.y) * 0.5) : null));
  b.jitter(rng, 0.04, 0.02);
  void gTip;
  return b.buildAll({ name: `crystal-${seed}` });
}
