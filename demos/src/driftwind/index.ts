import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIFTWIND_SFX } from '../../../scripts/lib/driftwind-sfx';
import { type DemoBundle, SceneBuilder, euler, hex, loadScripts, makeProject, prefab, svg } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));

/** Default world; `?seed=` on the URL or the start screen override it. */
export const DEFAULT_SEED = 'amber-lagoon-42';

export function build(): DemoBundle {
  const b = new SceneBuilder();
  b.entity('Camera', {
    Transform: { position: { x: 60, y: 70, z: 60 } },
    Camera3D: { fov: 62, near: 0.3, far: 1400, fogEnabled: true, fogNear: 140, fogFar: 520, fogColor: hex('#f3d2b0'), skyTop: hex('#5a6fd0'), skyBottom: hex('#ffcf8a'), clearColor: hex('#f3d2b0') },
    Script: { script: 'ChaseCamera', props: {} },
    AudioListener: {},
  });
  b.entity('Sun', { Transform: { position: { x: 120, y: 60, z: -80 }, rotation: euler(-0.5, 0.9, 0) }, Light: { kind: 'directional', intensity: 1.2, color: hex('#ffe2b0') } });
  b.entity('Ambient', { Transform: {}, Light: { kind: 'ambient', intensity: 0.42, color: hex('#c0b0ff') } });
  b.entity('Sky', { Transform: {}, Script: { script: 'Sky', props: { startTime: 0.71, dayLength: 720 } } });
  b.entity('World', { Transform: {}, Script: { script: 'WorldStreamer', props: { seed: DEFAULT_SEED, streamRadius: 520, lodDistance: 260, islands: 34, detail: true } } });
  b.entity('GameManager', {
    Transform: {},
    Script: { script: 'GameManager', props: { seed: DEFAULT_SEED, countdown: 3 } },
    NetworkIdentity: { ownerId: 'host', authority: 'host', replicate: false },
  });
  b.entity('Shell', { Transform: {}, Script: { script: 'Shell', props: {} } });
  const scene = b.save('Archipelago', { seed: 7 });

  // Glider: the placeholder cubes are replaced by generated livery meshes in Glider.applyLook.
  const glider = prefab('Glider', (p) => {
    const root = p.entity('Glider', {
      Transform: {},
      PlayerInput: { owner: 'local' },
      NetworkIdentity: { prefab: 'Glider', authority: 'host' },
      NetTransform: { syncRotation: true, interpolationDelay: 2, extrapolation: 0.15, teleportDistance: 40 },
      Script: { script: 'Glider', props: {} },
    }, { tags: ['glider'] });
    p.entity('Hull', { Transform: { scale: { x: 0.5, y: 0.3, z: 2.4 } }, MeshRenderer: { mesh: 'cube', color: hex('#f7f2e8'), roughness: 0.5 } }, { parent: root });
    p.entity('Wing', { Transform: { scale: { x: 3.4, y: 0.08, z: 0.9 } }, MeshRenderer: { mesh: 'cube', color: hex('#ff7a3d'), roughness: 0.55 } }, { parent: root });
    p.entity('Trim', { Transform: { position: { x: 0, y: 0.3, z: 1.1 }, scale: { x: 0.08, y: 0.5, z: 0.5 } }, MeshRenderer: { mesh: 'cube', color: hex('#1a2238'), roughness: 0.4 } }, { parent: root });
    p.entity('Canopy', { Transform: { position: { x: 0, y: 0.2, z: -0.4 }, scale: { x: 0.35, y: 0.2, z: 0.7 } }, MeshRenderer: { mesh: 'sphere', color: hex('#3a6fd8'), opacity: 0.75 } }, { parent: root });
    return root;
  });
  const ghost = prefab('Ghost', (p) => p.entity('Ghost', { Transform: {}, Script: { script: 'Ghost', props: {} } }, { tags: ['ghost'] }));

  const project = makeProject({
    id: 'driftwind',
    name: 'Driftwind',
    description: 'Glide through a procedurally generated floating archipelago at golden hour. Relax, collect light motes and discover islands, or race friends through gate rings. Every world comes from a shareable seed.',
    renderer: '3d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    prefabs: [glider, ghost],
    assets: [
      { id: 'wind', kind: 'audio', url: 'assets/wind.wav' },
      { id: 'chime', kind: 'audio', url: 'assets/chime.wav' },
      { id: 'whoosh', kind: 'audio', url: 'assets/whoosh.wav' },
      { id: 'thud', kind: 'audio', url: 'assets/thud.wav' },
      { id: 'mote', kind: 'audio', url: 'assets/mote.wav' },
      { id: 'discover', kind: 'audio', url: 'assets/discover.wav' },
      { id: 'tick', kind: 'audio', url: 'assets/tick.wav' },
      { id: 'go', kind: 'audio', url: 'assets/go.wav' },
      { id: 'pad', kind: 'audio', url: 'assets/pad.wav' },
    ],
    settings: {
      network: { mode: 'host-authoritative', maxPlayers: 8, tickRate: 20 },
      physics: { gravity3d: { x: 0, y: 0, z: 0 } },
      input: {
        actions: {
          boost: ['Space', 'ShiftLeft', 'ShiftRight', 'GamepadA', 'GamepadRT', 'Touch:boost'],
          brake: ['KeyX', 'ControlLeft', 'GamepadB', 'GamepadLT', 'Touch:brake'],
          photo: ['KeyP', 'GamepadY'],
          action: ['Enter', 'GamepadStart'],
          pause: ['Escape'],
          jump: ['Space'],
          fire: ['KeyJ'],
        },
        axes: {
          moveX: { negative: ['KeyA', 'ArrowLeft', 'GamepadDpadLeft'], positive: ['KeyD', 'ArrowRight', 'GamepadDpadRight'], gamepadAxis: 0, touchJoystick: 'x' },
          moveY: { negative: ['KeyS', 'ArrowDown', 'GamepadDpadDown'], positive: ['KeyW', 'ArrowUp', 'GamepadDpadUp'], gamepadAxis: 1, invertGamepad: true, touchJoystick: 'y' },
        },
      },
      touchControls: true,
      touchButtons: ['boost', 'brake'],
    },
  });

  return {
    id: 'driftwind',
    entry: {
      id: 'driftwind', name: 'Driftwind', title: 'Driftwind',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '3d', multiplayer: true,
      players: { min: 1, max: 8 }, tags: ['flying', 'procedural', 'relaxing', 'racing', 'webgl'],
      controls: ['A/D: bank', 'W/S: pitch', 'Space: boost', 'X: brake', 'P: photo mode', 'R: race'],
      featured: true, hero: true,
    },
    project,
    files: {
      'assets/wind.wav': DRIFTWIND_SFX.wind(),
      'assets/chime.wav': DRIFTWIND_SFX.chime(),
      'assets/whoosh.wav': DRIFTWIND_SFX.whoosh(),
      'assets/thud.wav': DRIFTWIND_SFX.thud(),
      'assets/mote.wav': DRIFTWIND_SFX.mote(),
      'assets/discover.wav': DRIFTWIND_SFX.discover(),
      'assets/tick.wav': DRIFTWIND_SFX.tick(),
      'assets/go.wav': DRIFTWIND_SFX.go(),
      'assets/pad.wav': DRIFTWIND_SFX.pad(),
      'thumbnail.svg': THUMBNAIL,
      'README.md': README,
    },
  };
}

/** Painted golden-hour archipelago: gradient sky, sun, island silhouettes with undercut rock, a glider. */
const THUMBNAIL = svg(320, 180, `
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f4ba0"/><stop offset="0.55" stop-color="#e0757a"/><stop offset="1" stop-color="#ffd18a"/></linearGradient>
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2c8"/><stop offset="1" stop-color="#ffb347"/></linearGradient>
  <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd18a" stop-opacity="0"/><stop offset="1" stop-color="#ffe6c0" stop-opacity="0.9"/></linearGradient>
</defs>
<rect width="320" height="180" fill="url(#sky)"/>
<circle cx="236" cy="78" r="26" fill="url(#sun)"/>
<circle cx="236" cy="78" r="40" fill="#ffd166" opacity="0.18"/>
<g opacity="0.55"><ellipse cx="60" cy="150" rx="70" ry="10" fill="#fff0dc"/><ellipse cx="250" cy="160" rx="90" ry="12" fill="#fff0dc"/></g>
<g transform="translate(200 112)" opacity="0.85"><polygon points="-42,0 42,0 30,-6 -34,-8" fill="#8fbf4f"/><polygon points="-42,0 42,0 18,26 -8,42 -30,20" fill="#9c6740"/><polygon points="-30,-6 -20,-16 -10,-6" fill="#6ea23e"/><polygon points="6,-8 14,-20 22,-6" fill="#4f9a3c"/><rect x="-24" y="-24" width="3" height="8" fill="#7a5236"/><rect x="12" y="-28" width="3" height="8" fill="#7a5236"/></g>
<g transform="translate(78 92)"><polygon points="-58,0 58,0 44,-10 -48,-12" fill="#b8d46a"/><polygon points="-58,0 58,0 26,36 -4,56 -40,30" fill="#c98a5a"/><polygon points="-44,-4 -36,-12 -44,-12 -30,-30 -16,-12 -24,-12 -16,-4" fill="#68b04e"/><polygon points="4,-10 14,-32 24,-10" fill="#4f9a3c"/><polygon points="26,-6 34,-22 42,-6" fill="#9fcf5c"/><rect x="-32" y="-4" width="3" height="6" fill="#7a5236"/><rect x="12" y="-10" width="3" height="6" fill="#7a5236"/><rect x="32" y="-6" width="3" height="6" fill="#7a5236"/><path d="M40,-6 q6,14 4,30" stroke="#8fe8ff" stroke-width="3" fill="none" opacity="0.8"/></g>
<g transform="translate(150 60) rotate(-12)"><polygon points="-18,4 0,-2 18,6 0,0" fill="#ff7a3d"/><polygon points="-3,-4 3,-4 4,10 -4,10" fill="#f7f2e8"/><polygon points="-2,-3 2,-3 2,2 -2,2" fill="#3a6fd8"/></g>
<g stroke="#fff" stroke-width="1.2" opacity="0.5" fill="none"><path d="M108,66 q10,-4 22,0"/><path d="M110,72 q14,-4 26,1"/></g>
<rect width="320" height="60" y="120" fill="url(#haze)"/>
<text x="160" y="34" fill="#fff" font-family="system-ui,sans-serif" font-size="20" text-anchor="middle" font-weight="300" letter-spacing="6">DRIFTWIND</text>`);

const README = `# Driftwind

Glide through a floating archipelago at golden hour. Every world is generated
in code from a **seed** (\`amber-lagoon-42\`): islands with terraces and
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
  drift toward night. \`P\` for photo mode.
- **Race**: a 3-2-1 countdown, then through every gate in order. Your best time
  per seed is stored in the browser and replayed as a translucent ghost.
- **Play with friends**: opens a room (\`?room=\`) with the current seed; the
  lobby's invite link brings others into the same archipelago. Races start
  for everyone when the host (or a guest asking the host) presses Race.
- **Daily seed**: the same world for everyone on a given day.

\`play.html?project=driftwind&seed=misty-spire-17\` opens a specific world;
\`&daily=1\` opens today's.

## How the art is generated

Nothing here is a downloaded asset. The \`src/procgen/\` library (see
\`docs/PROCGEN.md\`) builds every mesh at load time from the seed:

- **Islands** (\`island.ts\`): a polar heightfield with terraces and a cliff lip,
  an undercut rock underside with stalactites, colours chosen by slope and
  height (grass, sand, cliff, rock) with per-face jitter for the painted
  low-poly look, and waterfall ribbons. An analytic shape gives cheap
  collision and decoration placement.
- **Trees, rocks, crystals, ruins, props** (\`tree.ts\`, \`rock.ts\`, \`ruins.ts\`,
  \`props.ts\`): small generators sharing the same \`MeshBuilder\`; each object is
  emitted as a coloured mesh plus one mesh per colour group, so today's
  renderer draws them with per-material colours while the vertex colours are
  ready for the upgraded renderer.
- **World** (\`world.ts\`): islands are placed along a spiral flow path (so there
  is always a route), biomes are contiguous regions, wind currents follow
  stretches of the path, gates sit between islands, clouds fill the layers
  below and above. Content streams in chunks around the player.
- **Sound** (\`scripts/lib/driftwind-sfx.ts\`): the wind loop, chimes, whoosh,
  thud and the music pad are synthesized WAVs.

The scripts reach the library through the \`procgen\` engine plugin
(\`ctx.engine.procgen\`), which also registers meshes on the renderer.

## Fork it in the editor

Open **Driftwind** with *Open in Editor*, then:

1. Change the \`World\` entity's \`WorldStreamer\` props: \`seed\`, \`islands\`,
   \`streamRadius\`, or turn \`detail\` off for a minimalist look.
2. Tune the feel in the \`Glider\` prefab script props: \`cruise\`, \`stall\`,
   \`maxBank\`, \`turnRate\`, \`sink\`, \`boostAccel\`.
3. Retime the day in the \`Sky\` script (\`startTime\`, \`dayLength\`).
4. Add your own props: write a generator in \`src/procgen/\`, expose it through
   the plugin, and spawn it from \`WorldStreamer.spawnIsland\`.

## Ideas to extend it

1. Landing: touch down on a flat island top (\`shape.heightAt\`) to rest and refill boost.
2. Photo sharing: capture the canvas in photo mode and export with the seed baked in.
3. Weather seeds: rain palettes with darker fog and stronger, gustier wind currents.
4. Time trials per gate segment with split times in the standings.
5. Liveries as unlockables: \`LIVERIES\` in \`palettes.ts\` is the whole list.
`;
