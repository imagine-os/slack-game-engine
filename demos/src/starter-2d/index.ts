import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DemoBundle, SceneBuilder, hex, loadScripts, makeProject, svg, thumbnail, v2 } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));

const PLAYER_SVG = svg(32, 48, `
<rect x="4" y="6" width="24" height="38" rx="7" fill="#4cc2ff"/>
<rect x="8" y="2" width="16" height="12" rx="4" fill="#dff4ff"/>
<circle cx="19" cy="8" r="2" fill="#14203a"/>
<rect x="6" y="40" width="8" height="6" rx="2" fill="#1c5c86"/>
<rect x="18" y="40" width="8" height="6" rx="2" fill="#1c5c86"/>`);

export function build(): DemoBundle {
  const b = new SceneBuilder();
  const camera = b.entity('Camera', {
    Transform: { position: { x: 0, y: 2, z: 0 } },
    Camera2D: { zoom: 0.9, followSmoothing: 6, followOffset: v2(0, 1.5), backgroundColor: hex('#12172a'), bounds: { x: -14, y: -6, width: 28, height: 20 } },
    AudioListener: {},
  });
  b.entity('Ground', {
    Transform: { position: { x: 0, y: -1, z: 0 } },
    RigidBody2D: { bodyType: 'static', friction: 0.8 },
    BoxCollider2D: { width: 28, height: 2 },
    Shape: { kind: 'rect', width: 28, height: 2, fill: hex('#2a3350'), layer: -5 },
  });
  const platforms = [[-6, 1.5, 4], [0, 3, 3], [6, 1.5, 4]];
  platforms.forEach(([x, y, w], i) => b.entity(`Platform ${i + 1}`, {
    Transform: { position: { x, y, z: 0 } },
    RigidBody2D: { bodyType: 'static', friction: 0.8 },
    BoxCollider2D: { width: w, height: 0.5 },
    Shape: { kind: 'rect', width: w, height: 0.5, fill: hex('#3f4b78'), layer: -4 },
  }));
  const player = b.entity('Player', {
    Transform: { position: { x: -4, y: 1, z: 0 } },
    RigidBody2D: { fixedRotation: true, friction: 0.2, restitution: 0 },
    BoxCollider2D: { width: 0.8, height: 1.4 },
    CharacterController2D: {},
    Sprite: { texture: 'player', width: 1, height: 1.5, layer: 1 },
    PlayerInput: { owner: 'local' },
    Script: { script: 'PlayerController', props: { speed: 7, jump: 12 } },
  }, { tags: ['player'] });
  b.apply(camera, 'Camera2D', { follow: player });
  b.entity('Title', {
    Transform: { position: { x: 0, y: 6.5, z: 0 } },
    Text: { text: 'Starter 2D · A/D or arrows to move, Space to jump', size: 0.55, color: hex('#ffffff', 0.9), outlineWidth: 0.04 },
  });
  const scene = b.save('Main', { gravity: { x: 0, y: -24 } });

  const project = makeProject({
    id: 'starter-2d',
    name: 'Starter 2D',
    description: 'A player, a few platforms and a following camera. The blank canvas for a new 2D game.',
    renderer: '2d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    assets: [{ id: 'player', kind: 'image', url: 'assets/player.svg' }],
    settings: { pixelsPerUnit: 40, physics: { gravity: { x: 0, y: -24 } }, touchButtons: ['jump'] },
  });

  return {
    id: 'starter-2d',
    entry: {
      id: 'starter-2d', name: 'Starter 2D', title: 'Starter 2D',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '2d', multiplayer: false,
      players: { min: 1, max: 1 }, tags: ['template', 'platformer'], controls: ['A/D or arrows: move', 'Space: jump'], featured: false, template: true,
    },
    project,
    files: {
      'assets/player.svg': PLAYER_SVG,
      'thumbnail.svg': thumbnail(`
<rect x="0" y="140" width="320" height="40" fill="#2a3350"/>
<rect x="40" y="100" width="70" height="10" rx="2" fill="#3f4b78"/>
<rect x="150" y="70" width="60" height="10" rx="2" fill="#3f4b78"/>
<rect x="230" y="100" width="70" height="10" rx="2" fill="#3f4b78"/>
<rect x="60" y="106" width="22" height="34" rx="6" fill="#4cc2ff"/>
<text x="160" y="40" fill="#fff" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle" font-weight="700">Starter 2D</text>`),
      'README.md': README,
    },
  };
}

const README = `# Starter 2D

The smallest useful 2D project: a player with a \`CharacterController2D\`, a
few static platforms, a camera that follows the player and one script.
"New project" in the editor starts from this template.

## Controls

- **A / D** or **arrow keys**: move
- **Space**: jump (hold for a higher jump, release early for a short hop)
- Touch: virtual joystick and a **jump** button

## How it is built

| Entity | Components | Notes |
| --- | --- | --- |
| Camera | \`Camera2D\`, \`AudioListener\` | \`follow\` points at the player, \`bounds\` stop it leaving the level |
| Ground / Platforms | \`RigidBody2D\` (static), \`BoxCollider2D\`, \`Shape\` | Static geometry drawn with vector shapes |
| Player | \`RigidBody2D\`, \`BoxCollider2D\`, \`CharacterController2D\`, \`Sprite\`, \`PlayerInput\`, \`Script\` | The \`PlayerController\` script feeds the controller from \`onOwnerInput\` |

The only script, \`PlayerController\`, shows the idiomatic input pattern:
read the merged snapshot in \`onOwnerInput\` (works offline and in a room),
call \`cc.move()\` / \`cc.jump()\`, and respawn when falling off the map.

## Ideas to extend it

1. Add a \`Tilemap\` + \`TilemapCollider2D\` and paint a level instead of using boxes.
2. Give the player an \`AnimatedSprite\` with an atlas of run/jump frames.
3. Add a coin prefab with a trigger collider and a score label in \`ctx.engine.hud\`.
4. Add a \`ParticleEmitter\` that bursts when the player lands (\`onCollisionEnter\`).
5. Set \`settings.network.mode\` to \`host-authoritative\` and spawn one player prefab per peer (see the Sky Hoppers demo).
`;
