import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX } from '../../../scripts/lib/wav';
import { type DemoBundle, SceneBuilder, hex, loadScripts, makeProject, thumbnail, v2 } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));
const W = 24, H = 14, GOAL = 5, WALL = 0.5;
const BLUE = '#4cc2ff', ORANGE = '#ff7a3d';

export function build(): DemoBundle {
  const b = new SceneBuilder();
  b.entity('Camera', {
    Transform: {},
    Camera2D: { backgroundColor: hex('#0f1320'), shakeDecay: 8, ambientLight: hex('#c4c8da') },
    AudioListener: {},
    Script: { script: 'TableCamera', props: { width: W + 3, height: H + 3 } },
  });
  b.entity('GameManager', {
    Transform: {},
    Script: { script: 'GameManager', props: { scoreToWin: 7, serveDelay: 1.2, teamMode: true, aiWhenAlone: true } },
    NetworkIdentity: { ownerId: 'host', authority: 'host', replicate: false },
  });
  // Table art.
  const table = b.entity('Table', { Transform: {} });
  b.entity('Felt', { Transform: {}, Shape: { kind: 'rect', width: W, height: H, fill: hex('#1d2a4a'), layer: -20 } }, { parent: table });
  b.entity('Center Line', { Transform: {}, Shape: { kind: 'rect', width: 0.08, height: H, fill: hex('#ffffff', 0.25), layer: -19 } }, { parent: table });
  b.entity('Center Circle', { Transform: {}, Shape: { kind: 'circle', radius: 2.2, filled: false, stroke: hex('#ffffff', 0.25), strokeWidth: 0.08, layer: -19 } }, { parent: table });
  b.entity('Blue Crease', { Transform: { position: { x: -W / 2, y: 0, z: 0 } }, Shape: { kind: 'circle', radius: GOAL / 2 + 1, filled: false, stroke: hex(BLUE, 0.35), strokeWidth: 0.08, layer: -19 } }, { parent: table });
  b.entity('Orange Crease', { Transform: { position: { x: W / 2, y: 0, z: 0 } }, Shape: { kind: 'circle', radius: GOAL / 2 + 1, filled: false, stroke: hex(ORANGE, 0.35), strokeWidth: 0.08, layer: -19 } }, { parent: table });
  b.entity('Blue Goal Mouth', { Transform: { position: { x: -W / 2 - 0.35, y: 0, z: 0 } }, Shape: { kind: 'rect', width: 0.7, height: GOAL, fill: hex(BLUE, 0.35), layer: -18 } }, { parent: table });
  b.entity('Orange Goal Mouth', { Transform: { position: { x: W / 2 + 0.35, y: 0, z: 0 } }, Shape: { kind: 'rect', width: 0.7, height: GOAL, fill: hex(ORANGE, 0.35), layer: -18 } }, { parent: table });

  // Walls: top, bottom and the two segments beside each goal mouth.
  const walls = b.entity('Walls', { Transform: {} });
  const wall = (name: string, x: number, y: number, w: number, h: number) => b.entity(name, {
    Transform: { position: { x, y, z: 0 } },
    RigidBody2D: { bodyType: 'static', restitution: 1, friction: 0 },
    BoxCollider2D: { width: w, height: h },
    Shape: { kind: 'rect', width: w, height: h, fill: hex('#5b6b9a'), layer: -10 },
  }, { parent: walls });
  wall('Wall Top', 0, H / 2 + WALL / 2, W + WALL * 2, WALL);
  wall('Wall Bottom', 0, -H / 2 - WALL / 2, W + WALL * 2, WALL);
  const side = (H - GOAL) / 2;
  wall('Wall Left Upper', -W / 2 - WALL / 2, GOAL / 2 + side / 2, WALL, side);
  wall('Wall Left Lower', -W / 2 - WALL / 2, -GOAL / 2 - side / 2, WALL, side);
  wall('Wall Right Upper', W / 2 + WALL / 2, GOAL / 2 + side / 2, WALL, side);
  wall('Wall Right Lower', W / 2 + WALL / 2, -GOAL / 2 - side / 2, WALL, side);
  // Backstops behind the goals so the puck never escapes.
  wall('Backstop Left', -W / 2 - 1.6, 0, WALL, GOAL + 1);
  wall('Backstop Right', W / 2 + 1.6, 0, WALL, GOAL + 1);

  const goal = (name: string, x: number, sideName: 'left' | 'right') => b.entity(name, {
    Transform: { position: { x, y: 0, z: 0 } },
    RigidBody2D: { bodyType: 'static' },
    BoxCollider2D: { width: 0.8, height: GOAL, isTrigger: true },
    Script: { script: 'Goal', props: { side: sideName } },
  }, { parent: walls });
  goal('Goal Left', -W / 2 - 0.9, 'left');
  goal('Goal Right', W / 2 + 0.9, 'right');

  const paddle = (name: string, x: number, sideName: 'left' | 'right', color: string) => b.entity(name, {
    Transform: { position: { x, y: 0, z: 0 } },
    RigidBody2D: { bodyType: 'kinematic', restitution: 0.9, friction: 0.05 },
    CircleCollider2D: { radius: 0.75 },
    Shape: { kind: 'circle', radius: 0.75, fill: hex(color), stroke: hex('#ffffff', 0.7), strokeWidth: 0.08, layer: 5 },
    Light2D: { radius: 4, intensity: 0.8, color: hex(color) },
    PlayerInput: { owner: sideName === 'left' ? 'local' : 'ai', coOwners: [], mergeStrategy: 'average' },
    NetworkIdentity: { ownerId: 'host', authority: 'host', prefab: '' },
    NetTransform: { syncRotation: false },
    Script: { script: 'Paddle', props: { side: sideName, ai: sideName === 'right', tableWidth: W, tableHeight: H } },
  }, { tags: ['paddle'] });
  const left = paddle('Paddle Left', -W / 2 + 3, 'left', BLUE);
  const right = paddle('Paddle Right', W / 2 - 3, 'right', ORANGE);
  b.entity('Handle', { Transform: {}, Shape: { kind: 'circle', radius: 0.32, fill: hex('#dff4ff'), layer: 6 } }, { parent: left });
  b.entity('Handle', { Transform: {}, Shape: { kind: 'circle', radius: 0.32, fill: hex('#ffe3d1'), layer: 6 } }, { parent: right });

  b.entity('Puck', {
    Transform: {},
    RigidBody2D: { restitution: 1, friction: 0, linearDamping: 0.12, angularDamping: 0.2, bullet: true, mass: 0.4 },
    CircleCollider2D: { radius: 0.42 },
    Shape: { kind: 'circle', radius: 0.42, fill: hex('#f4f7ff'), stroke: hex('#9aa5c0'), strokeWidth: 0.06, layer: 4 },
    Light2D: { radius: 3, intensity: 0.7, color: hex('#ffffff') },
    ParticleEmitter: { emitting: false, rate: 60, maxParticles: 80, lifetime: 0.35, speed: 0.2, spread: Math.PI, gravity: v2(0, 0), startSize: 0.5, endSize: 0.05, startColor: hex('#ffffff', 0.5), endColor: hex('#4cc2ff', 0), blend: 'add', layer: 3 },
    NetworkIdentity: { ownerId: 'host', authority: 'host' },
    NetTransform: { syncRotation: false, interpolationDelay: 1 },
    Script: { script: 'Puck', props: {} },
  });
  const scene = b.save('Table', { gravity: { x: 0, y: 0 }, seed: 99 });

  const project = makeProject({
    id: 'paddle-rush',
    name: 'Paddle Rush',
    description: 'Air hockey with an AI opponent when you are alone. In team mode everyone on a side steers the same paddle: inputs are averaged in real time.',
    renderer: '2d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    assets: [
      { id: 'bounce', kind: 'audio', url: 'assets/bounce.wav' },
      { id: 'goal', kind: 'audio', url: 'assets/goal.wav' },
    ],
    settings: {
      pixelsPerUnit: 32,
      physics: { gravity: { x: 0, y: 0 } },
      network: { mode: 'host-authoritative', maxPlayers: 8, tickRate: 30 },
      multiUser: { sharedControl: true, mergeStrategy: 'average' },
      touchControls: true,
      touchButtons: [],
    },
  });

  return {
    id: 'paddle-rush',
    entry: {
      id: 'paddle-rush', name: 'Paddle Rush', title: 'Paddle Rush',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '2d', multiplayer: true,
      players: { min: 1, max: 8 }, tags: ['sports', 'shared-control', 'ai'],
      controls: ['WASD / arrows: move paddle'], featured: true,
    },
    project,
    files: {
      'assets/bounce.wav': SFX.bounce(),
      'assets/goal.wav': SFX.goal(),
      'thumbnail.svg': thumbnail(`
<rect x="20" y="30" width="280" height="120" rx="6" fill="#1d2a4a" stroke="#5b6b9a" stroke-width="6"/>
<line x1="160" y1="30" x2="160" y2="150" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
<circle cx="160" cy="90" r="24" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
<circle cx="70" cy="80" r="16" fill="${BLUE}" stroke="#fff" stroke-width="2"/><circle cx="70" cy="80" r="6" fill="#dff4ff"/>
<circle cx="250" cy="105" r="16" fill="${ORANGE}" stroke="#fff" stroke-width="2"/><circle cx="250" cy="105" r="6" fill="#ffe3d1"/>
<circle cx="150" cy="70" r="8" fill="#f4f7ff"/><line x1="120" y1="80" x2="145" y2="72" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>
<text x="160" y="170" fill="#fff" font-family="system-ui,sans-serif" font-size="14" text-anchor="middle" font-weight="700">Paddle Rush</text>`, '#0f1320', '#1a2140'),
      'README.md': README,
    },
  };
}

const README = `# Paddle Rush

Air hockey. Slide your mallet, smack the puck into the other goal, first to 7
wins. Alone, you play against an AI paddle. In a room, the paddles are
handed to the players, and in **team mode** every player on a side steers
the *same* paddle at once.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move paddle | WASD or arrows | left stick | joystick |

## Shared control (the multi-user showcase)

Forge can give several users control of one entity. This project turns the
feature on and uses it for teams:

- \`settings.multiUser.sharedControl\` is \`true\` and \`mergeStrategy\` is
  \`"average"\` (project defaults for shared entities).
- Each paddle has a \`PlayerInput\` whose \`owner\` is the first team member and
  whose \`coOwners\` are the rest, plus \`mergeStrategy: "average"\`. The
  \`NetworkIdentity.sharedWith\` list mirrors the co-owners.
- Every fixed step the host merges the latest snapshot from all controlling
  peers with \`mergeSnapshots\`: buttons are OR-ed, axes are averaged. Two
  team-mates pushing opposite ways cancel out; pushing together moves at
  full speed. Change the strategy to \`"additive"\` for "more hands = faster"
  or \`"first-wins"\` to let the first mover steer.
- The \`Paddle\` script does not know or care how many people control it: it
  just reads one snapshot in \`onOwnerInput\`.

The \`GameManager\` owns the team lists. Its \`teamMode\` prop toggles the
behaviour: **on**, players alternate between the blue and orange teams as
they join (\`assign\`) and \`refreshControllers\` writes \`owner\`/\`coOwners\` and
calls \`sync.shareControl(entity, peer, true)\`; **off**, the first two
players get one paddle each and later joiners spectate. A paddle with no
humans switches to AI (\`aiWhenAlone\`).

## How it is built

| Entity | Components | Notes |
| --- | --- | --- |
| Paddle Left / Right | kinematic \`RigidBody2D\`, \`CircleCollider2D\`, \`Shape\`, \`Light2D\`, \`PlayerInput\`, \`NetworkIdentity\`, \`NetTransform\`, \`Script\` (\`Paddle\`) | Moved by setting velocity, so the puck inherits momentum; clamped to its own half |
| Puck | dynamic \`RigidBody2D\` (restitution 1, \`bullet\`), \`CircleCollider2D\`, trail \`ParticleEmitter\`, \`Script\` (\`Puck\`) | Speed clamped between \`minSpeed\` and \`maxSpeed\` |
| Walls | static bodies with restitution 1 | Two segments per side leave the goal mouth open |
| Goal Left / Right | static trigger \`BoxCollider2D\`, \`Script\` (\`Goal\`) | Sends a \`goal\` message with its side |
| GameManager | \`Script\` | Teams, serving, score, HUD |

## Ideas to extend it

1. Power shots: hold \`fire\` to charge, then multiply the paddle's velocity on release.
2. Obstacles: static bumpers in the middle of the table with high restitution.
3. Best-of-three sets with a scoreboard panel between sets.
4. Try \`mergeStrategy: "first-wins"\` for a "hot seat" feel, or \`"additive"\` for chaos.
5. Replace the AI with a second local player by binding a second key set (e.g. IJKL) to \`moveX2\`/\`moveY2\` axes and a second \`PlayerInput\` owner.
`;
