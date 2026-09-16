/**
 * Narrowphase collision routines for convex shapes. Shapes are expressed in
 * world space; polygons are flat CCW vertex arrays with precomputed normals.
 */

export interface CircleShape {
  kind: 'circle';
  x: number;
  y: number;
  r: number;
}

export interface PolygonShape {
  kind: 'polygon';
  /** World-space vertices, flat. */
  verts: Float64Array;
  /** Outward edge normals, flat, normals[i] belongs to edge verts[i]→verts[i+1]. */
  normals: Float64Array;
  count: number;
  /** Centroid (for reference). */
  cx: number;
  cy: number;
}

export type Shape2D = CircleShape | PolygonShape;

/** Contact manifold: normal points from A to B, up to two contact points. */
export interface Manifold {
  nx: number;
  ny: number;
  penetration: number;
  count: number;
  px: [number, number];
  py: [number, number];
}

export function createManifold(): Manifold {
  return { nx: 0, ny: 1, penetration: 0, count: 0, px: [0, 0], py: [0, 0] };
}

/** Build a world-space polygon from local flat points with a rigid transform + scale. */
export function transformPolygon(
  local: ArrayLike<number>,
  px: number,
  py: number,
  angle: number,
  sx: number,
  sy: number,
  ox: number,
  oy: number,
  out?: PolygonShape,
): PolygonShape {
  const count = local.length / 2;
  const shape: PolygonShape = out && out.count === count ? out : {
    kind: 'polygon', verts: new Float64Array(count * 2), normals: new Float64Array(count * 2), count, cx: 0, cy: 0,
  };
  const c = Math.cos(angle), s = Math.sin(angle);
  let cx = 0, cy = 0;
  for (let i = 0; i < count; i++) {
    const lx = (local[i * 2] + ox) * sx;
    const ly = (local[i * 2 + 1] + oy) * sy;
    const wx = px + lx * c - ly * s;
    const wy = py + lx * s + ly * c;
    shape.verts[i * 2] = wx;
    shape.verts[i * 2 + 1] = wy;
    cx += wx;
    cy += wy;
  }
  shape.cx = cx / count;
  shape.cy = cy / count;
  // Ensure CCW winding (negative scale can flip it).
  let area = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    area += shape.verts[i * 2] * shape.verts[j * 2 + 1] - shape.verts[j * 2] * shape.verts[i * 2 + 1];
  }
  if (area < 0) {
    for (let i = 0, j = count - 1; i < j; i++, j--) {
      const ax = shape.verts[i * 2], ay = shape.verts[i * 2 + 1];
      shape.verts[i * 2] = shape.verts[j * 2]; shape.verts[i * 2 + 1] = shape.verts[j * 2 + 1];
      shape.verts[j * 2] = ax; shape.verts[j * 2 + 1] = ay;
    }
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ex = shape.verts[j * 2] - shape.verts[i * 2];
    const ey = shape.verts[j * 2 + 1] - shape.verts[i * 2 + 1];
    const len = Math.hypot(ex, ey) || 1;
    shape.normals[i * 2] = ey / len;
    shape.normals[i * 2 + 1] = -ex / len;
  }
  return shape;
}

/** Local box corners (CCW) as flat points. */
export function boxPoints(w: number, h: number): number[] {
  const hw = w / 2, hh = h / 2;
  return [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
}

/** AABB of a shape: writes [minX, minY, maxX, maxY] into `out`. */
export function shapeAABB(s: Shape2D, out: number[] | Float64Array, o = 0): void {
  if (s.kind === 'circle') {
    out[o] = s.x - s.r; out[o + 1] = s.y - s.r; out[o + 2] = s.x + s.r; out[o + 3] = s.y + s.r;
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < s.count; i++) {
    const x = s.verts[i * 2], y = s.verts[i * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  out[o] = minX; out[o + 1] = minY; out[o + 2] = maxX; out[o + 3] = maxY;
}

export function collideCircles(a: CircleShape, b: CircleShape, m: Manifold): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const r = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-9) { m.nx = 0; m.ny = 1; m.penetration = r; }
  else { m.nx = dx / d; m.ny = dy / d; m.penetration = r - d; }
  m.count = 1;
  m.px[0] = a.x + m.nx * (a.r - m.penetration / 2);
  m.py[0] = a.y + m.ny * (a.r - m.penetration / 2);
  return true;
}

/** Circle A against polygon B. Normal points from A to B. */
export function collideCirclePolygon(a: CircleShape, b: PolygonShape, m: Manifold): boolean {
  // Find the face with minimum penetration of the circle centre.
  let bestSep = -Infinity;
  let bestFace = 0;
  for (let i = 0; i < b.count; i++) {
    const sep = b.normals[i * 2] * (a.x - b.verts[i * 2]) + b.normals[i * 2 + 1] * (a.y - b.verts[i * 2 + 1]);
    if (sep > a.r) return false;
    if (sep > bestSep) { bestSep = sep; bestFace = i; }
  }
  const i = bestFace, j = (bestFace + 1) % b.count;
  const v1x = b.verts[i * 2], v1y = b.verts[i * 2 + 1];
  const v2x = b.verts[j * 2], v2y = b.verts[j * 2 + 1];
  if (bestSep < 1e-9) {
    // Centre inside the polygon.
    m.nx = -b.normals[i * 2]; m.ny = -b.normals[i * 2 + 1];
    m.penetration = a.r - bestSep;
    m.count = 1;
    m.px[0] = a.x + m.nx * a.r; m.py[0] = a.y + m.ny * a.r;
    return true;
  }
  // Voronoi regions of the face.
  const d1 = (a.x - v1x) * (v2x - v1x) + (a.y - v1y) * (v2y - v1y);
  const d2 = (a.x - v2x) * (v1x - v2x) + (a.y - v2y) * (v1y - v2y);
  let cx: number, cy: number;
  if (d1 <= 0) { cx = v1x; cy = v1y; }
  else if (d2 <= 0) { cx = v2x; cy = v2y; }
  else {
    // Face region.
    const nx = b.normals[i * 2], ny = b.normals[i * 2 + 1];
    m.nx = -nx; m.ny = -ny;
    m.penetration = a.r - bestSep;
    m.count = 1;
    m.px[0] = a.x - nx * (bestSep + (a.r - bestSep) / 2); m.py[0] = a.y - ny * (bestSep + (a.r - bestSep) / 2);
    return true;
  }
  const dx = cx - a.x, dy = cy - a.y;
  const dist2 = dx * dx + dy * dy;
  if (dist2 > a.r * a.r) return false;
  const dist = Math.sqrt(dist2) || 1e-9;
  m.nx = dx / dist; m.ny = dy / dist;
  m.penetration = a.r - dist;
  m.count = 1;
  m.px[0] = cx; m.py[0] = cy;
  return true;
}

function findAxisLeastPenetration(a: PolygonShape, b: PolygonShape): { face: number; sep: number } {
  let bestSep = -Infinity;
  let bestFace = 0;
  for (let i = 0; i < a.count; i++) {
    const nx = a.normals[i * 2], ny = a.normals[i * 2 + 1];
    // Support point of B in direction -n.
    let best = Infinity;
    let sx = 0, sy = 0;
    for (let j = 0; j < b.count; j++) {
      const d = b.verts[j * 2] * nx + b.verts[j * 2 + 1] * ny;
      if (d < best) { best = d; sx = b.verts[j * 2]; sy = b.verts[j * 2 + 1]; }
    }
    const sep = nx * (sx - a.verts[i * 2]) + ny * (sy - a.verts[i * 2 + 1]);
    if (sep > bestSep) { bestSep = sep; bestFace = i; }
  }
  return { face: bestFace, sep: bestSep };
}

const _inc = new Float64Array(4);
const _clip = new Float64Array(4);

function clip(nx: number, ny: number, c: number, io: Float64Array): number {
  let sp = 0;
  const out = _clip;
  const d1 = nx * io[0] + ny * io[1] - c;
  const d2 = nx * io[2] + ny * io[3] - c;
  if (d1 <= 0) { out[sp * 2] = io[0]; out[sp * 2 + 1] = io[1]; sp++; }
  if (d2 <= 0) { out[sp * 2] = io[2]; out[sp * 2 + 1] = io[3]; sp++; }
  if (d1 * d2 < 0 && sp < 2) {
    const t = d1 / (d1 - d2);
    out[sp * 2] = io[0] + t * (io[2] - io[0]);
    out[sp * 2 + 1] = io[1] + t * (io[3] - io[1]);
    sp++;
  }
  io[0] = out[0]; io[1] = out[1]; io[2] = out[2]; io[3] = out[3];
  return sp;
}

/** Polygon vs polygon via SAT with reference/incident face clipping (two-point manifold). */
export function collidePolygons(a: PolygonShape, b: PolygonShape, m: Manifold): boolean {
  const ra = findAxisLeastPenetration(a, b);
  if (ra.sep >= 0) return false;
  const rb = findAxisLeastPenetration(b, a);
  if (rb.sep >= 0) return false;
  let ref: PolygonShape, inc: PolygonShape, refFace: number, flip: boolean;
  // Prefer A's axis unless B's is clearly better (bias for stability).
  if (ra.sep >= rb.sep * 0.95 + rb.sep * 0.01) { ref = a; inc = b; refFace = ra.face; flip = false; }
  else { ref = b; inc = a; refFace = rb.face; flip = true; }
  const rnx = ref.normals[refFace * 2], rny = ref.normals[refFace * 2 + 1];
  // Incident face: the face on inc most anti-parallel to the reference normal.
  let incFace = 0;
  let minDot = Infinity;
  for (let i = 0; i < inc.count; i++) {
    const d = rnx * inc.normals[i * 2] + rny * inc.normals[i * 2 + 1];
    if (d < minDot) { minDot = d; incFace = i; }
  }
  const i2 = (incFace + 1) % inc.count;
  _inc[0] = inc.verts[incFace * 2]; _inc[1] = inc.verts[incFace * 2 + 1];
  _inc[2] = inc.verts[i2 * 2]; _inc[3] = inc.verts[i2 * 2 + 1];
  const r2 = (refFace + 1) % ref.count;
  const v1x = ref.verts[refFace * 2], v1y = ref.verts[refFace * 2 + 1];
  const v2x = ref.verts[r2 * 2], v2y = ref.verts[r2 * 2 + 1];
  // Side planes along the reference face tangent.
  let tx = v2x - v1x, ty = v2y - v1y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl; ty /= tl;
  const negSide = -(tx * v1x + ty * v1y);
  const posSide = tx * v2x + ty * v2y;
  if (clip(-tx, -ty, negSide, _inc) < 2) return false;
  if (clip(tx, ty, posSide, _inc) < 2) return false;
  const refC = rnx * v1x + rny * v1y;
  m.nx = flip ? -rnx : rnx;
  m.ny = flip ? -rny : rny;
  m.count = 0;
  let maxPen = 0;
  for (let k = 0; k < 2; k++) {
    const sep = rnx * _inc[k * 2] + rny * _inc[k * 2 + 1] - refC;
    if (sep <= 0) {
      m.px[m.count] = _inc[k * 2];
      m.py[m.count] = _inc[k * 2 + 1];
      m.count++;
      if (-sep > maxPen) maxPen = -sep;
    }
  }
  if (m.count === 0) return false;
  m.penetration = maxPen;
  return true;
}

/** Dispatch on shape kinds. Normal always points from `a` toward `b`. */
export function collideShapes(a: Shape2D, b: Shape2D, m: Manifold): boolean {
  if (a.kind === 'circle') {
    if (b.kind === 'circle') return collideCircles(a, b, m);
    return collideCirclePolygon(a, b, m);
  }
  if (b.kind === 'circle') {
    if (!collideCirclePolygon(b, a, m)) return false;
    m.nx = -m.nx; m.ny = -m.ny;
    return true;
  }
  return collidePolygons(a, b, m);
}

/** Ray vs shape. Returns distance along the ray or -1; writes hit normal into `n`. */
export function raycastShape(s: Shape2D, ox: number, oy: number, dx: number, dy: number, maxDist: number, n: [number, number]): number {
  if (s.kind === 'circle') {
    const fx = ox - s.x, fy = oy - s.y;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - s.r * s.r;
    const disc = b * b - 4 * c;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / 2;
    if (t < 0 || t > maxDist) return -1;
    n[0] = (ox + dx * t - s.x) / s.r;
    n[1] = (oy + dy * t - s.y) / s.r;
    return t;
  }
  // Slab-like test against each edge half-plane (convex polygon).
  let tmin = 0, tmax = maxDist;
  let nIdx = -1;
  for (let i = 0; i < s.count; i++) {
    const nx = s.normals[i * 2], ny = s.normals[i * 2 + 1];
    const denom = nx * dx + ny * dy;
    const dist = nx * (s.verts[i * 2] - ox) + ny * (s.verts[i * 2 + 1] - oy);
    if (Math.abs(denom) < 1e-12) {
      if (dist < 0) return -1;
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > tmin) { tmin = t; nIdx = i; }
    } else if (t < tmax) tmax = t;
    if (tmin > tmax) return -1;
  }
  if (nIdx < 0) return -1;
  n[0] = s.normals[nIdx * 2];
  n[1] = s.normals[nIdx * 2 + 1];
  return tmin;
}

/** Point containment test. */
export function shapeContains(s: Shape2D, x: number, y: number): boolean {
  if (s.kind === 'circle') {
    const dx = x - s.x, dy = y - s.y;
    return dx * dx + dy * dy <= s.r * s.r;
  }
  for (let i = 0; i < s.count; i++) {
    if (s.normals[i * 2] * (x - s.verts[i * 2]) + s.normals[i * 2 + 1] * (y - s.verts[i * 2 + 1]) > 0) return false;
  }
  return true;
}
