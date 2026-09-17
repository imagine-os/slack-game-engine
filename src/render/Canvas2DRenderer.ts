import { Color, Vec2, Vec3, type Vec3Like, clamp01 } from '../core/math';
import type { World } from '../core/ecs/World';
import { Transform } from '../core/ecs/Transform';
import type { Entity } from '../core/ecs/Entity';
import type { Atlas, AtlasFrame } from '../assets/types';
import { DebugDraw } from './DebugDraw';
import { compareLayerOrder, createRenderStats, type Renderer, type RendererHost, type RendererOptions, type RenderStats } from './Renderer';
import {
  type BlendMode, Camera2D, Light2D, ParticleEmitter, Shape, Sprite, Text, Tilemap,
} from './components';

type Drawable = Sprite | Shape | Text | Tilemap | ParticleEmitter;

interface RenderItem {
  layer: number;
  order: number;
  drawable: Drawable;
  transform: Transform;
}

const BLEND_OPS: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  add: 'lighter',
  multiply: 'multiply',
  screen: 'screen',
};

/**
 * Canvas 2D renderer: y-up world units, camera with zoom/rotation/follow,
 * layered sprites (atlases, flips, tint), shapes, text, tilemaps, particles,
 * a multiply-composited light map and debug overlay. Supports HiDPI and a
 * pixel-perfect mode for pixel art.
 */
export class Canvas2DRenderer implements Renderer {
  readonly kind = '2d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly debug = new DebugDraw();
  readonly clearColor = new Color(0.08, 0.09, 0.12, 1);
  readonly stats: RenderStats = createRenderStats();
  pixelsPerUnit: number;
  pixelPerfect: boolean;
  hidpi: boolean;

  width = 0;
  height = 0;
  pixelRatio = 1;

  /** Camera state used for the last frame (world units). */
  readonly camera = { x: 0, y: 0, zoom: 1, angle: 0 };

  private host: RendererHost | null = null;
  private items: RenderItem[] = [];
  private itemPool: RenderItem[] = [];
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightCtx: CanvasRenderingContext2D | null = null;
  private tintCache = new Map<string, HTMLCanvasElement>();
  private colorCache = new Map<string, string[]>();

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.pixelsPerUnit = opts.pixelsPerUnit ?? 32;
    this.pixelPerfect = opts.pixelPerfect ?? false;
    this.hidpi = opts.hidpi ?? true;
    if (opts.clearColor) this.clearColor.setHex(opts.clearColor);
    this.resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
  }

  init(host: RendererHost): void {
    this.host = host;
  }

  resize(width: number, height: number, pixelRatio?: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = pixelRatio ?? (this.hidpi && typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.canvas.width = Math.floor(this.width * this.pixelRatio);
    this.canvas.height = Math.floor(this.height * this.pixelRatio);
  }

  // --------------------------------------------------------------- camera

  private findCamera(world: World): { cam: Camera2D | null; t: Transform | null } {
    let best: Camera2D | null = null;
    let bestT: Transform | null = null;
    for (const cam of world.componentsOfType(Camera2D)) {
      if (!cam.active) continue;
      if (!best || cam.priority > best.priority) {
        best = cam;
        bestT = world.getComponent(cam.entity, Transform) ?? null;
      }
    }
    return { cam: best, t: bestT };
  }

  /** Apply the world→canvas transform for the current camera. */
  private applyCamera(ctx: CanvasRenderingContext2D): void {
    const s = this.camera.zoom * this.pixelsPerUnit;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(s, -s);
    ctx.rotate(-this.camera.angle);
    ctx.translate(-this.camera.x, -this.camera.y);
  }

  screenToWorld(sx: number, sy: number, out: Vec3): Vec3 {
    const s = this.camera.zoom * this.pixelsPerUnit;
    let x = (sx - this.width / 2) / s;
    let y = -(sy - this.height / 2) / s;
    const c = Math.cos(this.camera.angle), sn = Math.sin(this.camera.angle);
    const rx = x * c - y * sn;
    const ry = x * sn + y * c;
    x = rx + this.camera.x;
    y = ry + this.camera.y;
    return out.set(x, y, 0);
  }

  worldToScreen(p: Vec3Like, out: Vec2): Vec2 {
    const s = this.camera.zoom * this.pixelsPerUnit;
    const dx = p.x - this.camera.x;
    const dy = p.y - this.camera.y;
    const c = Math.cos(-this.camera.angle), sn = Math.sin(-this.camera.angle);
    const rx = dx * c - dy * sn;
    const ry = dx * sn + dy * c;
    return out.set(rx * s + this.width / 2, -ry * s + this.height / 2);
  }

  // --------------------------------------------------------------- render

  render(world: World, _alpha: number): void {
    const ctx = this.ctx;
    const stats = this.stats;
    stats.drawCalls = 0;
    stats.primitives = 0;
    const { cam, t: camT } = this.findCamera(world);
    let bg = this.clearColor;
    if (cam && camT) {
      this.camera.x = camT.worldMatrix.m[12];
      this.camera.y = camT.worldMatrix.m[13];
      this.camera.zoom = Math.max(0.0001, cam.zoom);
      this.camera.angle = camT.getWorldAngle();
      bg = cam.backgroundColor;
      const s = this.camera.zoom * this.pixelsPerUnit;
      cam.viewHalfSize.set(this.width / 2 / s, this.height / 2 / s);
      if (cam.pixelPerfect || this.pixelPerfect) {
        this.camera.x = Math.round(this.camera.x * s) / s;
        this.camera.y = Math.round(this.camera.y * s) / s;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg.toCSS();
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = !(this.pixelPerfect || cam?.pixelPerfect);
    this.applyCamera(ctx);

    this.collect(world);
    const items = this.items;
    items.sort(compareLayerOrder);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const d = it.drawable;
      if (d instanceof Sprite) this.drawSprite(ctx, d, it.transform);
      else if (d instanceof Shape) this.drawShape(ctx, d, it.transform);
      else if (d instanceof Text) { if (!d.screenSpace) this.drawText(ctx, d, it.transform, false); }
      else if (d instanceof Tilemap) this.drawTilemap(ctx, d, it.transform);
      else if (d instanceof ParticleEmitter) this.drawParticles(ctx, d, it.transform);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.renderLighting(world, cam);
    this.renderDebug(ctx);

    // Screen-space text on top of everything.
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    for (let i = 0; i < items.length; i++) {
      const d = items[i].drawable;
      if (d instanceof Text && d.screenSpace) this.drawText(ctx, d, items[i].transform, true);
    }
    this.recycleItems();
  }

  private collect(world: World): void {
    this.recycleItems();
    const push = (d: Drawable, layer: number, order: number, e: Entity) => {
      const t = world.getComponent(e, Transform);
      if (!t) return;
      const it = this.itemPool.pop() ?? { layer: 0, order: 0, drawable: d, transform: t };
      it.layer = layer;
      it.order = order;
      it.drawable = d;
      it.transform = t;
      this.items.push(it);
    };
    for (const s of world.componentsOfType(Sprite)) if (s.visible) push(s, s.layer, s.order, s.entity);
    for (const s of world.componentsOfType(Shape)) if (s.visible) push(s, s.layer, s.order, s.entity);
    for (const s of world.componentsOfType(Text)) if (s.visible) push(s, s.layer, s.order, s.entity);
    for (const s of world.componentsOfType(Tilemap)) if (s.visible) push(s, s.layer, s.order, s.entity);
    for (const s of world.componentsOfType(ParticleEmitter)) if (s.visible) push(s, s.layer, s.order, s.entity);
  }

  private recycleItems(): void {
    for (const it of this.items) this.itemPool.push(it);
    this.items.length = 0;
  }

  /** Apply an entity's world matrix as a 2D affine transform. */
  private applyTransform(ctx: CanvasRenderingContext2D, t: Transform): void {
    const m = t.worldMatrix.m;
    ctx.transform(m[0], m[1], m[4], m[5], m[12], m[13]);
  }

  private resolveImage(id: string, frame: string): { img: HTMLImageElement | HTMLCanvasElement; f: AtlasFrame | null } | null {
    const asset = this.host?.getAsset<HTMLImageElement | HTMLCanvasElement | Atlas>(id);
    if (!asset) return null;
    if (asset instanceof HTMLImageElement || asset instanceof HTMLCanvasElement) return { img: asset, f: null };
    const atlas = asset as Atlas;
    const img = this.host?.getAsset<HTMLImageElement>(atlas.image);
    if (!img) return null;
    const f = atlas.frames[frame] ?? Object.values(atlas.frames)[0];
    return f ? { img, f } : null;
  }

  private drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, t: Transform): void {
    const res = this.resolveImage(s.texture, s.frame);
    const ppu = this.pixelsPerUnit;
    ctx.save();
    this.applyTransform(ctx, t);
    ctx.globalAlpha = s.alpha * s.tint.a;
    ctx.globalCompositeOperation = BLEND_OPS[s.blend];
    if (!res) {
      // Missing texture: magenta placeholder box.
      const w = s.width || 1, h = s.height || 1;
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(-w * s.pivot.x, -h * s.pivot.y, w, h);
      ctx.restore();
      this.stats.drawCalls++;
      return;
    }
    let { img } = res;
    const f = res.f;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (f) { sx = f.x; sy = f.y; sw = f.w; sh = f.h; }
    else if (s.sourceRect.width > 0) { sx = s.sourceRect.x; sy = s.sourceRect.y; sw = s.sourceRect.width; sh = s.sourceRect.height; }
    const w = s.width || sw / ppu;
    const h = s.height || sh / ppu;
    const px = f?.pivotX ?? s.pivot.x;
    const py = f?.pivotY ?? s.pivot.y;
    if (!s.tint.equals(Color.WHITE) && (s.tint.r < 1 || s.tint.g < 1 || s.tint.b < 1)) {
      img = this.tinted(img, sx, sy, sw, sh, s.tint);
      sx = 0; sy = 0;
    }
    ctx.scale(s.flipX ? -1 : 1, s.flipY ? 1 : -1);
    const dx = s.flipX ? -(1 - px) * w : -px * w;
    const dy = s.flipY ? -py * h : -(1 - py) * h;
    if (this.pixelPerfect) {
      ctx.drawImage(img, sx, sy, sw, sh, Math.round(dx * ppu) / ppu, Math.round(dy * ppu) / ppu, w, h);
    } else ctx.drawImage(img, sx, sy, sw, sh, dx, dy, w, h);
    ctx.restore();
    this.stats.drawCalls++;
    this.stats.primitives++;
  }

  /** Cache a multiplied-tint copy of a sub-image (keyed by source, rect and colour). */
  private tinted(img: HTMLImageElement | HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, tint: Color): HTMLCanvasElement {
    const key = `${(img as HTMLImageElement).src ?? 'c'}|${sx},${sy},${sw},${sh}|${tint.toHex(false)}`;
    let c = this.tintCache.get(key);
    if (c) return c;
    if (this.tintCache.size > 256) this.tintCache.clear();
    c = document.createElement('canvas');
    c.width = Math.max(1, sw);
    c.height = Math.max(1, sh);
    const cx = c.getContext('2d')!;
    cx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = tint.toHex(false);
    cx.fillRect(0, 0, sw, sh);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    this.tintCache.set(key, c);
    return c;
  }

  private drawShape(ctx: CanvasRenderingContext2D, s: Shape, t: Transform): void {
    ctx.save();
    this.applyTransform(ctx, t);
    ctx.globalAlpha = s.alpha;
    ctx.globalCompositeOperation = BLEND_OPS[s.blend];
    ctx.beginPath();
    switch (s.kind) {
      case 'rect': ctx.rect(-s.width / 2, -s.height / 2, s.width, s.height); break;
      case 'circle': ctx.arc(0, 0, s.radius, 0, Math.PI * 2); break;
      case 'ellipse': ctx.ellipse(0, 0, s.width / 2, s.height / 2, 0, 0, Math.PI * 2); break;
      case 'polygon':
      case 'line': {
        const p = s.points;
        for (let i = 0; i + 1 < p.length; i += 2) {
          if (i === 0) ctx.moveTo(p[i], p[i + 1]);
          else ctx.lineTo(p[i], p[i + 1]);
        }
        if (s.kind === 'polygon') ctx.closePath();
        break;
      }
    }
    if (s.filled && s.kind !== 'line') {
      ctx.fillStyle = s.fill.toCSS();
      ctx.fill();
    }
    if (s.strokeWidth > 0 || s.kind === 'line') {
      ctx.lineWidth = s.strokeWidth || 1 / this.pixelsPerUnit;
      ctx.strokeStyle = s.stroke.toCSS();
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
    this.stats.drawCalls++;
    this.stats.primitives++;
  }

  private drawText(ctx: CanvasRenderingContext2D, txt: Text, t: Transform, screen: boolean): void {
    ctx.save();
    let size: number;
    if (screen) {
      ctx.translate(t.worldMatrix.m[12], t.worldMatrix.m[13]);
      size = txt.size;
    } else {
      this.applyTransform(ctx, t);
      ctx.scale(1, -1);
      size = txt.size;
    }
    ctx.globalAlpha = txt.alpha * txt.color.a;
    ctx.font = `${txt.bold ? 'bold ' : ''}${size}px ${txt.font}`;
    ctx.textAlign = txt.align;
    ctx.textBaseline = txt.baseline;
    const lines = this.wrap(ctx, txt.text, txt.maxWidth);
    const lineH = size * 1.2;
    const startY = txt.baseline === 'middle' ? -((lines.length - 1) * lineH) / 2 : 0;
    for (let i = 0; i < lines.length; i++) {
      const y = startY + i * lineH;
      if (txt.outlineWidth > 0) {
        ctx.lineWidth = txt.outlineWidth;
        ctx.strokeStyle = txt.outline.toCSS();
        ctx.lineJoin = 'round';
        ctx.strokeText(lines[i], 0, y);
      }
      ctx.fillStyle = txt.color.toCSS();
      ctx.fillText(lines[i], 0, y);
    }
    ctx.restore();
    this.stats.drawCalls++;
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const paragraphs = text.split('\n');
    if (maxWidth <= 0) return paragraphs;
    const out: string[] = [];
    for (const p of paragraphs) {
      const words = p.split(' ');
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxWidth && line) {
          out.push(line);
          line = w;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  private drawTilemap(ctx: CanvasRenderingContext2D, tm: Tilemap, t: Transform): void {
    const img = this.host?.getAsset<HTMLImageElement>(tm.tileset);
    if (!img) return;
    const cols = tm.columns || Math.max(1, Math.floor(img.width / tm.tileWidth));
    ctx.save();
    this.applyTransform(ctx, t);
    ctx.globalAlpha = tm.alpha;
    // Cull to the visible region (tilemap-local units, assuming no rotation for culling).
    const inv = 1 / (this.camera.zoom * this.pixelsPerUnit);
    const halfW = (this.width / 2) * inv + tm.tileSize * 2;
    const halfH = (this.height / 2) * inv + tm.tileSize * 2;
    const ox = t.worldMatrix.m[12], oy = t.worldMatrix.m[13];
    const minX = Math.max(0, Math.floor((this.camera.x - halfW - ox) / tm.tileSize));
    const maxX = Math.min(tm.width - 1, Math.ceil((this.camera.x + halfW - ox) / tm.tileSize));
    const minY = Math.max(0, Math.floor((oy - (this.camera.y + halfH)) / tm.tileSize));
    const maxY = Math.min(tm.height - 1, Math.ceil((oy - (this.camera.y - halfH)) / tm.tileSize));
    const ts = tm.tileSize;
    const pad = this.pixelPerfect ? 0 : 0.002; // hide seams
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = tm.data[y * tm.width + x];
        if (!idx) continue;
        const tile = idx - 1;
        const sx = (tile % cols) * tm.tileWidth;
        const sy = Math.floor(tile / cols) * tm.tileHeight;
        ctx.save();
        ctx.translate(x * ts, -(y + 1) * ts);
        ctx.scale(1, -1);
        ctx.drawImage(img, sx, sy, tm.tileWidth, tm.tileHeight, -pad, -ts - pad, ts + pad * 2, ts + pad * 2);
        ctx.restore();
        this.stats.primitives++;
      }
    }
    ctx.restore();
    this.stats.drawCalls++;
  }

  private gradientColors(em: ParticleEmitter): string[] {
    const key = em.startColor.toHex(true) + em.endColor.toHex(true);
    let list = this.colorCache.get(key);
    if (list) return list;
    list = [];
    const c = new Color();
    for (let i = 0; i < 32; i++) {
      c.copy(em.startColor).lerp(em.endColor, i / 31);
      list.push(c.toCSS());
    }
    if (this.colorCache.size > 64) this.colorCache.clear();
    this.colorCache.set(key, list);
    return list;
  }

  private drawParticles(ctx: CanvasRenderingContext2D, em: ParticleEmitter, t: Transform): void {
    if (em.particles.length === 0) return;
    ctx.save();
    if (!em.worldSpace) this.applyTransform(ctx, t);
    ctx.globalCompositeOperation = BLEND_OPS[em.blend];
    const img = em.texture ? this.host?.getAsset<HTMLImageElement>(em.texture) : undefined;
    const colors = this.gradientColors(em);
    const list = em.particles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const f = clamp01(1 - p.life / p.maxLife);
      const size = p.size + (em.endSize - p.size) * f;
      if (size <= 0) continue;
      const ci = Math.min(31, Math.floor(f * 31));
      const alpha = em.startColor.a + (em.endColor.a - em.startColor.a) * f;
      ctx.globalAlpha = clamp01(alpha);
      if (img) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(1, -1);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.fillStyle = colors[ci];
        ctx.beginPath();
        ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    this.stats.drawCalls++;
    this.stats.primitives += list.length;
  }

  /** Multiply-composite a light map when ambient light is not white or Light2D components exist. */
  private renderLighting(world: World, cam: Camera2D | null): void {
    const lights = world.componentsOfType(Light2D);
    const ambient = cam?.ambientLight ?? Color.WHITE;
    const needs = lights.length > 0 || ambient.r < 1 || ambient.g < 1 || ambient.b < 1;
    if (!needs) return;
    if (!this.lightCanvas) {
      this.lightCanvas = document.createElement('canvas');
      this.lightCtx = this.lightCanvas.getContext('2d');
    }
    const lc = this.lightCanvas;
    const lx = this.lightCtx!;
    if (lc.width !== this.canvas.width || lc.height !== this.canvas.height) {
      lc.width = this.canvas.width;
      lc.height = this.canvas.height;
    }
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalCompositeOperation = 'source-over';
    lx.fillStyle = ambient.toCSS();
    lx.fillRect(0, 0, lc.width, lc.height);
    this.applyCamera(lx);
    lx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.enabled) continue;
      const t = world.getComponent(l.entity, Transform);
      if (!t) continue;
      const x = t.worldMatrix.m[12], y = t.worldMatrix.m[13];
      const g = lx.createRadialGradient(x, y, l.radius * clamp01(l.falloff), x, y, l.radius);
      const c = l.color;
      const k = l.intensity;
      g.addColorStop(0, `rgba(${Math.round(clamp01(c.r * k) * 255)},${Math.round(clamp01(c.g * k) * 255)},${Math.round(clamp01(c.b * k) * 255)},${clamp01(c.a)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lx.fillStyle = g;
      lx.fillRect(x - l.radius, y - l.radius, l.radius * 2, l.radius * 2);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lc, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    this.stats.drawCalls += 1 + lights.length;
  }

  private renderDebug(ctx: CanvasRenderingContext2D): void {
    const dbg = this.debug;
    if (!dbg.enabled) { dbg.clear(); return; }
    this.applyCamera(ctx);
    ctx.lineWidth = 1 / (this.camera.zoom * this.pixelsPerUnit);
    let last = '';
    ctx.beginPath();
    for (const l of dbg.lines) {
      const css = l.color.toCSS();
      if (css !== last) {
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = css;
        last = css;
      }
      ctx.moveTo(l.ax, l.ay);
      ctx.lineTo(l.bx, l.by);
    }
    ctx.stroke();
    if (dbg.texts.length) {
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const p = new Vec2();
      for (const t of dbg.texts) {
        this.worldToScreen({ x: t.x, y: t.y, z: 0 }, p);
        ctx.fillStyle = t.color.toCSS();
        ctx.fillText(t.text, p.x, p.y);
      }
    }
    dbg.clear();
  }

  dispose(): void {
    this.tintCache.clear();
    this.colorCache.clear();
    this.lightCanvas = null;
    this.lightCtx = null;
  }
}
