/**
 * Soft two-tone clouds: merged flattened icospheres, lit tops and shaded
 * undersides as two colour groups.
 */
import { Random } from '../core/math/Random';
import { type GeneratedMesh, MeshBuilder, type RGB, addIcosphere, mixRGB, rgb } from './MeshBuilder';
import { Noise } from './noise';

export interface CloudOptions {
  /** Approximate length. Default 14..26. */
  size?: number;
  puffs?: number;
  light?: RGB;
  shadow?: RGB;
  lod?: 0 | 1;
}

export function generateCloud(seed: number, opts: CloudOptions = {}): GeneratedMesh {
  const rng = new Random(seed);
  const size = opts.size ?? rng.range(14, 26);
  const puffs = opts.puffs ?? (opts.lod ? 3 : rng.int(4, 8));
  const light = opts.light ?? rgb('#fff8f0');
  const shadow = opts.shadow ?? rgb('#d9c6e8');
  const noise = new Noise(seed);
  const b = new MeshBuilder();
  const gLight = b.group('cloud-light', light, { roughness: 1 });
  const gShade = b.group('cloud-shade', shadow, { roughness: 1 });
  b.useGroup(gLight);
  for (let i = 0; i < puffs; i++) {
    const t = puffs === 1 ? 0.5 : i / (puffs - 1);
    const along = (t - 0.5) * size * 0.75;
    const r = size * (0.16 + 0.12 * Math.sin(t * Math.PI)) * rng.range(0.85, 1.15);
    const start = b.triangleCount;
    addIcosphere(b, r, opts.lod ? 0 : 1, undefined, (d) => r * (0.88 + 0.18 * noise.simplex3(d.x * 1.5 + i * 3, d.y * 1.5, d.z * 1.5)));
    const oz = rng.range(-0.18, 0.18) * size, oy = rng.range(-0.05, 0.12) * size * Math.sin(t * Math.PI);
    b.displace((p, idx) => { if (idx >= start * 3) { p.y *= 0.55; if (p.y < -r * 0.25) p.y = -r * 0.25 + (p.y + r * 0.25) * 0.3; p.x += along; p.y += oy; p.z += oz; } });
  }
  b.regroupFaces((n) => (n.y > 0.12 ? gLight : gShade));
  b.colorFaces((n, _c, g) => (g === gLight ? mixRGB(light, shadow, Math.max(0, 0.4 - n.y) * 0.6) : mixRGB(shadow, light, Math.max(0, n.y + 0.3) * 0.4)));
  return b.buildAll({ name: `cloud-${seed}` });
}
