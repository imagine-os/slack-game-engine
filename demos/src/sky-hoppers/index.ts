import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX } from '../../../scripts/lib/wav';
import { type DemoBundle, SceneBuilder, hex, loadScripts, makeProject, prefab, svg, thumbnail, v2 } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The level as ASCII art (row 0 = top). Legend:
 *   #  dirt (grass is added automatically where air is above)
 *   S  stone block      B  crate      I  ice
 *   o  coin             ^  spike      P  player spawn
 *   K  checkpoint       F  goal flag  M  moving platform (see PLATFORMS, left to right)
 */
const LEVEL = [
  '................................................................................................',
  '................................................................................................',
  '.......................................................................................o........',
  '................................................................o.o.o..............o.o.o.o......',
  '........................................o.o..............M.....SSSSSSS..........................',
  '...........................o....o......SSSSS...........................................F........',
  '................o.o....SSSS..SSSS...................o.o.o......o.o.o......M.......SSSSSSSSS.....',
  '..............SSSSS................................SSSSSS.....SSSSSSS..................S........',
  '....P.......................................M........................o.o.o.............S........',
  '.....................##...............#####..........^^.......^^^.o.SSSSSSS......^^....S........',
  '...................####..oo.........#######........#####.....######...........o.####...S........',
  '.............^^...######.SSS..^^^..#########......K#####.....######.....^^^..######..K.S........',
  '#############################################.....######....############.###################....',
  '#############################################.....######....############.###################....',
  '#############################################.....######....############.###################....',
  '#############################################.....######....############.###################....',
  '#############################################.....######....############.###################....',
  '#############################################.....######....############.###################....',
];
/** Travel of each moving platform, in reading order (left to right). */
const PLATFORMS = [
  { dx: 0, dy: 4, period: 4, phase: 0 },
  { dx: 6, dy: 0, period: 5, phase: 1.5 },
  { dx: 8, dy: 2, period: 6, phase: 0 },
];
const TILE = { grass: 1, dirt: 2, stone: 3, crate: 4, ice: 5 } as const;

const TILESET_SVG = svg(160, 32, `
<g id="grass"><rect width="32" height="32" fill="#6b4a2e"/><rect width="32" height="9" fill="#4fbf5a"/><rect y="9" width="32" height="3" fill="#2f8a3d"/><rect x="4" y="16" width="5" height="4" fill="#5a3d24"/><rect x="18" y="22" width="6" height="4" fill="#5a3d24"/></g>
<g transform="translate(32 0)"><rect width="32" height="32" fill="#6b4a2e"/><rect x="6" y="6" width="6" height="4" fill="#5a3d24"/><rect x="20" y="14" width="7" height="5" fill="#5a3d24"/><rect x="10" y="24" width="5" height="4" fill="#5a3d24"/></g>
<g transform="translate(64 0)"><rect width="32" height="32" fill="#7a839a"/><rect x="1" y="1" width="30" height="30" fill="#8f99b3"/><rect x="1" y="1" width="30" height="14" fill="#9aa5c0"/><line x1="1" y1="16" x2="31" y2="16" stroke="#6b7590" stroke-width="2"/><line x1="16" y1="1" x2="16" y2="16" stroke="#6b7590" stroke-width="2"/><line x1="8" y1="16" x2="8" y2="31" stroke="#6b7590" stroke-width="2"/><line x1="24" y1="16" x2="24" y2="31" stroke="#6b7590" stroke-width="2"/></g>
<g transform="translate(96 0)"><rect width="32" height="32" fill="#a4703a"/><rect x="2" y="2" width="28" height="28" fill="#c58a4a"/><line x1="2" y1="2" x2="30" y2="30" stroke="#8a5a2a" stroke-width="3"/><line x1="30" y1="2" x2="2" y2="30" stroke="#8a5a2a" stroke-width="3"/></g>
<g transform="translate(128 0)"><rect width="32" height="32" fill="#9fdcff"/><rect x="2" y="2" width="28" height="28" fill="#c9eeff"/><polygon points="6,26 12,8 16,26" fill="#ffffff" opacity=".6"/></g>`);

const HOPPER_SVG = svg(32, 40, `
<ellipse cx="16" cy="24" rx="13" ry="14" fill="#f2f6ff"/>
<ellipse cx="16" cy="12" rx="11" ry="10" fill="#ffffff"/>
<circle cx="12" cy="11" r="2.4" fill="#1a2238"/><circle cx="21" cy="11" r="2.4" fill="#1a2238"/>
<circle cx="12.8" cy="10.2" r=".8" fill="#fff"/><circle cx="21.8" cy="10.2" r=".8" fill="#fff"/>
<path d="M12 17 q4 3 8 0" stroke="#1a2238" stroke-width="1.6" fill="none"/>
<ellipse cx="9" cy="37" rx="5" ry="3" fill="#c9d3e6"/><ellipse cx="23" cy="37" rx="5" ry="3" fill="#c9d3e6"/>`);
const COIN_SVG = svg(24, 24, `<circle cx="12" cy="12" r="11" fill="#e0a010"/><circle cx="12" cy="12" r="8.5" fill="#ffd166"/><rect x="10.5" y="6" width="3" height="12" rx="1" fill="#e0a010"/>`);
const SPIKE_SVG = svg(32, 32, `<polygon points="0,32 8,6 16,32" fill="#d8dce8"/><polygon points="16,32 24,6 32,32" fill="#d8dce8"/><polygon points="0,32 8,6 10,32" fill="#a3a9bb"/><polygon points="16,32 24,6 26,32" fill="#a3a9bb"/>`);
const FLAG_SVG = svg(32, 64, `<rect x="6" y="4" width="3" height="60" fill="#d8dce8"/><polygon points="9,6 30,14 9,22" fill="#ef476f"/>`);
const CHECKPOINT_SVG = svg(32, 64, `<rect x="14" y="8" width="4" height="56" fill="#d8dce8"/><circle cx="16" cy="10" r="7" fill="#ffffff"/><circle cx="16" cy="10" r="3.5" fill="#1a2238"/>`);
const PLATFORM_SVG = svg(96, 16, `<rect width="96" height="16" rx="4" fill="#8f99b3"/><rect x="3" y="3" width="90" height="6" rx="3" fill="#b7c0d8"/><circle cx="12" cy="8" r="2" fill="#4a5470"/><circle cx="84" cy="8" r="2" fill="#4a5470"/>`);
const MOUNTAINS_SVG = svg(1024, 320, `
<polygon points="0,320 0,200 120,90 220,180 330,60 440,170 560,110 680,200 780,80 900,190 1024,120 1024,320" fill="#2b3560"/>
<polygon points="0,320 0,240 90,190 200,250 300,170 420,260 520,200 640,270 760,190 880,260 1024,210 1024,320" fill="#3a4a7a"/>`);
const HILLS_SVG = svg(1024, 200, `
<path d="M0 200 L0 140 Q128 60 256 140 T512 140 T768 140 T1024 140 L1024 200 Z" fill="#2f6b4a"/>
<path d="M0 200 L0 170 Q128 110 256 170 T512 170 T768 170 T1024 170 L1024 200 Z" fill="#276040"/>`);

interface Parsed { width: number; height: number; data: number[]; coins: { x: number; y: number }[]; spikes: { x: number; y: number }[]; spawn: { x: number; y: number }; checkpoints: { x: number; y: number }[]; goal: { x: number; y: number }; platforms: { x: number; y: number }[] }

/** Convert the ASCII level into tile indices and object positions (world units, y up). */
function parseLevel(rows: string[]): Parsed {
  const height = rows.length, width = rows[0].length;
  for (const r of rows) if (r.length !== width) throw new Error(`Level row has ${r.length} columns, expected ${width}: ${r}`);
  const data = new Array<number>(width * height).fill(0);
  const out: Parsed = { width, height, data, coins: [], spikes: [], spawn: { x: 2, y: 3 }, checkpoints: [], goal: { x: 0, y: 0 }, platforms: [] };
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? '.' : rows[y][x]);
  const solid = (c: string) => c === '#' || c === 'S' || c === 'B' || c === 'I';
  // Tile centre in world units: column x → x + 0.5, row y → (height - y) - 0.5.
  const wx = (x: number) => x + 0.5, wy = (y: number) => height - y - 0.5;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = rows[y][x];
      if (c === '#') data[y * width + x] = solid(at(x, y - 1)) ? TILE.dirt : TILE.grass;
      else if (c === 'S') data[y * width + x] = TILE.stone;
      else if (c === 'B') data[y * width + x] = TILE.crate;
      else if (c === 'I') data[y * width + x] = TILE.ice;
      else if (c === 'o') out.coins.push({ x: wx(x), y: wy(y) });
      else if (c === '^') out.spikes.push({ x: wx(x), y: wy(y) });
      else if (c === 'P') out.spawn = { x: wx(x), y: wy(y) };
      else if (c === 'K') out.checkpoints.push({ x: wx(x), y: wy(y) + 0.5 });
      else if (c === 'F') out.goal = { x: wx(x), y: wy(y) + 0.5 };
      else if (c === 'M') out.platforms.push({ x: wx(x), y: wy(y) });
      else if (c !== '.') throw new Error(`Unknown level character "${c}" at ${x},${y}`);
    }
  }
  return out;
}

export function build(): DemoBundle {
  const L = parseLevel(LEVEL);
  const b = new SceneBuilder();
  const target = b.entity('Camera Target', {
    Transform: { position: { x: L.spawn.x, y: L.spawn.y, z: 0 } },
    Script: { script: 'MultiFollow', props: { tag: 'player' } },
  });
  b.entity('Camera', {
    Transform: { position: { x: L.spawn.x, y: L.spawn.y + 2, z: 0 } },
    Camera2D: { zoom: 1, follow: target, followSmoothing: 5, followOffset: v2(0, 2), bounds: { x: 0, y: 0, width: L.width, height: L.height + 2 }, backgroundColor: hex('#78b6ff') },
    AudioListener: {},
  });
  b.entity('GameManager', {
    Transform: {},
    Script: { script: 'GameManager', props: { respawnDelay: 1, restartDelay: 5 } },
    NetworkIdentity: { ownerId: 'host', authority: 'host', replicate: false },
  });
  b.entity('Spawn Point', { Transform: { position: { x: L.spawn.x, y: L.spawn.y, z: 0 } } });

  const far = b.entity('Mountains', { Transform: {}, Script: { script: 'Parallax', props: { factor: 0.85, factorY: 0.1, tileWidth: 32, baseY: 8 } } });
  for (let i = 0; i < 3; i++) b.entity(`Mountains ${i + 1}`, { Transform: { position: { x: (i - 1) * 32, y: 0, z: 0 } }, Sprite: { texture: 'mountains', width: 32, height: 10, layer: -30 } }, { parent: far });
  const near = b.entity('Hills', { Transform: {}, Script: { script: 'Parallax', props: { factor: 0.6, factorY: 0.25, tileWidth: 32, baseY: 4.5 } } });
  for (let i = 0; i < 3; i++) b.entity(`Hills ${i + 1}`, { Transform: { position: { x: (i - 1) * 32, y: 0, z: 0 } }, Sprite: { texture: 'hills', width: 32, height: 6.25, layer: -25 } }, { parent: near });

  b.entity('Level', {
    Transform: { position: { x: 0, y: L.height, z: 0 } },
    Tilemap: { tileset: 'tiles', tileWidth: 32, tileHeight: 32, columns: 5, width: L.width, height: L.height, tileSize: 1, data: L.data, layer: -10 },
    TilemapCollider2D: { friction: 0.7 },
  });
  const props = b.entity('Props', { Transform: {} });
  L.coins.forEach((c, i) => b.entity(`Coin ${i + 1}`, {
    Transform: { position: { x: c.x, y: c.y, z: 0 } },
    RigidBody2D: { bodyType: 'static' }, CircleCollider2D: { radius: 0.35, isTrigger: true },
    Sprite: { texture: 'coin', width: 0.6, height: 0.6, layer: 2 },
    ParticleEmitter: { emitting: false, rate: 0, maxParticles: 20, lifetime: 0.5, speed: 3, spread: Math.PI, gravity: v2(0, -4), startSize: 0.18, endSize: 0, startColor: hex('#ffd166'), endColor: hex('#ffd166', 0), blend: 'add' },
    Script: { script: 'Coin', props: {} },
  }, { tags: ['coin'], parent: props }));
  L.spikes.forEach((s, i) => b.entity(`Spike ${i + 1}`, {
    Transform: { position: { x: s.x, y: s.y, z: 0 } },
    RigidBody2D: { bodyType: 'static' }, BoxCollider2D: { width: 0.8, height: 0.5, offset: v2(0, -0.2), isTrigger: true },
    Sprite: { texture: 'spike', width: 1, height: 1, layer: 1 },
  }, { tags: ['hazard'], parent: props }));
  L.checkpoints.forEach((c, i) => b.entity(`Checkpoint ${i + 1}`, {
    Transform: { position: { x: c.x, y: c.y, z: 0 } },
    RigidBody2D: { bodyType: 'static' }, BoxCollider2D: { width: 0.8, height: 2, isTrigger: true },
    Sprite: { texture: 'checkpoint', width: 1, height: 2, layer: 0 },
    Script: { script: 'Checkpoint', props: {} },
  }, { tags: ['checkpoint'], parent: props }));
  b.entity('Goal Flag', {
    Transform: { position: { x: L.goal.x, y: L.goal.y, z: 0 } },
    RigidBody2D: { bodyType: 'static' }, BoxCollider2D: { width: 1, height: 2, isTrigger: true },
    Sprite: { texture: 'flag', width: 1, height: 2, layer: 0 },
    Script: { script: 'Goal', props: {} },
  }, { tags: ['goal'], parent: props });
  L.platforms.forEach((p, i) => {
    const cfg = PLATFORMS[i] ?? PLATFORMS[0];
    b.entity(`Moving Platform ${i + 1}`, {
      Transform: { position: { x: p.x, y: p.y, z: 0 } },
      RigidBody2D: { bodyType: 'kinematic', friction: 0.9 }, BoxCollider2D: { width: 3, height: 0.5 },
      Sprite: { texture: 'platform', width: 3, height: 0.5, layer: 1 },
      Script: { script: 'MovingPlatform', props: cfg },
    }, { parent: props });
  });
  b.entity('Title', {
    Transform: { position: { x: L.spawn.x + 4, y: L.spawn.y + 4.5, z: 0 } },
    Text: { text: 'Sky Hoppers', size: 0.9, bold: true, color: hex('#ffffff'), outlineWidth: 0.06, outline: hex('#1a2238') },
  });
  const scene = b.save('Level 1', { gravity: { x: 0, y: -32 } });

  const hopper = prefab('Hopper', (p) => {
    const root = p.entity('Hopper', {
      Transform: {},
      RigidBody2D: { fixedRotation: true, friction: 0.1, restitution: 0 },
      BoxCollider2D: { width: 0.7, height: 1 },
      CharacterController2D: { moveSpeed: 7.5, jumpSpeed: 14.5, coyoteTime: 0.12, jumpBufferTime: 0.12, fallGravityScale: 1.4 },
      Sprite: { texture: 'hopper', width: 0.9, height: 1.1, layer: 5 },
      ParticleEmitter: { emitting: false, rate: 0, maxParticles: 40, lifetime: 0.4, speed: 2.5, spread: Math.PI, gravity: v2(0, -6), startSize: 0.15, endSize: 0, startColor: hex('#ffffff', 0.8), endColor: hex('#ffffff', 0), blend: 'normal', layer: 4 },
      PlayerInput: { owner: 'local' },
      NetworkIdentity: { prefab: 'Hopper', authority: 'host' },
      NetTransform: { syncRotation: false },
      Script: { script: 'Player', props: {} },
    }, { tags: ['player'] });
    p.entity('Nameplate', { Transform: { position: { x: 0, y: 0.9, z: 0 } }, Text: { text: 'P1', size: 0.35, bold: true, outlineWidth: 0.04, layer: 6 } }, { parent: root });
    return root;
  });
  const coin = prefab('Coin', (p) => p.entity('Coin', {
    Transform: {},
    RigidBody2D: { bodyType: 'static' }, CircleCollider2D: { radius: 0.35, isTrigger: true },
    Sprite: { texture: 'coin', width: 0.6, height: 0.6, layer: 2 },
    ParticleEmitter: { emitting: false, rate: 0, maxParticles: 20, lifetime: 0.5, speed: 3, spread: Math.PI, gravity: v2(0, -4), startSize: 0.18, endSize: 0, startColor: hex('#ffd166'), endColor: hex('#ffd166', 0), blend: 'add' },
    NetworkIdentity: { prefab: 'Coin', authority: 'host' },
    Script: { script: 'Coin', props: {} },
  }, { tags: ['coin'] }));

  const project = makeProject({
    id: 'sky-hoppers',
    name: 'Sky Hoppers',
    description: 'Co-op platformer for 1-4 players: run and jump through a tilemap level with coins, spikes, moving platforms and shared checkpoints.',
    renderer: '2d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    prefabs: [hopper, coin],
    assets: [
      { id: 'tiles', kind: 'image', url: 'assets/tiles.svg' },
      { id: 'hopper', kind: 'image', url: 'assets/hopper.svg' },
      { id: 'coin', kind: 'image', url: 'assets/coin.svg' },
      { id: 'spike', kind: 'image', url: 'assets/spike.svg' },
      { id: 'flag', kind: 'image', url: 'assets/flag.svg' },
      { id: 'checkpoint', kind: 'image', url: 'assets/checkpoint.svg' },
      { id: 'platform', kind: 'image', url: 'assets/platform.svg' },
      { id: 'mountains', kind: 'image', url: 'assets/mountains.svg' },
      { id: 'hills', kind: 'image', url: 'assets/hills.svg' },
      { id: 'jump', kind: 'audio', url: 'assets/jump.wav' },
      { id: 'coin', kind: 'audio', url: 'assets/coin.wav' },
      { id: 'hit', kind: 'audio', url: 'assets/hit.wav' },
      { id: 'checkpoint', kind: 'audio', url: 'assets/checkpoint.wav' },
      { id: 'goal', kind: 'audio', url: 'assets/goal.wav' },
    ].map((a) => (a.kind === 'audio' && ['coin', 'checkpoint'].includes(a.id) ? { ...a, id: `sfx-${a.id}` } : a)),
    settings: {
      pixelsPerUnit: 32,
      physics: { gravity: { x: 0, y: -32 } },
      network: { mode: 'host-authoritative', maxPlayers: 4, tickRate: 20 },
      touchControls: true,
      touchButtons: ['jump'],
    },
  });
  // Audio ids that clash with image ids were prefixed; keep scripts in sync.
  for (const s of project.scripts) s.source = s.source.replace(/ctx\.audio\.play\('coin'/g, "ctx.audio.play('sfx-coin'").replace(/ctx\.audio\.play\('checkpoint'/g, "ctx.audio.play('sfx-checkpoint'");

  return {
    id: 'sky-hoppers',
    entry: {
      id: 'sky-hoppers', name: 'Sky Hoppers', title: 'Sky Hoppers',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '2d', multiplayer: true,
      players: { min: 1, max: 4 }, tags: ['platformer', 'co-op', 'tilemap'],
      controls: ['A/D: move', 'Space: jump'], featured: true,
    },
    project,
    files: {
      'assets/tiles.svg': TILESET_SVG,
      'assets/hopper.svg': HOPPER_SVG,
      'assets/coin.svg': COIN_SVG,
      'assets/spike.svg': SPIKE_SVG,
      'assets/flag.svg': FLAG_SVG,
      'assets/checkpoint.svg': CHECKPOINT_SVG,
      'assets/platform.svg': PLATFORM_SVG,
      'assets/mountains.svg': MOUNTAINS_SVG,
      'assets/hills.svg': HILLS_SVG,
      'assets/jump.wav': SFX.jump(),
      'assets/coin.wav': SFX.coin(),
      'assets/hit.wav': SFX.hit(),
      'assets/checkpoint.wav': SFX.checkpoint(),
      'assets/goal.wav': SFX.goal(),
      'thumbnail.svg': thumbnail(`
<polygon points="0,150 60,90 120,140 190,70 260,130 320,100 320,180 0,180" fill="#3a4a7a"/>
<rect x="0" y="140" width="320" height="40" fill="#4fbf5a"/><rect x="0" y="148" width="320" height="32" fill="#6b4a2e"/>
<rect x="90" y="100" width="64" height="12" rx="3" fill="#8f99b3"/>
<circle cx="200" cy="90" r="7" fill="#ffd166"/><circle cx="225" cy="80" r="7" fill="#ffd166"/><circle cx="250" cy="90" r="7" fill="#ffd166"/>
<ellipse cx="60" cy="122" rx="14" ry="16" fill="#4cc2ff"/><ellipse cx="110" cy="84" rx="14" ry="16" fill="#ff7a3d"/>
<rect x="290" y="80" width="3" height="60" fill="#d8dce8"/><polygon points="293,82 314,90 293,98" fill="#ef476f"/>
<text x="160" y="36" fill="#fff" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle" font-weight="700">Sky Hoppers</text>`, '#78b6ff', '#2b3560'),
      'README.md': README,
    },
  };
}

const README = `# Sky Hoppers

A cooperative platformer for 1-4 players. Run and jump across a tile-based
level, grab the coins, avoid the spikes, ride the moving platforms and reach
the flag. Checkpoints are shared: when any player touches one, everybody
respawns there.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | A / D or arrows | left stick / d-pad | joystick |
| Jump | Space / W / up | A | **jump** button |

Hold jump for a higher jump; release early for a short hop (variable jump
height, coyote time and jump buffering come from \`CharacterController2D\`).

## How it is built

- **Level**: one \`Tilemap\` (\`assets/tiles.svg\` is a 5-tile strip) with a
  \`TilemapCollider2D\`. The map is authored as ASCII art in
  \`demos/src/sky-hoppers/index.ts\`; \`#\` becomes dirt (grass where air is
  above), \`S\` stone, \`o\` coins, \`^\` spikes, \`K\` checkpoints, \`F\` the flag
  and \`M\` moving platforms. Edit the strings and rebuild, or paint tiles in
  the editor.
- **Camera**: \`Camera2D.follow\` targets an invisible *Camera Target* entity
  whose \`MultiFollow\` script sits at the average position of every living
  player. \`bounds\` keeps the camera inside the level.
- **Parallax**: two \`Parallax\` roots (mountains, hills) each with three
  child sprites; the root moves at a fraction of the camera speed and
  re-tiles its children around the camera.
- **Moving platforms**: kinematic \`RigidBody2D\` driven by \`MovingPlatform\`
  (sets velocity each fixed step). The \`Player\` script carries riders by
  translating them with the platform velocity when standing on it.
- **Triggers by tag**: coins, spikes (\`hazard\`), checkpoints and the goal are
  static bodies with trigger colliders. \`Player.onTriggerEnter\` looks at the
  other entity's \`Tag\` and sends messages; the \`GameManager\` owns the
  shared state (coin count, checkpoint, level complete, restart).
- **Multiplayer**: the \`GameManager\` spawns one \`Hopper\` prefab per peer on
  the host (\`playerJoined\` / \`playerLeft\`), players move through
  \`onOwnerInput\`, deaths and pickups are decided on the host.

## Ideas to extend it

1. Add a second scene ("Level 2") and switch with \`ctx.engine.loadScene\` when the flag is reached.
2. Give the hopper an \`AnimatedSprite\` atlas with idle/run/jump frames.
3. Add enemies: a patrolling prefab that flips direction at edges (raycast down with \`ctx.physics.raycast\`).
4. Wall jumps: check \`rb.contacts\` for a side normal and allow \`cc.jump()\` with a horizontal kick.
5. A co-op tally: count coins per player (the \`coinCollected\` message carries \`by\`) and show a mini scoreboard.
`;
