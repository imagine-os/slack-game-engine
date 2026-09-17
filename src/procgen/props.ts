/**
 * Props that make the archipelago feel inhabited: wind turbines (with a
 * separate blade mesh to spin), windsocks, floating paper lanterns, hot-air
 * balloons, collectible light motes and wind-current streaks.
 */
import { Random } from '../core/math/Random';
import { type GeneratedMesh, MeshBuilder, type RGB, addBox, addCylinder, addDisc, addIcosphere, addLathe, mixRGB, rgb, shade } from './MeshBuilder';
import { PALETTES, type Palette } from './palettes';

/** Turbine tower and nacelle (static part). Hub is at `(0, height, -0.45)`. */
export function generateTurbine(palette: Palette = PALETTES.meadow, height = 7): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('tower', mixRGB(palette.stone, { r: 1, g: 1, b: 1 }, 0.5), { roughness: 0.6 });
  addCylinder(b, 0.32, 0.18, 0, height, 6, undefined, false);
  addCylinder(b, 0.7, 0.55, 0, 0.35, 6, shade(palette.stoneDark, 0.9), true);
  b.group('nacelle', palette.accent, { roughness: 0.5 });
  addBox(b, { x: 0.5, y: 0.5, z: 1.3 }, { x: 0, y: height + 0.1, z: 0.1 });
  return b.buildAll({ name: 'turbine' });
}

/** Three tapered blades around a hub at the origin, rotating about Z. */
export function generateTurbineBlades(palette: Palette = PALETTES.meadow, length = 3.2): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('blade', rgb('#f7f5f0'), { roughness: 0.5 });
  addIcosphere(b, 0.32, 0, palette.accent);
  for (let i = 0; i < 3; i++) {
    const blade = new MeshBuilder();
    blade.group('blade', rgb('#f7f5f0'));
    blade.quad({ x: -0.16, y: 0.2, z: 0.06 }, { x: 0.16, y: 0.2, z: 0.06 }, { x: 0.05, y: length, z: 0.04 }, { x: -0.05, y: length, z: 0.04 });
    blade.quad({ x: 0.16, y: 0.2, z: -0.06 }, { x: -0.16, y: 0.2, z: -0.06 }, { x: -0.05, y: length, z: -0.04 }, { x: 0.05, y: length, z: -0.04 });
    blade.quad({ x: 0.16, y: 0.2, z: 0.06 }, { x: 0.16, y: 0.2, z: -0.06 }, { x: 0.05, y: length, z: -0.04 }, { x: 0.05, y: length, z: 0.04 });
    blade.quad({ x: -0.16, y: 0.2, z: -0.06 }, { x: -0.16, y: 0.2, z: 0.06 }, { x: -0.05, y: length, z: 0.04 }, { x: -0.05, y: length, z: -0.04 });
    blade.quad({ x: -0.05, y: length, z: 0.04 }, { x: 0.05, y: length, z: 0.04 }, { x: 0.05, y: length, z: -0.04 }, { x: -0.05, y: length, z: -0.04 }, palette.accent);
    blade.rotateZ((i / 3) * Math.PI * 2);
    b.addBuilder(blade);
  }
  return b.buildAll({ name: 'turbine-blades' });
}

/** Pole with a striped windsock (points along +X). */
export function generateWindsock(palette: Palette = PALETTES.meadow): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('pole', shade(palette.stoneDark, 0.8), { roughness: 0.7 });
  addCylinder(b, 0.06, 0.05, 0, 3.2, 5, undefined, false);
  const sock = new MeshBuilder();
  const a = sock.group('sock-a', palette.accent, { roughness: 0.8, wind: 0.6, doubleSided: true });
  const w = sock.group('sock-b', rgb('#fff7ee'), { roughness: 0.8, wind: 0.6, doubleSided: true });
  const bands = 4;
  for (let i = 0; i < bands; i++) {
    sock.useGroup(i % 2 ? w : a);
    const r0 = 0.28 - i * 0.045, r1 = 0.28 - (i + 1) * 0.045;
    const y0 = i * 0.45, y1 = (i + 1) * 0.45;
    addLathe(sock, [{ x: r0, y: y0 }, { x: r1, y: y1 }], 6);
  }
  sock.rotateZ(-Math.PI / 2 + 0.18).translate(0.1, 3.0, 0);
  b.addBuilder(sock);
  return b.buildAll({ name: 'windsock' });
}

/** Floating paper lantern with a warm glow (origin at its centre). */
export function generatePaperLantern(palette: Palette = PALETTES.meadow, color: RGB = palette.lantern): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('paper', color, { roughness: 0.9, opacity: 0.95, emissive: shade(color, 0.6), emissiveStrength: 0.8 });
  addLathe(b, [{ x: 0.28, y: -0.45 }, { x: 0.45, y: -0.2 }, { x: 0.45, y: 0.25 }, { x: 0.28, y: 0.48 }], 8);
  b.group('paper-dark', shade(palette.stoneDark, 0.7), { roughness: 0.9 });
  addCylinder(b, 0.3, 0.3, 0.48, 0.55, 8, undefined, true);
  addCylinder(b, 0.3, 0.3, -0.52, -0.45, 8, undefined, true);
  b.group('flame', rgb('#ffe9b0'), { unlit: true, emissive: rgb('#ffe9b0'), emissiveStrength: 2 });
  addIcosphere(b, 0.12, 0);
  return b.buildAll({ name: 'paper-lantern' });
}

/** Hot-air balloon with striped envelope and a basket (origin at the basket). */
export function generateBalloon(seed: number, palette: Palette = PALETTES.meadow): GeneratedMesh {
  const rng = new Random(seed);
  const b = new MeshBuilder();
  const colA = rng.pick([palette.accent, palette.canopy[0], palette.crystal, rgb('#ef476f'), rgb('#4cc2ff')]) ?? palette.accent;
  const colB = rng.chance(0.5) ? rgb('#fff6e8') : palette.lantern;
  const gA = b.group('stripe-a', colA, { roughness: 0.7 });
  const gB = b.group('stripe-b', colB, { roughness: 0.7 });
  const profile = [{ x: 0.35, y: 4.2 }, { x: 1.35, y: 5.0 }, { x: 2.1, y: 6.2 }, { x: 2.25, y: 7.4 }, { x: 1.9, y: 8.6 }, { x: 1.1, y: 9.4 }, { x: 0, y: 9.75 }];
  const segs = 10;
  for (let s = 0; s < segs; s++) {
    b.useGroup(s % 2 ? gB : gA);
    const a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2;
    for (let i = 0; i < profile.length - 1; i++) {
      const p0 = profile[i], p1 = profile[i + 1];
      const P = (r: number, y: number, a: number) => ({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
      if (p1.x <= 1e-6) b.tri(P(p0.x, p0.y, a0), P(p1.x, p1.y, a0), P(p0.x, p0.y, a1));
      else b.quad(P(p0.x, p0.y, a0), P(p1.x, p1.y, a0), P(p1.x, p1.y, a1), P(p0.x, p0.y, a1));
    }
  }
  b.group('basket', shade(palette.trunk, 1.1), { roughness: 1 });
  addBox(b, { x: 1.1, y: 0.8, z: 1.1 }, { x: 0, y: 0.4, z: 0 });
  b.group('rope', shade(palette.stoneDark, 0.8), { roughness: 1 });
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
    b.quad({ x: x - 0.03, y: 0.8, z }, { x: x + 0.03, y: 0.8, z }, { x: x * 0.7 + 0.03, y: 4.3, z: z * 0.7 }, { x: x * 0.7 - 0.03, y: 4.3, z: z * 0.7 });
    b.quad({ x: x + 0.03, y: 0.8, z }, { x: x - 0.03, y: 0.8, z }, { x: x * 0.7 - 0.03, y: 4.3, z: z * 0.7 }, { x: x * 0.7 + 0.03, y: 4.3, z: z * 0.7 });
  }
  b.group('burner', rgb('#ffb347'), { unlit: true, emissive: rgb('#ffb347'), emissiveStrength: 1.5 });
  addIcosphere(b, 0.18, 0);
  b.displace((p, idx) => { if (idx >= b.vertexCount - 60) p.y += 3.9; });
  return b.buildAll({ name: `balloon-${seed}` });
}

/** Collectible light mote: a small glowing gem. */
export function generateMote(color: RGB = rgb('#ffe9a8')): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('mote', color, { unlit: true, emissive: color, emissiveStrength: 2 });
  addIcosphere(b, 0.45, 0);
  b.scale(0.8, 1.2, 0.8);
  b.group('mote-halo', mixRGB(color, { r: 1, g: 1, b: 1 }, 0.3), { unlit: true, opacity: 0.22, emissive: color, emissiveStrength: 0.8 });
  addIcosphere(b, 0.6, 1);
  return b.buildAll({ name: 'mote' });
}

/** Soft translucent puff for wingtip contrails (unit-ish sphere, scaled per particle). */
export function generateTrailPuff(color: RGB = rgb('#fff6ea')): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('puff', color, { unlit: true, opacity: 0.2 });
  addIcosphere(b, 0.5, 1);
  return b.buildAll({ name: 'trail-puff' });
}

/** Thin elongated streak quad along Z for wind-current visuals (translucent, unlit). */
export function generateWindStreak(color: RGB = rgb('#ffffff')): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('streak', color, { unlit: true, opacity: 0.35, doubleSided: true });
  const w = 0.06, l = 4;
  b.quad({ x: -w, y: 0, z: -l / 2 }, { x: w, y: 0, z: -l / 2 }, { x: w * 0.2, y: 0, z: l / 2 }, { x: -w * 0.2, y: 0, z: l / 2 });
  b.quad({ x: 0, y: -w, z: -l / 2 }, { x: 0, y: w, z: -l / 2 }, { x: 0, y: w * 0.2, z: l / 2 }, { x: 0, y: -w * 0.2, z: l / 2 });
  return b.buildAll({ name: 'wind-streak' });
}

/** Feather burst particle for soft collisions. */
export function generateFeather(color: RGB = rgb('#fff7ee')): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('feather', color, { unlit: true, opacity: 0.9, doubleSided: true });
  b.quad({ x: -0.08, y: 0, z: -0.25 }, { x: 0.08, y: 0, z: -0.25 }, { x: 0.02, y: 0, z: 0.3 }, { x: -0.02, y: 0, z: 0.3 });
  return b.buildAll({ name: 'feather' });
}

/**
 * Long waterfall ribbon hanging from an island lip to the sea: two crossed
 * translucent quads of unit height (origin at the top, hangs along -Y), tapering
 * and narrowing toward the bottom so it fades into spray. Scale Y to the drop.
 */
export function generateWaterfallRibbon(palette: Palette = PALETTES.meadow, width = 0.8): GeneratedMesh {
  const b = new MeshBuilder();
  const top = mixRGB(palette.water, palette.foam, 0.25);
  const bottom = mixRGB(palette.water, palette.foam, 0.6);
  b.group('fall', top, { unlit: true, opacity: 0.22, doubleSided: true });
  const steps = 6;
  const taper = (t: number): number => width * (0.12 + 0.88 * Math.pow(1 - t, 1.6));
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps, t1 = (s + 1) / steps;
    const w0 = taper(t0), w1 = taper(t1);
    const c0 = mixRGB(top, bottom, t0), c1 = mixRGB(top, bottom, t1);
    const wob0 = Math.sin(t0 * 9.0) * width * 0.12, wob1 = Math.sin(t1 * 9.0) * width * 0.12;
    b.quad({ x: -w0 + wob0, y: -t0, z: 0 }, { x: w0 + wob0, y: -t0, z: 0 }, { x: w1 + wob1, y: -t1, z: 0 }, { x: -w1 + wob1, y: -t1, z: 0 }, mixRGB(c0, c1, 0.5));
    b.quad({ x: 0, y: -t0, z: -w0 * 0.7 }, { x: 0, y: -t0, z: w0 * 0.7 }, { x: 0, y: -t1, z: w1 * 0.7 }, { x: 0, y: -t1, z: -w1 * 0.7 }, mixRGB(c0, c1, 0.5));
  }
  return b.buildAll({ name: 'waterfall' });
}

/** Dark translucent disc of unit radius laid just above the sea under an island: a cheap fake reflection / shadow. */
export function generateSeaShadeDisc(color: RGB = rgb('#06243f')): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('shade', color, { unlit: true, opacity: 0.45 });
  addDisc(b, 1, 0, 18, undefined, false, (a) => 0.85 + 0.15 * Math.sin(a * 3) * Math.cos(a * 5));
  return b.buildAll({ name: 'sea-shade' });
}

/** Bright foam disc of unit radius where a waterfall meets the sea. */
export function generateSplashDisc(palette: Palette = PALETTES.meadow): GeneratedMesh {
  const b = new MeshBuilder();
  b.group('splash', mixRGB(palette.foam, palette.water, 0.3), { unlit: true, opacity: 0.32 });
  addDisc(b, 1, 0, 14, undefined, false, (a) => 0.7 + 0.3 * Math.abs(Math.sin(a * 4 + 0.7)));
  return b.buildAll({ name: 'sea-splash' });
}
