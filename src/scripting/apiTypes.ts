/**
 * TypeScript declarations describing the scripting API, as a string, for
 * editor autocompletion (e.g. Monaco `addExtraLib`) and in-app help.
 */
export const SCRIPT_API_DTS = `
/** Forge Engine scripting API. Call defineScript({...}) once per file. */
declare function defineScript(def: ScriptDefinition): ScriptDefinition;

type Entity = number;
type FieldType = 'number' | 'integer' | 'string' | 'boolean' | 'vec2' | 'vec3' | 'quat' | 'color' | 'rect' | 'enum' | 'asset' | 'entity' | 'json';

interface ScriptPropDef {
  type: FieldType; default: unknown; label?: string; description?: string;
  min?: number; max?: number; step?: number; options?: readonly string[]; assetKind?: string;
}

interface InputSnapshot {
  tick: number; held: string[]; pressed: string[]; released: string[];
  axes: Record<string, number>; pointer?: { x: number; y: number; buttons: number };
}

interface CollisionEvent { a: Entity; b: Entity; normal: Vec2; point: Vec2; penetration: number; impulse: number }

interface ScriptDefinition {
  name: string; description?: string; props?: Record<string, ScriptPropDef>;
  onStart?(ctx: ScriptContext): void;
  onUpdate?(ctx: ScriptContext, dt: number): void;
  onFixedUpdate?(ctx: ScriptContext, dt: number): void;
  onLateUpdate?(ctx: ScriptContext, dt: number): void;
  onDestroy?(ctx: ScriptContext): void;
  onReload?(ctx: ScriptContext): void;
  onCollisionEnter?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;
  onCollisionExit?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;
  onTriggerEnter?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;
  onTriggerExit?(ctx: ScriptContext, other: Entity, info: CollisionEvent): void;
  onNetSpawn?(ctx: ScriptContext, ownerId: string): void;
  /** Host migration: \`isHost\` is true on the peer that took over and should start serving. */
  onHostChanged?(ctx: ScriptContext, isHost: boolean, info: { hostId: string; previous: string }): void;
  /** Input of whoever controls this entity (works for local and remote players). */
  onOwnerInput?(ctx: ScriptContext, snapshot: InputSnapshot, dt: number): void;
  onMessage?(ctx: ScriptContext, name: string, data: unknown): void;
  onRpc?(ctx: ScriptContext, name: string, args: unknown[], from: string): void;
}

interface Vec2 { x: number; y: number; set(x: number, y: number): this; add(v: {x:number;y:number}): this; sub(v: {x:number;y:number}): this; scale(s: number): this; length(): number; normalize(): this; clone(): Vec2; lerp(v: {x:number;y:number}, t: number): this; angle(): number }
interface Vec3 { x: number; y: number; z: number; set(x: number, y: number, z: number): this; add(v: {x:number;y:number;z:number}): this; scale(s: number): this; length(): number; normalize(): this; clone(): Vec3 }
interface Quat { x: number; y: number; z: number; w: number; setEuler(x: number, y: number, z: number): this; angle2D(): number }
interface Color { r: number; g: number; b: number; a: number; set(r: number, g: number, b: number, a?: number): this; setHex(hex: string): this; lerp(c: Color, t: number): this }

interface Transform {
  position: Vec3; rotation: Quat; scale: Vec3; parent: Entity;
  x: number; y: number; z: number;
  /** Rotation about Z in radians (2D). */
  angle: number; angleDeg: number;
  setPosition(x: number, y: number, z?: number): this; setScale(x: number, y?: number, z?: number): this;
  translate(dx: number, dy: number, dz?: number): this; rotate2D(rad: number): this;
  setEuler(x: number, y: number, z: number): this; lookAt(target: Vec3): this;
  getWorldPosition(out?: Vec3): Vec3; getWorldAngle(): number; forward(out?: Vec3): Vec3; right(out?: Vec3): Vec3; up(out?: Vec3): Vec3;
}

interface RigidBody2D {
  bodyType: 'dynamic' | 'kinematic' | 'static'; mass: number; restitution: number; friction: number; gravityScale: number;
  velocity: Vec2; angularVelocity: number; fixedRotation: boolean; layer: number; collisionMask: number;
  readonly grounded: boolean;
  applyForce(fx: number, fy: number): void; applyImpulse(ix: number, iy: number): void; setVelocity(x: number, y: number): void;
}
interface CharacterController2D { moveSpeed: number; jumpSpeed: number; grounded: boolean; facing: number; move(x: number): void; jump(): void; jumpReleased(): void }
interface Sprite { texture: string; frame: string; flipX: boolean; flipY: boolean; tint: Color; alpha: number; layer: number; order: number; visible: boolean; width: number; height: number }
interface AnimatedSprite { animation: string; fps: number; loop: boolean; playing: boolean; finished: boolean; play(name: string, restart?: boolean): void }
interface Text { text: string; size: number; color: Color; visible: boolean }
interface Shape { kind: 'rect' | 'circle' | 'polygon' | 'line' | 'ellipse'; width: number; height: number; radius: number; fill: Color; stroke: Color; strokeWidth: number; visible: boolean }
interface ParticleEmitter { emitting: boolean; rate: number; burst(count: number): void; clear(): void }
interface Camera2D { zoom: number; follow: Entity; followSmoothing: number; shake: number; backgroundColor: Color }
interface MeshRenderer { mesh: string; color: Color; emissive: Color; metallic: number; roughness: number; wireframe: boolean; visible: boolean }
interface PlayerInput { owner: string; snapshot: InputSnapshot; held(a: string): boolean; pressed(a: string): boolean; released(a: string): boolean; axis(n: string): number }
interface AudioSource { clip: string; volume: number; pitch: number; loop: boolean; play(): void; stop(fade?: number): void; readonly playing: boolean }

interface ComponentMap {
  Transform: Transform; RigidBody2D: RigidBody2D; CharacterController2D: CharacterController2D; Sprite: Sprite; AnimatedSprite: AnimatedSprite;
  Text: Text; Shape: Shape; ParticleEmitter: ParticleEmitter; Camera2D: Camera2D; MeshRenderer: MeshRenderer; PlayerInput: PlayerInput; AudioSource: AudioSource;
  Name: { name: string }; Tag: { tags: string[]; has(t: string): boolean; add(t: string): void };
  BoxCollider2D: { width: number; height: number; isTrigger: boolean }; CircleCollider2D: { radius: number; isTrigger: boolean };
  Light2D: { color: Color; intensity: number; radius: number; enabled: boolean }; Camera3D: { fov: number; lookAt: Entity };
  Light: { kind: 'directional' | 'point' | 'ambient'; color: Color; intensity: number; range: number };
  RigidBody3D: { velocity: Vec3; grounded: boolean; bodyType: 'dynamic' | 'kinematic' | 'static' };
  CharacterController3D: { move(x: number, z: number): void; jump(): void; grounded: boolean };
  NetworkIdentity: { netId: number; ownerId: string; authority: 'host' | 'owner' };
  Script: { script: string; props: Record<string, unknown>; enabled: boolean };
}

interface Input {
  held(action: string): boolean; pressed(action: string): boolean; released(action: string): boolean; axis(name: string): number;
  bind(action: string, bindings: string | string[]): Input; bindAxis(name: string, axis: { positive?: string[]; negative?: string[]; gamepadAxis?: number; touchJoystick?: 'x' | 'y' }): Input;
  mouse: { position: Vec2; worldPosition: Vec2; buttons: number; wheel: number; held(b: number): boolean; pressed(b: number): boolean };
  keyboard: { held(code: string): boolean; pressed(code: string): boolean; released(code: string): boolean };
  touch: { joystick: Vec2; touches: { id: number; position: Vec2 }[] };
}

interface RaycastHit2D { entity: Entity; point: Vec2; normal: Vec2; distance: number }
interface Physics2D {
  gravity: Vec2;
  raycast(origin: {x:number;y:number}, direction: {x:number;y:number}, maxDistance?: number, mask?: number, ignore?: Entity): RaycastHit2D | null;
  overlapCircle(center: {x:number;y:number}, radius: number, mask?: number): Entity[];
  overlapBox(center: {x:number;y:number}, width: number, height: number, mask?: number): Entity[];
  queryPoint(point: {x:number;y:number}, mask?: number): Entity[];
}

interface TimerHandle { cancel(): void; readonly active: boolean }
interface SoundHandle { stop(fade?: number): void; setVolume(v: number): void; setPitch(p: number): void; playing: boolean }

interface ScriptContext {
  readonly entity: Entity;
  readonly transform: Transform;
  readonly props: Record<string, any>;
  readonly state: Record<string, any>;
  readonly input: Input;
  readonly playerInput: PlayerInput | undefined;
  readonly audio: { play(clip: string, opts?: { volume?: number; pitch?: number; pitchVariation?: number; loop?: boolean }): SoundHandle | null; music(clip: string, opts?: { fade?: number; volume?: number }): SoundHandle | null; stopMusic(fade?: number): void };
  readonly math: { clamp(v: number, a: number, b: number): number; lerp(a: number, b: number, t: number): number; Vec2: new (x?: number, y?: number) => Vec2; Vec3: new (x?: number, y?: number, z?: number) => Vec3; Color: new (r?: number, g?: number, b?: number, a?: number) => Color; [k: string]: any };
  readonly random: { next(): number; range(min: number, max: number): number; int(min: number, max: number): number; chance(p?: number): boolean; pick<T>(arr: readonly T[]): T | undefined };
  readonly net: { readonly localId: string; readonly isHost: boolean; readonly online: boolean; owner(): string; isOwner(): boolean; rpc(name: string, args?: unknown[], target?: string): void; spawn(prefab: string, opts?: { ownerId?: string; position?: { x: number; y: number; z?: number } }): Entity };
  readonly physics: Physics2D;
  readonly debug: { enabled: boolean; line(a: {x:number;y:number}, b: {x:number;y:number}, color?: Color): void; circle(cx: number, cy: number, r: number, color?: Color): void; rect(cx: number, cy: number, w: number, h: number, color?: Color): void; text(x: number, y: number, text: string): void };
  readonly time: { readonly delta: number; readonly fixedDelta: number; readonly elapsed: number; readonly tick: number; readonly frame: number };
  log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void;
  get<K extends keyof ComponentMap>(type: K): ComponentMap[K] | undefined;
  get(type: string): any;
  getOn<K extends keyof ComponentMap>(entity: Entity, type: K): ComponentMap[K] | undefined;
  getOn(entity: Entity, type: string): any;
  has(type: string): boolean;
  add<K extends keyof ComponentMap>(type: K, init?: Partial<ComponentMap[K]> | Record<string, unknown>): ComponentMap[K];
  add(type: string, init?: Record<string, unknown>): any;
  remove(type: string): boolean;
  spawn(prefab: string, opts?: { position?: { x: number; y: number; z?: number }; name?: string; parent?: Entity }): Entity;
  destroy(entity?: Entity): void;
  find(name: string): Entity | undefined;
  findAll(tag: string): Entity[];
  nameOf(entity: Entity): string;
  timer(seconds: number, fn: () => void, repeat?: boolean): TimerHandle;
  send(name: string, data?: unknown): void;
  sendTo(entity: Entity, name: string, data?: unknown): void;
}
`;
