import { Vec2, damp, type Random } from '../core/math';
import { SystemBase } from '../core/ecs/System';
import { Transform } from '../core/ecs/Transform';
import { NULL_ENTITY } from '../core/ecs/Entity';
import type { World } from '../core/ecs/World';
import type { Atlas } from '../assets/types';
import { AnimatedSprite, Camera2D, ParticleEmitter, Sprite, type Particle } from './components';

/** Advances AnimatedSprite components and writes the current frame to the Sprite. */
export class AnimatedSpriteSystem extends SystemBase {
  readonly name = 'AnimatedSpriteSystem';
  readonly phase = 'update' as const;
  override readonly priority = 100;

  constructor(private getAsset: <T>(id: string) => T | undefined) {
    super();
  }

  override update(world: World, dt: number): void {
    world.each(AnimatedSprite, Sprite, (_e, anim, sprite) => {
      let frames: readonly string[] = anim.frames;
      let fps = anim.fps;
      let loop = anim.loop;
      if (anim.animation) {
        const atlas = this.getAsset<Atlas>(sprite.texture);
        const def = atlas?.animations?.[anim.animation];
        if (def) {
          frames = def.frames;
          if (def.fps !== undefined) fps = def.fps;
          if (def.loop !== undefined) loop = def.loop;
        }
      }
      if (frames.length === 0) return;
      if (anim.playing && !anim.finished) anim.time += dt * anim.speed;
      const total = frames.length / Math.max(0.0001, fps);
      if (anim.time >= total) {
        if (loop) anim.time %= total;
        else {
          anim.time = total;
          anim.finished = true;
          anim.playing = false;
        }
      }
      anim.frameIndex = Math.min(frames.length - 1, Math.floor(anim.time * fps));
      sprite.frame = frames[anim.frameIndex];
    });
  }
}

const _tmp = new Vec2();

/** Camera follow, bounds clamping and shake decay. */
export class Camera2DSystem extends SystemBase {
  readonly name = 'Camera2DSystem';
  readonly phase = 'lateUpdate' as const;
  override readonly priority = -100;

  constructor(private random: Random) {
    super();
  }

  override update(world: World, dt: number): void {
    world.each(Camera2D, Transform, (_e, cam, t) => {
      if (cam.follow !== NULL_ENTITY && world.isAlive(cam.follow)) {
        const target = world.getComponent(cam.follow, Transform);
        if (target) {
          target.getWorldPosition();
          const tx = target.worldMatrix.m[12] + cam.followOffset.x;
          const ty = target.worldMatrix.m[13] + cam.followOffset.y;
          if (cam.followSmoothing <= 0) t.setPosition(tx, ty);
          else t.setPosition(damp(t.position.x, tx, cam.followSmoothing, dt), damp(t.position.y, ty, cam.followSmoothing, dt));
        }
      }
      if (cam.bounds.width > 0 && cam.bounds.height > 0) {
        const hw = cam.viewHalfSize.x;
        const hh = cam.viewHalfSize.y;
        const minX = cam.bounds.x + hw, maxX = cam.bounds.right - hw;
        const minY = cam.bounds.y + hh, maxY = cam.bounds.top - hh;
        t.setPosition(
          minX > maxX ? cam.bounds.centerX : Math.min(maxX, Math.max(minX, t.position.x)),
          minY > maxY ? cam.bounds.centerY : Math.min(maxY, Math.max(minY, t.position.y)),
        );
      }
      if (cam.shake > 0) {
        _tmp.set(this.random.range(-1, 1), this.random.range(-1, 1)).scale(cam.shake);
        cam.shake = Math.max(0, cam.shake - cam.shakeDecay * dt * cam.shake - 0.001);
        t.translate(_tmp.x, _tmp.y);
      }
    });
  }
}

/** Simulates ParticleEmitter pools. Runs in `update` so particles are framerate-smooth. */
export class ParticleSystem extends SystemBase {
  readonly name = 'ParticleSystem';
  readonly phase = 'update' as const;
  override readonly priority = 200;

  constructor(private random: Random) {
    super();
  }

  override update(world: World, dt: number): void {
    const rnd = this.random;
    world.each(ParticleEmitter, Transform, (_e, em, t) => {
      // Spawn.
      let toSpawn = em._burst;
      em._burst = 0;
      if (em.emitting) {
        em._accum += em.rate * dt;
        const n = Math.floor(em._accum);
        em._accum -= n;
        toSpawn += n;
      }
      const ox = em.worldSpace ? t.worldMatrix.m[12] : 0;
      const oy = em.worldSpace ? t.worldMatrix.m[13] : 0;
      for (let i = 0; i < toSpawn && em.particles.length < em.maxParticles; i++) {
        const p: Particle = em._pool.pop() ?? { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, rotation: 0, spin: 0, seed: 0 };
        const a = em.angle + rnd.range(-em.spread, em.spread);
        const s = em.speed + rnd.range(-em.speedVariation, em.speedVariation);
        p.x = ox + rnd.range(-em.areaSize.x, em.areaSize.x);
        p.y = oy + rnd.range(-em.areaSize.y, em.areaSize.y);
        p.vx = Math.cos(a) * s;
        p.vy = Math.sin(a) * s;
        p.maxLife = Math.max(0.01, em.lifetime + rnd.range(-em.lifetimeVariation, em.lifetimeVariation));
        p.life = p.maxLife;
        p.size = Math.max(0, em.startSize + rnd.range(-em.sizeVariation, em.sizeVariation));
        p.rotation = rnd.range(0, Math.PI * 2);
        p.spin = em.spin * rnd.range(-1, 1);
        p.seed = rnd.next();
        em.particles.push(p);
      }
      // Integrate (swap-remove dead particles).
      const list = em.particles;
      const dragK = 1 - Math.min(1, em.drag * dt);
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          em._pool.push(p);
          list[i] = list[list.length - 1];
          list.pop();
          continue;
        }
        p.vx = (p.vx + em.gravity.x * dt) * dragK;
        p.vy = (p.vy + em.gravity.y * dt) * dragK;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;
      }
    });
  }
}
