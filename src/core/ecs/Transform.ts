import { Mat4, Quat, Vec3 } from '../math';
import { Component } from './Component';
import { type Entity, NULL_ENTITY } from './Entity';
import { registerComponent } from './Registry';

const _p = new Vec3();
const _q = new Quat();
const _s = new Vec3();
const _m = new Mat4();

/**
 * Position, rotation and scale with parent/child hierarchy. 2D and 3D share
 * the same representation: 2D games use `x`/`y` and `angle` (rotation about Z).
 *
 * World matrices are recomputed lazily via {@link updateWorldMatrix} (the
 * engine runs `world.updateTransforms()` at the end of `lateUpdate`); call
 * {@link markDirty} after mutating `position`/`rotation`/`scale` in place if
 * you need the world matrix updated before then.
 */
export class Transform extends Component {
  static override readonly type = 'Transform';

  position = new Vec3();
  rotation = new Quat();
  scale = new Vec3(1, 1, 1);
  /** Parent entity or NULL_ENTITY. Change through `world.setParent`. */
  parent: Entity = NULL_ENTITY;

  /** Child entities (maintained by the World). */
  readonly children: Entity[] = [];
  /** Local matrix (updated by {@link updateWorldMatrix}). */
  readonly localMatrix = new Mat4();
  /** World matrix (updated by {@link updateWorldMatrix}). */
  readonly worldMatrix = new Mat4();
  /** Monotonic counter bumped whenever the world matrix changes. */
  worldVersion = 0;

  /** @internal set by World.setParent */
  _parentTransform: Transform | null = null;
  /** @internal child Transform instances, maintained by World.setParent */
  readonly _childTransforms: Transform[] = [];
  private _dirty = true;

  // ---- 2D conveniences ----

  get x(): number { return this.position.x; }
  set x(v: number) { this.position.x = v; this._dirty = true; }
  get y(): number { return this.position.y; }
  set y(v: number) { this.position.y = v; this._dirty = true; }
  get z(): number { return this.position.z; }
  set z(v: number) { this.position.z = v; this._dirty = true; }

  /** Rotation about Z in radians. */
  get angle(): number {
    return this.rotation.angle2D();
  }
  set angle(rad: number) {
    this.rotation.set(0, 0, Math.sin(rad / 2), Math.cos(rad / 2));
    this._dirty = true;
  }

  /** Rotation about Z in degrees. */
  get angleDeg(): number {
    return (this.angle * 180) / Math.PI;
  }
  set angleDeg(deg: number) {
    this.angle = (deg * Math.PI) / 180;
  }

  setPosition(x: number, y: number, z = this.position.z): this {
    this.position.set(x, y, z);
    this._dirty = true;
    return this;
  }

  setScale(x: number, y = x, z = this.scale.z): this {
    this.scale.set(x, y, z);
    this._dirty = true;
    return this;
  }

  /** Set rotation from Euler angles (radians). */
  setEuler(x: number, y: number, z: number): this {
    this.rotation.setEuler(x, y, z);
    this._dirty = true;
    return this;
  }

  translate(dx: number, dy: number, dz = 0): this {
    this.position.x += dx;
    this.position.y += dy;
    this.position.z += dz;
    this._dirty = true;
    return this;
  }

  rotate2D(dRad: number): this {
    this.angle += dRad;
    return this;
  }

  /** Flag that position/rotation/scale changed in place. */
  markDirty(): void {
    this._dirty = true;
  }

  get dirty(): boolean {
    return this._dirty;
  }

  /**
   * Recompute local and world matrices for this transform and, when
   * `recurse` is true, for the whole subtree (children are resolved through
   * the parent transform links maintained by the World).
   */
  updateWorldMatrix(recurse = false, parentChanged = false): void {
    const parent = this._parentTransform;
    let changed = parentChanged;
    if (this._dirty) {
      this.localMatrix.compose(this.position, this.rotation, this.scale);
      this._dirty = false;
      changed = true;
    }
    if (changed) {
      if (parent) Mat4.multiply(parent.worldMatrix, this.localMatrix, this.worldMatrix);
      else this.worldMatrix.copy(this.localMatrix);
      this.worldVersion++;
    }
    if (recurse) {
      const kids = this._childTransforms;
      for (let i = 0; i < kids.length; i++) kids[i].updateWorldMatrix(true, changed);
    }
  }

  /** World-space position (reads the last computed world matrix). */
  getWorldPosition(out = new Vec3()): Vec3 {
    return this.worldMatrix.getTranslation(out);
  }

  /** World-space rotation. */
  getWorldRotation(out = new Quat()): Quat {
    this.worldMatrix.decompose(_p, out, _s);
    return out;
  }

  /** World-space scale. */
  getWorldScale(out = new Vec3()): Vec3 {
    this.worldMatrix.decompose(_p, _q, out);
    return out;
  }

  /** World-space 2D rotation about Z. */
  getWorldAngle(): number {
    return this.getWorldRotation(_q).angle2D();
  }

  /** Set local TRS such that the world matrix equals `world` under `parent`. */
  setFromWorldMatrix(world: Mat4, parent: Transform | null): void {
    if (parent) {
      _m.copy(parent.worldMatrix).invert().multiply(world);
      _m.decompose(this.position, this.rotation, this.scale);
    } else {
      world.decompose(this.position, this.rotation, this.scale);
    }
    this._dirty = true;
  }

  /** Transform a local point into world space. */
  localToWorld(local: Vec3, out = new Vec3()): Vec3 {
    return this.worldMatrix.transformPoint(local, out);
  }

  /** Transform a world point into this transform's local space. */
  worldToLocal(world: Vec3, out = new Vec3()): Vec3 {
    return _m.copy(this.worldMatrix).invert().transformPoint(world, out);
  }

  /** Local forward direction (-Z) in world space. */
  forward(out = new Vec3()): Vec3 {
    return this.worldMatrix.transformDirection(Vec3.FORWARD, out).normalize();
  }

  /** Local right direction (+X) in world space. */
  right(out = new Vec3()): Vec3 {
    return this.worldMatrix.transformDirection(Vec3.RIGHT, out).normalize();
  }

  /** Local up direction (+Y) in world space. */
  up(out = new Vec3()): Vec3 {
    return this.worldMatrix.transformDirection(Vec3.UP, out).normalize();
  }

  /** Orient toward a world target (3D). */
  lookAt(target: Vec3, up: Vec3 = Vec3.UP): this {
    this.getWorldPosition(_p);
    _s.copy(target).sub(_p);
    this.rotation.lookRotation(_s, up);
    this._dirty = true;
    return this;
  }
}

registerComponent(Transform, {
  category: 'Core',
  description: 'Position, rotation and scale with parent/child hierarchy.',
  icon: 'move',
  fields: {
    position: { type: 'vec3' },
    rotation: { type: 'quat' },
    scale: { type: 'vec3' },
    parent: { type: 'entity', hidden: true },
    children: { type: 'json', transient: true, hidden: true },
    localMatrix: { type: 'json', transient: true, hidden: true },
    worldMatrix: { type: 'json', transient: true, hidden: true },
    worldVersion: { type: 'number', transient: true, hidden: true },
  },
});
