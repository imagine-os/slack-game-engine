import { Vec2 } from '../core/math';
import { Component } from '../core/ecs/Component';
import { registerComponent } from '../core/ecs/Registry';

export type BodyType = 'dynamic' | 'kinematic' | 'static';

/** Contact information for the current step (normals point away from the other body). */
export interface BodyContact {
  other: number;
  nx: number;
  ny: number;
}

/**
 * 2D rigid body. Position and rotation live on the Transform (the physics
 * system reads and writes `Transform.position` / `Transform.angle` directly,
 * so bodies should be root entities or have identity parents).
 */
export class RigidBody2D extends Component {
  static override readonly type = 'RigidBody2D';
  bodyType: BodyType = 'dynamic';
  mass = 1;
  /** Bounciness 0..1. */
  restitution = 0.1;
  /** Coulomb friction coefficient. */
  friction = 0.4;
  gravityScale = 1;
  velocity = new Vec2();
  angularVelocity = 0;
  linearDamping = 0;
  angularDamping = 0.05;
  /** Prevent rotation (platformer characters). */
  fixedRotation = false;
  /** Collision layer index 0..31. */
  layer = 0;
  /** Bitmask of layers this body collides with. */
  collisionMask = 0xffffffff;
  /** Continuous collision hint: clamp per-step movement to the smallest collider extent. */
  bullet = false;

  /** Accumulated force for this step (cleared after integration). */
  readonly force = new Vec2();
  /** Accumulated torque for this step. */
  torque = 0;
  /** Contacts recorded during the last step. */
  readonly contacts: BodyContact[] = [];
  /** @internal inverse mass (0 for static/kinematic) */
  _invMass = 1;
  /** @internal inverse inertia */
  _invInertia = 1;
  /** @internal cached world position and angle for the current step */
  _px = 0;
  _py = 0;
  _angle = 0;

  applyForce(fx: number, fy: number): void {
    this.force.x += fx;
    this.force.y += fy;
  }

  applyImpulse(ix: number, iy: number): void {
    if (this.bodyType !== 'dynamic') return;
    this.velocity.x += ix * this._invMass;
    this.velocity.y += iy * this._invMass;
  }

  setVelocity(x: number, y: number): void {
    this.velocity.set(x, y);
  }

  /** True when a contact normal points mostly upward (standing on something). */
  get grounded(): boolean {
    for (let i = 0; i < this.contacts.length; i++) if (this.contacts[i].ny > 0.5) return true;
    return false;
  }

  /** Does this body collide with the given layer? */
  collidesWithLayer(layer: number): boolean {
    return (this.collisionMask & (1 << layer)) !== 0;
  }
}
registerComponent(RigidBody2D, {
  category: 'Physics 2D',
  description: 'Rigid body simulated by the 2D physics world.',
  icon: 'atom',
  fields: {
    bodyType: { type: 'enum', options: ['dynamic', 'kinematic', 'static'] },
    mass: { type: 'number', min: 0.001 },
    restitution: { type: 'number', min: 0, max: 1, step: 0.01 },
    friction: { type: 'number', min: 0, max: 2, step: 0.01 },
    layer: { type: 'integer', min: 0, max: 31 },
    collisionMask: { type: 'integer' },
    force: { type: 'vec2', transient: true, hidden: true },
    torque: { type: 'number', transient: true, hidden: true },
    contacts: { type: 'json', transient: true, hidden: true },
  },
});

/** Base for 2D colliders. Requires a RigidBody2D on the same entity. */
export abstract class Collider2D extends Component {
  offset = new Vec2();
  /** Triggers report overlaps but do not collide. */
  isTrigger = false;
  /** Extra restitution/friction overrides (-1 = use body). */
  restitution = -1;
  friction = -1;
}

const COLLIDER_FIELDS = {
  restitution: { type: 'number', min: -1, max: 1, step: 0.01, description: '-1 uses the body value.' },
  friction: { type: 'number', min: -1, max: 2, step: 0.01, description: '-1 uses the body value.' },
} as const;

export class BoxCollider2D extends Collider2D {
  static override readonly type = 'BoxCollider2D';
  width = 1;
  height = 1;
}
registerComponent(BoxCollider2D, { category: 'Physics 2D', description: 'Axis-aligned box in local space.', icon: 'square', requires: ['RigidBody2D'], fields: COLLIDER_FIELDS });

export class CircleCollider2D extends Collider2D {
  static override readonly type = 'CircleCollider2D';
  radius = 0.5;
}
registerComponent(CircleCollider2D, { category: 'Physics 2D', description: 'Circle collider.', icon: 'circle', requires: ['RigidBody2D'], fields: COLLIDER_FIELDS });

/** Convex polygon collider; points are flat `[x0,y0,...]` in counter-clockwise order. */
export class PolygonCollider2D extends Collider2D {
  static override readonly type = 'PolygonCollider2D';
  points: number[] = [-0.5, -0.5, 0.5, -0.5, 0, 0.5];
}
registerComponent(PolygonCollider2D, { category: 'Physics 2D', description: 'Convex polygon collider.', icon: 'triangle', requires: ['RigidBody2D'], fields: { ...COLLIDER_FIELDS, points: { type: 'json' } } });

/** Treats solid tiles of the sibling Tilemap as static box colliders. */
export class TilemapCollider2D extends Component {
  static override readonly type = 'TilemapCollider2D';
  layer = 0;
  friction = 0.6;
  restitution = 0;
}
registerComponent(TilemapCollider2D, { category: 'Physics 2D', description: 'Static collision from a Tilemap.', icon: 'grid', requires: ['Tilemap'] });

export const COLLIDER_TYPES: readonly string[] = [BoxCollider2D.type, CircleCollider2D.type, PolygonCollider2D.type];
