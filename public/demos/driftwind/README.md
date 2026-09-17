# Driftwind

Glide through a floating archipelago at golden hour. Every world is generated
in code from a **seed** (`amber-lagoon-42`): islands with terraces and
waterfalls, forests, ruins, wind currents, clouds and a course of gate rings.
Fly for the view, collect light motes and discover named islands, or race
friends through the gates. Everyone in a room shares the host's seed.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Bank (turn) | A / D or left / right | left stick X | joystick |
| Pitch (climb / dive) | W / S or up / down | left stick Y | joystick |
| Boost (uses the meter) | Space or Shift | A / RT | **BOOST** |
| Air brake | X or Ctrl | B / LT | **BRAKE** |
| Photo mode (hides HUD, orbits) | P | Y | - |
| Start a race | R | - | - |
| Menu | Esc | - | - |

Flying is a trade between speed and height: dive to gain speed, pull up to
trade it back, and keep above the stall speed or the nose drops on its own.
Rings and wind currents refill the boost meter; islands bounce you off gently.

## Modes

- **Fly**: relaxed free roam. Collect motes, find every island, watch the day
  drift toward night. `P` for photo mode.
- **Race**: a 3-2-1 countdown, then through every gate in order. Your best time
  per seed is stored in the browser and replayed as a translucent ghost.
- **Play with friends**: opens a room (`?room=`) with the current seed; the
  lobby's invite link brings others into the same archipelago. Races start
  for everyone when the host (or a guest asking the host) presses Race.
- **Daily seed**: the same world for everyone on a given day.

`play.html?project=driftwind&seed=misty-spire-17` opens a specific world;
`&daily=1` opens today's.

## How the art is generated

Nothing here is a downloaded asset. The `src/procgen/` library (see
`docs/PROCGEN.md`) builds every mesh at load time from the seed:

- **Islands** (`island.ts`): a polar heightfield with terraces and a cliff lip,
  an undercut rock underside with stalactites, colours chosen by slope and
  height (grass, sand, cliff, rock) with per-face jitter for the painted
  low-poly look, and waterfall ribbons. An analytic shape gives cheap
  collision and decoration placement.
- **Trees, rocks, crystals, ruins, props** (`tree.ts`, `rock.ts`, `ruins.ts`,
  `props.ts`): small generators sharing the same `MeshBuilder`; each object is
  emitted as a coloured mesh plus one mesh per colour group, so today's
  renderer draws them with per-material colours while the vertex colours are
  ready for the upgraded renderer.
- **World** (`world.ts`): islands are placed along a spiral flow path (so there
  is always a route), biomes are contiguous regions, wind currents follow
  stretches of the path, gates sit between islands, clouds fill the layers
  below and above. Content streams in chunks around the player.
- **Sound** (`scripts/lib/driftwind-sfx.ts`): the wind loop, chimes, whoosh,
  thud and the music pad are synthesized WAVs.

The scripts reach the library through the `procgen` engine plugin
(`ctx.engine.procgen`), which also registers meshes on the renderer.

## Fork it in the editor

Open **Driftwind** with *Open in Editor*, then:

1. Change the `World` entity's `WorldStreamer` props: `seed`, `islands`,
   `streamRadius`, or turn `detail` off for a minimalist look.
2. Tune the feel in the `Glider` prefab script props: `cruise`, `stall`,
   `maxBank`, `turnRate`, `sink`, `boostAccel`.
3. Retime the day in the `Sky` script (`startTime`, `dayLength`).
4. Add your own props: write a generator in `src/procgen/`, expose it through
   the plugin, and spawn it from `WorldStreamer.spawnIsland`.

## Ideas to extend it

1. Landing: touch down on a flat island top (`shape.heightAt`) to rest and refill boost.
2. Photo sharing: capture the canvas in photo mode and export with the seed baked in.
3. Weather seeds: rain palettes with darker fog and stronger, gustier wind currents.
4. Time trials per gate segment with split times in the standings.
5. Liveries as unlockables: `LIVERIES` in `palettes.ts` is the whole list.
