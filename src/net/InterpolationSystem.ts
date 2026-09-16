import { Quat, Vec3 } from '../core/math';
import type { Entity } from '../core/ecs/Entity';
import { SystemBase } from '../core/ecs/System';
import { Transform } from '../core/ecs/Transform';
import type { World } from '../core/ecs/World';
import { NetTransform } from './components';

const RING = 16;
/** Floats per sample: tick, px,py,pz, qx,qy,qz,qw, vx,vy. */
const STRIDE = 10;

/** Buffered samples for one remote entity. */
class InterpBuffer {
  readonly data = new Float64Array(RING * STRIDE);
  count = 0;
  /** Index of the newest sample. */
  head = -1;
  /** Set on the first sample so we snap instead of lerping from the spawn pose. */
  primed = false;
  constructor(public entity: Entity) {}

  latestTick(): number {
    return this.count ? this.data[this.head * STRIDE] : 0;
  }

  push(tick: number, p: Vec3, q: Quat, v: Vec3): void {
    if (this.count && tick <= this.latestTick()) return; // stale / duplicate
    this.head = (this.head + 1) % RING;
    if (this.count < RING) this.count++;
    const o = this.head * STRIDE;
    const d = this.data;
    d[o] = tick;
    d[o + 1] = p.x; d[o + 2] = p.y; d[o + 3] = p.z;
    d[o + 4] = q.x; d[o + 5] = q.y; d[o + 6] = q.z; d[o + 7] = q.w;
    d[o + 8] = v.x; d[o + 9] = v.y;
  }

  clear(): void {
    this.count = 0;
    this.head = -1;
  }

  /** Sample index `k` steps back from the head (0 = newest). */
  at(k: number): number {
    return (((this.head - k) % RING) + RING) % RING;
  }
}

const _pa = new Vec3();
const _pb = new Vec3();
const _qa = new Quat();
const _qb = new Quat();
const _v = new Vec3();

/**
 * Smoothly moves replicated entities toward the states received from the
 * authority. Runs in the `update` phase before scripts (priority −500) so
 * game code sees the interpolated pose. Time is expressed in authority ticks:
 * the local render tick trails the newest sample by
 * `NetTransform.interpolationDelay` ticks and drifts toward it slowly to
 * absorb jitter. Beyond the newest sample, position is extrapolated with the
 * last velocity for at most `NetTransform.extrapolation` seconds.
 */
export class InterpolationSystem extends SystemBase {
  readonly name = 'NetInterpolationSystem';
  readonly phase = 'update' as const;
  override readonly priority = -500;
  /** Authority ticks per second (snapshot rate). */
  tickRate = 20;
  /** Default interpolation delay in ticks when the entity has no NetTransform. */
  defaultDelay = 2;
  /** Default teleport distance when the entity has no NetTransform. */
  defaultTeleport = 5;
  /** How fast the render clock corrects toward the target (0..1 per second). */
  clockGain = 4;

  private buffers = new Map<number, InterpBuffer>();
  private renderTick = 0;
  private latest = 0;
  private clockValid = false;

  /** Register/replace the entity an id resolves to. */
  track(netId: number, entity: Entity): void {
    const b = this.buffers.get(netId);
    if (b) b.entity = entity;
    else this.buffers.set(netId, new InterpBuffer(entity));
  }

  untrack(netId: number): void {
    this.buffers.delete(netId);
  }

  has(netId: number): boolean {
    return this.buffers.has(netId);
  }

  /** Newest authority tick seen. */
  get latestTick(): number {
    return this.latest;
  }

  /** Current render tick (fractional). */
  get currentRenderTick(): number {
    return this.renderTick;
  }

  /**
   * Add a sample for `netId`. Also writes `NetTransform` targets when the
   * entity has one so scripts/tools can read the raw authority pose.
   */
  push(world: World, netId: number, tick: number, position: Vec3, rotation: Quat, velocity: Vec3): void {
    const b = this.buffers.get(netId);
    if (!b) return;
    const nt = world.getComponent(b.entity, NetTransform);
    const teleport = nt?.teleportDistance ?? this.defaultTeleport;
    if (b.count) {
      const o = b.head * STRIDE;
      const dx = position.x - b.data[o + 1], dy = position.y - b.data[o + 2], dz = position.z - b.data[o + 3];
      if (dx * dx + dy * dy + dz * dz > teleport * teleport) {
        b.clear();
        const t = world.getComponent(b.entity, Transform);
        if (t) { t.position.copy(position); t.rotation.copy(rotation); t.markDirty(); }
      }
    }
    b.push(tick, position, rotation, velocity);
    if (tick > this.latest) this.latest = tick;
    if (nt) {
      nt.targetPosition.copy(position);
      nt.targetRotation.copy(rotation);
      nt.targetVelocity.copy(velocity);
      nt.lastTick = tick;
    }
    if (!b.primed) {
      b.primed = true;
      const t = world.getComponent(b.entity, Transform);
      if (t) { t.position.copy(position); t.rotation.copy(rotation); t.markDirty(); }
    }
  }

  /** Forget all samples (host migration, reconnect). */
  reset(): void {
    for (const b of this.buffers.values()) { b.clear(); b.primed = false; }
    this.latest = 0;
    this.clockValid = false;
  }

  override update(world: World, dt: number): void {
    if (this.latest === 0) return;
    // Advance the render clock and steer it toward (latest − delay).
    this.renderTick += dt * this.tickRate;
    const target = this.latest - this.defaultDelay;
    if (!this.clockValid || Math.abs(target - this.renderTick) > this.tickRate) {
      this.renderTick = target;
      this.clockValid = true;
    } else {
      this.renderTick += (target - this.renderTick) * Math.min(1, this.clockGain * dt);
    }

    for (const b of this.buffers.values()) {
      if (b.count === 0 || !world.isAlive(b.entity)) continue;
      const t = world.getComponent(b.entity, Transform);
      if (!t) continue;
      const nt = world.getComponent(b.entity, NetTransform);
      const delay = nt ? nt.interpolationDelay - this.defaultDelay : 0;
      const rt = this.renderTick - delay;
      this.sample(b, rt, nt, t);
    }
  }

  private sample(b: InterpBuffer, rt: number, nt: NetTransform | undefined, t: Transform): void {
    const d = b.data;
    const newest = b.at(0);
    const newestTick = d[newest * STRIDE];
    const syncPos = nt?.syncPosition ?? true;
    const syncRot = nt?.syncRotation ?? true;
    if (rt >= newestTick || b.count === 1) {
      // Extrapolate from the newest sample.
      const o = newest * STRIDE;
      const ahead = Math.max(0, rt - newestTick) / this.tickRate;
      const maxAhead = nt?.extrapolation ?? 0.1;
      const e = Math.min(ahead, maxAhead);
      if (syncPos) t.position.set(d[o + 1] + d[o + 8] * e, d[o + 2] + d[o + 9] * e, d[o + 3]);
      if (syncRot) t.rotation.set(d[o + 4], d[o + 5], d[o + 6], d[o + 7]);
      t.markDirty();
      return;
    }
    // Find the two samples around rt (walk back from newest).
    let hi = newest;
    let lo = b.at(1);
    for (let k = 1; k < b.count; k++) {
      lo = b.at(k);
      if (d[lo * STRIDE] <= rt) break;
      hi = lo;
    }
    const oa = lo * STRIDE, ob = hi * STRIDE;
    const ta = d[oa], tb = d[ob];
    if (tb <= ta || rt <= ta) {
      if (syncPos) t.position.set(d[oa + 1], d[oa + 2], d[oa + 3]);
      if (syncRot) t.rotation.set(d[oa + 4], d[oa + 5], d[oa + 6], d[oa + 7]);
      t.markDirty();
      return;
    }
    const f = (rt - ta) / (tb - ta);
    if (syncPos) {
      _pa.set(d[oa + 1], d[oa + 2], d[oa + 3]);
      _pb.set(d[ob + 1], d[ob + 2], d[ob + 3]);
      Vec3.lerp(_pa, _pb, f, _v);
      t.position.copy(_v);
    }
    if (syncRot) {
      _qa.set(d[oa + 4], d[oa + 5], d[oa + 6], d[oa + 7]);
      _qb.set(d[ob + 4], d[ob + 5], d[ob + 6], d[ob + 7]);
      _qa.slerp(_qb, f);
      t.rotation.copy(_qa);
    }
    t.markDirty();
  }
}
