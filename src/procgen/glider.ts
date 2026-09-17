/**
 * The player's glider: a paper-plane / sailplane hybrid with long slender
 * wings that curve up into winglets, a needle fuselage on a thin tail boom, a
 * T-tail and a low tinted canopy. Groups: `hull`, `wing`, `trim`, `canopy`.
 * Forward is -Z, wingspan about 5.2 units.
 */
import type { Vec3Like } from '../core/math/Vec3';
import { type GeneratedMesh, MeshBuilder, addIcosphere, addLathe, addLoft, mixRGB, shade } from './MeshBuilder';
import { LIVERIES, type Livery } from './palettes';

export interface GliderOptions {
  livery?: Livery | number;
  /** Half wingspan. Default 2.6. */
  span?: number;
  lod?: 0 | 1;
}

/** Thin airfoil section at a wing station: leading edge, upper, trailing edge, lower. */
function section(x: number, y: number, zLead: number, chord: number, thickness: number, camber = 0.06): Vec3Like[] {
  return [
    { x, y: y + camber * chord * 0.15, z: zLead },
    { x, y: y + thickness * chord, z: zLead + chord * 0.3 },
    { x, y: y - camber * chord * 0.25, z: zLead + chord },
    { x, y: y - thickness * chord * 0.4, z: zLead + chord * 0.38 },
  ];
}

export function generateGlider(opts: GliderOptions = {}): GeneratedMesh {
  const livery = typeof opts.livery === 'number' ? LIVERIES[opts.livery % LIVERIES.length] : opts.livery ?? LIVERIES[0];
  const span = opts.span ?? 2.6;
  const lod = opts.lod ?? 0;
  const b = new MeshBuilder();
  const gHull = b.group('hull', livery.hull, { roughness: 0.45, metallic: 0.05 });
  const gWing = b.group('wing', livery.wing, { roughness: 0.5 });
  const gTrim = b.group('trim', livery.trim, { roughness: 0.4, metallic: 0.2 });
  const gCanopy = b.group('canopy', livery.canopy, { roughness: 0.15, metallic: 0.4, opacity: 0.75, emissive: shade(livery.canopy, 0.2), emissiveStrength: 0.3 });

  // Fuselage: a needle, widest around the cockpit, thinning into a long tail boom. Lathe along Y then nose -> -Z.
  b.useGroup(gHull);
  const fus = new MeshBuilder();
  fus.group('hull', livery.hull);
  addLathe(fus, [
    { x: 0.015, y: -1.55 }, { x: 0.07, y: -1.15 }, { x: 0.13, y: -0.6 }, { x: 0.16, y: -0.15 }, { x: 0.15, y: 0.25 }, { x: 0.1, y: 0.7 },
    { x: 0.055, y: 1.1 }, { x: 0.035, y: 1.6 }, { x: 0.03, y: 2.05 }, { x: 0, y: 2.1 },
  ], lod ? 6 : 10, undefined, { capBottom: true, wobble: (a) => 1 - 0.14 * Math.max(0, -Math.sin(a)) });
  fus.rotateX(-Math.PI / 2); // +Y -> -Z
  fus.scale(1, 0.82, 1);
  b.addBuilder(fus);
  // Nose cone in the trim colour.
  b.useGroup(gTrim);
  const nose = new MeshBuilder();
  nose.group('trim', livery.trim);
  addLathe(nose, [{ x: 0.075, y: 1.12 }, { x: 0.03, y: 1.45 }, { x: 0, y: 1.58 }], lod ? 6 : 10, undefined, {});
  nose.rotateX(-Math.PI / 2);
  nose.scale(1, 0.82, 1);
  b.addBuilder(nose);

  // Wings: long, slender, slightly swept and tapered, rising gently and curling up into a winglet.
  const wing = (side: 1 | -1) => {
    const st = (u: number, chord: number, thick: number, extraY = 0, camber = 0.06): Vec3Like[] => {
      const x = side * (0.14 + (span - 0.14) * u);
      const y = 0.02 + 0.09 * u * u + extraY;                   // gentle dihedral
      const zLead = -0.45 + 0.42 * u * u + 0.1 * u;              // sweep
      return section(x, y, zLead, chord, thick, camber);
    };
    const stations = [
      st(0, 0.78, 0.075), st(0.3, 0.62, 0.07), st(0.62, 0.44, 0.06), st(0.88, 0.28, 0.055), st(1.0, 0.2, 0.05, 0.08, 0.04),
    ];
    // Winglet: the tip curls upward.
    const tip = stations[stations.length - 1];
    const winglet = tip.map((p) => ({ x: p.x + side * 0.05, y: p.y + 0.3, z: p.z + 0.07 }));
    const wingletTop = tip.map((p) => ({ x: p.x + side * 0.03, y: p.y + 0.42, z: p.z + 0.12 + (p.z - tip[0].z) * 0.2 }));
    stations.push(winglet, wingletTop);
    const rings = side === -1 ? stations : stations.map((r) => [r[0], r[3], r[2], r[1]]);
    b.useGroup(gWing);
    addLoft(b, rings, undefined, { closeRings: true, capEnds: true });
    // Trim: a stripe along the leading edge of the upper surface and a band near the tip.
    b.useGroup(gTrim);
    const upper = (r: Vec3Like[], f: number): Vec3Like => ({ x: r[0].x, y: r[1].y + 0.005 + (r[0].y - r[1].y) * f * 0.5, z: r[0].z + (r[1].z - r[0].z) * f });
    const quadOrder = (a: Vec3Like, c: Vec3Like, d: Vec3Like, e: Vec3Like) => (side === 1 ? b.quad(a, c, d, e) : b.quad(e, d, c, a));
    for (let i = 0; i < 4; i++) {
      const s0 = stations[i], s1 = stations[i + 1];
      quadOrder(upper(s0, 0.15), upper(s0, 0.6), upper(s1, 0.6), upper(s1, 0.15));
    }
    const s3 = stations[3], s4 = stations[4];
    const band = (r: Vec3Like[], f: number): Vec3Like => ({ x: r[0].x, y: r[1].y + 0.005, z: r[1].z + (r[2].z - r[1].z) * f });
    quadOrder(band(s3, 0.05), band(s3, 0.95), band(s4, 0.95), band(s4, 0.05));
  };
  wing(1); wing(-1);

  // T-tail: thin vertical fin on the boom with a small horizontal plane on top.
  const fin = (p: Vec3Like[], half: number) => {
    const c = { x: 0, y: 0, z: 0 };
    for (const q of p) { c.x += q.x / p.length; c.y += q.y / p.length; c.z += q.z / p.length; }
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length;
      b.tri({ x: c.x + half, y: c.y, z: c.z }, { x: p[i].x + half, y: p[i].y, z: p[i].z }, { x: p[j].x + half, y: p[j].y, z: p[j].z });
      b.tri({ x: c.x - half, y: c.y, z: c.z }, { x: p[j].x - half, y: p[j].y, z: p[j].z }, { x: p[i].x - half, y: p[i].y, z: p[i].z });
      b.quad({ x: p[i].x + half, y: p[i].y, z: p[i].z }, { x: p[i].x - half, y: p[i].y, z: p[i].z }, { x: p[j].x - half, y: p[j].y, z: p[j].z }, { x: p[j].x + half, y: p[j].y, z: p[j].z });
    }
  };
  b.useGroup(gWing);
  fin([{ x: 0, y: 0.03, z: 1.55 }, { x: 0, y: 0.5, z: 1.88 }, { x: 0, y: 0.5, z: 2.06 }, { x: 0, y: 0.03, z: 2.08 }], 0.015);
  b.useGroup(gTrim);
  fin([{ x: 0, y: 0.4, z: 1.82 }, { x: 0, y: 0.5, z: 1.88 }, { x: 0, y: 0.5, z: 2.06 }, { x: 0, y: 0.4, z: 2.06 }], 0.017);
  b.useGroup(gWing);
  for (const side of [1, -1] as const) {
    const stab = [section(side * 0.02, 0.5, 1.84, 0.26, 0.07, 0.02), section(side * 0.62, 0.53, 1.9, 0.16, 0.06, 0.02), section(side * 0.7, 0.55, 1.95, 0.1, 0.05, 0.02)];
    const rings = side === -1 ? stab : stab.map((r) => [r[0], r[3], r[2], r[1]]);
    addLoft(b, rings, undefined, { closeRings: true, capEnds: true });
  }

  // Canopy: a long low teardrop over the cockpit.
  b.useGroup(gCanopy);
  const start = b.triangleCount;
  addIcosphere(b, 0.15, lod ? 0 : 1, undefined);
  b.displace((p, idx) => { if (idx >= start * 3) { if (p.y < 0) p.y *= 0.1; p.x *= 0.8; p.y *= 0.9; p.z *= 2.6 + (p.z > 0 ? 1.2 : 0); p.y += 0.1; p.z -= 0.55; } });
  b.colorFaces((n, _c, g) => (g === gCanopy ? mixRGB(livery.canopy, { r: 1, g: 1, b: 1 }, Math.max(0, n.y) * 0.45) : g === gHull ? shade(livery.hull, 0.9 + Math.max(0, n.y) * 0.12) : g === gWing ? shade(livery.wing, 0.92 + Math.max(0, n.y) * 0.1) : null));
  return b.buildAll({ name: `glider-${livery.name.toLowerCase()}` });
}
