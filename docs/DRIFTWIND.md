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
| `WorldStreamer` | Owns the `WorldGenerator`, streams chunks around the player (`ChunkTracker`), spawns islands with manual hi/LOD swap, decorations (instanced shared meshes, `lods` hide small props far away), motes, flocks, wind streaks, lantern trails at the gates, the sea with its fake island reflections (`sea-shade` discs), long waterfall ribbons down to splash discs, and animates bobbing lanterns, spinning turbine blades, drifting clouds. Sets `renderer.wind` from the first current. Frees the previous seed's meshes (`procgen.unregisterPrefix`) a second after a seed change. |
| `Glider` | Flight model (in `onOwnerInput`, so only the simulating peer integrates): bank-to-turn, pitch authority, stall, gravity along the path, cruise settling, boost, brake, wind drift, sink, soft ceiling and an updraft floor just above the sea, soft collision, gate detection, motes and discovery, HUD, ghost recording, wingtip contrails (a pool of unlit puffs, one instanced draw). Uses `engine.procgen.flight` helpers. |
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
4. The scene's `SkySettings` (procedural sky, `timeOfDay` 17.65 drifting so the
   sun sinks and the first stars fade in, cool zenith, layered cloud band, sun
   pillar and corona, height fog), `PostProcessSettings` (ACES, bloom, vignette,
   FXAA, MSAA 4) and the shadow-casting sun (`shadowDistance` 110) do the
   lighting. The sea is a 7000-unit `WaterMaterial` plane at
   `W.bounds.seaLevel` (130 units below the lowest island underside, ~200 below
   the flight band) that follows the player: deep saturated blue-teal, per-pixel
   analytic wave normals, a long sun-glint band, noise-gated crest foam and
   drifting foam specks, and `fogStrength` 0.55 / a cool `fogTint` so the warm
   haze never washes it out. Under every island a dark `sea-shade` disc fakes a
   reflection; larger islands drop a translucent waterfall ribbon into a splash
   disc.

### World layout

`WorldGenerator` lays 40 islands along a spiral (spacing 74, islands 22–28 units
off the path so you fly past them at wing distance). Every 13th island is a
**landmark**: a 40–50 unit giant whose rim the path grazes, with a summit stone
ring, columns, stone lanterns, two waterfalls, a guaranteed flock and a 3.2×
arch on the rim aligned with the path so you can fly straight through it. A
small **crown** island floats ~50 units above each landmark, offset toward the
path, so you can thread between the two. Gates carry an 8-lantern approach
trail; clouds come in three tiers (a thick layer between islands and sea, a
flight-level tier 60–125 units beside the path, a thin one above).

All mesh names are prefixed with the world seed (`amber-lagoon-42:island-3`,
`amber-lagoon-42:tree-meadow-pine-0/base`, `amber-lagoon-42:glider-2/hull`) so a
seed change never collides with cached registrations.

## Tuning knobs

| Where | Knob | Effect |
| --- | --- | --- |
| `WorldStreamer` props | `streamRadius` (520), `lodDistance` (260), `islands` (40), `detail` | streaming distance, hi/LOD swap, world size, decorations on/off |
| `WorldGenerator` options | `spacing` (74), `chunkSize` (160), `gates` (12), `clouds` (120), `landmarkEvery` (13), `seaDepth` (130) | island density, chunk granularity, course length, cloud count, landmark cadence, sea height |
| Sea `WaterMaterial` (in `WorldStreamer.spawnSea`) | `deepColor`, `shallowColor`, `crestFoam` (0.84), `fresnel` (0.55), `specular` (1.35), `fogStrength` (0.55), `fogTint` | the colour and mood of the ocean |
| `Glider` props | `cruise`, `stall`, `maxSpeed`, `turnRate`, `maxBank`, `pitchRate`, `boostAccel`, `sink` | the whole feel of flight |
| `ChaseCamera` props | `distance`, `height`, `lookAhead`, `smoothing`, `fov`, `fovPerSpeed` | framing and speed sensation |
| `Sky` props / `SkySettings` | `hour` (17.65), `driftHours` (0.5), `driftPeriod` (540 s); `fogDensity`, `fogHeight`, `fogSunBlend`, `clouds`, `turbidity`, `sunGlow` | time of day drift, atmosphere |
| `PostProcessSettings` | `bloomIntensity` (0.45), `bloomThreshold` (0.95), `vignette` (0.32), `saturation` (1.15), `exposure` (0.98) | the filmic look |
| `Sun` `Light` | `shadowDistance` (110), `shadowSoftness`, `shadowBias` | shadow reach vs. sharpness |
| Project `settings.render` | `autoQuality: true`, `shadows`, `shadowMapSize` | the renderer's default quality ladder (render scale, shadow map size, MSAA, bloom, FXAA) |
| `palettes.ts` | biome colours, `LIVERIES` | the entire colour story |

## Performance

Default world in view: ~250–270 draw calls, ~1400 instances, ~110k triangles
approaching a landmark (~200 draws / 80k triangles elsewhere, ~90 shadow
draws, 10 post-process passes; measured with `renderer.stats` in the Playwright
run). The sea plane, its discs, the waterfall ribbons, the lantern trails and
the contrail puffs each add a single instanced draw. Decorations share meshes and identical materials so they
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
`PostProcessSettings`, `WaterMaterial` with `fogStrength`/`fogTint`,
`renderer.wind`, `setCameraShake`, `lods`, `autoQuality`,
`renderer.removeMesh`). The issues an earlier version worked around are fixed
in the engine: the composite binds a black texture to its bloom sampler when
bloom is off (no black frame when the quality ladder disables bloom), the
shadow map is recreated rather than resized in place (no warning when the
ladder changes its size), meshes can be unregistered (`procgen.unregister` /
`unregisterPrefix`, used after a seed change) and a non-recursive
`Transform.updateWorldMatrix()` no longer stops `world.updateTransforms()`
from reaching the entity's children, so scripts read a moving parent's world
matrix mid-frame with a plain `updateWorldMatrix()`.

## Screenshots and video

`hero.png` next to the demo source (`demos/src/driftwind/hero.png`) is a
1600×900 capture of the running game (start screen and HUD hidden); the demo
build copies it to `public/demos/driftwind/hero.png` and lists it as
`heroImage` in `index.json`, which the launcher's hero banner prefers over the
SVG thumbnail (cards keep the SVG). The Playwright harnesses that produced the
report screenshots step the engine manually (`engine.stop()` then
`engine.step(1/60)` with `renderer.autoTime = false`) so SwiftShader frames are
deterministic; the flight video is a 30 fps screenshot sequence assembled with
ffmpeg.
