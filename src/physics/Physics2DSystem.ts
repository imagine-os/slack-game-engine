import { Color } from '../core/math';
import { SystemBase } from '../core/ecs/System';
import type { World } from '../core/ecs/World';
import type { DebugDraw } from '../render/DebugDraw';
import { CharacterController2D } from './CharacterController2D';
import { RigidBody2D } from './components2d';
import type { Physics2DWorld } from './Physics2DWorld';

const TRIGGER_COLOR = new Color(1, 0.8, 0.2, 1);
const SOLID_COLOR = new Color(0.2, 1, 0.4, 1);

/** Runs the 2D physics world every fixed step (after scripts' onFixedUpdate). */
export class Physics2DSystem extends SystemBase {
  readonly name = 'Physics2DSystem';
  readonly phase = 'fixedUpdate' as const;
  override readonly priority = 100;
  /** Draw collider outlines when the debug drawer is enabled. */
  drawColliders = true;

  constructor(readonly physics: Physics2DWorld, private debug: DebugDraw | null = null) {
    super();
  }

  override update(world: World, dt: number): void {
    world.each(CharacterController2D, RigidBody2D, (_e, cc, rb) => cc.apply(rb, dt));
    this.physics.step(world, dt);
    if (this.debug?.enabled && this.drawColliders) {
      const dbg = this.debug;
      this.physics.debugShapes((shape, isTrigger) => {
        const c = isTrigger ? TRIGGER_COLOR : SOLID_COLOR;
        if (shape.kind === 'circle') dbg.circle(shape.x, shape.y, shape.r, c);
        else dbg.polygon(shape.verts.subarray(0, shape.count * 2), c);
      });
    }
  }
}
