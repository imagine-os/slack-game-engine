# Starter 3D

A lit cube on a ground plane with an orbit camera, rendered by the WebGL
renderer. "New project" (3D) in the editor starts from this template.

## Controls

- **Drag** with the mouse or a finger to orbit, **wheel** to zoom.
- The camera idles slowly around the cube when nobody is dragging.

## How it is built

| Entity | Components | Notes |
| --- | --- | --- |
| Camera | `Camera3D`, `Script` (`OrbitCamera`), `AudioListener` | Fog and sky gradient are camera settings |
| Sun / Ambient | `Light` | A directional key light plus a soft ambient fill |
| Ground | `MeshRenderer` (plane) | Scaled 30x30 |
| Cube | `MeshRenderer` (cube) | The orbit target, found by name |

The one script, `OrbitCamera`, reads raw mouse/touch state from `ctx.input`
(camera control is local, so it does not need `PlayerInput`) and uses
`ctx.transform.lookAt()` to aim at the target.

## Ideas to extend it

1. Add `RigidBody3D` + `BoxCollider3D` to the cube and drop it onto the ground.
2. Load a GLTF model (`assets` kind `gltf`) and use `mesh: "gltf:<id>"`.
3. Add a point `Light` that circles the cube in `onUpdate`.
4. Replace the orbit camera with a chase camera and a `CharacterController3D` (see Cube Racers).
5. Spawn a ring of cubes from a prefab in `onStart` with `ctx.spawn`.
