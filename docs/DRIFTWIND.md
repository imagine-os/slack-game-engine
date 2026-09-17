# Driftwind

Driftwind is the flagship demo: a relaxing glide through a floating archipelago
at golden hour, with a 12-gate race, collectibles, island discovery, ghost
replays and drop-in multiplayer. Every mesh, sound and world layout is generated
in code from a shareable seed by the [procgen library](PROCGEN.md).

Play: `play.html?project=driftwind` (`?seed=amber-lagoon-42`, `?daily=1`,
`?time=17.6` pins the hour, `&room=XYZ` for multiplayer). Source:
`demos/src/driftwind/`, generated project in `public/demos/driftwind/`.

## Design

- **Fantasy**: you are a paper-light glider in a warm, endless evening. Speed
  comes from diving, wind currents and rings; there is no way to crash, only
  soft bounces.
- **Loop**: fly (free roam, discover all islands, collect motes), race (gates,
  best time per seed, ghost of your best run), share a seed or invite friends.
- **Seeds**: `adjective-noun-NN` words (`Amber Lagoon 42`), a daily seed, a
  random seed; the world, decorations, winds, course and livery pool all derive
  from it, so two players with the same seed fly the same world.

### Controls

| Input | Action |
| --- | --- |
| A / D, left stick | bank (banking turns the glider; tighter when slow) |
| W / S | pitch (dive to gain speed, climb to trade it) |
| Space / Shift | boost (meter refills slowly, faster inside wind and through rings) |
| X / Ctrl | brake |
| P | photo mode (HUD hidden, slow orbit) |
| R | start / restart a race |
| Enter / Esc | fly / back to the start screen |
| Touch | joystick + Boost / Brake buttons |

### Scripts (`demos/src/driftwind/scripts`)

| Script | Role |
| --- | --- |
| `WorldStreamer` | Owns the `WorldGenerator`, streams chunks around the player (`ChunkTracker`), spawns islands with manual hi/LOD swap, decorations (instanced shared meshes, `lods` hide small props far away), motes, flocks, wind streaks, the sea, and animates bobbing lanterns, spinning turbine blades, drifting clouds. Sets `renderer.wind` from the first current. |
| `Glider` | Flight model (in `onOwnerInput`, so only the simulating peer integrates): bank-to-turn, pitch authority, stall, gravity along the path, cruise settling, boost, brake, wind drift, sink, soft ceiling/floor, soft collision, gate detection, motes and discovery, HUD, ghost recording. Uses `engine.procgen.flight` helpers. |
| `ChaseCamera` | Chase camera with speed FOV, look-ahead, `renderer.setCameraShake` on collisions, speed streaks in wind, photo mode orbit, cinematic drift before take-off. |
| `Sky` | Keeps `SkySettings.timeOfDay` drifting slowly around 17.5 (golden hour forever), pins a bloom-on quality ladder, positions the height fog above the sea; legacy path drives gradient sky/fog/lights when `SkySettings` is absent. |
| `GameManager` | Host-authoritative spawner (one `Glider` per peer at `W.spawn(i)`), start-screen messages (`shell:fly`, `shell:race`, `shell:seed`), race state machine (countdown → running → finished), standings, best time + ghost in `localStorage`, `hud` RPC to guests, `fly`/`requestRace` RPCs from guests, host migration via `onHostChanged`. |
| `Shell` | Start panel (seed field, Fly, Race, Play with friends, Daily/Random seed), toasts (island discovered, host changed seed), collision flash, photo-mode HUD hiding. |
| `Ring`, `Island`, `Flock`, `Ghost` | Gate glow/pulse and pass flash, island markers, boid flocks that scatter from the glider, ghost replay of the best run. |

Messages between scripts are plain `ctx.send` events (`worldSeed`, `takeControl`,
`resetTo`, `raceState`, `gatePassed`, `raceFinished`, `raceResult`, `ringPassed`,
`moteCollected`, `discover`, `collision`, `photoMode`).

## Art pipeline

1. `WorldGenerator(seed)` lays out islands, biomes, path, gates, winds, clouds.
2. Per island, `islandDetail(id)` builds the hi and LOD island meshes and a
   decoration list whose `key`s point at shared library meshes
   (`tree-<biome>-<species>-<n>`, `rock-<biome>-<n>`, `crystal-…`, `arch`,
   `turbine`, `lantern-<biome>`, …). Shared keys mean one `renderer.addMesh` and
   one instanced batch per key.
3. `WorldStreamer.spawnObject` creates the entity: on the current renderer,
   one child with the merged **base** mesh (all plain lit groups, vertex
   colours, `flatShading`) plus one child per **special** group (emissive
   crystal glow and lanterns, translucent waterfalls and streaks, wind-swayed
   canopies with `windStrength`, island ponds with a `WaterMaterial`).
4. The scene's `SkySettings` (procedural sky, `timeOfDay` 17.5, height fog),
   `PostProcessSettings` (ACES, mild bloom, vignette, FXAA, MSAA 4) and the
   shadow-casting sun (`shadowDistance` 110) do the lighting; the sea is a
   7000-unit `WaterMaterial` plane 320 units below the lowest island that
   follows the player.

All mesh names are prefixed with the world seed (`amber-lagoon-42:island-3`,
`amber-lagoon-42:tree-meadow-pine-0/base`, `amber-lagoon-42:glider-2/hull`) so a
seed change never collides with cached registrations.

## Tuning knobs

| Where | Knob | Effect |
| --- | --- | --- |
| `WorldStreamer` props | `streamRadius` (520), `lodDistance` (260), `islands` (34), `detail` | streaming distance, hi/LOD swap, world size, decorations on/off |
| `WorldGenerator` options | `spacing` (92), `chunkSize` (160), `gates` (12), `clouds` (70) | island density, chunk granularity, course length, cloud count |
| `Glider` props | `cruise`, `stall`, `maxSpeed`, `turnRate`, `maxBank`, `pitchRate`, `boostAccel`, `sink` | the whole feel of flight |
| `ChaseCamera` props | `distance`, `height`, `lookAhead`, `smoothing`, `fov`, `fovPerSpeed` | framing and speed sensation |
| `Sky` props / `SkySettings` | `hour` (17.5), `driftHours` (0.55), `driftPeriod` (540 s); `fogDensity`, `fogHeight`, `fogSunBlend`, `clouds`, `turbidity` | time of day drift, atmosphere |
| `PostProcessSettings` | `bloomIntensity` (0.38), `vignette` (0.3), `saturation` (1.1), `exposure` | the filmic look |
| `Sun` `Light` | `shadowDistance` (110), `shadowSoftness`, `shadowBias` | shadow reach vs. sharpness |
| Project `settings.render` | `autoQuality: true`, `shadows`, `shadowMapSize` | the renderer quality ladder (`Sky` pins a bloom-on ladder) |
| `palettes.ts` | biome colours, `LIVERIES` | the entire colour story |

## Performance

Default world in view: ~200 draw calls, ~900 instances, ~50k triangles, ~85
shadow draws, 10 post-process passes (measured with `renderer.stats` in the
Playwright run). Decorations share meshes and identical materials so they
instance; small props hide beyond 320 units and trees beyond 460 via
`MeshRenderer.lods`; islands swap to a low-poly variant beyond `lodDistance`;
chunks unload beyond `streamRadius`. `autoQuality` steps render scale, MSAA and
FXAA down on slow GPUs.

## Multiplayer

Host-authoritative (`maxPlayers` 8). The host spawns a `Glider` per peer, each
peer simulates its own glider (`NetTransform` replicates position/rotation),
the host runs the race clock and pushes `hud` state to guests, guests ask the
host to `fly`/`requestRace`. The seed is shared through the URL and the
`worldSeed` message; a host change re-seats everyone via `onHostChanged`.
Verified with two tabs over `?net=local` (see `driftwind-mp-*.png` in the
worker report).

## Roadmap to a commercial release

1. **Content**: more biomes (frost, volcanic night), landmark islands
   (lighthouses, ruined cities), weather (rain curtains, aurora), a day-night
   option with lanterns lighting up.
2. **Progression**: per-seed medals, daily challenge leaderboard, unlockable
   liveries and trails, seed collections ("worlds I've flown").
3. **Modes**: time trial with ghosts of friends, tag/follow-the-leader, photo
   challenges with shareable postcards (photo mode already hides the HUD).
4. **Feel**: gamepad rumble, richer audio (layered wind, music that reacts to
   altitude), particle trails on wingtips, cloth flutter on windsocks.
5. **Platforms**: PWA install, mobile performance profile (render scale 0.75,
   shadows 1024), Steam/itch wrapper via Electron/Tauri.
6. **Ops**: telemetry for seed popularity and session length, crash-free rate,
   a seed of the week curated from the daily pool.

## Renderer notes

Driftwind uses every feature of the upgraded renderer (vertex colours,
`flatShading`, `windStrength`, `emissiveStrength`, shadows, `SkySettings`,
`PostProcessSettings`, `WaterMaterial`, `renderer.wind`, `setCameraShake`,
`lods`, `autoQuality`). Two renderer issues are worked around in `Sky.js`:
disabling bloom after it has run leaves the composite's bloom sampler on the
shadow-map texture unit (GL_INVALID_OPERATION, black frame), and a shadow-map
resize logs the same warning for one frame, so the quality ladder keeps bloom
on and the shadow map at 2048 at every level. Meshes registered with
`renderer.addMesh` cannot be removed, so a long session that cycles many seeds
keeps old registrations alive.

Engine footgun worth knowing: `Transform.updateWorldMatrix()` (non-recursive)
clears the dirty flag, so a later `world.updateTransforms()` skips that
entity's children and their meshes freeze in place. Scripts that read a moving
parent's world matrix mid-frame must call `updateWorldMatrix(true)`; the
Driftwind scripts do.
