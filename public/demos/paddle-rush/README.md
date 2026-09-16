# Paddle Rush

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

- `settings.multiUser.sharedControl` is `true` and `mergeStrategy` is
  `"average"` (project defaults for shared entities).
- Each paddle has a `PlayerInput` whose `owner` is the first team member and
  whose `coOwners` are the rest, plus `mergeStrategy: "average"`. The
  `NetworkIdentity.sharedWith` list mirrors the co-owners.
- Every fixed step the host merges the latest snapshot from all controlling
  peers with `mergeSnapshots`: buttons are OR-ed, axes are averaged. Two
  team-mates pushing opposite ways cancel out; pushing together moves at
  full speed. Change the strategy to `"additive"` for "more hands = faster"
  or `"first-wins"` to let the first mover steer.
- The `Paddle` script does not know or care how many people control it: it
  just reads one snapshot in `onOwnerInput`.

The `GameManager` owns the team lists. Its `teamMode` prop toggles the
behaviour: **on**, players alternate between the blue and orange teams as
they join (`assign`) and `refreshControllers` writes `owner`/`coOwners` and
calls `sync.shareControl(entity, peer, true)`; **off**, the first two
players get one paddle each and later joiners spectate. A paddle with no
humans switches to AI (`aiWhenAlone`).

## How it is built

| Entity | Components | Notes |
| --- | --- | --- |
| Paddle Left / Right | kinematic `RigidBody2D`, `CircleCollider2D`, `Shape`, `Light2D`, `PlayerInput`, `NetworkIdentity`, `NetTransform`, `Script` (`Paddle`) | Moved by setting velocity, so the puck inherits momentum; clamped to its own half |
| Puck | dynamic `RigidBody2D` (restitution 1, `bullet`), `CircleCollider2D`, trail `ParticleEmitter`, `Script` (`Puck`) | Speed clamped between `minSpeed` and `maxSpeed` |
| Walls | static bodies with restitution 1 | Two segments per side leave the goal mouth open |
| Goal Left / Right | static trigger `BoxCollider2D`, `Script` (`Goal`) | Sends a `goal` message with its side |
| GameManager | `Script` | Teams, serving, score, HUD |

## Ideas to extend it

1. Power shots: hold `fire` to charge, then multiply the paddle's velocity on release.
2. Obstacles: static bumpers in the middle of the table with high restitution.
3. Best-of-three sets with a scoreboard panel between sets.
4. Try `mergeStrategy: "first-wins"` for a "hot seat" feel, or `"additive"` for chaos.
5. Replace the AI with a second local player by binding a second key set (e.g. IJKL) to `moveX2`/`moveY2` axes and a second `PlayerInput` owner.
