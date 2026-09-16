# Networking

`src/net` implements Forge's multiplayer: pluggable **transports**, the
**NetHub** (`engine.net`) that multiplexes channels over them, and two
**NetSync** implementations (host-authoritative and lockstep). The user guide
is `docs/MULTIPLAYER.md`; this file is the implementation reference.

```
scripts / editor / demos
        │  ctx.net.*        engine.net.channel('editor')
        ▼                          │
┌──────────────────────────────────▼─────────────────────┐
│ NetHub  (engine.net)                                    │
│  channel(name) · presence · stats · connect(kind)       │
│  sync: HostAuthoritativeSync | LockstepSync | null      │
└──────────────────────────┬─────────────────────────────┘
                           │ Transport contract
   ┌───────────┬───────────┼────────────┬────────────────┐
   │ Memory    │ Local     │ Peer       │ WebSocket      │ Null (offline)
   │ in-proc   │ Broadcast │ WebRTC via │ relay server   │
   │ (tests)   │ Channel   │ PeerJS     │ server/index.js│
```

## Concepts

- **Room**: a named session (`?room=<id>`). The first peer to join is the
  **host**; others are **clients**. Transports report `localId`, `isHost`,
  `hostId`, `peers`, `roomId` and emit `connected`, `peer-join`,
  `peer-leave`, `host-changed`, `message`, `error`, `disconnected`.
- **Peer id**: a string assigned by the transport. `NullTransport` uses
  `'local'` and is always host, so single-player is "a room of one".
- **Modes** (`project.settings.network.mode`): `none`, `host-authoritative`
  (default multiplayer), `lockstep`.
- **Owner mapping**: when a sync starts, every `PlayerInput.owner === 'local'`
  and `NetworkIdentity.ownerId === 'host'` is rewritten to the host's peer id,
  so a single-player scene automatically becomes "the host's player".

## Choosing a transport

| `?net=` | Class | When | Server needed |
| --- | --- | --- | --- |
| `peer` (default) | `PeerTransport` | Different devices, works from GitHub Pages | No (public PeerJS signalling; `?server=` for a self-hosted PeerServer) |
| `local` | `LocalTransport` | Tabs of the same browser (testing, hot-seat) | No |
| `ws` | `WebSocketTransport` | Strict NATs, fixed address, one process hosts game + relay | Yes: `npm run serve` (`server/README.md`), `?server=wss://host/ws` |
| `memory` | `MemoryTransport` | Unit tests, in-process bots | No |

`createTransport(kind, opts)` builds one; `parseNetParams(location.search)`
reads `room`, `net`, `server`, `name`; `inviteUrl(params)` produces a link.
`installNetworking(engine, { params, project, container })` does all of the
above plus the sync and the lobby (this is what `play.html` calls).

### Transport details

- **MemoryTransport / MemoryNetwork**: virtual clock (`advance(ms)`,
  `flush()`), `latency`, `jitter`, `loss` (unreliable only unless
  `lossAffectsReliable`), seeded. Host = first to join, migrates to the next
  in join order on leave.
- **LocalTransport**: `BroadcastChannel('forge-room-<id>')`. A joiner says
  `hello`; if no host answers within `discoveryMs` it becomes host. Every tab
  heartbeats; when the host misses `timeoutMs` the member with the lowest
  join sequence takes over (`host-changed`).
- **PeerTransport**: star topology. The host owns the PeerJS id
  `forge-<roomId>`; joiners `new Peer(thatId)`: success = host, `unavailable-id`
  = connect to it as a client, `peer-unavailable` = clear error. Stable
  transport ids (`peer-xxxx`) are independent of PeerJS ids so migration
  keeps identities: on host loss clients re-claim `forge-<roomId>` in roster
  order; the winner hosts and the rest rejoin. Reliable traffic uses the
  PeerJS connection; `reliable:false` binary uses a negotiated
  `RTCDataChannel` (`ordered:false, maxRetransmits:0`, id 42). ICE `failed`
  emits an `error` with a TURN hint. `peerjs` is imported lazily so tests and
  headless builds never touch the network.
- **WebSocketTransport**: JSON text frames + `[0x01][len][id][payload]`
  binary frames, server-side host assignment/migration, 2 s ping/pong RTT.
  Default URL `ws(s)://<page host>/ws`.

## NetHub (`engine.net`)

- `setTransport(t)`, `setSync(s)`, `localId`, `isHost`, `hostId`, `roomId`,
  `connected`, `online`.
- `connect(kind, { roomId, displayName, serverUrl })` convenience.
- `channel(name)` → `{ send(to, data, { reliable }), on(fn) }` where `to` is
  a peer id, `'all'`/`'others'` (never echoed) or `'host'`. Objects are JSON
  (`{ c: name, d }` envelope), `Uint8Array`/`ArrayBuffer` go binary
  (`[0xC0][u8 nameLen][name][payload]`). Channels work before any sync exists;
  names starting with `_` are reserved (`_hub`, `_sync`, `_snap`, `_lock`).
  The editor's collaboration layer uses `engine.net.channel('editor')`.
- `presence` → `{ peerId, displayName, isHost, isLocal, rtt }[]`; names come
  from a hello on `_hub`, RTTs from pings sent by `update()` (called by the
  syncs each frame and by the lobby timer).
- `stats` → bytes/messages per second in/out, totals, last snapshot size and
  RTT to the host (mean to clients when hosting).

## Host-authoritative sync (`HostAuthoritativeSync`)

```
client                                    host
  │ INPUT (tick, last 3 snapshots, ack)     │ fixedUpdate: PlayerInput.apply(merged) before scripts
  ├────────────────────────────────────────▶│ fixedUpdate: scripts (onOwnerInput) + physics
  │ SNAPSHOT @ tickRate (delta vs ack)      │ update: capture NetworkIdentity entities → history
  │◀────────────────────────────────────────┤         encode delta per client vs its acked tick
  │ InterpolationSystem (delay, extrapolate)│
  │ ACK (tick)                              │
  ├────────────────────────────────────────▶│
```

Channels: `_sync` (reliable JSON control) and `_snap` (unreliable binary).

**Handshake.** A client sends `hello { name }`; the host answers
`welcome { tick, hostId, players, entities[], nextNetId }` where `entities`
lists every replicated entity (`netId, prefab, ownerId, authority,
sharedWith, syncComponents, name, pos, rot`). The client instantiates
prefab entities it lacks, reconciles scene entities by `netId` and destroys
scene entities the host no longer has, then gets an immediate keyframe. The
host broadcasts `joined` to the others. Scene-authored `NetworkIdentity`
entities receive deterministic ids (`1..n` in load order) on every peer.

**Input.** Every fixed step (with `autoInput`, or via `submitInput`) a
client sends `INPUT = [u8 2][u32 lastSnapshotTick][u8 n]{ u32 tick, u32 held,
u32 pressed, u32 released, u8 axisCount, i16 axes..., u8 hasPointer,
(f32 x, f32 y, u8 buttons) }×n` with the last `inputRedundancy` ticks. Action
and axis names are `engine.input.actionNames()/axisNames()` (sorted; identical
on all peers). The host keeps the newest snapshot per peer and, in
`fixedUpdate` (before scripts), applies it to every `PlayerInput` whose
`owner` is that peer. Edges (`pressed`/`released`) are stripped when the same
tick is applied twice.

**Shared control.** When `PlayerInput.coOwners` is non-empty (and
`sharedControl` is on) the host gathers the owner's and each co-owner's latest
snapshot and applies `mergeSnapshots(list, PlayerInput.mergeStrategy)`:
`average` (axes averaged; opposite pushes cancel), `first-wins` (first
non-zero contributor in owner→co-owner order), `additive` (summed, clamped).
Buttons are OR-ed. `sync.shareControl(entity, peerId, enabled)` toggles
membership and updates `NetworkIdentity.sharedWith` everywhere; `inputFor(e)`
returns the merged snapshot.

**Snapshots.** At `tickRate` the host captures each `NetworkIdentity`
(`replicate` true) into an `EntityState` of 12 ints (position /1000,
smallest-three rotation as u8+3×i16, scale /1000, 2D velocity /100) plus the
JSON of replicated components. States are kept in a `SnapshotHistory` ring;
for each client the delta against the tick it last acknowledged is encoded
(`snapshot.ts` layout: `u32 tick · u32 baseline · u32 count · {varint netId ·
u8 flags · groups...}`) with only changed groups (thresholds from
`NetTransform.positionThreshold/rotationThreshold`) and only changed
component JSON; unchanged entities are skipped and an all-empty delta is not
sent at all. A keyframe (baseline 0) is sent on join, when the ack is missing
from the history, and every `keyframeInterval` snapshots. Values are absolute,
so loss never corrupts state. Owner-authority entities are excluded from
snapshots to their owner.

**Replicated components.** `Transform` always; other components when
`markReplicated('Type', ['field'?])` was called, `NetworkIdentity.syncComponents`
lists the type, `ComponentMeta.replicate` is true, or a field has
`FieldMeta.sync` (read structurally; no core changes). Received JSON is
applied with `registry.applyProps`.

**Client side.** Snapshot groups update a per-entity "known" state; the
`InterpolationSystem` (`update` phase, priority −500) buffers samples in a
ring per entity, advances a render clock at `tickRate` trailing the newest
sample by `interpolationDelay` ticks, lerps position / slerps rotation between
surrounding samples, extrapolates with velocity for up to `extrapolation`
seconds, and snaps when a sample jumps more than `teleportDistance`. Remote
`RigidBody2D`/`RigidBody3D` are switched to `kinematic` (restored when
authority returns) so local physics does not fight the interpolation.
`NetTransform.targetPosition/targetRotation/targetVelocity/lastTick` mirror
the newest sample.

**Spawn / despawn.** Host: `spawn(prefab, { ownerId, position, authority })`
instantiates from `engine.prefabs`, assigns `netId`, sets `PlayerInput.owner`,
broadcasts `spawn`. Clients call the same API and the host executes it
(`spawnReq`, owner defaults to the requester; the call returns `NULL_ENTITY`
on the client). `despawn` destroys everywhere (`despawned` event);
`despawnOwnedBy(peerId)` and `spawnPlayers(prefab, opts)` cover the usual
"one avatar per player" flow.

**Authority.** `authority: 'host'` (default): host simulates.
`authority: 'owner'`: the owner simulates and streams `OWNER_STATE` (same
encoding, full) to the host each tick; the host writes it into its kinematic
copy and relays it in snapshots to everyone else.

**RPC.** `rpc(name, args, target, entity?)` with target `'host'` (default),
`'all'` (includes caller, delivered locally at once), `'others'`, or a peer
id. Clients send to the host which routes/forwards; delivery emits the `rpc`
event, calls `onRpc(name)` handlers and, with an entity, `engine.scripting.rpc`
→ the script's `onRpc(ctx, name, args, from)`.

**Ownership.** `setOwner(entity, peerId)` (host, or the current owner via
`ownerReq`) updates `NetworkIdentity.ownerId` and `PlayerInput.owner`,
re-applies the simulation policy and emits `ownershipChanged` everywhere.

**Host migration.** When the transport reports `host-changed`, the new host
adopts the entity table (`nextNetId = max + 1`), re-enables physics for
host-authority entities, takes over entities the old host owned, drops the
old host from the roster (`playerLeft`) and broadcasts `takeover`; clients
reset interpolation and re-`hello`, receiving a fresh `welcome` + keyframe.
Everyone gets `hostChanged { hostId, previous, isHost }`.

**Events**: `connected`, `disconnected`, `playerJoined`, `playerLeft`,
`spawned`, `despawned`, `ownershipChanged`, `rpc`, `hostChanged`. Local
`playerJoined` for the host itself is emitted one frame after `start()` so
scripts registered in `onStart` receive it. `players()` returns
`{ peerId, displayName, isHost, rtt }[]`.

Options (`HostSyncOptions`): `tickRate` (20), `maxPlayers`, `sharedControl`,
`mergeStrategy`, `autoInput` (true), `keyframeInterval` (60),
`inputRedundancy` (3), `historySize` (64).

## Lockstep (`LockstepSync`)

All participants run identical fixed steps. Each step a peer publishes its
`InputSnapshot` for tick `T + inputDelay` (`{ t:'in', tick, s, r? }` on
`_lock`, reliable) and executes tick `T` only when every participant's input
for `T` is present; otherwise all `fixedUpdate` systems are disabled for that
step (`stalls` counts them). RPCs ride in `r` and are delivered by everyone at
the same tick in participant-id order, so they are deterministic. The host
locks the roster with `begin(seed)` (`go { peers, seed }` reseeds
`engine.random` on all peers; the lobby's Start button calls it); joiners
after that get `busy`. Every `hashInterval` ticks an FNV-1a hash of
`saveScene().entities` is exchanged; a mismatch emits `desync`. `spawn` is
local and deterministic (no messages), `setOwner`/`shareControl` are local too.

## Player integration

`src/player/main.ts` calls `installNetworking` when `?room=` is present and
`settings.network.mode !== 'none'`: it creates the transport from `?net=`
(default `peer`), connects with `?name=`, creates the sync for the project's
mode and shows `NetLobbyOverlay` (room code, "Copy invite link", roster with
host badge + RTT, status/errors, "Play offline" fallback, Start button in
lockstep). The lobby collapses to a pill a few seconds after the game starts.

## Tests

`tests/net.test.ts` runs everything over `MemoryNetwork` (with latency,
jitter and loss): wire/snapshot encoding, rooms and host election, channel
multiplexing and presence, handshake and roster, spawn/position replication,
delta compression, replicated component fields, late join, input relay,
shared-control merging (average / first-wins / additive), RPC targets and
entity RPCs, ownership transfer, owner authority, host migration,
`spawnPlayers`, lockstep determinism and URL parsing.
