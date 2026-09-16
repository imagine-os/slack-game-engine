# Demo projects

Seven projects ship with the engine under `public/demos/`. Each one is a
complete `Project` JSON document (scenes, scripts, prefabs, assets, settings)
that plays in `play.html?project=<id>`, opens in `editor.html?project=<id>`
and works as a template for your own game. All of them run offline with the
`NullTransport` and are written for host-authoritative multiplayer.

## Gallery

| Demo | Renderer | Players | What it shows | Controls |
| --- | --- | --- | --- | --- |
| [Arena Blasters](../public/demos/arena-blasters/README.md) `arena-blasters` | 2D | 1-8 | Top-down shooter: `RigidBody2D` ships, trigger bullets, splitting asteroids, respawns, `ctx.engine.hud` scoreboard, particles, screen shake, procedural WAV sound | A/D turn, W thrust, J/click fire |
| [Sky Hoppers](../public/demos/sky-hoppers/README.md) `sky-hoppers` | 2D | 1-4 | Co-op platformer: `Tilemap` + `TilemapCollider2D`, `CharacterController2D`, coins, spikes, moving platforms, shared checkpoints, goal flag, camera framing every player, parallax | A/D move, Space jump |
| [Paddle Rush](../public/demos/paddle-rush/README.md) `paddle-rush` | 2D | 1-8 | Air hockey with an AI opponent and **shared control**: `multiUser.sharedControl`, `PlayerInput.coOwners`, `mergeStrategy: "average"` team paddles | WASD/arrows |
| [Cube Racers](../public/demos/cube-racers/README.md) `cube-racers` | 3D | 1-6 | WebGL arcade racer: `RigidBody3D`/`BoxCollider3D` track, chase camera per player, checkpoints, lap timer, countdown | W/S throttle, A/D steer, E reset |
| [Tower Together](../public/demos/tower-together/README.md) `tower-together` | 2D | 1-4 | Co-op tower defence: pointer input from the snapshot, per-player build cursors, shared gold, `first-wins` merging, waves | Click / tap to build |
| [Starter 2D](../public/demos/starter-2d/README.md) `starter-2d` | 2D | 1 | Template: player + platforms + follow camera + one script | A/D, Space |
| [Starter 3D](../public/demos/starter-3d/README.md) `starter-3d` | 3D | 1 | Template: lit cube, plane, orbit camera + one script | Drag, wheel |

Every demo folder contains `project.json`, an `assets/` directory (hand-made
SVG sprites and tilesets, generated WAV effects), a `thumbnail.svg` and a
`README.md` describing the game, its controls, how it is built and five
ideas to extend it. `public/demos/index.json` lists them for the launcher.

## Playing

```bash
npm run dev
# then open
http://localhost:5173/play.html?project=arena-blasters
http://localhost:5173/play.html?project=arena-blasters&room=abc   # multiplayer room (needs the net layer)
http://localhost:5173/editor.html?project=sky-hoppers             # open as a template in the editor
```

On phones the 2D demos show the virtual joystick and the buttons listed in
`settings.touchButtons`; Tower Together uses taps directly.

## How the demos are built

The JSON is generated, not hand-written. Sources live in `demos/src/`:

```
demos/src/
  lib.ts                 SceneBuilder, prefab(), loadScripts(), makeProject(), colour/SVG helpers
  index.ts               registry of demos (order = launcher order)
  <id>/index.ts          builds the scene(s), prefabs, assets, README and index entry
  <id>/scripts/*.js      the project's scripts, one defineScript() per file (readable in the editor)
scripts/
  build-demos.ts         writes public/demos/** and index.json (`--check` fails when stale)
  lib/wav.ts             deterministic sound synthesizer for the .wav assets
  verify-demos.mjs       Playwright smoke test: plays each demo and screenshots it
```

```bash
npm run build:demos     # regenerate public/demos from demos/src
npm run check:demos     # CI-style staleness check (tests/demos.test.ts does the same)
npm run verify:demos    # needs `npm run dev` running and Playwright + Chromium
```

Scenes are authored against a live `World` and serialized with `saveScene`,
so the output is always valid for the current component registry; unknown
component fields fail the build. Timestamps are fixed so the JSON is
reproducible, and `tests/demos.test.ts` loads every demo headlessly, runs
300 fixed steps and asserts that no script reported an error, that key
entities exist, and that a fake two-peer `NetSync` produces per-player
entities.

## Multiplayer pattern used by every demo

All games follow the same host-authoritative recipe, which works unchanged
offline because the `NullTransport` makes the local peer the host of a room
of one:

1. A `GameManager` entity spawns one player prefab for the local peer in
   `onStart`, then one for every peer already in `ctx.net.hub.sync.players()`,
   and subscribes to `playerJoined` / `playerLeft` to spawn and despawn.
2. Player prefabs carry `PlayerInput` (owner = peer id), `NetworkIdentity`
   (`prefab` name so remote peers can instantiate it) and `NetTransform`.
3. Player scripts read input only in `onOwnerInput(ctx, snapshot)`; the same
   code drives local and remote players.
4. Game rules run where `ctx.net.isHost` is true; results travel as messages
   (`ctx.send` / `ctx.sendTo`). Data for a freshly spawned prefab is written
   into its `Script.props` before it starts.
5. Spawns go through `ctx.net.spawn(prefab, { ownerId, position })`, which uses
   the sync layer when online and `ctx.spawn` otherwise; despawns use
   `sync.despawn` when available.

Paddle Rush and Tower Together additionally enable
`settings.multiUser.sharedControl` and show the `average` and `first-wins`
merge strategies for several users steering one entity.

## Make your own game from a template

### In the editor

1. Open the launcher (`index.html`) and click **New project** (uses
   `starter-2d`; choose 3D for `starter-3d`), or open any demo with **Open in
   Editor** and save it under a new name.
2. Edit entities in the inspector, paint tiles, tweak script `props`.
3. Add a script: **Scripts → New**, paste

   ```js
   defineScript({
     name: 'Spinner',
     props: { speed: { type: 'number', default: 1 } },
     onUpdate(ctx, dt) { ctx.transform.rotate2D(dt * ctx.props.speed); },
   });
   ```

   and attach a `Script` component with `script: "Spinner"` to an entity.
4. Press **Play**. Projects are saved in the browser (`ProjectStore`) and can
   be exported as JSON from the launcher.

### From the command line (generator workflow)

1. Copy `demos/src/starter-2d` to `demos/src/my-game` and rename the id, name
   and description in `index.ts`; register it in `demos/src/index.ts`.
2. Build the scene with `SceneBuilder` (component names and fields are the
   same as in the JSON), put reusable things in `prefab()` calls and write
   scripts as `.js` files in `scripts/`.
3. `npm run build:demos` writes `public/demos/my-game/`; `npm run dev` and open
   `play.html?project=my-game`.
4. Add a `PLAYS` entry in `scripts/verify-demos.mjs` if you want the Playwright
   smoke test to drive it.

### Script API cheat sheet

| Need | Use |
| --- | --- |
| Player input (works online) | `onOwnerInput(ctx, snap)` → `snap.axes.moveX`, `snap.pressed.includes('jump')`, `snap.pointer` |
| Components | `ctx.get('RigidBody2D')`, `ctx.getOn(entity, 'Transform')`, `ctx.add`, `ctx.remove` |
| Spawning | `ctx.net.spawn('Prefab', { ownerId, position })`, `ctx.spawn`, `ctx.destroy(e)` |
| Finding things | `ctx.find('Name')`, `ctx.findAll('tag')`, `ctx.world.getChildren(e)` |
| Messaging | `ctx.send('name', data)` → `onMessage(ctx, name, data)`; `ctx.sendTo(entity, ...)` |
| Timers | `ctx.timer(seconds, fn, repeat)` |
| Audio | `ctx.audio.play('assetId', { volume, pitchVariation })` |
| HUD | `ctx.engine.hud.text(id, text, { anchor })`, `.panel(id, title, body)` (guard with `ctx.engine.canvas` for headless runs) |
| Physics queries | `ctx.physics.overlapCircle`, `ctx.physics.raycast`, `ctx.physics3d.raycast` |
| Randomness | `ctx.random.range(a, b)`, `new ctx.math.Random(seed)` for per-entity determinism |
| Network | `ctx.net.isHost`, `ctx.net.localId`, `ctx.net.hub.sync?.on('playerJoined', ...)`, `ctx.net.rpc` |
