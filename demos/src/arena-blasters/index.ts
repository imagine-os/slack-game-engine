import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Random } from '../../../src/index';
import { SFX } from '../../../scripts/lib/wav';
import { type DemoBundle, SceneBuilder, hex, loadScripts, makeProject, prefab, svg, thumbnail, v2 } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));
const ARENA_W = 32, ARENA_H = 18;

/** White ship silhouette: the Sprite tint gives each player a colour. */
const SHIP_SVG = svg(64, 64, `
<polygon points="32,4 50,52 32,42 14,52" fill="#f4f7ff"/>
<polygon points="32,12 42,46 32,40 22,46" fill="#c9d3e6"/>
<polygon points="32,4 36,26 28,26" fill="#ffffff"/>
<rect x="28" y="46" width="8" height="8" rx="2" fill="#8892a8"/>`);

function starfield(): string {
  const rng = new Random(7);
  const stars: string[] = [];
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, 1024).toFixed(1), y = rng.range(0, 576).toFixed(1);
    const r = rng.range(0.6, 2.2).toFixed(2), a = rng.range(0.25, 0.9).toFixed(2);
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#dfe8ff" opacity="${a}"/>`);
  }
  for (let i = 0; i < 6; i++) {
    const x = rng.range(0, 1024).toFixed(0), y = rng.range(0, 576).toFixed(0), r = rng.range(60, 140).toFixed(0);
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#5a6cff" opacity="0.06"/>`);
  }
  return svg(1024, 576, `<rect width="1024" height="576" fill="#0a0d18"/>\n${stars.join('\n')}`);
}

export function build(): DemoBundle {
  const b = new SceneBuilder();
  b.entity('Camera', {
    Transform: {},
    Camera2D: { zoom: 1, backgroundColor: hex('#0a0d18'), ambientLight: hex('#b8bdd0'), shakeDecay: 6 },
    AudioListener: {},
    Script: { script: 'ArenaCamera', props: { margin: 0.5 } },
  });
  b.entity('GameManager', {
    Transform: {},
    Script: { script: 'GameManager', props: { arenaWidth: ARENA_W, arenaHeight: ARENA_H, asteroids: 5, respawnDelay: 2, scoreToWin: 15 } },
    NetworkIdentity: { ownerId: 'host', authority: 'host', replicate: false },
  });
  b.entity('Starfield', {
    Transform: { position: { x: 0, y: 0, z: 0 } },
    Sprite: { texture: 'stars', width: ARENA_W, height: ARENA_H, layer: -20 },
  });
  b.entity('Arena Border', {
    Transform: {},
    Shape: { kind: 'rect', width: ARENA_W, height: ARENA_H, filled: false, stroke: hex('#3a4a7a'), strokeWidth: 0.12, layer: -15 },
  });
  const scene = b.save('Arena', { gravity: { x: 0, y: 0 }, seed: 1234 });

  const ship = prefab('Ship', (p) => {
    const root = p.entity('Ship', {
      Transform: {},
      RigidBody2D: { fixedRotation: true, linearDamping: 0.9, friction: 0.1, restitution: 0.6, mass: 1, layer: 0 },
      CircleCollider2D: { radius: 0.5 },
      Sprite: { texture: 'ship', width: 1.3, height: 1.3, layer: 5 },
      PlayerInput: { owner: 'local' },
      NetworkIdentity: { prefab: 'Ship', authority: 'host' },
      NetTransform: { syncRotation: true },
      Script: { script: 'Ship', props: {} },
      ParticleEmitter: {
        emitting: false, rate: 90, maxParticles: 120, lifetime: 0.35, lifetimeVariation: 0.1, speed: 5, speedVariation: 1.5,
        angle: -Math.PI / 2, spread: 0.35, gravity: v2(0, 0), startSize: 0.28, endSize: 0.02, blend: 'add', layer: 4,
        startColor: hex('#4cc2ff'), endColor: hex('#ffffff', 0),
      },
      Light2D: { radius: 4, intensity: 0.9, color: hex('#4cc2ff') },
    }, { tags: ['ship'] });
    p.entity('Nameplate', {
      Transform: { position: { x: 0, y: -1.1, z: 0 } },
      Text: { text: 'P1', size: 0.42, bold: true, outlineWidth: 0.05, layer: 6 },
    }, { parent: root });
    return root;
  });
  const bullet = prefab('Bullet', (p) => p.entity('Bullet', {
    Transform: {},
    RigidBody2D: { gravityScale: 0, bullet: true, mass: 0.05, layer: 1, angularDamping: 0 },
    CircleCollider2D: { radius: 0.14, isTrigger: true },
    Shape: { kind: 'circle', radius: 0.14, fill: hex('#ffd166'), layer: 6 },
    Light2D: { radius: 1.6, intensity: 0.8, color: hex('#ffd166') },
    NetworkIdentity: { prefab: 'Bullet', authority: 'host' },
    NetTransform: { syncRotation: false, interpolationDelay: 1 },
    Script: { script: 'Bullet', props: {} },
  }, { tags: ['bullet'] }));
  const asteroid = prefab('Asteroid', (p) => p.entity('Asteroid', {
    Transform: {},
    RigidBody2D: { gravityScale: 0, restitution: 0.9, friction: 0, angularDamping: 0, layer: 2 },
    CircleCollider2D: { radius: 1.2 },
    Shape: { kind: 'polygon', points: [-1, -1, 1, -1, 1, 1, -1, 1], fill: hex('#8a8580'), stroke: hex('#2a2825'), strokeWidth: 0.08, layer: 2 },
    NetworkIdentity: { prefab: 'Asteroid', authority: 'host' },
    NetTransform: {},
    Script: { script: 'Asteroid', props: { size: 3, seed: 1 } },
  }, { tags: ['asteroid'] }));
  const explosion = prefab('Explosion', (p) => p.entity('Explosion', {
    Transform: {},
    ParticleEmitter: {
      emitting: false, rate: 0, maxParticles: 200, lifetime: 0.7, lifetimeVariation: 0.3, speed: 6, speedVariation: 3,
      spread: Math.PI, gravity: v2(0, 0), startSize: 0.3, endSize: 0, sizeVariation: 0.1, blend: 'add', layer: 8, drag: 2,
    },
    Light2D: { radius: 5, intensity: 2 },
    NetworkIdentity: { prefab: 'Explosion', authority: 'host' },
    Script: { script: 'Explosion', props: {} },
  }));

  const project = makeProject({
    id: 'arena-blasters',
    name: 'Arena Blasters',
    description: 'Top-down arena shooter for 1-8 players: thrust, turn, blast asteroids and each other, first to 15 points wins.',
    renderer: '2d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    prefabs: [ship, bullet, asteroid, explosion],
    assets: [
      { id: 'ship', kind: 'image', url: 'assets/ship.svg' },
      { id: 'stars', kind: 'image', url: 'assets/stars.svg' },
      { id: 'laser', kind: 'audio', url: 'assets/laser.wav' },
      { id: 'explosion', kind: 'audio', url: 'assets/explosion.wav' },
      { id: 'hit', kind: 'audio', url: 'assets/hit.wav' },
    ],
    settings: {
      pixelsPerUnit: 32,
      physics: { gravity: { x: 0, y: 0 } },
      network: { mode: 'host-authoritative', maxPlayers: 8, tickRate: 20 },
      touchControls: true,
      touchButtons: ['fire'],
    },
  });

  return {
    id: 'arena-blasters',
    entry: {
      id: 'arena-blasters', name: 'Arena Blasters', title: 'Arena Blasters',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '2d', multiplayer: true,
      players: { min: 1, max: 8 }, tags: ['shooter', 'physics', 'particles', 'audio'],
      controls: ['A/D: turn', 'W: thrust', 'J / click: fire'], featured: true,
    },
    project,
    files: {
      'assets/ship.svg': SHIP_SVG,
      'assets/stars.svg': starfield(),
      'assets/laser.wav': SFX.laser(),
      'assets/explosion.wav': SFX.explosion(),
      'assets/hit.wav': SFX.hit(),
      'thumbnail.svg': thumbnail(`
<circle cx="40" cy="30" r="1.5" fill="#fff" opacity=".7"/><circle cx="280" cy="50" r="1" fill="#fff" opacity=".6"/><circle cx="120" cy="150" r="1.2" fill="#fff" opacity=".5"/><circle cx="220" cy="120" r="1.8" fill="#fff" opacity=".8"/><circle cx="70" cy="110" r="1" fill="#fff" opacity=".6"/>
<polygon points="80,60 60,110 80,100 100,110" fill="#4cc2ff" transform="rotate(-30 80 85)"/>
<polygon points="240,110 220,160 240,150 260,160" fill="#ff7a3d" transform="rotate(150 240 135)"/>
<polygon points="150,40 185,30 205,60 195,95 160,100 135,70" fill="#8a8580" stroke="#2a2825" stroke-width="3"/>
<circle cx="120" cy="75" r="3" fill="#ffd166"/><circle cx="135" cy="70" r="3" fill="#ffd166"/>
<text x="160" y="168" fill="#fff" font-family="system-ui,sans-serif" font-size="16" text-anchor="middle" font-weight="700">Arena Blasters</text>`, '#0a0d18', '#1a2140'),
      'README.md': README,
    },
  };
}

const README = `# Arena Blasters

A top-down arena shooter for 1-8 players. Thrust and turn your ship, blast
the drifting asteroids (they split!) and the other ships. Everything wraps
around the arena edges. First to 15 points wins the round.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Turn | A / D or arrows | left stick | joystick |
| Thrust / brake | W / S | left stick | joystick |
| Fire | J or left click | X / RT | **fire** button |

Set the \`controlMode\` prop of the Ship prefab to \`twin-stick\` to steer with
the stick direction instead of rotating.

## Scoring

- Destroying an asteroid: +1 (per rock, so a large one is worth up to 7).
- Destroying a ship: +5. Ships have 3 hit points and respawn after 2 seconds
  with a brief invulnerability flash.

## How it is built

**Scene**: a fixed camera (\`ArenaCamera\` fits the zoom to the arena), a
starfield sprite, a border shape and the \`GameManager\`.

**Prefabs** (spawnable from scripts and replicated in multiplayer):

| Prefab | Key components | Script |
| --- | --- | --- |
| Ship | \`RigidBody2D\` (fixed rotation, damping), \`CircleCollider2D\`, \`Sprite\` (tinted per player), \`ParticleEmitter\` (thruster), \`Light2D\`, \`PlayerInput\`, \`NetworkIdentity\`, \`NetTransform\` | \`Ship\` |
| Bullet | trigger \`CircleCollider2D\`, \`Shape\`, \`Light2D\` | \`Bullet\` |
| Asteroid | \`RigidBody2D\`, \`CircleCollider2D\`, polygon \`Shape\` generated from a seed | \`Asteroid\` |
| Explosion | \`ParticleEmitter\` burst + \`Light2D\` flash, self-destructs | \`Explosion\` |

**Multiplayer flow** (host-authoritative). \`GameManager.onStart\` spawns a
Ship for the local peer, then for every peer already in the room, and
listens to \`playerJoined\` / \`playerLeft\` on \`ctx.net.hub.sync\` to spawn and
despawn ships. Each Ship has a \`PlayerInput\` whose \`owner\` is the peer id;
the \`Ship\` script reads the merged snapshot in \`onOwnerInput\`, so local and
remote ships run identical code. Hits are resolved only on the host
(\`ctx.net.isHost\`) and delivered as \`hit\` messages; offline the local peer
is the host, so nothing changes for single-player.

**Passing data to spawned prefabs**: scripts on a freshly spawned entity have
not started yet, so instead of sending a message the spawner writes into the
entity's \`Script.props\` (\`script.props.color = ...\`) and the target reads
them in \`onStart\`.

**Sound**: three tiny WAV files generated procedurally by
\`scripts/lib/wav.ts\`, played with \`ctx.audio.play(id, { pitchVariation })\`.

## Ideas to extend it

1. Power-ups: spawn a \`PowerUp\` prefab (trigger collider) that raises \`fireInterval\` or adds a shield prop.
2. Team mode: colour ships by team in \`GameManager.addPlayer\` and ignore friendly fire in \`Bullet.onTriggerEnter\`.
3. Homing missiles: a second projectile prefab that steers toward the nearest \`ship\` tag each \`onFixedUpdate\`.
4. A shrinking arena: lower \`arenaWidth\`/\`arenaHeight\` over time and push ships inward.
5. Persistent leaderboard: keep scores across rounds and show a podium panel with \`ctx.engine.hud.panel\`.
`;
