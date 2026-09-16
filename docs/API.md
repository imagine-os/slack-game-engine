# Public API reference

All symbols are exported from `forge-engine` (`src/index.ts`). Signatures are
abbreviated; see the JSDoc in source for details.

## Engine

```ts
class Engine {
  static create(canvas: HTMLCanvasElement | null, opts?: EngineOptions): Engine;
  readonly canvas: HTMLCanvasElement | null;
  readonly world: World;            readonly registry: Registry;
  readonly clock: Clock;            readonly random: Random;
  readonly renderer: Renderer | null;
  readonly input: Input;            readonly audio: AudioEngine;
  readonly assets: AssetManager;    readonly physics: Physics2DWorld;
  readonly physics3d: Physics3DWorld;
  readonly scripting: ScriptRuntime; readonly net: NetHub;
  readonly prefabs: Map<string, PrefabData>;
  readonly events: EventEmitter<EngineEvents>;        // start stop pause resume frameStart fixedStep beforeRender afterRender resize sceneLoaded
  readonly diagnostics: EventEmitter<DiagnosticsEvents>; // error warn log  (payload: Diagnostic)
  readonly hud: Overlay;            // lazy DOM HUD
  running: boolean; paused: boolean;
  use(plugin: EnginePlugin): this; removePlugin(name): boolean; hasPlugin(name): boolean;
  start(): this; stop(): this; pause(): this; resume(): this; togglePause(): this;
  step(dt?: number): void;          // advance one frame manually (headless)
  fixedSteps(n?: number): void;     // run only fixed steps (lockstep/server)
  resize(width?: number, height?: number): void;
  loadScene(scene: SceneData): LoadResult; saveScene(name?, settings?): SceneData; clearScene(): void;
  screenToWorld(sx, sy, out?: Vec3): Vec3; worldToScreen(p: Vec3, out?: Vec2): Vec2;
  transformOf(entity): Transform | undefined; warn(msg): void; log(msg): void; dispose(): void;
}
interface EngineOptions extends ClockOptions {
  renderer?: '2d' | '3d' | 'none' | Renderer; render?: RendererOptions; pixelsPerUnit?: number;
  registry?: Registry; seed?: number; gravity?: Vec2Like; autoResize?: boolean; input?: boolean;
  touchOverlay?: TouchOverlayOptions | false; audio?: boolean; assetBaseUrl?: string; defaultBindings?: boolean;
}
interface EnginePlugin { name: string; install(engine: Engine): void; uninstall?(engine: Engine): void }
```

## World (ECS)

```ts
type Entity = number;  const NULL_ENTITY = 0;
class World {
  constructor(registry?: Registry);
  readonly registry: Registry; readonly events: EventEmitter<WorldEvents>; // entityCreated entityDestroyed componentAdded componentRemoved systemAdded systemRemoved cleared
  createEntity(name?: string): Entity;        // always gets a Transform (+ Name when named)
  createBareEntity(): Entity;                 // no Transform
  destroyEntity(e): void; destroyEntityDeferred(e): void; flushDestroyed(): void;
  isAlive(e): boolean; entityCount: number; entities(): Entity[];
  addComponent<T>(e, cls: ComponentClass<T> | T, init?: Partial<T> | Record<string, unknown>): T;
  addComponentByType(e, type: string, init?): Component;
  getComponent<T>(e, ref: ComponentClass<T> | string): T | undefined;
  requireComponent<T>(e, ref): T; ensureComponent<T>(e, cls): T;
  hasComponent(e, ref): boolean; removeComponent(e, ref): boolean;
  getComponents(e): Component[]; getComponentTypes(e): string[];
  componentsOfType<T>(ref): readonly T[];     // dense array, do not mutate
  query(all: ComponentRef[], none?: ComponentRef[]): Query;   // cached
  with(...all): Entity[];
  each(A, fn) / each(A, B, fn) / each(A, B, C, fn): void;     // fn(entity, a, b, c)
  findByName(name): Entity | undefined; findByTag(tag): Entity[]; nameOf(e): string;
  setParent(child, parent, keepWorldTransform?): void; getParent(e): Entity; getChildren(e): readonly Entity[];
  roots(): Entity[]; isDescendantOf(e, ancestor): boolean; updateTransforms(): void;
  addSystem(s: System): System; removeSystem(s): boolean; getSystem(name): System | undefined;
  systemsIn(phase): readonly System[]; runPhase(phase: Phase, dt: number): void;
  clear(): void; dispose(): void;
}
class Query { readonly entities: Entity[]; readonly all: string[]; readonly none: string[]; size: number; has(e): boolean; [Symbol.iterator]() }
type Phase = 'input' | 'fixedUpdate' | 'update' | 'lateUpdate' | 'render';
interface System { name: string; phase: Phase; priority?: number; enabled?: boolean; init?(world); update(world, dt): void; dispose?(world) }
abstract class SystemBase implements System { ... }
function createSystem(name, phase, update: (world, dt) => void, priority?): System;

abstract class Component { static readonly type: string; entity: Entity; get type(): string; onAttach?(); onDetach?() }
interface ComponentClass<T> { new (): T; readonly type: string }
type FieldType = 'number'|'integer'|'string'|'boolean'|'vec2'|'vec3'|'quat'|'color'|'rect'|'enum'|'asset'|'entity'|'json';
interface FieldMeta { type: FieldType; label?; description?; min?; max?; step?; options?: readonly string[]; assetKind?; hidden?; readonly?; transient? }
interface ComponentMeta { category?; description?; icon?; fields?: Record<string, FieldMeta>; unique?: boolean; requires?: readonly string[] }
```

### Registry

```ts
class Registry {
  register<T>(cls: ComponentClass<T>, meta?: ComponentMeta): this; unregister(type): boolean;
  has(type): boolean; get(type): RegistryEntry | undefined; require(type): RegistryEntry;
  types(): string[]; all(): RegistryEntry[]; byCategory(): Map<string, RegistryEntry[]>;
  create(type): Component; fields(type): Record<string, FieldMeta>; defaults(type): Record<string, unknown>;
  serialize(component, remap?: (id) => number): Record<string, unknown>;
  deserialize<T>(type, data, into?: T, remap?): T;
  applyProps(component, data, remap?): void;
}
interface RegistryEntry { type; cls; meta; defaults; fields }
const defaultRegistry: Registry;
function registerComponent<T>(cls, meta?): ComponentClass<T>;   // registers into defaultRegistry
```

### Transform and built-in core components

```ts
class Transform extends Component {  // type 'Transform'
  position: Vec3; rotation: Quat; scale: Vec3; parent: Entity; readonly children: Entity[];
  readonly localMatrix: Mat4; readonly worldMatrix: Mat4; worldVersion: number;
  x, y, z: number; angle: number /* rad about Z */; angleDeg: number;
  setPosition(x, y, z?): this; setScale(x, y?, z?): this; setEuler(x, y, z): this; translate(dx, dy, dz?): this; rotate2D(rad): this;
  markDirty(): void; updateWorldMatrix(recurse?, parentChanged?): void;
  getWorldPosition(out?): Vec3; getWorldRotation(out?): Quat; getWorldScale(out?): Vec3; getWorldAngle(): number;
  localToWorld(p, out?): Vec3; worldToLocal(p, out?): Vec3; forward(out?): Vec3; right(out?): Vec3; up(out?): Vec3; lookAt(target, up?): this;
}
class Name extends Component { name: string }                       // 'Name'
class Tag extends Component { tags: string[]; has(t); add(t); remove(t) } // 'Tag'
```

### Scenes and prefabs

```ts
const SCENE_VERSION = 1;
interface ComponentData { type: string; data: Record<string, unknown> }
interface EntityData { id: number; name?: string; parent?: number; components: ComponentData[] }
interface SceneData { version: number; name: string; entities: EntityData[]; settings?: Record<string, unknown> }
interface PrefabData { version: number; name: string; entities: EntityData[] }   // root first
function saveScene(world, name?, settings?): SceneData;
function loadScene(world, scene, opts?: { clear?: boolean; onUnknownComponent? }): LoadResult;  // { idMap, roots }
function createPrefab(world, root, name?): PrefabData;
function instantiatePrefab(world, prefab, overrides?: { position?; name?; parent? }): Entity;
function serializeEntity(world, e, remap?): EntityData; function createEmptyScene(name?): SceneData; function migrateScene(scene): SceneData;
```

## Math

`Vec2`, `Vec3`, `Quat`, `Mat4` (column-major `Float32Array m`), `Color` (0..1
floats, `fromHex`/`toHex`/`toCSS`/`setHSL`), `Rect`, `Random` (Mulberry32:
`next`, `range`, `int`, `chance`, `pick`, `shuffle`, `gaussian`,
`getState`/`setState`), scalars (`clamp`, `lerp`, `inverseLerp`, `remap`,
`smoothstep`, `moveToward`, `damp`, `wrapAngle`, `lerpAngle`, `degToRad`,
`radToDeg`, `EPSILON`, `TAU`). Mutating methods return `this`; static
variants take an `out` parameter.

## Clock

```ts
class Clock { fixedDelta; fixedRate; timeScale; delta; unscaledDelta; elapsed; tick; frame; alpha; fps;
  advance(timestampMs): number /* steps */; advanceBy(dt): number; consumeFixedStep(): void; updateAlpha(): void; reset(): void }
```

## Input

```ts
class Input {
  readonly keyboard: Keyboard; readonly mouse: Mouse; readonly touch: Touch; readonly gamepads: Gamepads;
  readonly events: EventEmitter<InputEvents>;  enabled: boolean; tick: number;
  attach(el: HTMLElement): void; detach(): void; enableTouchOverlay(opts?: TouchOverlayOptions): void;
  bind(action: string, bindings: string | string[]): this; addBinding(action, ...bindings): this; unbind(action): this;
  bindAxis(name: string, axis: AxisBinding): this; unbindAxis(name): this;
  actionNames(): string[]; axisNames(): string[]; bindingsOf(action): readonly string[];
  loadBindings(cfg: { actions?; axes? }): this; saveBindings(): { actions; axes }; useDefaultBindings(): this;
  held(action): boolean; pressed(action): boolean; released(action): boolean; axis(name): number;
  bindingHeld(binding): boolean; anyHeld(): boolean; getSnapshot(): InputSnapshot;
  update(): void; endFrame(): void;
}
// Binding grammar: KeyboardEvent.code | 'MouseLeft'|'MouseRight'|'MouseMiddle'|'Mouse<n>' | 'Gamepad<A|B|X|Y|LB|RB|LT|RT|Back|Start|LS|RS|DpadUp|DpadDown|DpadLeft|DpadRight|Home>' | 'Touch:<name>'
interface AxisBinding { positive?: string[]; negative?: string[]; gamepadAxis?: number; invertGamepad?: boolean; touchJoystick?: 'x'|'y'; gamepadTrigger?: number }

interface InputSnapshot { tick: number; held: string[]; pressed: string[]; released: string[]; axes: Record<string, number>; pointer?: { x; y; buttons } }
type EncodedSnapshot = [tick, heldMask, pressedMask, releasedMask, axes: number[], pointer?: [x, y, buttons]];
function createEmptySnapshot(tick?): InputSnapshot; function cloneSnapshot(s): InputSnapshot;
function encodeSnapshot(s, actions: string[], axes: string[]): EncodedSnapshot; function decodeSnapshot(e, actions, axes): InputSnapshot;
type InputMergeStrategy = 'first-wins' | 'average' | 'additive';
function mergeSnapshots(snaps: InputSnapshot[], strategy?): InputSnapshot;

class PlayerInput extends Component { // 'PlayerInput'
  owner: string /* peer id, 'local' offline */; coOwners: string[]; mergeStrategy: InputMergeStrategy; snapshot: InputSnapshot; fresh: boolean;
  held(a); pressed(a); released(a); axis(n); apply(s: InputSnapshot): void }
```

## Rendering

```ts
interface Renderer {
  readonly kind: '2d' | '3d'; readonly canvas; readonly width; readonly height; readonly pixelRatio;
  readonly clearColor: Color; readonly debug: DebugDraw; readonly stats: RenderStats; pixelsPerUnit: number;
  init(host: RendererHost): void; resize(w, h, pixelRatio?): void; render(world: World, alpha: number): void;
  screenToWorld(sx, sy, out: Vec3): Vec3; worldToScreen(p: Vec3Like, out: Vec2): Vec2; dispose(): void;
}
class Canvas2DRenderer implements Renderer { readonly ctx; readonly camera: { x; y; zoom; angle }; pixelPerfect; hidpi }
class WebGLRenderer implements Renderer { readonly gl: WebGL2RenderingContext; readonly viewProj: Mat4; readonly cameraPosition: Vec3;
  addMesh(name: string, data: MeshData): void; screenRay(sx, sy, origin: Vec3, dir: Vec3): void }
class DebugDraw { enabled; line(a, b, color?); line3(a, b, color?); rect(cx, cy, w, h, color?, angle?); circle(cx, cy, r, color?); polygon(points, color?); box3(min, max, color?); text(x, y, text, color?); clear() }
// Components: Camera2D, Sprite, AnimatedSprite, Shape, Text, Tilemap, ParticleEmitter, Light2D, MeshRenderer, Camera3D, Light
// Systems: AnimatedSpriteSystem, Camera2DSystem, ParticleSystem (installed by Engine)
// WebGL helpers: MeshData, GPUMesh, createCube/createSphere/createPlane/createCylinder, PRIMITIVES, parseGLTF/parseGLB/loadGLTF, OrbitController, Shader
```

## Physics

```ts
class Physics2DWorld {
  readonly gravity: Vec2; iterations; positionCorrection; slop; restingSpeed; cellSize; readonly events: EventEmitter<PhysicsEvents>; contactCount;
  setLayerCollision(a, b, enabled): void; layersCollide(a, b): boolean; setCollisionMatrix(masks: number[]): void; getCollisionMatrix(): number[];
  step(world: World, dt: number): void; reset(): void; refresh(world): void;
  raycast(origin, dir, maxDistance?, mask?, ignore?): RaycastHit2D | null; raycastAll(...): RaycastHit2D[];
  overlapCircle(center, r, mask?): Entity[]; overlapBox(center, w, h, mask?): Entity[]; queryPoint(p, mask?): Entity[];
  debugShapes(fn: (shape, isTrigger, entity) => void): void;
}
// events: collisionEnter/Stay/Exit, triggerEnter/Stay/Exit → CollisionEvent { a, b, normal (a→b), point, penetration, impulse }
class RigidBody2D { bodyType: 'dynamic'|'kinematic'|'static'; mass; restitution; friction; gravityScale; velocity: Vec2; angularVelocity; linearDamping; angularDamping; fixedRotation; layer; collisionMask; bullet; force: Vec2; torque; contacts: BodyContact[]; grounded; applyForce; applyImpulse; setVelocity }
class BoxCollider2D { width; height; offset; isTrigger; restitution; friction }   class CircleCollider2D { radius; ... }   class PolygonCollider2D { points: number[]; ... }
class TilemapCollider2D { layer; friction; restitution }
class CharacterController2D { moveSpeed; acceleration; airAcceleration; jumpSpeed; coyoteTime; jumpBufferTime; fallGravityScale; jumpCutoff; maxFallSpeed; variableJump; grounded; facing; move(x); jump(); jumpReleased(); apply(rb, dt) }
class Physics2DSystem extends SystemBase   // fixedUpdate, priority 100
class Physics3DWorld { gravity: Vec3; step(world, dt); reset(); raycast(origin, dir, max?, mask?); events }
class RigidBody3D, BoxCollider3D, SphereCollider3D, CharacterController3D, Physics3DSystem
// Low level: collideShapes, transformPolygon, boxPoints, raycastShape, SpatialHash
```

## Audio

```ts
class AudioEngine { context; unlocked; init(); unlockOnGesture(...targets); unlock(): Promise<boolean>; decode(buf): Promise<AudioBuffer>;
  setBusVolume(bus, v); getBusVolume(bus); setMuted(m); setListener(x, y); play(buffer, opts?: PlayOptions): SoundHandle | null;
  playMusic(buffer, id, opts?): SoundHandle | null; stopMusic(fade?); stopAll(fade?); suspend(); resume(); dispose() }
class SoundHandle { playing; position; setVolume(v); setPitch(r); refresh(); stop(fade?) }
class AudioSource extends Component { clip; volume; pitch; pitchVariation; loop; playOnStart; spatial; maxDistance; bus; play(); stop(fade?); playing }
class AudioListener extends Component { enabled }
```

## Assets

```ts
class AssetManager {
  baseUrl: string; readonly events: EventEmitter<AssetEvents>; // progress loaded error complete
  registerLoader<T>(kind, loader: AssetLoader<T>): void; resolveUrl(url): string;
  load<T>(kind, url, id?, meta?): Promise<T>; loadManifest(manifest, opts?): Promise<{ failed }>; loadAll(entries, opts?): Promise<{ failed }>;
  set<T>(id, kind, value): T; get<T>(id): T | undefined; require<T>(id): T; has(id); kindOf(id); ids(kind?); unload(id); clear();
  fetchArrayBuffer(url); fetchText(url); fetchJSON<T>(url);
}
type AssetKind = 'image' | 'atlas' | 'audio' | 'json' | 'text' | 'binary' | 'gltf' | string;
interface AssetManifest { baseUrl?: string; assets: { id; kind; url; meta? }[] }
interface Atlas { image: string; frames: Record<string, AtlasFrame>; animations?: Record<string, { frames: string[]; fps?; loop? }> }
```

## Scripting

```ts
function defineScript(def: ScriptDefinition): ScriptDefinition;
interface ScriptDefinition { name; description?; props?: Record<string, ScriptPropDef>;
  onStart?(ctx); onUpdate?(ctx, dt); onFixedUpdate?(ctx, dt); onLateUpdate?(ctx, dt); onDestroy?(ctx); onReload?(ctx);
  onCollisionEnter?/onCollisionExit?/onTriggerEnter?/onTriggerExit?(ctx, other: Entity, info: CollisionEvent);
  onNetSpawn?(ctx, ownerId); onOwnerInput?(ctx, snapshot: InputSnapshot, dt); onMessage?(ctx, name, data); onRpc?(ctx, name, args, from) }
interface ScriptPropDef { type: FieldType; default: unknown; label?; description?; min?; max?; step?; options?; assetKind? }
class Script extends Component { script: string; props: Record<string, unknown>; enabled: boolean }   // 'Script'
class ScriptRuntime {
  readonly definitions: Map<string, ScriptDefinition>; readonly sources: Map<string, string>; maxErrors; consoleLogging;
  register(def): ScriptDefinition; compile(source, fallbackName?): ScriptDefinition /* throws ScriptCompileError */;
  load(scripts: ScriptSource[]): Diagnostic[]; reload(source, name, rerunStart?): ScriptDefinition; unregister(name): void;
  defaultProps(name): Record<string, unknown>; names(): string[]; instanceOf(entity): { def; ctx; started } | undefined; instanceCount;
  update(dt); fixedUpdate(dt); lateUpdate(dt); message(name, data, target?); rpc(entity, name, args, from); dispose();
}
interface ScriptContext { engine; world; entity; transform; props; state; input; playerInput; audio; math; random; net; physics; physics3d; debug; time;
  log/warn/error(...args); get(type); getOn(entity, type); has(type); add(type, init?); remove(type);
  spawn(prefab | PrefabData, opts?); destroy(entity?); find(name); findAll(tag); nameOf(e); timer(seconds, fn, repeat?): TimerHandle; send(name, data?); sendTo(entity, name, data?) }
interface Diagnostic { level: 'error'|'warn'|'log'; message; script?; hook?; entity?; error?; line?; column? }
const SCRIPT_API_DTS: string;   // .d.ts text for editor autocompletion
```

## Project

```ts
const PROJECT_VERSION = 1;
interface Project { id; name; version; projectVersion; description; author; thumbnail; createdAt; updatedAt;
  scenes: SceneData[]; startScene: string; scripts: { name; source }[]; prefabs: PrefabData[]; assets: AssetManifest; settings: ProjectSettings }
interface ProjectSettings { renderer: '2d'|'3d'; pixelsPerUnit; pixelPerfect; fixedRate; viewport: { width; height };
  physics: { gravity: {x;y}; gravity3d: {x;y;z} }; network: { mode: 'none'|'host-authoritative'|'lockstep'; maxPlayers; tickRate };
  multiUser: { sharedControl: boolean; mergeStrategy: InputMergeStrategy }; input: { actions; axes }; touchControls: boolean; touchButtons: string[] }
function createProject(opts?: { name?; renderer?; id?; author? }): Project; function normalizeProject(partial): Project; function defaultSettings(renderer?): ProjectSettings; function defaultScene(renderer, name?): SceneData; function generateId(prefix?): string;
class ProjectStore { save(p): Promise<Project>; load(id): Promise<Project | undefined>; list(): Promise<ProjectSummary[]>; delete(id): Promise<void>; has(id): Promise<boolean>; export(p, pretty?): string; import(json, opts?: { newId? }): Project; download(p, filename?): void }
class ProjectLoader { constructor(store?: ProjectStore | null, demosBase?: string); fromUrl(url): Promise<Project>; fromDemo(id): Promise<Project>; resolve(ref): Promise<Project> }
function engineOptionsFor(project, extra?: EngineOptions): EngineOptions;
function runProject(engine, project, opts?: { onProgress?; scene?; strictAssets? }): Promise<void>;
```

## Networking (interfaces for the networking worker)

```ts
interface Transport { readonly name; readonly localId: PeerId; readonly isHost: boolean; readonly roomId: string; readonly peers: readonly PeerId[]; readonly connected: boolean;
  connect(opts: ConnectOptions): Promise<void>; disconnect(): Promise<void>; send(to: PeerId | 'all', data: ArrayBuffer | Uint8Array | object, opts?: { reliable?: boolean }): void;
  on(event: 'connected'|'disconnected'|'message'|'peer-join'|'peer-leave'|'host-changed'|'error', fn): () => void; rtt(peerId?): number }
class NullTransport implements Transport   // offline default: localId 'local', isHost true
interface NetSync { readonly transport; readonly options: NetSyncOptions; readonly tick; readonly isHost; readonly localId;
  start(); stop(); update(dt); fixedUpdate(dt);
  spawn(prefab, opts?): Entity; despawn(entity); setOwner(entity, ownerId); shareControl(entity, peerId, enabled);
  submitInput(snapshot: InputSnapshot); inputFor(entity): InputSnapshot | undefined;
  onRpc(name, handler): () => void; rpc(name, args, target?: PeerId|'host'|'all'|'others', entity?); on(event, fn); players() }
interface NetSyncOptions { mode; tickRate; maxPlayers; sharedControl; mergeStrategy }
class NetHub { transport; sync; setTransport(t); setSync(s | null); localId; isHost; connected; roomId; online; events }
class NetworkIdentity extends Component { netId; ownerId; authority: 'host'|'owner'; prefab; sharedWith: string[]; replicate }
class NetTransform extends Component { syncPosition; syncRotation; syncScale; interpolationDelay; extrapolation; positionThreshold; rotationThreshold; teleportDistance; targetPosition; targetRotation; targetVelocity; lastTick }
```

## UI

```ts
class Overlay { constructor(container: HTMLElement); text(id, text, opts?); button(id, label, onClick, opts?); add(id, el, opts?); panel(id, title, body?, opts?); get(id); remove(id); clear(); dispose() }
```
