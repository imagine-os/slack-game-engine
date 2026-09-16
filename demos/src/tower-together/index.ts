import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Random } from '../../../src/index';
import { SFX } from '../../../scripts/lib/wav';
import { type DemoBundle, SceneBuilder, hex, loadScripts, makeProject, prefab, thumbnail, v2 } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));
const MAP_W = 36, MAP_H = 18;
const PATH: [number, number][] = [[-16, 6], [-8, 6], [-8, -4], [2, -4], [2, 5], [10, 5], [10, -3], [16.5, -3]];

export function build(): DemoBundle {
  const b = new SceneBuilder();
  b.entity('Camera', {
    Transform: {},
    Camera2D: { backgroundColor: hex('#16212b'), shakeDecay: 8 },
    AudioListener: {},
    Script: { script: 'MapCamera', props: { width: MAP_W + 1, height: MAP_H + 1 } },
  });
  b.entity('GameManager', {
    Transform: {},
    Script: { script: 'GameManager', props: { startGold: 120, towerCost: 50, baseHealth: 20, waveDelay: 5, mapWidth: MAP_W, mapHeight: MAP_H, path: PATH } },
    NetworkIdentity: { ownerId: 'host', authority: 'host', replicate: false },
  });
  const map = b.entity('Map', { Transform: {} });
  b.entity('Grass', { Transform: {}, Shape: { kind: 'rect', width: MAP_W, height: MAP_H, fill: hex('#2f5d3a'), layer: -30 } }, { parent: map });
  const rng = new Random(11);
  for (let i = 0; i < 40; i++) {
    const x = rng.range(-MAP_W / 2 + 1, MAP_W / 2 - 1), y = rng.range(-MAP_H / 2 + 1, MAP_H / 2 - 1);
    b.entity(`Grass Tuft ${i + 1}`, { Transform: { position: { x, y, z: 0 } }, Shape: { kind: 'circle', radius: rng.range(0.25, 0.6), fill: hex('#36683f'), layer: -29 } }, { parent: map });
  }
  b.entity('Road Edge', { Transform: {}, Shape: { kind: 'line', points: PATH.flat(), filled: false, stroke: hex('#6b5238'), strokeWidth: 2.2, layer: -21 } }, { parent: map });
  b.entity('Road', { Transform: {}, Shape: { kind: 'line', points: PATH.flat(), filled: false, stroke: hex('#b08a5a'), strokeWidth: 1.8, layer: -20 } }, { parent: map });
  const [sx, sy] = PATH[0], [ex, ey] = PATH[PATH.length - 1];
  b.entity('Portal', {
    Transform: { position: { x: sx, y: sy, z: 0 } },
    Shape: { kind: 'circle', radius: 1.1, fill: hex('#5a2d82'), stroke: hex('#b98cff'), strokeWidth: 0.12, layer: -10 },
    ParticleEmitter: { rate: 12, maxParticles: 40, lifetime: 1.2, speed: 0.6, spread: Math.PI, gravity: v2(0, 0.4), startSize: 0.25, endSize: 0, startColor: hex('#b98cff', 0.8), endColor: hex('#b98cff', 0), blend: 'add', layer: -9 },
  }, { parent: map });
  b.entity('Base', {
    Transform: { position: { x: ex, y: ey, z: 0 } },
    Shape: { kind: 'rect', width: 2, height: 2, fill: hex('#3f4b78'), stroke: hex('#c9d3e6'), strokeWidth: 0.12, layer: -10 },
  }, { parent: map });
  b.entity('Base Label', { Transform: { position: { x: ex, y: ey + 1.5, z: 0 } }, Text: { text: 'BASE', size: 0.5, bold: true, outlineWidth: 0.04 } }, { parent: map });
  const scene = b.save('Valley', { gravity: { x: 0, y: 0 }, seed: 5 });

  const builder = prefab('Builder', (p) => {
    const root = p.entity('Builder', {
      Transform: {},
      Shape: { kind: 'rect', width: 1, height: 1, filled: false, stroke: hex('#4cc2ff'), strokeWidth: 0.1, layer: 20 },
      PlayerInput: { owner: 'local', mergeStrategy: 'first-wins' },
      // `Shape` replicates so guests see the cursor's valid / invalid / unaffordable colour.
      NetworkIdentity: { prefab: 'Builder', authority: 'host', syncComponents: ['Shape'] },
      NetTransform: { syncRotation: false, interpolationDelay: 1 },
      Script: { script: 'Builder', props: {} },
    }, { tags: ['builder'] });
    p.entity('Nameplate', { Transform: { position: { x: 0, y: 0.8, z: 0 } }, Text: { text: 'P1', size: 0.35, bold: true, outlineWidth: 0.04, layer: 21 } }, { parent: root });
    return root;
  });
  const tower = prefab('Tower', (p) => {
    const root = p.entity('Tower', {
      Transform: {},
      Shape: { kind: 'rect', width: 0.85, height: 0.85, fill: hex('#8f99b3'), stroke: hex('#3a4460'), strokeWidth: 0.08, layer: 5 },
      ParticleEmitter: { emitting: false, rate: 0, maxParticles: 20, lifetime: 0.5, speed: 2, spread: Math.PI, gravity: v2(0, 0), startSize: 0.2, endSize: 0, startColor: hex('#ffffff', 0.8), endColor: hex('#ffffff', 0), blend: 'add', layer: 6 },
      NetworkIdentity: { prefab: 'Tower', authority: 'host' },
      Script: { script: 'Tower', props: {} },
    }, { tags: ['tower'] });
    p.entity('Range', { Transform: {}, Shape: { kind: 'circle', radius: 3.6, filled: false, stroke: hex('#ffffff', 0.12), strokeWidth: 0.04, layer: 4 } }, { parent: root });
    p.entity('Barrel', { Transform: {}, Shape: { kind: 'rect', width: 0.22, height: 0.7, fill: hex('#3a4460'), layer: 7 } }, { parent: root });
    p.entity('Turret', { Transform: {}, Shape: { kind: 'circle', radius: 0.28, fill: hex('#c9d3e6'), layer: 8 } }, { parent: root });
    return root;
  });
  // The barrel pivots at its base: shift its shape upward by half its height.
  {
    const barrel = tower.entities.find((e) => e.name === 'Barrel')!;
    const t = barrel.components.find((c) => c.type === 'Transform')!;
    (t.data.position as { x: number; y: number; z: number }).y = 0;
  }
  const enemy = prefab('Enemy', (p) => {
    const root = p.entity('Enemy', {
      Transform: {},
      Shape: { kind: 'circle', radius: 0.38, fill: hex('#ef476f'), stroke: hex('#4a1020'), strokeWidth: 0.06, layer: 10 },
      ParticleEmitter: { emitting: false, rate: 0, maxParticles: 40, lifetime: 0.5, speed: 3, spread: Math.PI, gravity: v2(0, 0), startSize: 0.2, endSize: 0, startColor: hex('#ef476f'), endColor: hex('#ef476f', 0), blend: 'add', layer: 11 },
      NetworkIdentity: { prefab: 'Enemy', authority: 'host' },
      NetTransform: { syncRotation: false },
      Script: { script: 'Enemy', props: {} },
    }, { tags: ['enemy'] });
    p.entity('Health Back', { Transform: { position: { x: 0, y: 0.6, z: 0 } }, Shape: { kind: 'rect', width: 0.8, height: 0.12, fill: hex('#000000', 0.6), layer: 11 } }, { parent: root });
    p.entity('Health', { Transform: { position: { x: 0, y: 0.6, z: 0 } }, Shape: { kind: 'rect', width: 0.8, height: 0.12, fill: hex('#06d6a0'), layer: 12 } }, { parent: root });
    return root;
  });
  const shot = prefab('Shot', (p) => p.entity('Shot', {
    Transform: {},
    Shape: { kind: 'circle', radius: 0.12, fill: hex('#ffd166'), layer: 15 },
    Script: { script: 'Shot', props: {} },
  }, { tags: ['shot'] }));

  const project = makeProject({
    id: 'tower-together',
    name: 'Tower Together',
    description: 'Co-op tower defence for 1-4 players: click or tap to build turrets along the road, share one purse of gold and hold the base through escalating waves.',
    renderer: '2d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    prefabs: [builder, tower, enemy, shot],
    assets: [
      { id: 'place', kind: 'audio', url: 'assets/place.wav' },
      { id: 'shoot', kind: 'audio', url: 'assets/shoot.wav' },
      { id: 'hit', kind: 'audio', url: 'assets/hit.wav' },
      { id: 'lose', kind: 'audio', url: 'assets/lose.wav' },
      { id: 'clear', kind: 'audio', url: 'assets/clear.wav' },
      { id: 'deny', kind: 'audio', url: 'assets/deny.wav' },
    ],
    settings: {
      pixelsPerUnit: 32,
      physics: { gravity: { x: 0, y: 0 } },
      network: { mode: 'host-authoritative', maxPlayers: 4, tickRate: 15 },
      multiUser: { sharedControl: true, mergeStrategy: 'first-wins' },
      touchControls: false,
      touchButtons: [],
    },
  });

  return {
    id: 'tower-together',
    entry: {
      id: 'tower-together', name: 'Tower Together', title: 'Tower Together',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '2d', multiplayer: true,
      players: { min: 1, max: 4 }, tags: ['tower-defense', 'co-op', 'pointer', 'shared-control'],
      controls: ['Click / tap: build tower'], featured: true,
    },
    project,
    files: {
      'assets/place.wav': SFX.place(),
      'assets/shoot.wav': SFX.shoot(),
      'assets/hit.wav': SFX.hit(),
      'assets/lose.wav': SFX.lose(),
      'assets/clear.wav': SFX.goal(),
      'assets/deny.wav': SFX.bounce(),
      'thumbnail.svg': thumbnail(`
<rect width="320" height="180" fill="#2f5d3a"/>
<polyline points="0,60 80,60 80,130 180,130 180,50 260,50 260,120 320,120" fill="none" stroke="#6b5238" stroke-width="26" stroke-linejoin="round"/>
<polyline points="0,60 80,60 80,130 180,130 180,50 260,50 260,120 320,120" fill="none" stroke="#b08a5a" stroke-width="20" stroke-linejoin="round"/>
<circle cx="30" cy="60" r="8" fill="#ef476f"/><circle cx="80" cy="95" r="8" fill="#ef476f"/><circle cx="130" cy="130" r="8" fill="#ef476f"/>
<rect x="105" y="80" width="20" height="20" fill="#8f99b3" stroke="#3a4460" stroke-width="2"/><circle cx="115" cy="90" r="5" fill="#c9d3e6"/>
<rect x="210" y="90" width="20" height="20" fill="#8f99b3" stroke="#3a4460" stroke-width="2"/><circle cx="220" cy="100" r="5" fill="#c9d3e6"/>
<rect x="290" y="100" width="24" height="24" fill="#3f4b78" stroke="#c9d3e6" stroke-width="2"/>
<rect x="150" y="60" width="16" height="16" fill="none" stroke="#4cc2ff" stroke-width="2"/>
<text x="160" y="170" fill="#fff" font-family="system-ui,sans-serif" font-size="14" text-anchor="middle" font-weight="700">Tower Together</text>`),
      'README.md': README,
    },
  };
}

const README = `# Tower Together

Cooperative tower defence for 1-4 players. Creeps walk the road from the
portal to the base; click or tap anywhere off the road to build a turret.
Gold is shared by the whole team, so talk before you spend it. Waves grow
until the base falls.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Aim the build cursor | move the mouse | (tap aims and builds) |
| Build a tower (50 gold) | left click or **J** | tap the spot |

The cursor turns yellow when you cannot afford a tower and red when the spot
is invalid (on the road, off the map or already taken).

## Shared building

Each player gets a **Builder** prefab: a cursor with a \`PlayerInput\` owned by
that peer. Its \`Builder\` script reads the pointer from the input snapshot
(\`snapshot.pointer\`, in world units, which the engine fills from the mouse
and the network relays for remote players), snaps it to the grid and, on
\`fire\`, sends a \`placeTower\` message. The \`GameManager\` validates the spot
and the shared purse on the host and spawns the \`Tower\` prefab, so two
players clicking the same cell in the same tick cannot both pay.

The project enables \`multiUser.sharedControl\` with \`mergeStrategy:
"first-wins"\`, and the Builder's \`PlayerInput.mergeStrategy\` is
\`first-wins\` too: if the room assigns more than one user to a single cursor,
the first non-zero input (and the first pointer) wins each tick instead of
being averaged, which is what you want for discrete placement.

## How it is built

| Piece | Components / script | Notes |
| --- | --- | --- |
| Road | two \`Shape\` lines drawn from the \`path\` waypoints | The same waypoint list drives enemies and placement validation |
| Enemy | \`Shape\`, health-bar children, \`ParticleEmitter\`, \`Enemy\` script | Walks waypoint to waypoint; every third wave has heavy variants |
| Tower | \`Shape\` base, barrel, range ring, \`Tower\` script | Nearest-enemy targeting; fires \`Shot\` prefabs |
| Shot | \`Shape\`, \`Shot\` script | Homing projectile; damage applied by message |
| Builder | outline \`Shape\`, \`PlayerInput\`, \`Builder\` script | One per player, coloured per player |
| GameManager | \`GameManager\` script | Waves, gold, base health, HUD, restart |

The game runs without any physics: movement and targeting are plain distance
checks in \`onFixedUpdate\`, which keeps it deterministic and cheap.

## Ideas to extend it

1. Tower types: add \`props.kind\` (slow, splash, sniper) and a key to cycle the cursor's selection.
2. Upgrades: click an existing tower to spend gold on \`damage\`/\`range\` (the cursor already detects occupied cells).
3. Selling: right-click refunds 60% of the cost.
4. Flying enemies that ignore the road: give them their own straight-line path and towers a \`canHitAir\` prop.
5. Vote to start the next wave early: an RPC that counts ready players and shortens \`waveDelay\`.
`;
