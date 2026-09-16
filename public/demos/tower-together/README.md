# Tower Together

Cooperative tower defence for 1-4 players. Creeps walk the road from the
portal to the base; click or tap anywhere off the road to build a turret.
Gold is shared by the whole team, so talk before you spend it. Waves grow
until the base falls.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Aim the build cursor | move the mouse | (tap aims and builds) |
| Build a tower (50 gold) | left click or **J** | tap the spot |

The cursor turns yellow when you cannot afford a tower and red when the spot
is invalid (on the road, off the map or already taken).

## Shared building

Each player gets a **Builder** prefab: a cursor with a `PlayerInput` owned by
that peer. Its `Builder` script reads the pointer from the input snapshot
(`snapshot.pointer`, in world units, which the engine fills from the mouse
and the network relays for remote players), snaps it to the grid and, on
`fire`, sends a `placeTower` message. The `GameManager` validates the spot
and the shared purse on the host and spawns the `Tower` prefab, so two
players clicking the same cell in the same tick cannot both pay.

The project enables `multiUser.sharedControl` with `mergeStrategy:
"first-wins"`, and the Builder's `PlayerInput.mergeStrategy` is
`first-wins` too: if the room assigns more than one user to a single cursor,
the first non-zero input (and the first pointer) wins each tick instead of
being averaged, which is what you want for discrete placement.

## How it is built

| Piece | Components / script | Notes |
| --- | --- | --- |
| Road | two `Shape` lines drawn from the `path` waypoints | The same waypoint list drives enemies and placement validation |
| Enemy | `Shape`, health-bar children, `ParticleEmitter`, `Enemy` script | Walks waypoint to waypoint; every third wave has heavy variants |
| Tower | `Shape` base, barrel, range ring, `Tower` script | Nearest-enemy targeting; fires `Shot` prefabs |
| Shot | `Shape`, `Shot` script | Homing projectile; damage applied by message |
| Builder | outline `Shape`, `PlayerInput`, `Builder` script | One per player, coloured per player |
| GameManager | `GameManager` script | Waves, gold, base health, HUD, restart |

The game runs without any physics: movement and targeting are plain distance
checks in `onFixedUpdate`, which keeps it deterministic and cheap.

## Ideas to extend it

1. Tower types: add `props.kind` (slow, splash, sniper) and a key to cycle the cursor's selection.
2. Upgrades: click an existing tower to spend gold on `damage`/`range` (the cursor already detects occupied cells).
3. Selling: right-click refunds 60% of the cost.
4. Flying enemies that ignore the road: give them their own straight-line path and towers a `canHitAir` prop.
5. Vote to start the next wave early: an RPC that counts ready players and shortens `waveDelay`.
