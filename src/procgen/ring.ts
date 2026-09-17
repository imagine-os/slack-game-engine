/**
 * Race gate: a torus of alternating stone frame and glowing segments, lying in
 * the XY plane (fly through along Z). Groups: `ring-frame`, `ring-glow`.
 */
import type { Vec3Like } from '../core/math/Vec3';
import { type GeneratedMesh, MeshBuilder, type RGB, addLoft, rgb, shade } from './MeshBuilder';
import { PALETTES, type Palette } from './palettes';

export interface RingOptions {
  radius?: number;
  tube?: number;
  segments?: number;
  tubeSides?: number;
  palette?: Palette;
  glow?: RGB;
  lod?: 0 | 1;
}

export function generateRing(opts: RingOptions = {}): GeneratedMesh {
  const radius = opts.radius ?? 6, tube = opts.tube ?? 0.32;
  const segments = opts.segments ?? (opts.lod ? 12 : 24), sides = opts.tubeSides ?? (opts.lod ? 4 : 6);
  const palette = opts.palette ?? PALETTES.meadow;
  const glow = opts.glow ?? rgb('#ffd166');
  const b = new MeshBuilder();
  const gFrame = b.group('ring-frame', shade(palette.stoneDark, 0.9), { roughness: 0.7, metallic: 0.2 });
  const gGlow = b.group('ring-glow', glow, { unlit: true, emissive: glow, emissiveStrength: 1.6 });
  const ring = (s: number): Vec3Like[] => {
    const a = (s / segments) * Math.PI * 2;
    const cx = Math.cos(a) * radius, cy = Math.sin(a) * radius;
    const out: Vec3Like[] = [];
    for (let k = 0; k < sides; k++) {
      const t = (k / sides) * Math.PI * 2;
      const r = tube * (1 + 0.15 * Math.cos(t * 2));
      out.push({ x: cx + Math.cos(a) * Math.cos(t) * r, y: cy + Math.sin(a) * Math.cos(t) * r, z: Math.sin(t) * r });
    }
    return out;
  };
  for (let s = 0; s < segments; s++) {
    const glowing = (s % 6) >= 4; // two glowing segments every six
    b.useGroup(glowing ? gGlow : gFrame);
    addLoft(b, [ring(s), ring(s + 1)], undefined, { closeRings: true });
  }
  return b.buildAll({ name: 'ring' });
}
