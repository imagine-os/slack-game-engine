# Working on Forge Engine in parallel

Several workers build on the core at the same time. To avoid conflicts each
worker owns a set of paths and **adds** to the core rather than rewriting it.

## Ownership

| Worker | Owns (create/modify freely) | Touches core only to |
| --- | --- | --- |
| **Core** (this repo's initial author) | `src/core/**`, `src/render/**`, `src/physics/**`, `src/input/**`, `src/audio/**`, `src/assets/**`, `src/scripting/**`, `src/project/**`, `src/ui/**`, `src/launcher/**`, `src/player/**`, `src/styles/**`, `tests/**`, `docs/**`, root config | — |
| **Networking** | `src/net/**`, `server/**` | implement the interfaces in `src/net/`; may add exports to `src/net/index.ts`; may add a `NetSyncSystem` via `engine.world.addSystem` at runtime |
| **Editor** | `src/editor/**`, `editor.html` | consume `Registry`, `ScriptRuntime`, `ProjectStore`, `SCRIPT_API_DTS`; may add CSS files under `src/editor/` |
| **Demos** | `demos/**`, `public/demos/**` | author `project.json` files and `public/demos/index.json`; scripts use only the documented `ScriptContext` API |

If you need a change in someone else's area (a missing hook, a new field),
add it in the smallest backward-compatible way and mention it in your commit
message, or ask the coordinator. Never rename or remove an exported symbol.

## Stable contracts

- **Public API**: everything exported from `src/index.ts` and documented in
  `docs/API.md`. Add, don't break.
- **Scene / project JSON**: `SceneData` v1, `Project` v1. Add optional fields
  only; bump the version and add a migration in `migrateScene` /
  `normalizeProject` for anything else.
- **Component registration**: `registerComponent(Cls, meta)` with a unique
  static `type`. New components serialize automatically; mark runtime-only
  fields `transient` (or prefix with `_`).
- **Phases and priorities**: Input −1000 (`input`); scripts 0, physics 100
  (`fixedUpdate`); scripts 0, animation 100, particles 200 (`update`);
  camera −100, scripts 0, audio 500 (`lateUpdate`); render 0 (`render`).
  A `NetSyncSystem` should apply remote inputs in `fixedUpdate` at priority
  −10 (before scripts) and send snapshots in `lateUpdate` at priority 900,
  or use the `NetSync.fixedUpdate` / `NetSync.update` calls the Engine makes.
- **Diagnostics**: report problems through `engine.diagnostics` (`error`,
  `warn`, `log` with a `Diagnostic` payload) rather than throwing in systems.

## Networking worker notes

- Install via `engine.net.setTransport(transport)` and
  `engine.net.setSync(sync)`. `play.html` reads `?room=<id>` and, when the
  project's `settings.network.mode !== 'none'`, expects you to connect there
  (see the marked block in `src/player/main.ts`).
- Remote input: write snapshots into `PlayerInput.apply(snapshot)` for
  entities whose `owner`/`coOwners` include the remote peer, before
  `fixedUpdate` runs scripts. Use `mergeSnapshots` for shared control.
- Determinism for lockstep: use `engine.random` (seeded via scene
  `settings.seed` or `Random.seed`), `Engine.fixedSteps(n)`, and never read
  wall-clock time inside `fixedUpdate`.
- `server/index.js` is the `npm run serve` entry point; keep it dependency
  free if possible (Node's `ws`-less WebSocket via `http` upgrade, or add
  the dependency in `package.json` under `dependencies` with a note).
- Full model: `src/net/README.md`.

## Editor worker notes

- Generic inspector: `engine.registry.byCategory()` for the "Add Component"
  menu, `registry.fields(type)` for field metadata, `registry.serialize(c)`
  for values and `registry.applyProps(c, patch)` to write back (entity refs
  and math types are handled).
- Script props: `engine.scripting.definitions.get(name)?.props` and
  `defaultProps(name)`; edit `Script.props`. Hot reload with
  `engine.scripting.reload(source, name, rerunStart)`; compile errors are
  `ScriptCompileError`, runtime errors arrive on `engine.diagnostics`.
- Autocompletion: `SCRIPT_API_DTS` (Monaco `addExtraLib`).
- Play-in-editor: create a second `Engine` on a preview canvas and
  `runProject(engine, project)`; `engine.saveScene()` serializes the live
  world. `ProjectStore` handles persistence, `ProjectLoader.resolve(ref)`
  resolves `?project=` the same way the player does. `?new=1` should create
  a project with `createProject()`.
- The launcher links to `editor.html?project=<id>`.

## Demos worker notes

- Put each demo in `public/demos/<id>/project.json` with assets beside it and
  list it in `public/demos/index.json` (schema in `public/demos/README.md`).
- Scripts run through `ScriptRuntime`; only the `ScriptContext` API is
  available (no `window`/`document`). Use `onOwnerInput` for player control so
  demos work in multiplayer.
- Test locally with `npm run dev` then `play.html?project=<id>`.

## Conventions

- TypeScript strict, no `any` in public signatures, JSDoc on exported
  symbols, small focused files, no framework.
- `npm run typecheck && npm test && npm run build` must stay green.
- Commit in logical chunks with clear messages.
