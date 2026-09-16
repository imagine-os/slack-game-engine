import type { World } from './World';

/**
 * Update phases in execution order for one frame:
 * - `input`: sample devices, apply input snapshots (once per frame).
 * - `fixedUpdate`: deterministic simulation (0..N times per frame).
 * - `update`: variable-rate game logic (once per frame).
 * - `lateUpdate`: cameras, transforms, anything depending on update results.
 * - `render`: draw (once per frame).
 */
export type Phase = 'input' | 'fixedUpdate' | 'update' | 'lateUpdate' | 'render';

export const PHASES: readonly Phase[] = ['input', 'fixedUpdate', 'update', 'lateUpdate', 'render'];

/**
 * A system is a unit of behaviour that runs in a phase with a priority. Lower
 * priority runs first. Systems are plain objects so they are easy to write
 * inline; extend {@link SystemBase} for a class with sensible defaults.
 */
export interface System {
  /** Debug name. */
  readonly name: string;
  /** Phase this system runs in. */
  readonly phase: Phase;
  /** Lower runs first. Default 0. */
  readonly priority?: number;
  /** Disabled systems are skipped. Default true. */
  enabled?: boolean;
  /** Called once when added to a world. */
  init?(world: World): void;
  /** Called every time the phase runs. `dt` is fixed delta in fixedUpdate, frame delta otherwise. */
  update(world: World, dt: number): void;
  /** Called when removed from the world or the world is disposed. */
  dispose?(world: World): void;
}

/** Convenience base class for systems. */
export abstract class SystemBase implements System {
  abstract readonly name: string;
  abstract readonly phase: Phase;
  readonly priority: number = 0;
  enabled = true;
  init(_world: World): void {}
  abstract update(world: World, dt: number): void;
  dispose(_world: World): void {}
}

/** Build a system from a plain function. */
export function createSystem(
  name: string,
  phase: Phase,
  update: (world: World, dt: number) => void,
  priority = 0,
): System {
  return { name, phase, priority, enabled: true, update };
}
