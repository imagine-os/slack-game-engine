import { Mat4, Vec3, type Vec3Like } from '../../core/math';

/** Result of fitting a directional shadow frustum to the camera view. */
export interface ShadowFit {
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  /** Centre of the bounding sphere around the covered part of the camera frustum. */
  center: Vec3;
  /** Radius of that sphere (half the orthographic extent). */
  radius: number;
  /** Orthographic near/far along the light direction. */
  near: number;
  far: number;
  /** World size of one shadow-map texel. */
  texelSize: number;
}

export function createShadowFit(): ShadowFit {
  return { view: new Mat4(), proj: new Mat4(), viewProj: new Mat4(), center: new Vec3(), radius: 1, near: 0, far: 1, texelSize: 1 };
}

const _corner = new Vec3();
const _dir = new Vec3();
const _up = new Vec3();
const _eye = new Vec3();
const _rot = new Mat4();
const _rotInv = new Mat4();
const _tmp = new Vec3();

/**
 * NDC depth of a view-space distance `d` for an OpenGL perspective projection
 * (near..far → -1..1). Returns 1 when `d >= far`.
 */
export function perspectiveNdcDepth(d: number, near: number, far: number): number {
  if (d >= far) return 1;
  if (d <= near) return -1;
  return (2 * far * near - (far + near) * d) / (d * (near - far));
}

/**
 * Fit an orthographic light frustum around the camera frustum between the
 * camera near plane and `shadowDistance`. The fit uses a bounding sphere so
 * its size is stable under camera rotation, and the centre is snapped to the
 * shadow-map texel grid so shadow edges do not shimmer when the camera moves.
 *
 * `camInvViewProj` is the inverse of the camera view-projection matrix, and
 * `ndcFarDepth` the NDC depth (-1..1) at which to cut the frustum (use
 * {@link perspectiveNdcDepth} or 1 for the full camera far plane).
 * `lightDir` is the direction light travels (from the sun toward the scene).
 */
export function fitDirectionalShadow(
  camInvViewProj: Mat4,
  ndcFarDepth: number,
  lightDir: Vec3Like,
  mapSize: number,
  out: ShadowFit,
  casterMargin = 1,
): ShadowFit {
  // Frustum slice corners.
  const center = out.center.set(0, 0, 0);
  const corners: number[] = [];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? 1 : -1, y = i & 2 ? 1 : -1, z = i & 4 ? ndcFarDepth : -1;
    camInvViewProj.transformPoint({ x, y, z }, _corner);
    corners.push(_corner.x, _corner.y, _corner.z);
    center.add(_corner);
  }
  center.scale(1 / 8);
  let radius = 0;
  for (let i = 0; i < 8; i++) {
    const dx = corners[i * 3] - center.x, dy = corners[i * 3 + 1] - center.y, dz = corners[i * 3 + 2] - center.z;
    radius = Math.max(radius, Math.hypot(dx, dy, dz));
  }
  radius = Math.max(radius, 1e-3);
  // Round the radius up so the texel size only changes in coarse steps.
  radius = Math.ceil(radius * 16) / 16;
  out.radius = radius;
  out.texelSize = (2 * radius) / mapSize;

  _dir.copy(lightDir).normalize();
  if (_dir.lengthSq() < 1e-8) _dir.set(0, -1, 0);
  if (Math.abs(_dir.y) > 0.99) _up.set(0, 0, 1); else _up.set(0, 1, 0);

  // Snap the centre to texels in light space (rotation only).
  _rot.lookAt(Vec3.ZERO, _dir, _up);
  _rot.transformPoint(center, _tmp);
  _tmp.x = Math.round(_tmp.x / out.texelSize) * out.texelSize;
  _tmp.y = Math.round(_tmp.y / out.texelSize) * out.texelSize;
  _rotInv.copy(_rot).invert().transformPoint(_tmp, center);

  const back = radius * casterMargin;
  _eye.copy(center).addScaled(_dir, -(radius + back));
  out.near = 0;
  out.far = 2 * radius + back;
  out.view.lookAt(_eye, center, _up);
  out.proj.orthographic(-radius, radius, -radius, radius, out.near, out.far);
  Mat4.multiply(out.proj, out.view, out.viewProj);
  return out;
}
