# Procedural art library (`src/procgen`)

`src/procgen` generates stylised low-poly art in code: islands, trees, rocks,
crystals, clouds, ruins, gliders, birds, race rings and small props, plus a
`WorldGenerator` that lays a whole floating archipelago out from a seed. It is
what [Driftwind](DRIFTWIND.md) is built from, and it is engine-agnostic enough
to reuse in any 3D project: every generator returns plain `MeshData` that
`renderer.addMesh` accepts.

```ts
import { generateTree, PALETTES, WorldGenerator } from 'forge-engine';

const tree = generateTree(7, { species: 'pine', palette: PALETTES.meadow });
renderer.addMesh('pine-7', tree.mesh);                 // one mesh, vertex colours
for (const g of tree.groups) renderer.addMesh(`pine-7/${g.name}`, g.data); // or per colour group

const world = new WorldGenerator('amber-lagoon-42');   // 40 islands (+ landmark crowns), 12 gates, wind, clouds
```

## Output format

Every generator returns a `GeneratedMesh`:

```ts
interface GeneratedMesh {
  mesh: ProcMeshData;    // merged geometry with RGB per vertex (MeshData + colors, bounds, weights?)
  groups: MeshGroup[];   // the same geometry split by colour group, each with material hints
}
interface MeshGroup extends MaterialHint { name: string; color: RGB; data: ProcMeshData; triangles: number }
interface MaterialHint { emissive?, emissiveStrength?, opacity?, unlit?, wind?, water?, doubleSided?, roughness?, metallic? }
```

- Geometry is **unwelded flat-shaded triangles** (three unique vertices per
  face) with per-face normals, so facets read crisply with or without
  `MeshRenderer.flatShading`.
- `mesh.colors` carries the palette; `mesh.bounds` is in the renderer's
  `MeshBounds` layout (`{ min: [x,y,z], max: [x,y,z] }`) so frustum culling
  uses it directly.
- `groups` exist for two reasons: renderers without vertex colours can draw one
  `MeshRenderer` per group with `color = group.color`, and groups with material
  hints (emissive crystals, translucent water, wind-blown canopies, unlit
  streaks) need their own material even when vertex colours are available.
- Front faces are counter-clockwise; `validateMesh(data)` returns a list of
  problems (NaNs, bad indices, mismatched attribute lengths) and is used by the
  tests for every generator.

## Building blocks

| Module | What it gives you |
| --- | --- |
| `noise.ts` | `Noise(seed)` with `simplex2/3`, `fbm2/3`, `ridged2`, `warp2`, `worley2`; `hashString`, `hash2i`, `hash2f`. Deterministic per seed. |
| `MeshBuilder.ts` | `MeshBuilder` (colour groups, `tri/quad`, `addMesh/addBuilder`, transforms, `jitter`, `gradientByHeight`, `colorFaces`, `regroupFaces`, `build/buildGroups/buildAll`), helpers `addBox`, `addLathe`, `addCylinder`, `addCone`, `addLoft`, `addExtrude`, `addIcosphere`, `addDisc`, `smoothNormals`, `weld/unweld`, `subdivide`, `mergeMeshes`, `meshBounds`, `validateMesh`, colour helpers `rgb`, `mixRGB`, `shade`, `gradient`, `jitterColor`. |
| `palettes.ts` | Five biome palettes (`meadow`, `lagoon`, `dusk`, `ember`, `crest`), `SKY_PRESETS` + `skyAt(t)` for the legacy gradient sky, six glider `LIVERIES`. |
| `island.ts` | `generateIsland(seed, opts)` → mesh, groups, an `IslandShape` (outline/height/underside queries, `contains`, `resolve` for soft collision, `samplePoints` for decoration placement) and waterfall anchors. `lod: 1` gives the distant variant. |
| `tree.ts`, `rock.ts`, `cloud.ts`, `ruins.ts`, `props.ts` | Trees (pine, broadleaf, palm, dead; canopies flagged `wind`), rocks and glowing crystals, puffy clouds (smoothed normals), arches/columns/stone rings/stone lanterns, turbines (hub + separately spinning blades), windsocks, paper lanterns, balloons, motes, wind streaks, feathers, waterfall ribbons, sea-shade / splash discs, contrail puffs. |
| `glider.ts`, `bird.ts`, `ring.ts` | Player glider per livery: a sailplane / paper-plane hybrid with long slender wings curling into winglets, a needle fuselage on a tail boom and a T-tail (forward is -Z, span ≈ 5.2); bird poses for flocks; race rings (torus in XY, fly through along Z). |
| `seed.ts` | Human seeds: `normalizeSeed('Amber Lagoon 42') → 'amber-lagoon-42'`, `randomSeed()`, `dailySeed()`, `seedTitle()`, `seedValue()`. |
| `world.ts` | `WorldGenerator` and `ChunkTracker` (below). |
| `flight.ts` | Pure flight helpers: `headingForward`, `yawFromDirection`, `bankTurnRate`, `integrateSpeed`, `gateCrossing`, `bounceHeading`. |
| `plugin.ts` | `procgenPlugin` exposes all of the above to sandboxed scripts as `ctx.engine.procgen`. |

Everything is deterministic: generators take a numeric seed (or derive one
from the world seed with `hash2i`) and draw all randomness from the engine's
`Random` (Mulberry32) and `Noise`.

## WorldGenerator

```ts
const W = new WorldGenerator('amber-lagoon-42', { islands: 40, spacing: 74, chunkSize: 160, gates: 12, clouds: 120, landmarkEvery: 13, seaDepth: 130 });
W.islands      // IslandSpec[]: position, radius, height, depth, biome, name, chunk, yaw, side, landmark?, crownOf?
W.path         // the spiral flow path the archipelago follows
W.rings        // RingSpec[]: the race course (index, position, yaw, radius, lanterns: approach trail)
W.winds        // WindCurrent[]: spline tubes that push the glider along
W.clouds       // CloudSpec[]: a layer below the islands and a thinner one above
W.bounds       // { minY, maxY, radius, seaLevel }
W.spawn(i)     // start-line slot i: position + yaw facing gate 0
W.islandDetail(id) // cached: hi/LOD island meshes, decorations (kind, key, position, yaw, scale, animate), motes, flock
W.library(key) // shared mesh for a decoration key ('tree-meadow-pine-0', 'rock-dusk-2', 'ring', 'glider-3', 'bird-up', ...)
W.windAt(pos, out) / W.collide(pos, radius) / W.groundBelow(pos) / W.nearestIsland(pos) / W.nearbyIslands(pos, range)
W.chunkKey(x, z) / W.chunksAround(pos, radius) / W.contentOf(key) / W.chunkKeys
```

Layout: islands are spaced along the path by arc length, alternating sides,
grouped into contiguous biome regions; every `landmarkEvery`-th island is a
giant landmark whose rim the path grazes (summit ruins, a fly-through arch
aligned with the path, two waterfalls, a flock) with a small crown island
floating above it; gates sit on the path about 75 units apart with gentle
height changes and an 8-lantern approach trail; wind currents connect stretches
of the path; clouds fill three tiers (below the islands, at flight level beside
the path, above); the sea sits `seaDepth` below the lowest underside; spawns
are spread around the start line. `ChunkTracker.update(pos, radius)`
returns `{ entered, exited }` chunk keys so a script can stream content.
Generating the whole default world takes a few milliseconds; building every
island's detail (≈50k triangles, ≈580 decorations) takes ≈110 ms.

## The plugin: `engine.procgen`

Scripts run in a sandbox without imports, so the player, the editor's play
mode and the headless tests install `procgenPlugin`:

```ts
engine.use(procgenPlugin);
// in a script:
const P = ctx.engine.procgen;
P.world = P.createWorld(seed);                       // shared world slot
const desc = P.registerGenerated(`${seed}:tree-0`, P.world.library('tree-meadow-pine-0'));
// desc.mesh  -> merged mesh name; desc.groups -> per-group names; desc.base / desc.special -> see below
P.applyMaterial(meshRenderer, desc.groups[0]);      // colour, emissive, opacity, wind, shadows...
P.features // { vertexColors, sky, post, shadows, water, wind, lods, cameraShake, renderer }
P.env      // param/setParam (URL), storageGet/Set, copyText, urlWith, navigate, isTouch, now
```

`registerGenerated` registers `name` (the merged coloured mesh) and
`name/<group>` for each group; `unregister(name)` / `unregisterPrefix(prefix)`
free them again through `renderer.removeMesh`. When the renderer supports vertex colours it
also registers `name/base`: every *plain* lit group merged into one mesh, and
lists the remaining groups as `special` (emissive, translucent, unlit,
wind-swayed, water, double-sided). Drawing `base` plus `special` is the
cheapest faithful rendering: one draw for the bulk of the object, one per
material that genuinely differs. `applyMaterial` uses a white material colour
when vertex colours are on (the palette lives in the mesh) and the group colour
otherwise, and turns `castShadow` off for unlit, translucent and water groups.

`features` is detected from the component registry (`MeshRenderer.vertexColors`,
`SkySettings`, `PostProcessSettings`, `WaterMaterial`, `Light.castShadows`,
`MeshRenderer.windStrength/lods`) and the renderer instance, so scripts can
branch without try/catch and headless tests build the same scene.

## Adding a generator

1. Create `src/procgen/<thing>.ts`; start a `MeshBuilder`, declare colour
   groups with material hints, add geometry with the helpers, `return b.buildAll()`.
2. Export it from `src/procgen/index.ts` and, if scripts need it, add it to
   `ProcgenAPI.generators` in `plugin.ts`.
3. Add it to the `GENERATORS` table in `tests/procgen.test.ts` (validity,
   groups sum to the mesh, non-degenerate bounds).
4. If the world should place it, add a library key in `WorldGenerator.library`
   and emit decorations for it in `islandDetail`.
