import { SystemBase } from '../core/ecs/System';
import type { World } from '../core/ecs/World';
import type { ScriptRuntime } from './ScriptRuntime';

/** Runs `onFixedUpdate` / `onOwnerInput` before physics. */
export class ScriptFixedSystem extends SystemBase {
  readonly name = 'ScriptFixedSystem';
  readonly phase = 'fixedUpdate' as const;
  override readonly priority = 0;
  constructor(private runtime: ScriptRuntime) { super(); }
  override update(_world: World, dt: number): void { this.runtime.fixedUpdate(dt); }
}

/** Runs `onStart` (first time) and `onUpdate`. */
export class ScriptUpdateSystem extends SystemBase {
  readonly name = 'ScriptUpdateSystem';
  readonly phase = 'update' as const;
  override readonly priority = 0;
  constructor(private runtime: ScriptRuntime) { super(); }
  override update(_world: World, dt: number): void { this.runtime.update(dt); }
}

/** Runs `onLateUpdate`. */
export class ScriptLateSystem extends SystemBase {
  readonly name = 'ScriptLateSystem';
  readonly phase = 'lateUpdate' as const;
  override readonly priority = 0;
  constructor(private runtime: ScriptRuntime) { super(); }
  override update(_world: World, dt: number): void { this.runtime.lateUpdate(dt); }
}
