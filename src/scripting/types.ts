import type { Entity } from '../core/ecs/Entity';
import type { FieldType } from '../core/ecs/Component';
import type { InputSnapshot } from '../input/InputSnapshot';
import type { CollisionEvent } from '../physics/Physics2DWorld';
import type { ScriptContext } from './ScriptContext';

/** Declares an editable script property with inspector metadata. */
export interface ScriptPropDef {
  type: FieldType;
  default: unknown;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  assetKind?: string;
}

/**
 * A script definition as returned by `defineScript({...})`. All hooks are
 * optional. `ctx` is the per-entity {@link ScriptContext}.
 */
export interface ScriptDefinition {
  /** Unique script name; the Script component references it. */
  name: string;
  description?: string;
  /** Editable properties with defaults. */
  props?: Record<string, ScriptPropDef>;

  /** Once, before the first update after the entity gets the script. */
  onStart?(ctx: ScriptContext): void;
  /** Every rendered frame. */
  onUpdate?(ctx: ScriptContext, dt: number): void;
  /** Every fixed simulation step (before physics). */
  onFixedUpdate?(ctx: ScriptContext, dt: number): void;
  /** After all updates, before rendering. */
  onLateUpdate?(ctx: ScriptContext, dt: number): void;
  /** When the entity or script is removed. */
  onDestroy?(ctx: ScriptContext): void;
  /** When the definition was hot-reloaded (state and props preserved). */
  onReload?(ctx: ScriptContext): void;

  onCollisionEnter?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;
  onCollisionExit?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;
  onTriggerEnter?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;
  onTriggerExit?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;

  /** Networked entity was spawned locally (host or remote). */
  onNetSpawn?(ctx: ScriptContext, ownerId: string): void;
  /**
   * The room's host changed (host migration). `isHost` is true on the peer
   * that took over: that is where a manager script should start serving
   * (spawning players, running waves or AI). The old host's `playerLeft`
   * follows this hook, so handlers installed here see it.
   */
  onHostChanged?(ctx: ScriptContext, isHost: boolean, info: { hostId: string; previous: string }): void;
  /**
   * Each fixed step when the entity has a PlayerInput: receives the merged
   * snapshot of whoever controls it (local or remote). Prefer this over
   * `ctx.input` for anything that must work in multiplayer.
   */
  onOwnerInput?(ctx: ScriptContext, snapshot: InputSnapshot, dt: number): void;
  /** A message sent with `ctx.send(name, data)` by any script. */
  onMessage?(ctx: ScriptContext, name: string, data: unknown): void;
  /** A network RPC targeting this entity. */
  onRpc?(ctx: ScriptContext, name: string, args: unknown[], from: string): void;
}

/** Hook names, used for dispatch and diagnostics. */
export type ScriptHook = Exclude<keyof ScriptDefinition, 'name' | 'description' | 'props'>;

/** Source record stored in a project. */
export interface ScriptSource {
  name: string;
  source: string;
}

/** Problem reported to `engine.diagnostics`. */
export interface Diagnostic {
  level: 'error' | 'warn' | 'log';
  message: string;
  /** Script name, when the problem originated in a script. */
  script?: string;
  hook?: string;
  entity?: Entity;
  error?: unknown;
  /** Line/column from a compile error when available. */
  line?: number;
  column?: number;
}

/** Thrown by `ScriptRuntime.compile` on syntax or runtime errors during definition. */
export class ScriptCompileError extends Error {
  constructor(readonly scriptName: string, message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'ScriptCompileError';
  }
}

/**
 * Identity helper giving authors type inference. In sandboxed sources the
 * runtime injects its own `defineScript` that captures the definition.
 */
export function defineScript(def: ScriptDefinition): ScriptDefinition {
  if (!def || typeof def.name !== 'string' || !def.name) throw new Error('defineScript: "name" is required');
  return def;
}
