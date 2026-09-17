import type { Mat4 } from '../../core/math';
import type { LodLevel } from '../components';

/**
 * Six clip planes extracted from a view-projection matrix (Gribb/Hartmann).
 * Planes are stored as `(nx, ny, nz, d)` with unit normals pointing inward, so
 * a point is inside when `dot(n, p) + d >= 0` for every plane.
 */
export class Frustum {
  /** 6 planes x 4 floats: left, right, bottom, top, near, far. */
  readonly planes = new Float32Array(24);

  setFromMatrix(viewProj: Mat4 | Float32Array): this {
    const m = viewProj instanceof Float32Array ? viewProj : viewProj.m;
    const p = this.planes;
    // Rows of the column-major matrix.
    const r0 = [m[0], m[4], m[8], m[12]];
    const r1 = [m[1], m[5], m[9], m[13]];
    const r2 = [m[2], m[6], m[10], m[14]];
    const r3 = [m[3], m[7], m[11], m[15]];
    const set = (i: number, a: number[], b: number[], sign: number) => {
      const nx = a[0] + sign * b[0], ny = a[1] + sign * b[1], nz = a[2] + sign * b[2], d = a[3] + sign * b[3];
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      p[i * 4] = nx * inv; p[i * 4 + 1] = ny * inv; p[i * 4 + 2] = nz * inv; p[i * 4 + 3] = d * inv;
    };
    set(0, r3, r0, 1);   // left
    set(1, r3, r0, -1);  // right
    set(2, r3, r1, 1);   // bottom
    set(3, r3, r1, -1);  // top
    set(4, r3, r2, 1);   // near
    set(5, r3, r2, -1);  // far
    return this;
  }

  /** True when the sphere is at least partially inside. */
  containsSphere(x: number, y: number, z: number, radius: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -radius) return false;
    }
    return true;
  }

  containsPoint(x: number, y: number, z: number): boolean {
    return this.containsSphere(x, y, z, 0);
  }
}

/**
 * World-space bounding sphere of a local sphere under an affine matrix:
 * transforms the centre and scales the radius by the largest axis scale.
 * Writes `[x, y, z, r]` into `out`.
 */
export function transformSphere(m: Float32Array, center: ArrayLike<number>, radius: number, out: Float32Array): Float32Array {
  const cx = center[0], cy = center[1], cz = center[2];
  out[0] = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
  out[1] = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
  out[2] = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
  const sx = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
  const sy = m[4] * m[4] + m[5] * m[5] + m[6] * m[6];
  const sz = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
  out[3] = radius * Math.sqrt(Math.max(sx, sy, sz));
  return out;
}

/**
 * Pick the LOD level for a camera distance. Returns the index of the last
 * level whose `distance` is at or below `distance`, or -1 for the base mesh.
 * Levels must be sorted by ascending distance.
 */
export function selectLod(lods: readonly LodLevel[] | undefined, distance: number): number {
  if (!lods || lods.length === 0) return -1;
  let pick = -1;
  for (let i = 0; i < lods.length; i++) {
    if (distance >= lods[i].distance) pick = i;
    else break;
  }
  return pick;
}
