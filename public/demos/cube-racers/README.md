# Cube Racers

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

- **Track**: flat `MeshRenderer` slabs for the asphalt, kerbs and infield;
  walls, cones and chicanes are static `RigidBody3D` + `BoxCollider3D`
  entities the karts bounce off. The circuit is generated from a few
  constants in `demos/src/cube-racers/index.ts` (outer/inner size).
- **Kart prefab**: a dynamic `RigidBody3D` with a box collider and child
  meshes (body, cabin, nose, wheels). The `Kart` script steers by rotating
  the Transform (`setEuler(0, heading, 0)`) and blends the velocity toward
  the heading (`grip`), which gives an arcade drift feel without a full
  vehicle model. Steering authority scales with speed and flips in reverse.
- **Checkpoints**: four entities tagged `checkpoint` carrying a `Checkpoint`
  script whose props store the index, half-extents and respawn heading. The
  kart tests its position against them every fixed step (the 3D physics
  world does not route trigger events to scripts), so laps are counted
  without colliders. Index 0 is the start/finish line.
- **Chase camera**: `ChaseCamera` finds the kart whose `PlayerInput.owner`
  is the local peer, damps toward a point behind it and uses
  `Transform.lookAt` to aim ahead. Every client sees its own kart.
- **Race flow**: the `GameManager` spawns karts on a staggered grid (one per
  peer, host-authoritative), runs the 3-2-1 countdown, receives `lapDone`
  messages and shows standings; the first to `laps` wins and the grid resets.
- **Sound**: collisions are picked up from `ctx.physics3d.events` inside the
  kart script (unsubscribed in `onDestroy`).

## Ideas to extend it

1. Boost pads: flat trigger slabs (tag `boost`) that the kart tests like checkpoints and that add speed.
2. Items: spawn a `Crate` prefab on the track; picking one up gives a shove RPC (`ctx.net.rpc`) to the kart ahead.
3. Replace the cube body with a GLTF model (`mesh: "gltf:<asset>"`).
4. Ghost lap: record the local kart's positions per tick and replay them as a translucent kart.
5. Split-screen: add a second `Camera3D` with a different `priority` and a viewport rect for two local players.
