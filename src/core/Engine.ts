import { Clock, type ClockOptions } from './Clock';
import { EventEmitter } from './EventEmitter';
import { Random, Vec2, Vec3, type Vec2Like } from './math';
import { defaultRegistry, Registry } from './ecs/Registry';
import { World } from './ecs/World';
import { loadScene, saveScene, type LoadResult, type PrefabData, type SceneData } from './ecs/Scene';
import { createSystem } from './ecs/System';
import { Transform } from './ecs/Transform';
import { Input } from '../input/Input';
import type { TouchOverlayOptions } from '../input/Touch';
import { PlayerInput } from '../input/PlayerInput';
import { AssetManager } from '../assets/AssetManager';
import { AudioEngine } from '../audio/AudioEngine';
import { AudioSystem } from '../audio/AudioSystem';
import type { Renderer, RendererOptions } from '../render/Renderer';
import { Canvas2DRenderer } from '../render/Canvas2DRenderer';
import { WebGLRenderer } from '../render/WebGLRenderer';
import { DebugDraw } from '../render/DebugDraw';
import { AnimatedSpriteSystem, Camera2DSystem, ParticleSystem } from '../render/systems2d';
import { loadGLTF } from '../render/webgl/GLTFLoader';
import { Physics2DWorld } from '../physics/Physics2DWorld';
import { Physics2DSystem } from '../physics/Physics2DSystem';
import { Physics3DSystem, Physics3DWorld } from '../physics/physics3d';
import { ScriptRuntime } from '../scripting/ScriptRuntime';
import { ScriptFixedSystem, ScriptLateSystem, ScriptUpdateSystem } from '../scripting/ScriptSystems';
import type { Diagnostic } from '../scripting/types';
import { NetHub } from '../net/NetHub';
// Side-effect import: registers NetworkIdentity/NetTransform so scenes and prefabs using them load in every bundle.
import '../net/components';
import { Overlay } from '../ui/Overlay';

export type RendererChoice = '2d' | '3d' | 'none';

export interface EngineOptions extends ClockOptions {
  /** Which renderer to create, or a pre-built renderer instance. Default `'2d'` (`'none'` when no canvas). */
  renderer?: RendererChoice | Renderer;
  /** Renderer settings. */
  render?: RendererOptions;
  /** Shorthand for `render.pixelsPerUnit`. */
  pixelsPerUnit?: number;
  /** Component registry. Default: the process-wide registry. */
  registry?: Registry;
  /** PRNG seed for `engine.random`. Default: time-based. */
  seed?: number;
  /** 2D gravity. Default (0, -20). */
  gravity?: Vec2Like;
  /** Keep the canvas sized to its parent element. Default true. */
  autoResize?: boolean;
  /** Attach input devices to the canvas. Default true when a canvas is given. */
  input?: boolean;
  /** Show the mobile touch overlay (joystick + buttons). Default false. */
  touchOverlay?: TouchOverlayOptions | false;
  /** Create an AudioEngine and unlock it on the first gesture. Default true. */
  audio?: boolean;
  /** Base URL for relative asset paths. Default `'./'`. */
  assetBaseUrl?: string;
  /** Apply `Input.useDefaultBindings()`. Default true. */
  defaultBindings?: boolean;
}

export interface EngineEvents extends Record<string, unknown> {
  start: void;
  stop: void;
  pause: void;
  resume: void;
  /** Once per frame before any phase. */
  frameStart: number;
  /** After each fixed step, with the tick number. */
  fixedStep: number;
  beforeRender: number;
  afterRender: number;
  resize: { width: number; height: number };
  sceneLoaded: SceneData;
}

export interface DiagnosticsEvents extends Record<string, unknown> {
  error: Diagnostic;
  warn: Diagnostic;
  log: Diagnostic;
}

/** Extension hook: plugins get the engine and may add systems, components, loaders, etc. */
export interface EnginePlugin {
  name: string;
  install(engine: Engine): void;
  uninstall?(engine: Engine): void;
}

/**
 * The engine: owns the world, clock, renderer, input, audio, assets, physics,
 * scripting and networking hub, and runs the frame loop:
 *
 * `input → fixedUpdate×N → update → lateUpdate → transforms → render`.
 *
 * Create with {@link Engine.create}. Pass `null` for the canvas to run
 * headless (tests, servers) and drive it with {@link step}.
 */
export class Engine {
  readonly canvas: HTMLCanvasElement | null;
  readonly registry: Registry;
  readonly world: World;
  readonly clock: Clock;
  readonly random: Random;
  readonly events = new EventEmitter<EngineEvents>();
  readonly diagnostics = new EventEmitter<DiagnosticsEvents>();
  readonly input: Input;
  readonly audio: AudioEngine;
  readonly assets: AssetManager;
  readonly physics: Physics2DWorld;
  readonly physics3d: Physics3DWorld;
  readonly scripting: ScriptRuntime;
  readonly net = new NetHub();
  /** Prefabs available to `ctx.spawn(name)`; filled by the project loader. */
  readonly prefabs = new Map<string, PrefabData>();
  /** Debug drawer used when there is no renderer (headless). */
  readonly debug = new DebugDraw();
  readonly options: Readonly<EngineOptions>;

  private _renderer: Renderer | null = null;
  private _running = false;
  private _paused = false;
  private rafId = 0;
  private plugins = new Map<string, EnginePlugin>();
  private resizeObserver: ResizeObserver | null = null;
  private _overlay: Overlay | null = null;
  private frameHandler = (ts: number): void => {
    if (!this._running) return;
    this.rafId = requestAnimationFrame(this.frameHandler);
    const steps = this.clock.advance(ts);
    this.runFrame(steps);
  };

  /** Create an engine. Prefer this over `new`. */
  static create(canvas: HTMLCanvasElement | null, opts: EngineOptions = {}): Engine {
    return new Engine(canvas, opts);
  }

  constructor(canvas: HTMLCanvasElement | null, opts: EngineOptions = {}) {
    this.canvas = canvas;
    this.options = opts;
    this.registry = opts.registry ?? defaultRegistry;
    this.world = new World(this.registry);
    this.clock = new Clock(opts);
    this.random = new Random(opts.seed);
    this.assets = new AssetManager(opts.assetBaseUrl ?? './');
    this.assets.registerLoader('gltf', loadGLTF);
    this.audio = new AudioEngine(this.random);
    this.assets.decodeAudio = (buf) => this.audio.decode(buf);
    this.input = new Input();
    this.physics = new Physics2DWorld();
    if (opts.gravity) this.physics.gravity.set(opts.gravity.x, opts.gravity.y);
    this.physics3d = new Physics3DWorld();
    this.scripting = new ScriptRuntime(this);

    // Renderer.
    const choice = opts.renderer ?? (canvas ? '2d' : 'none');
    if (canvas && choice !== 'none') {
      const rOpts: RendererOptions = { ...opts.render };
      if (opts.pixelsPerUnit !== undefined) rOpts.pixelsPerUnit = opts.pixelsPerUnit;
      if (typeof choice === 'string') this._renderer = choice === '3d' ? new WebGLRenderer(canvas, rOpts) : new Canvas2DRenderer(canvas, rOpts);
      else this._renderer = choice;
      this._renderer.init({ world: this.world, getAsset: (id) => this.assets.get(id), warn: (m) => this.warn(m) });
    }

    // Input & audio.
    if (canvas && opts.input !== false) {
      this.input.attach(canvas);
      if (opts.touchOverlay) this.input.enableTouchOverlay(opts.touchOverlay);
    }
    if (opts.defaultBindings !== false) this.input.useDefaultBindings();
    if (opts.audio !== false && typeof window !== 'undefined') this.audio.unlockOnGesture(canvas ?? window);

    this.installCoreSystems();

    if (canvas && opts.autoResize !== false && typeof ResizeObserver !== 'undefined') {
      const target = canvas.parentElement ?? canvas;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(target);
      this.resize();
    }
  }

  private installCoreSystems(): void {
    const w = this.world;
    const debug = this._renderer?.debug ?? this.debug;
    // Input phase: poll devices, resolve mouse world position, feed local PlayerInput.
    w.addSystem(createSystem('InputSystem', 'input', () => {
      this.input.tick = this.clock.tick;
      this.input.update();
      if (this._renderer) {
        this._renderer.screenToWorld(this.input.mouse.position.x, this.input.mouse.position.y, _v3);
        this.input.mouse.worldPosition.set(_v3.x, _v3.y);
        this.input.getSnapshot().pointer = { x: _v3.x, y: _v3.y, buttons: this.input.mouse.buttons };
      }
      const snap = this.input.getSnapshot();
      const me = this.net.localId;
      for (const pi of w.componentsOfType(PlayerInput)) {
        if (pi.owner === 'local' || pi.owner === me || (pi.coOwners.includes(me) && !this.net.online)) pi.apply(snap);
      }
    }, -1000));
    w.addSystem(new ScriptFixedSystem(this.scripting));
    w.addSystem(new Physics2DSystem(this.physics, debug));
    w.addSystem(new Physics3DSystem(this.physics3d));
    w.addSystem(new ScriptUpdateSystem(this.scripting));
    w.addSystem(new AnimatedSpriteSystem((id) => this.assets.get(id)));
    w.addSystem(new ParticleSystem(this.random));
    w.addSystem(new Camera2DSystem(this.random));
    w.addSystem(new ScriptLateSystem(this.scripting));
    w.addSystem(new AudioSystem(this.audio, this.assets));
    w.addSystem(createSystem('RenderSystem', 'render', () => {
      this._renderer?.render(w, this.clock.alpha);
    }, 0));
  }

  // -------------------------------------------------------------- accessors

  get renderer(): Renderer | null {
    return this._renderer;
  }

  get running(): boolean {
    return this._running;
  }

  get paused(): boolean {
    return this._paused;
  }

  /** Lazily created DOM HUD over the canvas. */
  get hud(): Overlay {
    if (!this._overlay) {
      if (!this.canvas?.parentElement) throw new Error('HUD requires a canvas inside a parent element');
      this._overlay = new Overlay(this.canvas.parentElement);
    }
    return this._overlay;
  }

  // ---------------------------------------------------------------- plugins

  use(plugin: EnginePlugin): this {
    if (this.plugins.has(plugin.name)) return this;
    this.plugins.set(plugin.name, plugin);
    plugin.install(this);
    return this;
  }

  removePlugin(name: string): boolean {
    const p = this.plugins.get(name);
    if (!p) return false;
    p.uninstall?.(this);
    return this.plugins.delete(name);
  }

  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  // -------------------------------------------------------------- lifecycle

  start(): this {
    if (this._running) return this;
    this._running = true;
    this.clock.reset();
    this.events.emit('start', undefined);
    if (typeof requestAnimationFrame === 'function') this.rafId = requestAnimationFrame(this.frameHandler);
    return this;
  }

  stop(): this {
    if (!this._running) return this;
    this._running = false;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.events.emit('stop', undefined);
    return this;
  }

  pause(): this {
    if (this._paused) return this;
    this._paused = true;
    this.events.emit('pause', undefined);
    return this;
  }

  resume(): this {
    if (!this._paused) return this;
    this._paused = false;
    this.events.emit('resume', undefined);
    return this;
  }

  togglePause(): this {
    return this._paused ? this.resume() : this.pause();
  }

  /**
   * Advance manually by `dt` seconds (default: one fixed step). Runs the same
   * pipeline as the frame loop, so headless tests and servers behave like the browser.
   */
  step(dt = this.clock.fixedDelta): void {
    const steps = this.clock.advanceBy(dt);
    this.runFrame(steps);
  }

  /** Run exactly `n` fixed steps without a render (lockstep/server use). */
  fixedSteps(n = 1): void {
    for (let i = 0; i < n; i++) {
      const fd = this.clock.fixedDelta;
      this.net.sync?.fixedUpdate(fd);
      this.world.runPhase('fixedUpdate', fd);
      this.clock.tick++;
      this.events.emit('fixedStep', this.clock.tick);
    }
    this.world.updateTransforms();
  }

  private runFrame(steps: number): void {
    const clock = this.clock;
    this.events.emit('frameStart', clock.delta);
    this.world.runPhase('input', clock.delta);
    if (!this._paused) {
      for (let i = 0; i < steps; i++) {
        this.net.sync?.fixedUpdate(clock.fixedDelta);
        this.world.runPhase('fixedUpdate', clock.fixedDelta);
        clock.consumeFixedStep();
        this.events.emit('fixedStep', clock.tick);
      }
      clock.updateAlpha();
      this.net.sync?.update(clock.delta);
      this.world.runPhase('update', clock.delta);
      this.world.runPhase('lateUpdate', clock.delta);
    } else {
      // Consume the accumulator so unpausing does not fast-forward.
      for (let i = 0; i < steps; i++) clock.consumeFixedStep();
      this.net.sync?.update(clock.delta);
    }
    this.world.updateTransforms();
    this.events.emit('beforeRender', clock.alpha);
    this.world.runPhase('render', clock.delta);
    this.events.emit('afterRender', clock.alpha);
    this.input.endFrame();
  }

  /** Match the canvas backing store to its CSS size (called automatically with `autoResize`). */
  resize(width?: number, height?: number): void {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const w = width ?? ((parent ? parent.clientWidth : this.canvas.clientWidth) || 1);
    const h = height ?? ((parent ? parent.clientHeight : this.canvas.clientHeight) || 1);
    if (this._renderer) this._renderer.resize(w, h);
    else {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.events.emit('resize', { width: w, height: h });
  }

  // ----------------------------------------------------------------- scenes

  /** Replace the world contents with a scene document. */
  loadScene(scene: SceneData): LoadResult {
    this.physics.reset();
    this.physics3d.reset();
    const res = loadScene(this.world, scene, {
      onUnknownComponent: (e, cd) => this.warn(`Unknown component "${cd.type}" on entity ${e} skipped`),
    });
    if (scene.settings) this.applySceneSettings(scene.settings);
    this.events.emit('sceneLoaded', scene);
    return res;
  }

  /** Serialize the current world. */
  saveScene(name = 'Scene', settings?: Record<string, unknown>): SceneData {
    return saveScene(this.world, name, settings);
  }

  clearScene(): void {
    this.world.clear();
    this.physics.reset();
    this.physics3d.reset();
  }

  private applySceneSettings(s: Record<string, unknown>): void {
    const g = s.gravity as Vec2Like | undefined;
    if (g && typeof g.x === 'number') this.physics.gravity.set(g.x, g.y);
    const seed = s.seed as number | undefined;
    if (typeof seed === 'number') this.random.seed(seed);
  }

  // ----------------------------------------------------------------- helpers

  /** Canvas CSS pixel to world position (2D plane or 3D ground plane). */
  screenToWorld(sx: number, sy: number, out = new Vec3()): Vec3 {
    return this._renderer ? this._renderer.screenToWorld(sx, sy, out) : out.set(sx, sy, 0);
  }

  worldToScreen(p: Vec3, out = new Vec2()): Vec2 {
    return this._renderer ? this._renderer.worldToScreen(p, out) : out.set(p.x, p.y);
  }

  /** Convenience: entity's Transform. */
  transformOf(entity: number): Transform | undefined {
    return this.world.getComponent(entity, Transform);
  }

  warn(message: string): void {
    this.diagnostics.emit('warn', { level: 'warn', message });
  }

  log(message: string): void {
    this.diagnostics.emit('log', { level: 'log', message });
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    for (const p of this.plugins.values()) p.uninstall?.(this);
    this.plugins.clear();
    this.scripting.dispose();
    this.input.detach();
    this.audio.dispose();
    this._overlay?.dispose();
    this._renderer?.dispose();
    this.world.dispose();
  }
}

const _v3 = new Vec3();
