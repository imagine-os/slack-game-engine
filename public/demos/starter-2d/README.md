# Starter 2D

The smallest useful 2D project: a player with a `CharacterController2D`, a
few static platforms, a camera that follows the player and one script.
"New project" in the editor starts from this template.

## Controls

- **A / D** or **arrow keys**: move
- **Space**: jump (hold for a higher jump, release early for a short hop)
- Touch: virtual joystick and a **jump** button

## How it is built

| Entity | Components | Notes |
| --- | --- | --- |
| Camera | `Camera2D`, `AudioListener` | `follow` points at the player, `bounds` stop it leaving the level |
| Ground / Platforms | `RigidBody2D` (static), `BoxCollider2D`, `Shape` | Static geometry drawn with vector shapes |
| Player | `RigidBody2D`, `BoxCollider2D`, `CharacterController2D`, `Sprite`, `PlayerInput`, `Script` | The `PlayerController` script feeds the controller from `onOwnerInput` |

The only script, `PlayerController`, shows the idiomatic input pattern:
read the merged snapshot in `onOwnerInput` (works offline and in a room),
call `cc.move()` / `cc.jump()`, and respawn when falling off the map.

## Ideas to extend it

1. Add a `Tilemap` + `TilemapCollider2D` and paint a level instead of using boxes.
2. Give the player an `AnimatedSprite` with an atlas of run/jump frames.
3. Add a coin prefab with a trigger collider and a score label in `ctx.engine.hud`.
4. Add a `ParticleEmitter` that bursts when the player lands (`onCollisionEnter`).
5. Set `settings.network.mode` to `host-authoritative` and spawn one player prefab per peer (see the Sky Hoppers demo).
