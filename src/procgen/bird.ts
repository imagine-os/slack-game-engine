/**
 * A tiny bird in two wing poses (`up` / `down`); swapping meshes at 6-8 Hz
 * reads as flapping. Forward is -Z.
 */
import { type GeneratedMesh, MeshBuilder, type RGB, addIcosphere, rgb, shade } from './MeshBuilder';

export type BirdPose = 'up' | 'down' | 'glide';

export interface BirdOptions {
  pose?: BirdPose;
  color?: RGB;
  belly?: RGB;
  /** Body length. Default 0.5. */
  size?: number;
}

export function generateBird(opts: BirdOptions = {}): GeneratedMesh {
  const pose = opts.pose ?? 'glide';
  const size = opts.size ?? 0.5;
  const color = opts.color ?? rgb('#2a2f45');
  const belly = opts.belly ?? rgb('#e8e0d0');
  const b = new MeshBuilder();
  const gBody = b.group('bird', color, { roughness: 0.9 });
  const gBelly = b.group('bird-belly', belly, { roughness: 0.9 });
  b.useGroup(gBody);
  const start = b.triangleCount;
  addIcosphere(b, size * 0.18, 0);
  b.displace((p, idx) => { if (idx >= start * 3) { p.z *= 2.4; p.x *= 0.9; } });
  b.regroupFaces((n) => (n.y < -0.3 ? gBelly : gBody));
  // Head + beak.
  b.useGroup(gBody);
  b.tri({ x: 0, y: size * 0.12, z: -size * 0.4 }, { x: -size * 0.06, y: size * 0.02, z: -size * 0.38 }, { x: size * 0.06, y: size * 0.02, z: -size * 0.38 }, shade(color, 1.1));
  b.tri({ x: -size * 0.06, y: size * 0.02, z: -size * 0.38 }, { x: 0, y: size * 0.04, z: -size * 0.58 }, { x: size * 0.06, y: size * 0.02, z: -size * 0.38 }, rgb('#ffb347'));
  // Wings: two segments each so the tips fold.
  const lift = pose === 'up' ? 0.55 : pose === 'down' ? -0.45 : 0.08;
  const tipLift = pose === 'up' ? 0.5 : pose === 'down' ? -0.6 : 0.2;
  for (const side of [1, -1] as const) {
    const root = { x: side * size * 0.12, y: size * 0.02, z: 0 };
    const mid = { x: side * size * 0.55, y: size * 0.02 + lift * size * 0.5, z: size * 0.05 };
    const tip = { x: side * size * 1.0, y: mid.y + tipLift * size * 0.45, z: size * 0.18 };
    const chord = size * 0.28;
    const q = (a: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, e: { x: number; y: number; z: number }) => {
      if (side === 1) { b.quad(a, c, d, e); b.quad(e, d, c, a, belly); } else { b.quad(e, d, c, a); b.quad(a, c, d, e, belly); }
    };
    b.useGroup(gBody);
    q({ x: root.x, y: root.y, z: root.z - chord * 0.5 }, { x: root.x, y: root.y, z: root.z + chord * 0.5 }, { x: mid.x, y: mid.y, z: mid.z + chord * 0.4 }, { x: mid.x, y: mid.y, z: mid.z - chord * 0.4 });
    q({ x: mid.x, y: mid.y, z: mid.z - chord * 0.4 }, { x: mid.x, y: mid.y, z: mid.z + chord * 0.4 }, { x: tip.x, y: tip.y, z: tip.z + chord * 0.1 }, { x: tip.x, y: tip.y, z: tip.z - chord * 0.15 });
  }
  // Tail feathers.
  b.tri({ x: -size * 0.12, y: 0, z: size * 0.55 }, { x: size * 0.12, y: 0, z: size * 0.55 }, { x: 0, y: size * 0.02, z: size * 0.3 });
  b.tri({ x: size * 0.12, y: 0, z: size * 0.55 }, { x: -size * 0.12, y: 0, z: size * 0.55 }, { x: 0, y: -size * 0.01, z: size * 0.3 }, belly);
  return b.buildAll({ name: `bird-${pose}` });
}
