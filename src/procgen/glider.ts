/**
 * The player's glider: an elegant paper-plane silhouette with swept, slightly
 * dihedral wings, a slim fuselage, a tail and a tinted canopy. Groups:
 * `hull`, `wing`, `trim`, `canopy`. Forward is -Z, wingspan about 3.4 units.
 */
import type { Vec3Like } from '../core/math/Vec3';
import { type GeneratedMesh, MeshBuilder, addIcosphere, addLathe, addLoft, mixRGB, shade } from './MeshBuilder';
import { LIVERIES, type Livery } from './palettes';

export interface GliderOptions {
  livery?: Livery | number;
  /** Half wingspan. Default 1.7. */
  span?: number;
  lod?: 0 | 1;
}

/** Diamond-ish airfoil section at a wing station. */
function section(x: number, zLead: number, chord: number, thickness: number, dihedral: number, camber = 0.08): Vec3Like[] {
  const y = dihedral;
  return [
    { x, y: y + camber * chord * 0.1, z: zLead },                          // leading edge
    { x, y: y + thickness * chord, z: zLead + chord * 0.32 },              // upper surface
    { x, y: y - camber * chord * 0.2, z: zLead + chord },                  // trailing edge
    { x, y: y - thickness * chord * 0.45, z: zLead + chord * 0.4 },        // lower surface
  ];
}

export function generateGlider(opts: GliderOptions = {}): GeneratedMesh {
  const livery = typeof opts.livery === 'number' ? LIVERIES[opts.livery % LIVERIES.length] : opts.livery ?? LIVERIES[0];
  const span = opts.span ?? 1.7;
  const lod = opts.lod ?? 0;
  const b = new MeshBuilder();
  const gHull = b.group('hull', livery.hull, { roughness: 0.5, metallic: 0.05 });
  const gWing = b.group('wing', livery.wing, { roughness: 0.55 });
  const gTrim = b.group('trim', livery.trim, { roughness: 0.4, metallic: 0.2 });
  const gCanopy = b.group('canopy', livery.canopy, { roughness: 0.15, metallic: 0.4, opacity: 0.75, emissive: shade(livery.canopy, 0.2), emissiveStrength: 0.3 });

  // Fuselage: lathe along Y then rotated so the nose points to -Z.
  b.useGroup(gHull);
  const fus = new MeshBuilder();
  fus.group('hull', livery.hull);
  addLathe(fus, [
    { x: 0.02, y: -1.35 }, { x: 0.09, y: -1.0 }, { x: 0.17, y: -0.45 }, { x: 0.22, y: 0.05 }, { x: 0.2, y: 0.55 }, { x: 0.12, y: 0.95 }, { x: 0.03, y: 1.3 }, { x: 0, y: 1.36 },
  ], lod ? 6 : 8, undefined, { capBottom: true, wobble: (a) => 1 - 0.18 * Math.max(0, -Math.sin(a)) });
  fus.rotateX(-Math.PI / 2); // +Y -> -Z
  fus.scale(1.05, 0.85, 1);
  b.addBuilder(fus);
  // Nose trim.
  b.useGroup(gTrim);
  const nose = new MeshBuilder();
  nose.group('trim', livery.trim);
  addLathe(nose, [{ x: 0.06, y: 1.1 }, { x: 0.02, y: 1.33 }, { x: 0, y: 1.38 }], lod ? 6 : 8, undefined, {});
  nose.rotateX(-Math.PI / 2);
  b.addBuilder(nose);

  // Wings: three stations per side, swept back and tapered, with a little dihedral.
  const wing = (side: 1 | -1) => {
    const stations = [
      section(side * 0.18, -0.35, 0.95, 0.09, 0.0),
      section(side * span * 0.55, -0.35 + 0.42, 0.62, 0.07, 0.09),
      section(side * span, -0.35 + 0.95, 0.28, 0.05, 0.24, 0.04),
    ];
    const rings = side === -1 ? stations : stations.map((r) => [r[0], r[3], r[2], r[1]]);
    b.useGroup(gWing);
    addLoft(b, rings, undefined, { closeRings: true, capEnds: true });
    // Trim stripe on the upper surface near the trailing edge.
    b.useGroup(gTrim);
    const stripe = (r: Vec3Like[], f: number): Vec3Like => ({ x: r[0].x, y: r[1].y + 0.004, z: r[1].z + (r[2].z - r[1].z) * f });
    const s0 = stations[0], s1 = stations[1], s2 = stations[2];
    const quadOrder = (a: Vec3Like, c: Vec3Like, d: Vec3Like, e: Vec3Like) => (side === 1 ? b.quad(a, c, d, e) : b.quad(e, d, c, a));
    quadOrder(stripe(s0, 0.55), stripe(s0, 0.75), stripe(s1, 0.75), stripe(s1, 0.55));
    quadOrder(stripe(s1, 0.55), stripe(s1, 0.75), stripe(s2, 0.75), stripe(s2, 0.55));
  };
  wing(1); wing(-1);

  // Tail: vertical fin and horizontal stabilisers.
  b.useGroup(gWing);
  const fin = (p: Vec3Like[]) => {
    const c = { x: 0, y: 0, z: 0 };
    for (const q of p) { c.x += q.x / p.length; c.y += q.y / p.length; c.z += q.z / p.length; }
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length;
      b.tri({ x: c.x + 0.02, y: c.y, z: c.z }, { x: p[i].x + 0.02, y: p[i].y, z: p[i].z }, { x: p[j].x + 0.02, y: p[j].y, z: p[j].z });
      b.tri({ x: c.x - 0.02, y: c.y, z: c.z }, { x: p[j].x - 0.02, y: p[j].y, z: p[j].z }, { x: p[i].x - 0.02, y: p[i].y, z: p[i].z });
    }
    // edge strip
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length;
      b.quad({ x: p[i].x + 0.02, y: p[i].y, z: p[i].z }, { x: p[i].x - 0.02, y: p[i].y, z: p[i].z }, { x: p[j].x - 0.02, y: p[j].y, z: p[j].z }, { x: p[j].x + 0.02, y: p[j].y, z: p[j].z });
    }
  };
  fin([{ x: 0, y: 0.1, z: 0.75 }, { x: 0, y: 0.62, z: 1.2 }, { x: 0, y: 0.62, z: 1.38 }, { x: 0, y: 0.1, z: 1.36 }]);
  b.useGroup(gTrim);
  fin([{ x: 0, y: 0.5, z: 1.14 }, { x: 0, y: 0.62, z: 1.2 }, { x: 0, y: 0.62, z: 1.38 }, { x: 0, y: 0.5, z: 1.38 }]);
  b.useGroup(gWing);
  for (const side of [1, -1] as const) {
    const st = [section(side * 0.1, 0.9, 0.42, 0.08, 0.05), section(side * 0.7, 1.08, 0.24, 0.06, 0.12)];
    const rings = side === -1 ? st : st.map((r) => [r[0], r[3], r[2], r[1]]);
    addLoft(b, rings, undefined, { closeRings: true, capEnds: true });
  }

  // Canopy: a stretched dome over the cockpit.
  b.useGroup(gCanopy);
  const start = b.triangleCount;
  addIcosphere(b, 0.2, lod ? 0 : 1, undefined);
  b.displace((p, idx) => { if (idx >= start * 3) { if (p.y < 0) p.y *= 0.15; p.x *= 0.85; p.y *= 1.0; p.z *= 1.9; p.y += 0.12; p.z -= 0.35; } });
  b.colorFaces((n, _c, g) => (g === gCanopy ? mixRGB(livery.canopy, { r: 1, g: 1, b: 1 }, Math.max(0, n.y) * 0.45) : g === gHull ? shade(livery.hull, 0.9 + Math.max(0, n.y) * 0.12) : null));
  return b.buildAll({ name: `glider-${livery.name.toLowerCase()}` });
}
