import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DemoBundle, SceneBuilder, euler, hex, loadScripts, makeProject, thumbnail } from '../lib';

const here = dirname(fileURLToPath(import.meta.url));

export function build(): DemoBundle {
  const b = new SceneBuilder();
  const cube = b.entity('Cube', {
    Transform: { position: { x: 0, y: 1, z: 0 }, rotation: euler(0, 0.6, 0) },
    MeshRenderer: { mesh: 'cube', color: hex('#ff7a3d'), roughness: 0.4, metallic: 0.15 },
  });
  b.entity('Camera', {
    Transform: { position: { x: 6, y: 4, z: 7 } },
    Camera3D: { fov: 55, fogEnabled: true, fogNear: 20, fogFar: 60, fogColor: hex('#c7d3e3'), skyTop: hex('#3b62b3'), skyBottom: hex('#d5dfec') },
    Script: { script: 'OrbitCamera', props: { target: 'Cube', distance: 9 } },
    AudioListener: {},
  });
  b.entity('Sun', {
    Transform: { position: { x: 5, y: 10, z: 5 }, rotation: euler(-0.9, 0.6, 0) },
    Light: { kind: 'directional', intensity: 1.1, color: hex('#fff5e6') },
  });
  b.entity('Ambient', { Transform: {}, Light: { kind: 'ambient', intensity: 0.3, color: hex('#9fb4ff') } });
  b.entity('Ground', {
    Transform: { scale: { x: 30, y: 1, z: 30 } },
    MeshRenderer: { mesh: 'plane', color: hex('#4c5c4a'), roughness: 0.9 },
  });
  void cube;
  const scene = b.save('Main');

  const project = makeProject({
    id: 'starter-3d',
    name: 'Starter 3D',
    description: 'A lit cube on a plane with an orbit camera. The blank canvas for a new 3D game.',
    renderer: '3d',
    scenes: [scene],
    scripts: loadScripts(join(here, 'scripts')),
    settings: { touchControls: false, touchButtons: [] },
  });

  return {
    id: 'starter-3d',
    entry: {
      id: 'starter-3d', name: 'Starter 3D', title: 'Starter 3D',
      description: project.description, thumbnail: 'thumbnail.svg', renderer: '3d', multiplayer: false,
      players: { min: 1, max: 1 }, tags: ['template', 'webgl'], controls: ['Drag: orbit', 'Wheel: zoom'], featured: false, template: true,
    },
    project,
    files: {
      'thumbnail.svg': thumbnail(`
<polygon points="0,150 320,120 320,180 0,180" fill="#4c5c4a"/>
<polygon points="130,70 190,55 190,115 130,130" fill="#ff7a3d"/>
<polygon points="100,85 130,70 130,130 100,145" fill="#c85a25"/>
<polygon points="100,85 160,70 190,55 130,70" fill="#ffa571"/>
<text x="160" y="35" fill="#fff" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle" font-weight="700">Starter 3D</text>`, '#3b62b3', '#0b0e16'),
      'README.md': README,
    },
  };
}

const README = `# Starter 3D

A lit cube on a ground plane with an orbit camera, rendered by the WebGL
renderer. "New project" (3D) in the editor starts from this template.

## Controls

- **Drag** with the mouse or a finger to orbit, **wheel** to zoom.
- The camera idles slowly around the cube when nobody is dragging.

## How it is built

| Entity | Components | Notes |
| --- | --- | --- |
| Camera | \`Camera3D\`, \`Script\` (\`OrbitCamera\`), \`AudioListener\` | Fog and sky gradient are camera settings |
| Sun / Ambient | \`Light\` | A directional key light plus a soft ambient fill |
| Ground | \`MeshRenderer\` (plane) | Scaled 30x30 |
| Cube | \`MeshRenderer\` (cube) | The orbit target, found by name |

The one script, \`OrbitCamera\`, reads raw mouse/touch state from \`ctx.input\`
(camera control is local, so it does not need \`PlayerInput\`) and uses
\`ctx.transform.lookAt()\` to aim at the target.

## Ideas to extend it

1. Add \`RigidBody3D\` + \`BoxCollider3D\` to the cube and drop it onto the ground.
2. Load a GLTF model (\`assets\` kind \`gltf\`) and use \`mesh: "gltf:<id>"\`.
3. Add a point \`Light\` that circles the cube in \`onUpdate\`.
4. Replace the orbit camera with a chase camera and a \`CharacterController3D\` (see Cube Racers).
5. Spawn a ring of cubes from a prefab in \`onStart\` with \`ctx.spawn\`.
`;
