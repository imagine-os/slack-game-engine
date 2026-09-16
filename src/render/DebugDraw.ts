import { Color, type Vec2Like, type Vec3Like } from '../core/math';

export interface DebugLine { ax: number; ay: number; az: number; bx: number; by: number; bz: number; color: Color }
export interface DebugText { x: number; y: number; text: string; color: Color }

/**
 * Immediate-mode debug primitives in world space. Add shapes during update;
 * the renderer draws and clears them each frame. Disabled draws are dropped.
 */
export class DebugDraw {
  enabled = false;
  readonly lines: DebugLine[] = [];
  readonly texts: DebugText[] = [];
  private pool: DebugLine[] = [];

  private push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Color): void {
    const l = this.pool.pop() ?? { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, color: new Color() };
    l.ax = ax; l.ay = ay; l.az = az; l.bx = bx; l.by = by; l.bz = bz;
    l.color.copy(color);
    this.lines.push(l);
  }

  line(a: Vec2Like, b: Vec2Like, color: Color = Color.GREEN): void {
    if (this.enabled) this.push(a.x, a.y, 0, b.x, b.y, 0, color);
  }

  line3(a: Vec3Like, b: Vec3Like, color: Color = Color.GREEN): void {
    if (this.enabled) this.push(a.x, a.y, a.z, b.x, b.y, b.z, color);
  }

  /** Axis-aligned rectangle from center and size (2D). */
  rect(cx: number, cy: number, w: number, h: number, color: Color = Color.GREEN, angle = 0): void {
    if (!this.enabled) return;
    const hw = w / 2, hh = h / 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const px = [-hw, hw, hw, -hw];
    const py = [-hh, -hh, hh, hh];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.push(cx + px[i] * c - py[i] * s, cy + px[i] * s + py[i] * c, 0, cx + px[j] * c - py[j] * s, cy + px[j] * s + py[j] * c, 0, color);
    }
  }

  circle(cx: number, cy: number, r: number, color: Color = Color.GREEN, segments = 24): void {
    if (!this.enabled) return;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 0, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 0, color);
    }
  }

  /** Closed polygon from flat `[x0,y0,x1,y1,...]` points. */
  polygon(points: ArrayLike<number>, color: Color = Color.GREEN, ox = 0, oy = 0): void {
    if (!this.enabled) return;
    const n = points.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.push(ox + points[i * 2], oy + points[i * 2 + 1], 0, ox + points[j * 2], oy + points[j * 2 + 1], 0, color);
    }
  }

  /** Axis-aligned box (3D). */
  box3(min: Vec3Like, max: Vec3Like, color: Color = Color.GREEN): void {
    if (!this.enabled) return;
    const xs = [min.x, max.x], ys = [min.y, max.y], zs = [min.z, max.z];
    for (const y of ys) for (const z of zs) this.push(xs[0], y, z, xs[1], y, z, color);
    for (const x of xs) for (const z of zs) this.push(x, ys[0], z, x, ys[1], z, color);
    for (const x of xs) for (const y of ys) this.push(x, y, zs[0], x, y, zs[1], color);
  }

  text(x: number, y: number, text: string, color: Color = Color.WHITE): void {
    if (this.enabled) this.texts.push({ x, y, text, color });
  }

  /** Drop all primitives (renderer calls after drawing). */
  clear(): void {
    for (const l of this.lines) this.pool.push(l);
    this.lines.length = 0;
    this.texts.length = 0;
  }
}
