import { moveToward } from '../core/math';
import { Component } from '../core/ecs/Component';
import { registerComponent } from '../core/ecs/Registry';
import type { RigidBody2D } from './components2d';

/**
 * Platformer movement helper layered on a RigidBody2D (set `fixedRotation`).
 * Call {@link move} and {@link jump} from scripts each frame; the physics
 * system applies them during the fixed step with coyote time and jump
 * buffering.
 */
export class CharacterController2D extends Component {
  static override readonly type = 'CharacterController2D';
  moveSpeed = 6;
  /** Horizontal acceleration on the ground (units/s²). */
  acceleration = 60;
  /** Horizontal acceleration in the air. */
  airAcceleration = 30;
  jumpSpeed = 10;
  /** Seconds after leaving a ledge during which a jump is still allowed. */
  coyoteTime = 0.1;
  /** Seconds a jump press is remembered before landing. */
  jumpBufferTime = 0.1;
  /** Gravity multiplier while falling (snappier jumps). */
  fallGravityScale = 1.5;
  /** Releasing jump early cuts vertical speed to this fraction. */
  jumpCutoff = 0.5;
  maxFallSpeed = 25;
  /** Enable variable jump height (call `jumpReleased()` when the button goes up). */
  variableJump = true;

  /** True while standing on something (updated after each step). */
  grounded = false;
  /** Contact normal y of the ground below (1 = flat). */
  groundNormalY = 0;
  /** Horizontal facing (-1 or 1) based on the last non-zero move. */
  facing = 1;

  /** @internal */
  _moveX = 0;
  _jumpRequested = false;
  _jumpHeld = false;
  _coyote = 0;
  _buffer = 0;
  _wasGrounded = false;
  _jumping = false;

  /** Desired horizontal input in -1..1. */
  move(x: number): void {
    this._moveX = Math.max(-1, Math.min(1, x));
    if (x !== 0) this.facing = x > 0 ? 1 : -1;
  }

  /** Request a jump (buffered). */
  jump(): void {
    this._jumpRequested = true;
    this._jumpHeld = true;
  }

  /** Signal the jump button is no longer held (for variable jump height). */
  jumpReleased(): void {
    this._jumpHeld = false;
  }

  /** Apply controller state to the body; called by the physics system before stepping. */
  apply(rb: RigidBody2D, dt: number): void {
    this.grounded = false;
    this.groundNormalY = 0;
    for (const c of rb.contacts) {
      if (c.ny > 0.5 && c.ny > this.groundNormalY) { this.grounded = true; this.groundNormalY = c.ny; }
    }
    if (this.grounded) { this._coyote = this.coyoteTime; this._jumping = false; }
    else this._coyote = Math.max(0, this._coyote - dt);
    if (this._jumpRequested) { this._buffer = this.jumpBufferTime; this._jumpRequested = false; }
    else this._buffer = Math.max(0, this._buffer - dt);

    const accel = this.grounded ? this.acceleration : this.airAcceleration;
    rb.velocity.x = moveToward(rb.velocity.x, this._moveX * this.moveSpeed, accel * dt);

    if (this._buffer > 0 && this._coyote > 0) {
      rb.velocity.y = this.jumpSpeed;
      this._buffer = 0;
      this._coyote = 0;
      this._jumping = true;
      this.grounded = false;
    }
    if (this.variableJump && this._jumping && !this._jumpHeld && rb.velocity.y > 0) {
      rb.velocity.y *= this.jumpCutoff;
      this._jumping = false;
    }
    rb.gravityScale = rb.velocity.y < 0 && !this.grounded ? this.fallGravityScale : 1;
    if (rb.velocity.y < -this.maxFallSpeed) rb.velocity.y = -this.maxFallSpeed;
    this._wasGrounded = this.grounded;
  }
}
registerComponent(CharacterController2D, {
  category: 'Physics 2D',
  description: 'Platformer movement with coyote time and jump buffering.',
  icon: 'person',
  requires: ['RigidBody2D'],
  fields: {
    grounded: { type: 'boolean', readonly: true },
    groundNormalY: { type: 'number', transient: true, hidden: true },
    facing: { type: 'integer', readonly: true },
  },
});
