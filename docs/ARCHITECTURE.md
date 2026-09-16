# Architecture

## Module map

```
                 ┌──────────────────────────────────────────────┐
                 │                    Engine                     │
                 │  clock · world · renderer · input · audio     │
                 │  assets · physics · scripting · net · hud     │
                 └──────────────┬───────────────────────────────┘
                                │ owns / drives
   ┌──────────┐   ┌─────────────▼─────────────┐   ┌──────────────┐
   │  input   │──▶│           World           │◀──│   scripting  │
   │ devices, │   │  entities · components    │   │ ScriptRuntime│
   │ actions, │   │  queries · systems        │   │ ScriptContext│
   │ snapshot │   └────┬──────────┬───────────┘   └──────┬───────┘
   └──────────┘        │          │                      │
              ┌────────▼──┐  ┌────▼────────┐   ┌─────────▼────────┐
              │  physics  │  │   render    │   │      net (hub)   │
              │ 2D + 3D   │  │ Canvas2D /  │   │ Transport/NetSync│
              │ worlds    │  │ WebGL       │   │ interfaces       │
              └───────────┘  └─────────────┘   └──────────────────┘
                     assets ─▶ (images, atlases, audio, gltf)   audio
```

Each module under `src/` has an `index.ts` and is re-exported by
`src/index.ts` (`import { ... } from 'forge-engine'`).

| Module | Responsibility |
| --- | --- |
| `core/math` | Value types (`Vec2`, `Vec3`, `Quat`, `Mat4`, `Color`, `Rect`), scalar helpers, seedable `Random`. |
| `core/ecs` | `World`, `Component`, `Registry`, `Query`, `System`, `Transform`, `Name`/`Tag`, scene/prefab serialization. |
| `core/Clock` | Fixed-step accumulator and frame timing. |
| `core/Engine` | Composition root and frame loop. |
| `render` | `Renderer` interface, render components, `Canvas2DRenderer`, `WebGLRenderer`, 2D systems (camera follow, animation, particles). |
| `physics` | `Physics2DWorld` + system, `Physics3DWorld` + system, controllers. |
| `input` | Devices, `Input` action mapping, `InputSnapshot`, `PlayerInput`. |
| `audio` | `AudioEngine`, components, `AudioSystem`. |
| `assets` | `AssetManager`, loaders, manifest types. |
| `scripting` | `ScriptRuntime`, `Script` component, `ScriptContext`, API typings. |
| `project` | `Project` schema, `ProjectStore`, `ProjectLoader`, `runProject`. |
| `net` | Interfaces/stubs and components for the networking worker. |
| `ui` | `Overlay` DOM HUD. |

## Frame loop and data flow

`Engine.start()` schedules `requestAnimationFrame`. Each frame:

1. `Clock.advance(ts)` computes the frame delta (capped, time-scaled) and how
   many fixed steps (`fixedDelta = 1/60` by default) are due.
2. Phase `input`: `InputSystem` polls devices, resolves actions/axes, builds
   the `InputSnapshot`, converts the mouse position to world space through the
   renderer and copies the snapshot into every `PlayerInput` owned by the
   local peer.
3. For each due fixed step: `NetSync.fixedUpdate` (if any), phase
   `fixedUpdate` → `ScriptFixedSystem` (`onOwnerInput`, `onFixedUpdate`), then
   `Physics2DSystem`/`Physics3DSystem` (character controllers, then the
   world step, which writes `Transform.position`/`angle`). `Clock.tick`
   increments once per step.
4. Phase `update`: `ScriptUpdateSystem` (`onStart` for new instances,
   `onUpdate`, timers), `AnimatedSpriteSystem`, `ParticleSystem`.
5. Phase `lateUpdate`: `Camera2DSystem` (follow/bounds/shake),
   `ScriptLateSystem`, `AudioSystem`.
6. `World.updateTransforms()` recomputes world matrices root-first.
7. Phase `render`: `RenderSystem` calls `renderer.render(world, alpha)`.
8. `Input.endFrame()` clears per-frame edges.

When paused, phases 3–5 are skipped but input and rendering keep running so
menus work. `Engine.step(dt)` runs the same pipeline synchronously for tests
and servers; `Engine.fixedSteps(n)` runs only fixed steps (lockstep servers).

Deferred entity destruction (`world.destroyEntityDeferred`, `ctx.destroy`)
is flushed after every phase so systems never iterate freed entities.

## ECS

- **Entities** are integers: 20 bits of slot index + 12 bits of generation, so
  stale ids fail `world.isAlive`. `NULL_ENTITY = 0`.
- **Components** are classes extending `Component` with a unique static
  `type`. Storage is dense per type (`ComponentStore`), giving cache-friendly
  iteration via `world.componentsOfType(Cls)` or `world.each(A, B, fn)`.
- **Queries** (`world.query([A, B], [Excluded])`) are cached by signature and
  updated incrementally on add/remove; `query.entities` is a plain array safe
  to iterate in hot loops.
- **Systems** are objects `{ name, phase, priority, update(world, dt) }`.
  Lower priority runs first. Core systems use: Input −1000; scripts 0;
  physics 100; camera −100 (lateUpdate); animation 100 / particles 200
  (update); audio 500 (lateUpdate).
- **Hierarchy** lives on `Transform` (`parent`, `children`). Reparent with
  `world.setParent(child, parent, keepWorld?)`. World matrices are
  recomputed lazily via dirty flags; mutate `position` in place then call
  `markDirty()` (or use setters like `t.x = …`, `setPosition`).

## Registry, serialization and inspectors

`Registry.register(Cls, meta)` records the class, JSON defaults (from a fresh
instance) and per-field metadata. Field types are inferred from the default
instance (`number`, `string`, `boolean`, `vec2`, `vec3`, `quat`, `color`,
`rect`, plain objects/arrays → `json`) and can be overridden/annotated in
`meta.fields` (`enum` with `options`, `asset` with `assetKind`, `entity` refs,
`min`/`max`/`step`, `hidden`, `readonly`, `transient`). Fields prefixed with
`_` and unknown object types are transient automatically.

`saveScene(world)` walks roots depth-first, renumbers entities to compact
document ids, serializes every registered component through the Registry and
remaps `entity` fields. `loadScene(world, data)` creates all entities first
(so references can be remapped), then applies components, then hierarchy.
`SceneData.version` is checked by `migrateScene`. Prefabs use the same
`EntityData[]` format with the root first.

An editor renders an inspector by iterating `registry.fields(type)` and
editing the plain record from `registry.serialize(component)`, then writing
back with `registry.applyProps(component, changes)`.

## Scripting

User source is wrapped in `new Function('defineScript', 'console', 'math',
...shadowed, source)`; browser globals such as `window`, `document`, `fetch`
and `localStorage` are passed as `undefined` parameters so scripts cannot
reach them by name (this is a guard rail for authored content, not a security
boundary against hostile code). The injected `defineScript` captures the
definition. One `ScriptRuntime` instance per engine listens to World events
to create/destroy instances for `Script` components, merges `props` with
definition defaults, and calls hooks in the corresponding systems. Errors in
hooks are caught, reported through `engine.diagnostics`, and an instance that
fails `maxErrors` times consecutively is disabled. `reload(source, name)`
swaps definitions in place while keeping `ctx.state` and `props`.

## Multiplayer integration points

- `Input` produces an `InputSnapshot` per frame; `encodeSnapshot` packs it for
  the wire using the shared, sorted action/axis name lists.
- `PlayerInput.owner` names the controlling peer; the engine only fills
  snapshots for the local owner. A `NetSync` implementation writes remote
  peers' snapshots into their `PlayerInput`s before `fixedUpdate`, optionally
  merging several peers with `mergeSnapshots` (shared control).
- `engine.net` (`NetHub`) exposes `transport`, `sync`, `localId`, `isHost`.
  `Engine.runFrame` calls `sync.fixedUpdate` and `sync.update` when present.
- `NetworkIdentity` / `NetTransform` components carry replication settings.
  See `src/net/README.md` for the full model.

## Extension points

- `engine.use(plugin)` – add systems, components, loaders.
- `registerComponent(Cls, meta)` – new component types (auto-serializable).
- `world.addSystem(system)` – behaviour in any phase.
- `assets.registerLoader(kind, loader)` – new asset kinds.
- `Renderer` interface – alternative renderers.
- `engine.net.setTransport / setSync` – networking implementations.
- `engine.scripting.register(def)` – built-in scripts written in TypeScript.
