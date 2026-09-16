import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX } from '../../../scripts/lib/wav';
import { type DemoBundle, type RGBA, SceneBuilder, euler, hex, loadScripts, makeProject, prefab, thumbnail } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));

// Track: a rectangular ring in the XZ plane. Outer 70x44, inner 42x16 → 14 wide lanes.
const OUTER_W = 70, OUTER_D = 44, INNER_W = 42, INNER_D = 16, WALL_H = 1.4, WALL_T = 1;
const LANE = (OUTER_W - INNER_W) / 2; // 14
const MID_X = INNER_W / 2 + LANE / 2;  // 28: centre line of the left/right straights
const MID_Z = INNER_D / 2 + LANE / 2;  // 15: centre line of the top/bottom straights

export function build(): DemoBundle {
  const b = new SceneBuilder();
  b.entity('Camera', {
    Transform: { position: { x: MID_X, y: 6, z: 20 } },
    Camera3D: { fov: 60, fogEnabled: true, fogNear: 60, fogFar: 160, fogColor: hex('#c9d6e8'), skyTop: hex('#3a6fd8'), skyBottom: hex('#dbe6f5'), far: 400 },
    Script: { script: 'ChaseCamera', props: { distance: 9, height: 4.5, lookAhead: 6, smoothing: 5 } },
    AudioListener: {},
  });
  b.entity('GameManager', {
    Transform: {},
    Script: { script: 'GameManager', props: { laps: 3, countdown: 3, gridX: MID_X, gridZ: 4, heading: Math.PI } },
    NetworkIdentity: { ownerId: 'host', authority: 'host', replicate: false },
  });
  b.entity('Sun', { Transform: { position: { x: 20, y: 40, z: 10 }, rotation: euler(-1.0, 0.5, 0) }, Light: { kind: 'directional', intensity: 1.15, color: hex('#fff4e0') } });
  b.entity('Ambient', { Transform: {}, Light: { kind: 'ambient', intensity: 0.35, color: hex('#9fb4ff') } });
  b.entity('Ground', { Transform: { scale: { x: 200, y: 1, z: 200 } }, MeshRenderer: { mesh: 'plane', color: hex('#4f7a48'), roughness: 1 } });
  b.entity('Ground Collider', {
    Transform: { position: { x: 0, y: -0.5, z: 0 }, scale: { x: 200, y: 1, z: 200 } },
    RigidBody3D: { bodyType: 'static', friction: 0 },
    BoxCollider3D: { size: { x: 1, y: 1, z: 1 } },
  });

  // Track surface: four overlapping slabs.
  const track = b.entity('Track', { Transform: {} });
  const slab = (name: string, x: number, z: number, w: number, d: number) => b.entity(name, {
    Transform: { position: { x, y: 0.02, z }, scale: { x: w, y: 0.04, z: d } },
    MeshRenderer: { mesh: 'cube', color: hex('#3b3f4a'), roughness: 0.95 },
  }, { parent: track });
  slab('Straight North', 0, -MID_Z, OUTER_W, LANE);
  slab('Straight South', 0, MID_Z, OUTER_W, LANE);
  slab('Straight West', -MID_X, 0, LANE, OUTER_D);
  slab('Straight East', MID_X, 0, LANE, OUTER_D);
  // Kerbs (visual) along the inner and outer edges.
  const kerb = (name: string, x: number, z: number, w: number, d: number, color: RGBA) => b.entity(name, {
    Transform: { position: { x, y: 0.05, z }, scale: { x: w, y: 0.1, z: d } },
    MeshRenderer: { mesh: 'cube', color, roughness: 0.8 },
  }, { parent: track });
  kerb('Kerb Outer N', 0, -OUTER_D / 2 + 0.3, OUTER_W, 0.6, hex('#ef476f'));
  kerb('Kerb Outer S', 0, OUTER_D / 2 - 0.3, OUTER_W, 0.6, hex('#ef476f'));
  kerb('Kerb Outer W', -OUTER_W / 2 + 0.3, 0, 0.6, OUTER_D, hex('#ef476f'));
  kerb('Kerb Outer E', OUTER_W / 2 - 0.3, 0, 0.6, OUTER_D, hex('#ef476f'));
  kerb('Kerb Inner N', 0, -INNER_D / 2 - 0.3, INNER_W + 1.2, 0.6, hex('#f4f7ff'));
  kerb('Kerb Inner S', 0, INNER_D / 2 + 0.3, INNER_W + 1.2, 0.6, hex('#f4f7ff'));
  kerb('Kerb Inner W', -INNER_W / 2 - 0.3, 0, 0.6, INNER_D, hex('#f4f7ff'));
  kerb('Kerb Inner E', INNER_W / 2 + 0.3, 0, 0.6, INNER_D, hex('#f4f7ff'));

  // Walls with colliders.
  const walls = b.entity('Walls', { Transform: {} });
  const wall = (name: string, x: number, z: number, w: number, d: number, color: RGBA) => b.entity(name, {
    Transform: { position: { x, y: WALL_H / 2, z }, scale: { x: w, y: WALL_H, z: d } },
    MeshRenderer: { mesh: 'cube', color, roughness: 0.7 },
    RigidBody3D: { bodyType: 'static', restitution: 0.3, friction: 0.2 },
    BoxCollider3D: { size: { x: 1, y: 1, z: 1 } },
  }, { parent: walls });
  const outer = hex('#5b6b9a'), inner = hex('#8f99b3');
  wall('Outer N', 0, -OUTER_D / 2 - WALL_T / 2, OUTER_W + WALL_T * 2, WALL_T, outer);
  wall('Outer S', 0, OUTER_D / 2 + WALL_T / 2, OUTER_W + WALL_T * 2, WALL_T, outer);
  wall('Outer W', -OUTER_W / 2 - WALL_T / 2, 0, WALL_T, OUTER_D, outer);
  wall('Outer E', OUTER_W / 2 + WALL_T / 2, 0, WALL_T, OUTER_D, outer);
  wall('Inner N', 0, -INNER_D / 2 + WALL_T / 2, INNER_W, WALL_T, inner);
  wall('Inner S', 0, INNER_D / 2 - WALL_T / 2, INNER_W, WALL_T, inner);
  wall('Inner W', -INNER_W / 2 + WALL_T / 2, 0, WALL_T, INNER_D, inner);
  wall('Inner E', INNER_W / 2 - WALL_T / 2, 0, WALL_T, INNER_D, inner);
  // Infield decoration.
  b.entity('Infield', { Transform: { position: { x: 0, y: 0.01, z: 0 }, scale: { x: INNER_W - 2, y: 0.02, z: INNER_D - 2 } }, MeshRenderer: { mesh: 'cube', color: hex('#6aa35a'), roughness: 1 } });
  b.entity('Grandstand', { Transform: { position: { x: 0, y: 2, z: -OUTER_D / 2 - 6 }, scale: { x: 30, y: 4, z: 6 } }, MeshRenderer: { mesh: 'cube', color: hex('#c9d3e6'), roughness: 0.8 } });

  // Checkpoints (index 0 = start/finish on the east straight, driving north = -Z).
  const cps = b.entity('Checkpoints', { Transform: {} });
  const checkpoint = (index: number, x: number, z: number, across: 'x' | 'z', heading: number) => {
    const halfX = across === 'x' ? LANE / 2 : 0.8, halfZ = across === 'z' ? LANE / 2 : 0.8;
    const root = b.entity(`Checkpoint ${index}`, {
      Transform: { position: { x, y: 0, z } },
      Script: { script: 'Checkpoint', props: { index, halfX, halfZ, heading } },
    }, { tags: ['checkpoint'], parent: cps });
    const color = index === 0 ? hex('#ffffff') : hex('#ffd166');
    const px = across === 'x' ? LANE / 2 - 0.5 : 0, pz = across === 'z' ? LANE / 2 - 0.5 : 0;
    for (const sgn of [-1, 1]) b.entity('Pillar', {
      Transform: { position: { x: sgn * px, y: 2, z: sgn * pz }, scale: { x: 0.5, y: 4, z: 0.5 } },
      MeshRenderer: { mesh: 'cylinder', color: hex('#d8dce8'), roughness: 0.5 },
    }, { parent: root });
    b.entity('Bar', {
      Transform: { position: { x: 0, y: 4.2, z: 0 }, scale: { x: across === 'x' ? LANE - 1 : 0.4, y: 0.4, z: across === 'z' ? LANE - 1 : 0.4 } },
      MeshRenderer: { mesh: 'cube', color, emissive: color, unlit: true, opacity: 0.8 },
    }, { parent: root });
    if (index === 0) b.entity('Start Line', {
      Transform: { position: { x: 0, y: 0.045, z: 0 }, scale: { x: LANE, y: 0.02, z: 1 } },
      MeshRenderer: { mesh: 'cube', color: hex('#ffffff'), roughness: 0.6 },
    }, { parent: root });
  };
  checkpoint(0, MID_X, 0, 'x', Math.PI);          // east straight, heading north (-Z)
  checkpoint(1, 0, -MID_Z, 'z', -Math.PI / 2);     // north straight, heading west (-X)
  checkpoint(2, -MID_X, 0, 'x', 0);                // west straight, heading south (+Z)
  checkpoint(3, 0, MID_Z, 'z', Math.PI / 2);       // south straight, heading east (+X)

  // Obstacles: traffic cones and a couple of blocks.
  const obstacles = b.entity('Obstacles', { Transform: {} });
  const cone = (name: string, x: number, z: number) => b.entity(name, {
    Transform: { position: { x, y: 0.5, z }, scale: { x: 0.8, y: 1, z: 0.8 } },
    MeshRenderer: { mesh: 'cylinder', color: hex('#ff7a3d'), roughness: 0.6 },
    RigidBody3D: { bodyType: 'static', restitution: 0.2 },
    BoxCollider3D: { size: { x: 1, y: 1, z: 1 } },
  }, { parent: obstacles });
  cone('Cone 1', MID_X - 4, -8); cone('Cone 2', MID_X + 3, -12); cone('Cone 3', -10, -MID_Z + 4); cone('Cone 4', -14, -MID_Z - 3);
  cone('Cone 5', -MID_X + 3, 6); cone('Cone 6', -MID_X - 4, 10); cone('Cone 7', 8, MID_Z - 3); cone('Cone 8', 14, MID_Z + 4);
  const block = (name: string, x: number, z: number, w: number, d: number) => b.entity(name, {
    Transform: { position: { x, y: 0.6, z }, scale: { x: w, y: 1.2, z: d } },
    MeshRenderer: { mesh: 'cube', color: hex('#ffd166'), roughness: 0.6 },
    RigidBody3D: { bodyType: 'static', restitution: 0.3 },
    BoxCollider3D: { size: { x: 1, y: 1, z: 1 } },
  }, { parent: obstacles });
  block('Chicane 1', 4, -MID_Z - 4, 6, 1.2); block('Chicane 2', 16, -MID_Z + 4, 6, 1.2); block('Chicane 3', -6, MID_Z + 4, 6, 1.2);
  const scene = b.save('Circuit', { seed: 7 });

  const kart = prefab('Kart', (p) => {
    const root = p.entity('Kart', {
      Transform: {},
      RigidBody3D: { mass: 1, friction: 0, restitution: 0.15, linearDamping: 0 },
      BoxCollider3D: { size: { x: 1.5, y: 0.8, z: 2.4 } },
      PlayerInput: { owner: 'local' },
      NetworkIdentity: { prefab: 'Kart', authority: 'host' },
      NetTransform: { syncRotation: true },
      Script: { script: 'Kart', props: {} },
    }, { tags: ['kart'] });
    p.entity('Body', { Transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 0.5, z: 2.4 } }, MeshRenderer: { mesh: 'cube', color: hex('#ff7a3d'), roughness: 0.35, metallic: 0.2 } }, { parent: root });
    p.entity('Cabin', { Transform: { position: { x: 0, y: 0.45, z: -0.3 }, scale: { x: 1.0, y: 0.5, z: 1.0 } }, MeshRenderer: { mesh: 'cube', color: hex('#1a2238'), roughness: 0.2, metallic: 0.4 } }, { parent: root });
    p.entity('Nose', { Transform: { position: { x: 0, y: 0.15, z: 1.35 }, scale: { x: 0.8, y: 0.25, z: 0.5 } }, MeshRenderer: { mesh: 'cube', color: hex('#ff7a3d'), roughness: 0.35 } }, { parent: root });
    for (const [i, [x, z]] of [[-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]].entries()) {
      p.entity(`Wheel ${i + 1}`, { Transform: { position: { x, y: -0.1, z }, scale: { x: 0.35, y: 0.6, z: 0.6 } }, MeshRenderer: { mesh: 'cube', color: hex('#15171e'), roughness: 0.9 } }, { parent: root });
    }
    return root;
  });

  const project = makeProject({
    id: 'cube-racers',
    name: 'Cube Racers',
    description: 'WebGL arcade racer for 1-6 players: drive kart cubes around a walled circuit with cones and chicanes, chase camera, checkpoints and lap timing.',
    renderer: '3d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    prefabs: [kart],
    assets: [
      { id: 'beep', kind: 'audio', url: 'assets/beep.wav' },
      { id: 'go', kind: 'audio', url: 'assets/go.wav' },
      { id: 'hit', kind: 'audio', url: 'assets/hit.wav' },
      { id: 'lap', kind: 'audio', url: 'assets/lap.wav' },
      { id: 'checkpoint', kind: 'audio', url: 'assets/checkpoint.wav' },
    ],
    settings: {
      network: { mode: 'host-authoritative', maxPlayers: 6, tickRate: 20 },
      physics: { gravity3d: { x: 0, y: -25, z: 0 } },
      touchControls: true,
      touchButtons: ['action'],
    },
  });

  return {
    id: 'cube-racers',
    entry: {
      id: 'cube-racers', name: 'Cube Racers', title: 'Cube Racers',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '3d', multiplayer: true,
      players: { min: 1, max: 6 }, tags: ['racing', 'webgl', '3d-physics'],
      controls: ['W/S: throttle', 'A/D: steer', 'E / Enter: reset to checkpoint'], featured: true,
    },
    project,
    files: {
      'assets/beep.wav': SFX.bounce(),
      'assets/go.wav': SFX.goal(),
      'assets/hit.wav': SFX.hit(),
      'assets/lap.wav': SFX.coin(),
      'assets/checkpoint.wav': SFX.checkpoint(),
      'thumbnail.svg': thumbnail(`
<polygon points="0,180 0,120 320,90 320,180" fill="#4f7a48"/>
<polygon points="40,180 110,100 250,100 320,180" fill="#3b3f4a"/>
<polygon points="110,100 250,100 240,106 120,106" fill="#ef476f"/>
<g transform="translate(150 125) skewX(-8)"><rect x="-22" y="-10" width="44" height="22" rx="3" fill="#ff7a3d"/><rect x="-12" y="-22" width="24" height="14" rx="2" fill="#1a2238"/><rect x="-24" y="8" width="10" height="8" fill="#15171e"/><rect x="14" y="8" width="10" height="8" fill="#15171e"/></g>
<g transform="translate(225 108) scale(.6) skewX(-8)"><rect x="-22" y="-10" width="44" height="22" rx="3" fill="#4cc2ff"/><rect x="-12" y="-22" width="24" height="14" rx="2" fill="#1a2238"/></g>
<polygon points="80,150 86,128 92,150" fill="#ff7a3d"/>
<text x="160" y="36" fill="#fff" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle" font-weight="700">Cube Racers</text>`, '#3a6fd8', '#dbe6f5'),
      'README.md': README,
    },
  };
}

const README = `# Cube Racers

An arcade racer rendered with the WebGL renderer. Up to six kart cubes race
three laps around a walled circuit dotted with cones and chicanes. Each
player has a chase camera, a lap timer and a best-lap readout.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Throttle / reverse | W / S or up / down | left stick Y | joystick |
| Steer | A / D or left / right | left stick X | joystick |
| Reset to last checkpoint | E or Enter | B | **action** button |

## How it is built

- **Track**: flat \`MeshRenderer\` slabs for the asphalt, kerbs and infield;
  walls, cones and chicanes are static \`RigidBody3D\` + \`BoxCollider3D\`
  entities the karts bounce off. The circuit is generated from a few
  constants in \`demos/src/cube-racers/index.ts\` (outer/inner size).
- **Kart prefab**: a dynamic \`RigidBody3D\` with a box collider and child
  meshes (body, cabin, nose, wheels). The \`Kart\` script steers by rotating
  the Transform (\`setEuler(0, heading, 0)\`) and blends the velocity toward
  the heading (\`grip\`), which gives an arcade drift feel without a full
  vehicle model. Steering authority scales with speed and flips in reverse.
- **Checkpoints**: four entities tagged \`checkpoint\` carrying a \`Checkpoint\`
  script whose props store the index, half-extents and respawn heading. The
  kart tests its position against them every fixed step (the 3D physics
  world does not route trigger events to scripts), so laps are counted
  without colliders. Index 0 is the start/finish line.
- **Chase camera**: \`ChaseCamera\` finds the kart whose \`PlayerInput.owner\`
  is the local peer, damps toward a point behind it and uses
  \`Transform.lookAt\` to aim ahead. Every client sees its own kart.
- **Race flow**: the \`GameManager\` spawns karts on a staggered grid (one per
  peer, host-authoritative), runs the 3-2-1 countdown, receives \`lapDone\`
  messages and shows standings; the first to \`laps\` wins and the grid resets.
- **Sound**: collisions are picked up from \`ctx.physics3d.events\` inside the
  kart script (unsubscribed in \`onDestroy\`).

## Ideas to extend it

1. Boost pads: flat trigger slabs (tag \`boost\`) that the kart tests like checkpoints and that add speed.
2. Items: spawn a \`Crate\` prefab on the track; picking one up gives a shove RPC (\`ctx.net.rpc\`) to the kart ahead.
3. Replace the cube body with a GLTF model (\`mesh: "gltf:<asset>"\`).
4. Ghost lap: record the local kart's positions per tick and replay them as a translucent kart.
5. Split-screen: add a second \`Camera3D\` with a different \`priority\` and a viewport rect for two local players.
`;
