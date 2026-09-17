# Forge Engine

A web-based game engine for 2D and 3D games that run from any static host
(including GitHub Pages), with an entity-component world, JavaScript scripting,
deterministic physics, audio, an in-browser editor shell and hooks for
multiplayer rooms where several people can control the same game.

- **Zero runtime dependencies.** TypeScript + Vite; the whole engine ships as
  ES modules.
- **One world, two renderers.** A Canvas 2D renderer (sprites, atlases,
  tilemaps, particles, lighting) and a WebGL2 renderer (instanced meshes,
  lit/unlit materials, GLTF, fog, sky gradient) share the same `Transform`,
  ECS and scene format.
- **Deterministic fixed step.** 60 Hz simulation with interpolation alpha for
  rendering; the 2D physics world produces identical results for identical
  inputs, which is what lockstep networking needs.
- **Scripting for authors.** Users write `defineScript({...})` in the editor;
  scripts run with a restricted API, hot reload, and report errors to
  `engine.diagnostics` instead of crashing the loop.
- **Built for multi-user control.** Input is captured as a serializable
  `InputSnapshot`; each `PlayerInput` component carries an `owner` peer id so
  the same script drives local and remote players.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (launcher)
npm test           # vitest unit tests
npm run typecheck  # tsc --noEmit
npm run build      # static site in dist/ (works under a sub-path)
```

Pages:

| Page | Purpose |
| --- | --- |
| `index.html` | Launcher: demo gallery from `public/demos/index.json` (Play, Play Multiplayer, Open in Editor) and local projects. |
| `editor.html` | Editor shell (`src/editor/`, filled by the editor worker). |
| `play.html` | Runtime player: `?project=<id|url>&room=<id>&scene=<name>&renderer=2d|3d`. Without `project` it shows a smoke scene (`?renderer=3d` for WebGL; `?room=` still joins a multiplayer room). |

### Playing multiplayer

Every demo is host-authoritative multiplayer out of the box. Open a room and
share the link; the first player in the room hosts, everyone else joins:

```
play.html?project=arena-blasters&room=ABC123            # WebRTC (PeerJS public signalling), no server
play.html?project=arena-blasters&room=ABC123&net=local  # two tabs in the same browser (BroadcastChannel)
play.html?project=arena-blasters&room=ABC123&net=ws&server=wss://your-host/ws   # self-hosted relay (server/)
```

`&name=Zoe` picks a display name. **Play Multiplayer** in the launcher creates
a fresh room code and the lobby's **Copy invite link** shares it. When the
host leaves, the remaining players elect a new host and the game continues.
Guide: [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md); demos: [`docs/DEMOS.md`](docs/DEMOS.md).

### Using the engine from code

```ts
import { Engine, Sprite, RigidBody2D, BoxCollider2D, Camera2D, Transform } from 'forge-engine';

const engine = Engine.create(canvas, { renderer: '2d', pixelsPerUnit: 32 });
const cam = engine.world.createEntity('Camera');
engine.world.addComponent(cam, Camera2D);

const hero = engine.world.createEntity('Hero');
engine.world.getComponent(hero, Transform)!.setPosition(0, 2);
engine.world.addComponent(hero, Sprite, { texture: 'hero' });
engine.world.addComponent(hero, RigidBody2D);
engine.world.addComponent(hero, BoxCollider2D, { width: 1, height: 1 });

await engine.assets.load('image', 'hero.png', 'hero');
engine.start();
```

### Writing a script (in the editor or `project.scripts`)

```js
defineScript({
  name: 'Runner',
  props: { speed: { type: 'number', default: 6 } },
  onOwnerInput(ctx, snap) {
    const cc = ctx.get('CharacterController2D');
    cc.move(snap.axes.moveX);
    if (snap.pressed.includes('jump')) cc.jump();
  },
  onCollisionEnter(ctx, other) {
    if (ctx.getOn(other, 'Tag')?.has('coin')) { ctx.destroy(other); ctx.send('score', 1); }
  },
});
```

## Features

**Core** – `Vec2`/`Vec3`/`Quat`/`Mat4`/`Color`/`Rect`, seedable PRNG, typed
`EventEmitter`, fixed-step `Clock`, `World` ECS (integer entities, typed
components, cached queries, systems in `input`/`fixedUpdate`/`update`/
`lateUpdate`/`render` phases), `Transform` hierarchy with local/world matrices
and 2D helpers, `Name`/`Tag`, prefabs, versioned `SceneData` JSON, and a
`Registry` of component types with inspector metadata.

**Rendering** – `Canvas2DRenderer`: camera zoom/rotation/follow/bounds/shake,
layers and order, sprites with atlases/flip/tint/blend, animated sprites,
shapes, text (world or screen space), tilemaps, pooled particles, multiply
light map with `Light2D`, debug draw, pixel-perfect and HiDPI.
`WebGLRenderer`: instanced meshes, lit (directional + up to 8 point lights,
roughness/metallic) and unlit shaders, cube/sphere/plane/cylinder/cone,
perspective and orthographic `Camera3D`, sky gradient, fog, wireframe, debug
lines, minimal GLTF/GLB loader, `OrbitController`.

**Physics** – `Physics2DWorld`: dynamic/kinematic/static bodies, box/circle/
convex polygon colliders (SAT), spatial hash broadphase, sequential impulses
with friction and restitution, positional correction, layers + collision
matrix, triggers, enter/stay/exit events, raycast/overlap queries, tilemap
collision, `CharacterController2D` (coyote time, jump buffer, variable jump).
`Physics3DWorld`: AABB/sphere bodies, gravity, events, raycast and
`CharacterController3D`.

**Input** – keyboard, mouse (canvas + world coords, wheel), multi-touch with a
virtual joystick/buttons overlay, gamepads (standard mapping, deadzone),
action and axis bindings, per-frame `InputSnapshot` with compact encoding and
shared-control merging, `PlayerInput` component.

**Audio** – WebAudio buses (master/sfx/music), pitch/volume variation, music
crossfade, 2D positional audio, gesture unlock, `AudioSource`/`AudioListener`.

**Assets** – `AssetManager` with image/atlas/audio/json/text/binary/gltf
loaders, progress events, caching, base URL and data URLs, project manifests.

**Scripting** – `ScriptRuntime` compiles user JavaScript with shadowed
globals, per-entity `ScriptContext`, hot reload preserving state, diagnostics,
timers, messages, prefab spawning, and a `.d.ts` string for editor autocomplete.

**Projects** – `Project` schema (scenes, scripts, prefabs, assets, settings
including renderer, physics, network mode and shared control), `ProjectStore`
(IndexedDB save/load/list/delete + JSON export/import), `ProjectLoader`
(URL, demo id or local id), `runProject(engine, project)`.

**Networking** – transports: WebRTC (`PeerTransport`, PeerJS signalling),
WebSocket relay (`WebSocketTransport` + `server/`), same-browser
`LocalTransport` (BroadcastChannel), in-process `MemoryNetwork` for tests and
bots, offline `NullTransport`. `HostAuthoritativeSync`: quantized delta
snapshots with interpolation/extrapolation, input relay with redundancy and
edge merging, spawn/despawn with initial `Script.props`, ownership transfer,
owner authority, shared control (`average` / `first-wins` / `additive`
merging), RPCs, late join and host migration. `LockstepSync` for
deterministic games. Lobby overlay with roster, RTT and invite link. Model
documented in [`src/net/README.md`](src/net/README.md).

**Demos** – seven generated projects in `public/demos/` (Arena Blasters, Sky
Hoppers, Paddle Rush, Cube Racers, Tower Together, Starter 2D/3D) built from
`demos/src/` with `npm run build:demos`; see [`docs/DEMOS.md`](docs/DEMOS.md).

## Repository structure

```
index.html / editor.html / play.html   multi-page entry points
src/core        math, Clock, EventEmitter, ECS, Engine
src/render      Renderer interface, components, Canvas2D + WebGL renderers
src/physics     2D + 3D physics, character controllers
src/input       devices, action mapping, InputSnapshot, PlayerInput
src/audio       AudioEngine, AudioSource/AudioListener, AudioSystem
src/assets      AssetManager and loaders
src/scripting   ScriptRuntime, Script component, ScriptContext, API .d.ts
src/project     Project schema, store, loader, runProject
src/net         transports (peer/ws/local/memory/null), HostAuthoritativeSync, LockstepSync, lobby UI
src/ui          DOM Overlay (HUD)
src/launcher    landing page          src/player  runtime player + smoke scenes
src/editor      editor shell (editor worker)
src/styles      shared CSS
public/demos    generated demo projects (sources in demos/src, generator in scripts/build-demos.ts)
server/         WebSocket relay server for `?net=ws`
docs/           ARCHITECTURE.md, API.md, RENDERING.md (renderer pipeline), PROCGEN.md (procedural art), DRIFTWIND.md (flagship demo), CONTRIBUTING-WORKERS.md
tests/          vitest unit tests
```

## Roadmap

- Editor: scene hierarchy, generic inspector driven by the `Registry`,
  script editor with hot reload, asset browser, play-in-editor.
- Networking follow-ups: client-side prediction for owner-authority
  entities, TURN configuration UI, spectators.
- Engine follow-ups: sprite batching for WebGL 2D, shadow maps, audio
  effects buses, tilemap auto-tiling, joint constraints.

## License

MIT
