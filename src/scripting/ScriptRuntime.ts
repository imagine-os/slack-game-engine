import type { Component, ComponentClass } from '../core/ecs/Component';
import type { Entity } from '../core/ecs/Entity';
import { instantiatePrefab, type PrefabData } from '../core/ecs/Scene';
import { Transform } from '../core/ecs/Transform';
import type { World } from '../core/ecs/World';
import * as MathNS from '../core/math';
import type { Engine } from '../core/Engine';
import { PlayerInput } from '../input/PlayerInput';
import type { NetSync } from '../net/NetSync';
import type { CollisionEvent } from '../physics/Physics2DWorld';
import { Script } from './Script';
import type { ScriptContext, TimerHandle } from './ScriptContext';
import { type Diagnostic, type ScriptDefinition, type ScriptHook, type ScriptSource, ScriptCompileError } from './types';

interface Timer {
  remaining: number;
  interval: number;
  repeat: boolean;
  fn: () => void;
  active: boolean;
}

interface Instance {
  id: number;
  entity: Entity;
  component: Script;
  def: ScriptDefinition;
  ctx: ScriptContext;
  started: boolean;
  errors: number;
  disabled: boolean;
  timers: Timer[];
  state: Record<string, unknown>;
}

/** Globals shadowed inside user scripts so they cannot reach the page by accident. */
const SHADOWED_GLOBALS = ['window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'location', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'Function', 'importScripts', 'alert', 'prompt', 'confirm', 'open'];

/**
 * Compiles user scripts, instantiates them per `Script` component and drives
 * their lifecycle hooks. Errors inside hooks are caught and reported through
 * `engine.diagnostics`; a script that fails {@link maxErrors} times in a row is
 * disabled instead of crashing the loop.
 */
export class ScriptRuntime {
  readonly definitions = new Map<string, ScriptDefinition>();
  readonly sources = new Map<string, string>();
  /** Consecutive hook errors after which an instance is disabled. */
  maxErrors = 5;
  /** Forward `ctx.log` to the browser console too. Default true. */
  consoleLogging = true;

  private instances = new Map<Entity, Instance>();
  private nextId = 1;
  private unsub: (() => void)[] = [];
  private syncUnsub: (() => void) | null = null;

  constructor(readonly engine: Engine) {
    const world = engine.world;
    this.unsub.push(
      world.events.on('componentAdded', ({ entity, component }) => {
        if (component instanceof Script) this.ensureInstance(entity, component);
      }),
      world.events.on('componentRemoved', ({ entity, component }) => {
        if (component instanceof Script) this.destroyInstance(entity);
      }),
      world.events.on('entityDestroyed', (e) => this.destroyInstance(e)),
      world.events.on('cleared', () => this.instances.clear()),
      engine.physics.events.on('collisionEnter', (ev) => this.dispatchCollision('onCollisionEnter', ev)),
      engine.physics.events.on('collisionExit', (ev) => this.dispatchCollision('onCollisionExit', ev)),
      engine.physics.events.on('triggerEnter', (ev) => this.dispatchCollision('onTriggerEnter', ev)),
      engine.physics.events.on('triggerExit', (ev) => this.dispatchCollision('onTriggerExit', ev)),
      engine.net.events.on('syncChanged', (sync) => this.bindSync(sync)),
    );
    this.bindSync(engine.net.sync);
  }

  /** Forward the sync's `hostChanged` to every running script as `onHostChanged`. */
  private bindSync(sync: NetSync | null): void {
    this.syncUnsub?.();
    this.syncUnsub = null;
    if (!sync) return;
    this.syncUnsub = sync.on('hostChanged', (e) => {
      for (const inst of Array.from(this.instances.values())) {
        if (this.active(inst)) this.invoke(inst, 'onHostChanged', e.isHost, { hostId: e.hostId, previous: e.previous });
      }
    });
  }

  // ----------------------------------------------------------- definitions

  /** Register a definition written in TypeScript/JavaScript code (not sandboxed). */
  register(def: ScriptDefinition): ScriptDefinition {
    this.definitions.set(def.name, def);
    this.rebind(def.name, false);
    return def;
  }

  /**
   * Compile user source. The source must call `defineScript({...})` exactly
   * once. Throws {@link ScriptCompileError} on syntax or definition errors.
   */
  compile(source: string, fallbackName = 'script'): ScriptDefinition {
    let captured: ScriptDefinition | null = null;
    const define = (def: ScriptDefinition): ScriptDefinition => {
      if (!def || typeof def !== 'object') throw new Error('defineScript expects an object');
      if (typeof def.name !== 'string' || !def.name) def.name = fallbackName;
      captured = def;
      return def;
    };
    let fn: (...args: unknown[]) => unknown;
    try {
      fn = new Function('defineScript', 'console', 'math', ...SHADOWED_GLOBALS, `"use strict";\n${source}`) as typeof fn;
    } catch (err) {
      throw new ScriptCompileError(fallbackName, `Syntax error in "${fallbackName}": ${(err as Error).message}`, err);
    }
    const sandboxConsole = {
      log: (...a: unknown[]) => this.diag('log', a.map(String).join(' '), fallbackName),
      warn: (...a: unknown[]) => this.diag('warn', a.map(String).join(' '), fallbackName),
      error: (...a: unknown[]) => this.diag('error', a.map(String).join(' '), fallbackName),
      info: (...a: unknown[]) => this.diag('log', a.map(String).join(' '), fallbackName),
    };
    try {
      fn(define, sandboxConsole, MathNS, ...SHADOWED_GLOBALS.map(() => undefined));
    } catch (err) {
      throw new ScriptCompileError(fallbackName, `Error while defining "${fallbackName}": ${(err as Error).message}`, err);
    }
    if (!captured) throw new ScriptCompileError(fallbackName, `Script "${fallbackName}" did not call defineScript()`);
    const def = captured as ScriptDefinition;
    this.sources.set(def.name, source);
    this.definitions.set(def.name, def);
    return def;
  }

  /** Compile many sources, returning problems instead of throwing. */
  load(scripts: readonly ScriptSource[]): Diagnostic[] {
    const problems: Diagnostic[] = [];
    for (const s of scripts) {
      try {
        this.compile(s.source, s.name);
      } catch (err) {
        const d: Diagnostic = { level: 'error', message: (err as Error).message, script: s.name, error: err };
        problems.push(d);
        this.engine.diagnostics.emit('error', d);
      }
    }
    for (const s of scripts) this.rebind(s.name, false);
    return problems;
  }

  /**
   * Hot reload: recompile `source` and swap the definition into live
   * instances, preserving `state` and `props`. Runs `onReload` (and
   * `onStart` again when `rerunStart`).
   */
  reload(source: string, name: string, rerunStart = false): ScriptDefinition {
    const def = this.compile(source, name);
    this.rebind(def.name, rerunStart);
    return def;
  }

  unregister(name: string): void {
    this.definitions.delete(name);
    this.sources.delete(name);
    for (const inst of this.instances.values()) if (inst.def.name === name) inst.disabled = true;
  }

  /** Default props for a definition (for inspectors). */
  defaultProps(name: string): Record<string, unknown> {
    const def = this.definitions.get(name);
    const out: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(def?.props ?? {})) out[k] = structuredClone(p.default);
    return out;
  }

  names(): string[] {
    return Array.from(this.definitions.keys());
  }

  private rebind(name: string, rerunStart: boolean): void {
    const def = this.definitions.get(name);
    if (!def) return;
    for (const inst of this.instances.values()) {
      if (inst.component.script !== name) continue;
      inst.def = def;
      inst.disabled = false;
      inst.errors = 0;
      this.mergeProps(inst);
      if (inst.started) {
        this.invoke(inst, 'onReload');
        if (rerunStart) this.invoke(inst, 'onStart');
      }
    }
  }

  // -------------------------------------------------------------- instances

  private ensureInstance(entity: Entity, component: Script): Instance | undefined {
    let inst = this.instances.get(entity);
    if (inst && inst.component === component) return inst;
    const def = this.definitions.get(component.script);
    if (!def) return undefined;
    const state: Record<string, unknown> = inst?.state ?? {};
    inst = {
      id: this.nextId++, entity, component, def, started: false, errors: 0, disabled: false, timers: [], state,
      ctx: null as unknown as ScriptContext,
    };
    inst.ctx = this.createContext(inst);
    component._instance = inst.id;
    this.mergeProps(inst);
    this.instances.set(entity, inst);
    return inst;
  }

  private destroyInstance(entity: Entity): void {
    const inst = this.instances.get(entity);
    if (!inst) return;
    this.instances.delete(entity);
    if (inst.started) this.invoke(inst, 'onDestroy');
    inst.timers.length = 0;
  }

  /** Fill missing props from definition defaults (component props win). */
  private mergeProps(inst: Instance): void {
    const props = inst.component.props;
    for (const [k, p] of Object.entries(inst.def.props ?? {})) {
      if (!(k in props)) props[k] = structuredClone(p.default);
    }
  }

  /** Instance for an entity, if the script is bound. */
  instanceOf(entity: Entity): { def: ScriptDefinition; ctx: ScriptContext; started: boolean } | undefined {
    const i = this.instances.get(entity);
    return i ? { def: i.def, ctx: i.ctx, started: i.started } : undefined;
  }

  get instanceCount(): number {
    return this.instances.size;
  }

  // ------------------------------------------------------------- lifecycle

  /** Start any instances that have not run `onStart` yet (called before each phase). */
  private startPending(): void {
    // Late-bound: Script components added before their definitions were loaded.
    for (const s of this.engine.world.componentsOfType(Script)) {
      if (!this.instances.has(s.entity)) this.ensureInstance(s.entity, s);
    }
    for (const inst of this.instances.values()) {
      if (inst.started || inst.disabled || !inst.component.enabled) continue;
      inst.started = true;
      this.invoke(inst, 'onStart');
      if (this.engine.world.hasComponent(inst.entity, 'NetworkIdentity')) {
        const owner = (this.engine.world.getComponent(inst.entity, 'NetworkIdentity') as unknown as { ownerId: string }).ownerId;
        this.invoke(inst, 'onNetSpawn', owner);
      }
    }
  }

  /** Run the `update` hooks and timers. */
  update(dt: number): void {
    this.startPending();
    for (const inst of this.instances.values()) {
      if (!this.active(inst)) continue;
      this.tickTimers(inst, dt);
      this.invoke(inst, 'onUpdate', dt);
    }
  }

  fixedUpdate(dt: number): void {
    this.startPending();
    for (const inst of this.instances.values()) {
      if (!this.active(inst)) continue;
      if (inst.def.onOwnerInput) {
        const pi = this.engine.world.getComponent(inst.entity, PlayerInput);
        // Only where the entity is simulated: clients of a host-authoritative room render the
        // replicated result and must not steer (or fire from) their kinematic copy.
        if (pi && this.engine.net.sync?.simulatesEntity?.(inst.entity) !== false) this.invoke(inst, 'onOwnerInput', pi.snapshot, dt);
      }
      this.invoke(inst, 'onFixedUpdate', dt);
    }
  }

  lateUpdate(dt: number): void {
    for (const inst of this.instances.values()) {
      if (!this.active(inst)) continue;
      this.invoke(inst, 'onLateUpdate', dt);
    }
  }

  /** Deliver a broadcast or targeted message. */
  message(name: string, data: unknown, target?: Entity): void {
    for (const inst of this.instances.values()) {
      if (target !== undefined && inst.entity !== target) continue;
      if (!this.active(inst)) continue;
      this.invoke(inst, 'onMessage', name, data);
    }
  }

  /** Deliver an RPC to the script on `entity`. */
  rpc(entity: Entity, name: string, args: unknown[], from: string): void {
    const inst = this.instances.get(entity);
    if (inst && this.active(inst)) this.invoke(inst, 'onRpc', name, args, from);
  }

  private dispatchCollision(hook: 'onCollisionEnter' | 'onCollisionExit' | 'onTriggerEnter' | 'onTriggerExit', ev: CollisionEvent): void {
    const a = this.instances.get(ev.a);
    const b = this.instances.get(ev.b);
    if (a && this.active(a)) this.invoke(a, hook, ev.b, ev);
    if (b && this.active(b) && b.def[hook]) {
      const flipped: CollisionEvent = { ...ev, a: ev.b, b: ev.a, normal: ev.normal.clone().negate() };
      this.invoke(b, hook, ev.a, flipped);
    }
  }

  private active(inst: Instance): boolean {
    return inst.started && !inst.disabled && inst.component.enabled && this.engine.world.isAlive(inst.entity);
  }

  private tickTimers(inst: Instance, dt: number): void {
    const timers = inst.timers;
    for (let i = timers.length - 1; i >= 0; i--) {
      const t = timers[i];
      if (!t.active) { timers.splice(i, 1); continue; }
      t.remaining -= dt;
      if (t.remaining <= 0) {
        this.call(inst, 'onUpdate', () => t.fn());
        if (t.repeat && t.active) t.remaining += t.interval;
        else { t.active = false; timers.splice(i, 1); }
      }
    }
  }

  /** Call a hook if the definition implements it, with error isolation. */
  private invoke(inst: Instance, hook: ScriptHook, ...args: unknown[]): void {
    const fn = inst.def[hook] as ((...a: unknown[]) => void) | undefined;
    if (typeof fn !== 'function') return;
    this.call(inst, hook, (def) => fn.call(def, inst.ctx, ...args));
  }

  private call(inst: Instance, hook: ScriptHook, fn: (def: ScriptDefinition) => void): void {
    try {
      fn(inst.def);
      inst.errors = 0;
    } catch (err) {
      inst.errors++;
      const d: Diagnostic = {
        level: 'error',
        message: `${inst.def.name}.${hook}: ${(err as Error)?.message ?? String(err)}`,
        script: inst.def.name, hook, entity: inst.entity, error: err,
      };
      this.engine.diagnostics.emit('error', d);
      if (this.consoleLogging) console.error(`[script] ${d.message}`, err);
      if (inst.errors >= this.maxErrors) {
        inst.disabled = true;
        this.diag('warn', `Script "${inst.def.name}" on entity ${inst.entity} disabled after ${inst.errors} consecutive errors`, inst.def.name, inst.entity);
      }
    }
  }

  private diag(level: Diagnostic['level'], message: string, script?: string, entity?: Entity): void {
    const d: Diagnostic = { level, message, script, entity };
    this.engine.diagnostics.emit(level, d);
    if (this.consoleLogging) {
      const tag = script ? `[${script}]` : '[script]';
      if (level === 'error') console.error(tag, message);
      else if (level === 'warn') console.warn(tag, message);
      else console.log(tag, message);
    }
  }

  // --------------------------------------------------------------- context

  private createContext(inst: Instance): ScriptContext {
    const engine = this.engine;
    const world: World = engine.world;
    const entity = inst.entity;
    const runtime = this;
    const resolve = (type: ComponentClass | string): string => (typeof type === 'string' ? type : type.type);
    const ctx: ScriptContext = {
      engine,
      world,
      entity,
      get transform(): Transform { return world.requireComponent(entity, Transform); },
      get props() { return inst.component.props; },
      state: inst.state,
      input: engine.input,
      get playerInput() { return world.getComponent(entity, PlayerInput); },
      audio: {
        play: (clip, opts) => {
          const buf = engine.assets.get<AudioBuffer>(clip);
          if (!buf) { runtime.diag('warn', `audio.play: clip "${clip}" not loaded`, inst.def.name, entity); return null; }
          const t = world.getComponent(entity, Transform);
          return engine.audio.play(buf, { position: t ? { x: t.worldMatrix.m[12], y: t.worldMatrix.m[13] } : undefined, ...opts });
        },
        music: (clip, opts) => {
          const buf = engine.assets.get<AudioBuffer>(clip);
          if (!buf) { runtime.diag('warn', `audio.music: clip "${clip}" not loaded`, inst.def.name, entity); return null; }
          return engine.audio.playMusic(buf, clip, opts);
        },
        stopMusic: (fade) => engine.audio.stopMusic(fade),
      },
      math: MathNS,
      random: engine.random,
      net: {
        get localId() { return engine.net.localId; },
        get isHost() { return engine.net.isHost; },
        get online() { return engine.net.online; },
        hub: engine.net,
        owner: () => world.getComponent(entity, PlayerInput)?.owner ?? (world.getComponent(entity, 'NetworkIdentity') as unknown as { ownerId?: string } | undefined)?.ownerId ?? 'local',
        isOwner: () => {
          const pi = world.getComponent(entity, PlayerInput);
          const me = engine.net.localId;
          if (pi) return pi.owner === 'local' || pi.owner === me || pi.coOwners.includes(me);
          const ni = world.getComponent(entity, 'NetworkIdentity') as unknown as { ownerId?: string } | undefined;
          return !ni || ni.ownerId === me || (ni.ownerId === 'host' && engine.net.isHost);
        },
        rpc: (name, args = [], target = 'all') => engine.net.sync?.rpc(name, args, target as 'all', entity),
        spawn: (prefab, opts) => engine.net.sync ? engine.net.sync.spawn(prefab, opts) : ctx.spawn(prefab, { position: opts?.position }),
      },
      physics: engine.physics,
      physics3d: engine.physics3d,
      get debug() { return engine.renderer?.debug ?? engine.debug; },
      time: {
        get delta() { return engine.clock.delta; },
        get fixedDelta() { return engine.clock.fixedDelta; },
        get elapsed() { return engine.clock.elapsed; },
        get tick() { return engine.clock.tick; },
        get frame() { return engine.clock.frame; },
      },
      log: (...a) => runtime.diag('log', a.map(fmt).join(' '), inst.def.name, entity),
      warn: (...a) => runtime.diag('warn', a.map(fmt).join(' '), inst.def.name, entity),
      error: (...a) => runtime.diag('error', a.map(fmt).join(' '), inst.def.name, entity),
      get: <T extends Component>(type: ComponentClass<T> | string) => world.getComponent<T>(entity, resolve(type)),
      getOn: <T extends Component>(e: Entity, type: ComponentClass<T> | string) => world.getComponent<T>(e, resolve(type)),
      has: (type) => world.hasComponent(entity, resolve(type)),
      add: <T extends Component>(type: ComponentClass<T> | string, init?: Record<string, unknown>) =>
        world.addComponentByType(entity, resolve(type), init) as T,
      remove: (type) => world.removeComponent(entity, resolve(type)),
      spawn: (prefab, opts = {}) => {
        const data: PrefabData | undefined = typeof prefab === 'string' ? engine.prefabs.get(prefab) : prefab;
        if (!data) throw new Error(`Prefab "${String(prefab)}" not found`);
        return instantiatePrefab(world, data, opts);
      },
      destroy: (e = entity) => world.destroyEntityDeferred(e),
      find: (name) => world.findByName(name),
      findAll: (tag) => world.findByTag(tag),
      nameOf: (e) => world.nameOf(e),
      timer: (seconds, fn, repeat = false): TimerHandle => {
        const t: Timer = { remaining: seconds, interval: seconds, repeat, fn, active: true };
        inst.timers.push(t);
        return { cancel: () => { t.active = false; }, get active() { return t.active; } };
      },
      send: (name, data) => runtime.message(name, data),
      sendTo: (e, name, data) => runtime.message(name, data, e),
    };
    return ctx;
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    this.syncUnsub?.();
    this.syncUnsub = null;
    this.instances.clear();
  }
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
