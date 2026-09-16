import type { Component, ComponentClass } from '../core/ecs/Component';
import type { Entity } from '../core/ecs/Entity';
import type { PrefabData } from '../core/ecs/Scene';
import type { Transform } from '../core/ecs/Transform';
import type { World } from '../core/ecs/World';
import type * as MathNS from '../core/math';
import type { Random } from '../core/math';
import type { Input } from '../input/Input';
import type { PlayerInput } from '../input/PlayerInput';
import type { PlayOptions, SoundHandle } from '../audio/AudioEngine';
import type { Physics2DWorld } from '../physics/Physics2DWorld';
import type { Physics3DWorld } from '../physics/physics3d';
import type { DebugDraw } from '../render/DebugDraw';
import type { NetHub } from '../net/NetHub';
import type { Engine } from '../core/Engine';

/** Handle returned by `ctx.timer`. */
export interface TimerHandle {
  cancel(): void;
  readonly active: boolean;
}

export interface ScriptAudioAPI {
  /** Play a loaded audio asset by id. */
  play(clip: string, opts?: PlayOptions): SoundHandle | null;
  /** Play/cross-fade music by asset id. */
  music(clip: string, opts?: { fade?: number; volume?: number; loop?: boolean }): SoundHandle | null;
  stopMusic(fade?: number): void;
}

export interface ScriptNetAPI {
  readonly localId: string;
  readonly isHost: boolean;
  readonly online: boolean;
  readonly hub: NetHub;
  /** Owner peer id of this entity (`"local"` offline). */
  owner(): string;
  /** Is the local peer the owner (or a co-owner) of this entity? */
  isOwner(): boolean;
  /** Call an RPC; no-op when offline. */
  rpc(name: string, args?: unknown[], target?: string): void;
  /** Spawn a replicated prefab via NetSync when online, locally otherwise. */
  spawn(prefab: string, opts?: { ownerId?: string; position?: { x: number; y: number; z?: number } }): Entity;
}

export interface ScriptTime {
  readonly delta: number;
  readonly fixedDelta: number;
  readonly elapsed: number;
  readonly tick: number;
  readonly frame: number;
}

/**
 * Everything a script can touch. Scripts never receive `window`/`document`;
 * engine access goes through this object.
 */
export interface ScriptContext {
  readonly engine: Engine;
  readonly world: World;
  readonly entity: Entity;
  readonly transform: Transform;
  /** Editable properties (definition defaults merged with Script component overrides). */
  readonly props: Record<string, unknown>;
  /** Free-form per-instance state that survives hot reloads. */
  readonly state: Record<string, unknown>;
  readonly input: Input;
  /** PlayerInput on this entity, if any. */
  readonly playerInput: PlayerInput | undefined;
  readonly audio: ScriptAudioAPI;
  readonly math: typeof MathNS;
  /** Seeded engine random (deterministic under lockstep). */
  readonly random: Random;
  readonly net: ScriptNetAPI;
  readonly physics: Physics2DWorld;
  readonly physics3d: Physics3DWorld;
  readonly debug: DebugDraw;
  readonly time: ScriptTime;

  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;

  /** Component on this entity by class or type name. */
  get<T extends Component>(type: ComponentClass<T> | string): T | undefined;
  /** Component on another entity. */
  getOn<T extends Component>(entity: Entity, type: ComponentClass<T> | string): T | undefined;
  has(type: ComponentClass | string): boolean;
  add<T extends Component>(type: ComponentClass<T> | string, init?: Record<string, unknown>): T;
  remove(type: ComponentClass | string): boolean;

  /** Instantiate a registered prefab (by name) or inline prefab data. */
  spawn(prefab: string | PrefabData, opts?: { position?: { x: number; y: number; z?: number }; name?: string; parent?: Entity }): Entity;
  /** Destroy an entity (default: this one) at the end of the phase. */
  destroy(entity?: Entity): void;
  find(name: string): Entity | undefined;
  findAll(tag: string): Entity[];
  /** Name of an entity. */
  nameOf(entity: Entity): string;

  /** Run `fn` after `seconds` (repeating when `repeat`). Timers are cancelled on destroy. */
  timer(seconds: number, fn: () => void, repeat?: boolean): TimerHandle;
  /** Broadcast a message to every script's `onMessage`. */
  send(name: string, data?: unknown): void;
  /** Send a message to scripts on one entity. */
  sendTo(entity: Entity, name: string, data?: unknown): void;
}
