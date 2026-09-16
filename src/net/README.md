# Networking model

This directory holds the **interfaces and components** the core depends on.
The networking worker implements them (`Transport` implementations, a
`NetSync`, and the server in `server/`). Nothing in the engine assumes a
particular wire format beyond these contracts.

## Concepts

- **Room**: a named session (`?room=<id>` in `play.html`). The first peer to
  join becomes the **host**; others are **clients**. The transport reports
  `localId`, `isHost`, `peers` and `roomId` and emits `peer-join`,
  `peer-leave`, `host-changed`.
- **Peer id**: string assigned by the transport/server. `NullTransport` uses
  `'local'` and is always host, so single-player is just "a room of one".
- **Modes** (`project.settings.network.mode`):
  - `none`: no networking; `NullTransport`.
  - `host-authoritative`: the host simulates; clients send input and render
    interpolated snapshots.
  - `lockstep`: every peer simulates the same deterministic fixed steps from
    the same inputs (needs deterministic physics/random, which the core
    provides).

## Host-authoritative flow (default multiplayer)

```
client                          host
  │  InputSnapshot (per tick)     │
  ├──────────────────────────────▶│  PlayerInput.apply() for that peer's entities
  │                               │  fixedUpdate: scripts (onOwnerInput) + physics
  │   Snapshot @ tickRate         │  collect NetworkIdentity entities → delta vs last ack
  │◀──────────────────────────────┤
  │  NetTransform interpolation   │
```

1. **Input relay**: every fixed step the client calls
   `sync.submitInput(engine.input.getSnapshot())`. Encode with
   `encodeSnapshot(snapshot, actionNames, axisNames)`; the ordered name lists
   come from `Input.actionNames()` / `axisNames()` and are identical on all
   peers because they derive from `project.settings.input`. Send unreliably
   with the tick number; include the last few ticks redundantly to survive
   loss. The host writes the latest snapshot into `PlayerInput.apply()` for
   every entity whose `owner` (or `coOwners`) is that peer, before the
   `fixedUpdate` phase (Engine calls `sync.fixedUpdate(dt)` first).
2. **Snapshot sync**: at `tickRate` (default 20 Hz) the host serializes
   every entity with `NetworkIdentity.replicate` — `netId`, `ownerId`,
   `Transform` (per `NetTransform` flags), velocity from `RigidBody2D`, and
   any component fields marked for replication (suggested: a
   `meta.fields[x].sync = true` convention added by the net worker). Use
   **delta compression**: keep the last acknowledged snapshot per client and
   send only changed fields beyond `positionThreshold`/`rotationThreshold`;
   send a full keyframe on join and every N ticks. Quantize positions
   (e.g. 1/1000 unit) and rotations (16-bit angles / smallest-three).
3. **Client interpolation**: clients buffer snapshots and render
   `interpolationDelay` ticks behind, lerping position and slerping rotation
   between the two surrounding snapshots into `Transform`, extrapolating with
   `targetVelocity` for up to `extrapolation` seconds when data is late, and
   snapping when the error exceeds `teleportDistance`. Clients do not run
   physics for replicated entities (set their `RigidBody2D.bodyType` to
   `kinematic` locally or skip the physics system for them).
4. **Spawning / despawning**: the host assigns `netId`s (monotonic) and
   sends `spawn { netId, prefab, ownerId, authority, position }`; clients
   call `instantiatePrefab` with the project's prefab (`engine.prefabs`) and
   attach the identity. `despawn { netId }` destroys. Scripts get
   `onNetSpawn(ctx, ownerId)`.
5. **RPCs**: `sync.rpc(name, args, target, entity?)` sends reliably; the
   receiver calls `engine.scripting.rpc(entity, name, args, from)` when an
   entity is given (routes to the entity's script `onRpc`) or the handler
   registered with `sync.onRpc(name, fn)`. Clients may only RPC the host or
   `all` via the host (the host relays), which keeps the host authoritative.
6. **Ownership transfer**: `sync.setOwner(entity, peerId)` (host) updates
   `NetworkIdentity.ownerId` and `PlayerInput.owner`, sends
   `owner { netId, ownerId }`, emits `ownershipChanged`. With
   `authority: 'owner'` the owner sends its own transform snapshots (useful
   for latency-sensitive player avatars) and the host relays them; with
   `authority: 'host'` the host simulates from the owner's input.
7. **Host migration** (optional): on host `peer-leave`, the transport picks
   the lowest peer id as new host (`host-changed`); the new host resumes from
   the last snapshot it has.

## Shared control (multi-user on one entity)

Several users can be assigned to the same entity: `PlayerInput.owner` plus
`PlayerInput.coOwners` / `NetworkIdentity.sharedWith`. Each step the host
collects the latest snapshot from every controlling peer and merges them with
`mergeSnapshots(snaps, strategy)` (`PlayerInput.mergeStrategy` or the project
default in `settings.multiUser.mergeStrategy`):

- `first-wins`: buttons OR-ed; each axis takes the first non-zero contributor
  (peer order = join order).
- `average`: buttons OR-ed; axes averaged (two players pushing opposite ways
  cancel out — good for cooperative steering).
- `additive`: buttons OR-ed; axes summed and clamped to −1..1 (two players
  pushing the same way move faster).

`pressed` edges are preserved for actions no peer was already holding; the
merged snapshot is applied with `PlayerInput.apply()` so scripts see one
consistent `onOwnerInput`. `sync.shareControl(entity, peerId, enabled)`
toggles membership at runtime; `settings.multiUser.sharedControl` gates the
feature for a project.

## Lockstep mode

All peers run `Engine.fixedSteps()` only when they have every peer's input for
that tick (input delay of 2–3 ticks hides latency). Inputs are exchanged
reliably; the simulation is deterministic because the physics world sorts
bodies and pairs, uses no wall-clock time, and randomness goes through the
seeded `engine.random`. Periodically hash `saveScene()` output to detect
desync and fall back to a host keyframe.

## Wire format guidelines

- Control messages (join, spawn, despawn, owner, rpc) as small JSON objects
  with a `t` type field, reliable.
- Snapshots and inputs as binary (`ArrayBuffer`) via `DataView`, unreliable
  when the transport supports it. Prefix every packet with a `u8` type and a
  `u32` tick.
- Keep the server a dumb relay/signalling service where possible so the
  host's browser owns game state; the server tracks rooms, assigns peer ids,
  elects the host and forwards messages.

## Implementation checklist for the net worker

- [ ] `WebSocketTransport` (relay server in `server/index.js`, `npm run serve`)
- [ ] optional `WebRTCTransport` with the WebSocket server for signalling
- [ ] `HostAuthoritativeSync implements NetSync` (+ system installation)
- [ ] `LockstepSync implements NetSync`
- [ ] connect in `src/player/main.ts` where marked, using
      `project.settings.network`
- [ ] tests in `tests/net.test.ts` using two engines in one process with an
      in-memory transport
