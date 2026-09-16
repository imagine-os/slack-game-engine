import type { Engine } from '../../core/Engine';
import type { Entity } from '../../core/ecs/Entity';
import { Transform } from '../../core/ecs/Transform';
import { Vec3 } from '../../core/math';
import { Camera2D, Camera3D } from '../../render/components';
import { OrbitController } from '../../render/webgl/OrbitController';
import type { SceneEditor } from '../project/SceneEditor';

/** Serializable camera pose (bookmarks, per-scene persistence, follow-user). */
export interface CameraPose {
  x: number; y: number; zoom: number;
  /** 3D orbit fields. */
  tx?: number; ty?: number; tz?: number; yaw?: number; pitch?: number; distance?: number;
}

/**
 * The editor's own camera: an editor-owned entity with a very high priority
 * so the renderer uses it instead of scene cameras. 2D pans/zooms the
 * Canvas2D camera; 3D drives an {@link OrbitController}.
 */
export class EditorCamera {
  entity: Entity = 0;
  /** 2D state (world units). */
  x = 0;
  y = 0;
  zoom = 1;
  /** 3D state. */
  readonly orbit: OrbitController | null = null;
  private cam2d: Camera2D | null = null;
  private cam3d: Camera3D | null = null;
  private transform: Transform | null = null;

  constructor(readonly engine: Engine, readonly scene: SceneEditor, readonly is3d: boolean) {
    this.create();
    if (is3d) {
      this.orbit = new OrbitController(this.transform!, null);
      this.orbit.distance = 14;
      this.orbit.yaw = Math.PI / 4;
      this.orbit.pitch = Math.PI / 5;
      this.orbit.apply();
    }
    // Re-create after scene loads (world.clear destroys our entity).
    scene.events.on('loaded', () => { this.create(); if (this.orbit) (this.orbit as unknown as { transform: Transform }).transform = this.transform!; this.apply(); });
  }

  private create(): void {
    const w = this.engine.world;
    if (this.entity && w.isAlive(this.entity)) return;
    this.entity = w.createEntity('Editor Camera');
    this.scene.markEditorEntity(this.entity);
    this.transform = w.getComponent(this.entity, Transform)!;
    if (this.is3d) {
      this.cam3d = w.addComponent(this.entity, Camera3D, { priority: 1_000_000, far: 2000 });
      this.transform.setPosition(10, 8, 10);
      this.transform.updateWorldMatrix();
      this.transform.lookAt(new Vec3(0, 0, 0));
    } else {
      this.cam2d = w.addComponent(this.entity, Camera2D, { priority: 1_000_000 });
    }
    this.apply();
  }

  /** Push state into the camera entity and mirror scene camera looks (background/sky). */
  apply(): void {
    if (!this.transform) return;
    if (this.is3d) {
      this.orbit?.apply();
      const sceneCam = this.engine.world.componentsOfType(Camera3D).find((c) => c !== this.cam3d && c.active);
      if (sceneCam && this.cam3d) {
        this.cam3d.clearColor.copy(sceneCam.clearColor);
        this.cam3d.skyTop.copy(sceneCam.skyTop);
        this.cam3d.skyBottom.copy(sceneCam.skyBottom);
        this.cam3d.skybox = sceneCam.skybox;
      }
    } else {
      this.transform.setPosition(this.x, this.y, 0);
      this.transform.rotation.identity();
      this.transform.markDirty();
      if (this.cam2d) {
        this.cam2d.zoom = this.zoom;
        const sceneCam = this.engine.world.componentsOfType(Camera2D).find((c) => c !== this.cam2d && c.active);
        if (sceneCam) this.cam2d.backgroundColor.copy(sceneCam.backgroundColor);
      }
    }
  }

  /** Zoom around a screen point (2D). */
  zoomAt(sx: number, sy: number, factor: number): void {
    if (this.is3d) {
      if (this.orbit) this.orbit.distance = Math.min(this.orbit.maxDistance, Math.max(this.orbit.minDistance, this.orbit.distance * factor));
      this.apply();
      return;
    }
    const before = this.engine.screenToWorld(sx, sy);
    this.zoom = Math.min(50, Math.max(0.02, this.zoom / factor));
    this.apply();
    this.engine.renderer?.render(this.engine.world, 0);
    const after = this.engine.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.apply();
  }

  /** Pan by a screen-space delta. */
  pan(dx: number, dy: number): void {
    if (this.is3d && this.orbit) {
      const t = this.transform!;
      const right = t.right();
      const up = t.up();
      const k = this.orbit.distance * 0.0016;
      this.orbit.target.addScaled(right, -dx * k).addScaled(up, dy * k);
      this.apply();
      return;
    }
    const ppu = this.engine.renderer?.pixelsPerUnit ?? 32;
    const s = this.zoom * ppu;
    this.x -= dx / s;
    this.y += dy / s;
    this.apply();
  }

  rotate(dx: number, dy: number): void {
    if (!this.orbit) return;
    this.orbit.yaw -= dx * 0.006;
    this.orbit.pitch = Math.min(Math.PI / 2 - 0.02, Math.max(-Math.PI / 2 + 0.02, this.orbit.pitch + dy * 0.006));
    this.apply();
  }

  /** Center on a world-space box, fitting it into the view. */
  frame(min: Vec3, max: Vec3, viewW: number, viewH: number): void {
    const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
    if (this.is3d && this.orbit) {
      this.orbit.target.set(cx, cy, cz);
      const radius = Math.max(0.5, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2);
      this.orbit.distance = radius * 2.8;
      this.apply();
      return;
    }
    const ppu = this.engine.renderer?.pixelsPerUnit ?? 32;
    const w = Math.max(0.5, max.x - min.x), h = Math.max(0.5, max.y - min.y);
    this.x = cx;
    this.y = cy;
    this.zoom = Math.min(50, Math.max(0.02, Math.min(viewW / (w * 1.6 * ppu), viewH / (h * 1.6 * ppu))));
    this.apply();
  }

  reset(): void {
    if (this.is3d && this.orbit) { this.orbit.target.set(0, 0, 0); this.orbit.distance = 14; this.orbit.yaw = Math.PI / 4; this.orbit.pitch = Math.PI / 5; }
    else { this.x = 0; this.y = 0; this.zoom = 1; }
    this.apply();
  }

  getPose(): CameraPose {
    const p: CameraPose = { x: this.x, y: this.y, zoom: this.zoom };
    if (this.orbit) { p.tx = this.orbit.target.x; p.ty = this.orbit.target.y; p.tz = this.orbit.target.z; p.yaw = this.orbit.yaw; p.pitch = this.orbit.pitch; p.distance = this.orbit.distance; }
    return p;
  }

  setPose(p: CameraPose): void {
    this.x = p.x ?? this.x; this.y = p.y ?? this.y; this.zoom = p.zoom ?? this.zoom;
    if (this.orbit) {
      if (p.tx !== undefined) this.orbit.target.set(p.tx, p.ty ?? 0, p.tz ?? 0);
      if (p.yaw !== undefined) this.orbit.yaw = p.yaw;
      if (p.pitch !== undefined) this.orbit.pitch = p.pitch;
      if (p.distance !== undefined) this.orbit.distance = p.distance;
    }
    this.apply();
  }
}
