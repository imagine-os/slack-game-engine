# Sky Hoppers

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
height, coyote time and jump buffering come from `CharacterController2D`).

## How it is built

- **Level**: one `Tilemap` (`assets/tiles.svg` is a 5-tile strip) with a
  `TilemapCollider2D`. The map is authored as ASCII art in
  `demos/src/sky-hoppers/index.ts`; `#` becomes dirt (grass where air is
  above), `S` stone, `o` coins, `^` spikes, `K` checkpoints, `F` the flag
  and `M` moving platforms. Edit the strings and rebuild, or paint tiles in
  the editor.
- **Camera**: `Camera2D.follow` targets an invisible *Camera Target* entity
  whose `MultiFollow` script sits at the average position of every living
  player. `bounds` keeps the camera inside the level.
- **Parallax**: two `Parallax` roots (mountains, hills) each with three
  child sprites; the root moves at a fraction of the camera speed and
  re-tiles its children around the camera.
- **Moving platforms**: kinematic `RigidBody2D` driven by `MovingPlatform`
  (sets velocity each fixed step). The `Player` script carries riders by
  translating them with the platform velocity when standing on it.
- **Triggers by tag**: coins, spikes (`hazard`), checkpoints and the goal are
  static bodies with trigger colliders. `Player.onTriggerEnter` looks at the
  other entity's `Tag` and sends messages; the `GameManager` owns the
  shared state (coin count, checkpoint, level complete, restart).
- **Multiplayer**: the `GameManager` spawns one `Hopper` prefab per peer on
  the host (`playerJoined` / `playerLeft`), players move through
  `onOwnerInput`, deaths and pickups are decided on the host.

## Ideas to extend it

1. Add a second scene ("Level 2") and switch with `ctx.engine.loadScene` when the flag is reached.
2. Give the hopper an `AnimatedSprite` atlas with idle/run/jump frames.
3. Add enemies: a patrolling prefab that flips direction at edges (raycast down with `ctx.physics.raycast`).
4. Wall jumps: check `rb.contacts` for a side normal and allow `cc.jump()` with a horizontal kick.
5. A co-op tally: count coins per player (the `coinCollected` message carries `by`) and show a mini scoreboard.
