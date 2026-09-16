# Arena Blasters

A top-down arena shooter for 1-8 players. Thrust and turn your ship, blast
the drifting asteroids (they split!) and the other ships. Everything wraps
around the arena edges. First to 15 points wins the round.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Turn | A / D or arrows | left stick | joystick |
| Thrust / brake | W / S | left stick | joystick |
| Fire | J or left click | X / RT | **fire** button |

Set the `controlMode` prop of the Ship prefab to `twin-stick` to steer with
the stick direction instead of rotating.

## Scoring

- Destroying an asteroid: +1 (per rock, so a large one is worth up to 7).
- Destroying a ship: +5. Ships have 3 hit points and respawn after 2 seconds
  with a brief invulnerability flash.

## How it is built

**Scene**: a fixed camera (`ArenaCamera` fits the zoom to the arena), a
starfield sprite, a border shape and the `GameManager`.

**Prefabs** (spawnable from scripts and replicated in multiplayer):

| Prefab | Key components | Script |
| --- | --- | --- |
| Ship | `RigidBody2D` (fixed rotation, damping), `CircleCollider2D`, `Sprite` (tinted per player), `ParticleEmitter` (thruster), `Light2D`, `PlayerInput`, `NetworkIdentity`, `NetTransform` | `Ship` |
| Bullet | trigger `CircleCollider2D`, `Shape`, `Light2D` | `Bullet` |
| Asteroid | `RigidBody2D`, `CircleCollider2D`, polygon `Shape` generated from a seed | `Asteroid` |
| Explosion | `ParticleEmitter` burst + `Light2D` flash, self-destructs | `Explosion` |

**Multiplayer flow** (host-authoritative). `GameManager.onStart` spawns a
Ship for the local peer, then for every peer already in the room, and
listens to `playerJoined` / `playerLeft` on `ctx.net.hub.sync` to spawn and
despawn ships. Each Ship has a `PlayerInput` whose `owner` is the peer id;
the `Ship` script reads the merged snapshot in `onOwnerInput`, so local and
remote ships run identical code. Hits are resolved only on the host
(`ctx.net.isHost`) and delivered as `hit` messages; offline the local peer
is the host, so nothing changes for single-player.

**Passing data to spawned prefabs**: scripts on a freshly spawned entity have
not started yet, so instead of sending a message the spawner writes into the
entity's `Script.props` (`script.props.color = ...`) and the target reads
them in `onStart`.

**Sound**: three tiny WAV files generated procedurally by
`scripts/lib/wav.ts`, played with `ctx.audio.play(id, { pitchVariation })`.

## Ideas to extend it

1. Power-ups: spawn a `PowerUp` prefab (trigger collider) that raises `fireInterval` or adds a shield prop.
2. Team mode: colour ships by team in `GameManager.addPlayer` and ignore friendly fire in `Bullet.onTriggerEnter`.
3. Homing missiles: a second projectile prefab that steers toward the nearest `ship` tag each `onFixedUpdate`.
4. A shrinking arena: lower `arenaWidth`/`arenaHeight` over time and push ships inward.
5. Persistent leaderboard: keep scores across rounds and show a podium panel with `ctx.engine.hud.panel`.
