# Making a game multiplayer in 5 steps

Forge games are multiplayer-ready by construction: input is a serializable
`InputSnapshot`, entities are addressed by `NetworkIdentity`, and the host's
browser runs the authoritative simulation. Nothing to deploy for the default
peer-to-peer transport. Implementation reference: `src/net/README.md`.

## 1. Turn networking on in the project

In project settings (or `project.json`):

```json
"network": { "mode": "host-authoritative", "maxPlayers": 8, "tickRate": 20 },
"multiUser": { "sharedControl": true, "mergeStrategy": "average" }
```

`mode` can be `host-authoritative` (recommended) or `lockstep` (deterministic;
everyone simulates; the host presses Start when all players are in).

## 2. Give replicated things a `NetworkIdentity`

Any entity that other players must see needs `NetworkIdentity` (and usually
`NetTransform` for smooth interpolation). Scene entities get stable ids
automatically. Put a player avatar in a **prefab** with `Transform`,
`NetworkIdentity`, `NetTransform`, `PlayerInput`, your `Script` and (for
platformers) `RigidBody2D` + `CharacterController2D`.

Game state beyond the transform (health, score) replicates when you mark the
component: in a built-in script `markReplicated('Health')` from the engine
API, or list types on the entity: `NetworkIdentity.syncComponents = ['Health']`.

## 3. Drive players with `onOwnerInput`

```js
defineScript({
  name: 'Player',
  onOwnerInput(ctx, input, dt) {
    const rb = ctx.get('RigidBody2D');
    rb.velocity.x = input.axes.moveX * 6;
    if (input.pressed.includes('jump')) rb.velocity.y = 12;
  },
});
```

The same code runs offline and online. Online, the host applies each player's
snapshot to the `PlayerInput` that player owns before scripts run; clients
only send input and render the interpolated result: `onOwnerInput` is not
called on a peer that does not simulate the entity (`sync.simulatesEntity`),
so a script can spawn, fire or play sounds there without guarding on
`ctx.net.isHost`. A quick tap is never lost: press/release edges from client
ticks that arrive between two host steps are merged into the next one.

## 4. Spawn one avatar per player (host)

Add a `GameManager` script on an empty scene entity:

```js
defineScript({
  name: 'GameManager',
  onStart(ctx) {
    const sync = ctx.net.hub.sync;
    if (!sync) { ctx.net.spawn('Player'); return; }        // offline: just a local player
    const spawned = {};
    const spawnFor = (peerId) => {
      if (!ctx.net.isHost || spawned[peerId]) return;      // only the host spawns
      spawned[peerId] = ctx.net.spawn('Player', { ownerId: peerId, position: { x: Object.keys(spawned).length * 2, y: 1 } });
    };
    for (const p of sync.players()) spawnFor(p.peerId);     // players already here (host itself, or after migration)
    sync.on('playerJoined', (e) => spawnFor(e.peerId));
    sync.on('playerLeft', (e) => { const ent = spawned[e.peerId]; delete spawned[e.peerId]; if (ent && ctx.net.isHost) sync.despawn(ent); });
  },
});
```

Or the one-liner equivalent from a built-in script or `main.ts`:
`(engine.net.sync as HostAuthoritativeSync).spawnPlayers('Player', { position: (i) => ({ x: i * 2, y: 1 }) })`.

Configure the instance right after `spawn()`: `ctx.getOn(e, 'Script').props.color = '#ff7a3d'`,
`ctx.getOn(e, 'Name').name = ...`, `rb.setVelocity(...)`. The host announces the
spawn at the end of the frame with the `Script` component, the `Name`, the
transform and any replicated components, so remote copies start their script
with the same props (late joiners get the same through the `welcome`).

HUD or other host-only state that guests should see travels as an RPC on the
manager entity: `ctx.net.rpc('hud', [payload], 'others')` on the host and
`onRpc(ctx, name, args)` on every peer (see the demos' `GameManager` scripts).

### Host migration: `onHostChanged`

When the host leaves, the transport elects a new one and every script gets
`onHostChanged(ctx, isHost, { hostId, previous })`. On the peer where `isHost`
is true, the manager must start serving: subscribe to `playerJoined`/
`playerLeft`, adopt the entities that already exist (they were replicated to
it while it was a guest) and start its timers, waves or AI. The old host's
`playerLeft` fires right *after* this hook, so a handler installed here can
despawn its avatar; anything it still owns afterwards is handed to the new
host by the sync so it keeps simulating.

```js
onHostChanged(ctx, isHost) {
  if (!isHost || ctx.state.serving) return;
  ctx.state.serving = true;
  for (const e of ctx.world.with('NetworkIdentity')) {          // adopt existing avatars
    const ni = ctx.getOn(e, 'NetworkIdentity');
    if (ni.prefab === 'Player') spawned[ni.ownerId] = e;
  }
  for (const p of sync.players()) spawnFor(p.peerId);             // anyone without one
  sync.on('playerJoined', ...); sync.on('playerLeft', ...);       // as in onStart
}
```

Guest copies of a manager keep the host's HUD state from the `hud` RPC, so
the new host can continue scores, teams or waves from it (the demos'
`GameManager` scripts do exactly this in `becomeHost`).

Useful `ScriptContext.net` members: `localId`, `isHost`, `online`,
`owner()`, `isOwner()`, `spawn(prefab, { ownerId, position })`,
`rpc(name, args, target)` and `hub` (`engine.net`): `hub.sync.on(...)`,
`hub.sync.players()`, `hub.channel('chat')`, `hub.presence`, `hub.stats`.

## 5. Share a link

Open `play.html?project=<id>&room=ABC123` and press **Copy invite link** in
the lobby. Friends open the link and join; the first one in the room hosts.

| Situation | URL parameters |
| --- | --- |
| Different devices, no server (default) | `&room=ABC123` (WebRTC through public PeerJS signalling) |
| Two tabs in the same browser | `&room=ABC123&net=local` |
| Behind strict NATs / you run a server | `&room=ABC123&net=ws&server=wss://your-host/ws` (see `server/README.md`) |
| Pick a name | `&name=Zoe` |

The lobby shows the roster with host badge and RTT, connection errors and a
**Play offline** button.

## Shared control (several people, one entity)

Let two players steer one vehicle: on the host call
`sync.shareControl(entity, peerId, true)` (or author `PlayerInput.coOwners`).
Each step the host merges the controllers' snapshots with
`PlayerInput.mergeStrategy`:

- `average`: axes averaged, so opposite pushes cancel (co-op steering).
- `first-wins`: the first non-zero contributor wins (owner, then co-owners).
- `additive`: summed and clamped (pushing together goes faster).

Buttons are OR-ed in every mode. Scripts see one merged `onOwnerInput`.

## RPCs and ownership

- `ctx.net.rpc('explode', [x, y], 'all')` from an entity script reaches
  `onRpc(ctx, name, args, from)` on that entity everywhere. Targets: `'host'`
  (default), `'all'`, `'others'`, or a peer id. Clients go through the host.
- `sync.setOwner(entity, peerId)` hands an entity to another player (updates
  `PlayerInput.owner`); `authority: 'owner'` at spawn lets the owner simulate
  it locally for lag-free movement, with the host relaying its state.

## Testing without a browser

```ts
const net = new MemoryNetwork({ latency: 40, loss: 0.1 });
const host = Engine.create(null, { audio: false }); host.net.setTransport(net.createTransport());
await host.net.transport.connect({ roomId: 'r' });
host.net.setSync(new HostAuthoritativeSync(host, { autoInput: false })); host.net.sync!.start();
// ...same for a client, then: host.step(); client.step(); net.flush();
```

See `tests/net.test.ts` for complete examples of every feature.

## Limits and notes

- Host-authoritative: when the host leaves, the transport elects a new host
  who resumes from the last replicated state. Order of events on every peer:
  `hostChanged` (scripts: `onHostChanged`), then `playerLeft` for the old
  host (despawn its avatar here), then any entity the old host still owns is
  handed to the new host. Timers and `ctx.state` of the old host's manager
  are gone; the new host rebuilds them from the replicated world and the
  last HUD RPC.
- Lockstep needs all players present before Start; late join is refused.
- WebRTC through public signalling can fail behind symmetric NATs; fall back
  to `net=ws` or configure a TURN server via `PeerTransportOptions.iceServers`.
- Snapshot precision is 1 mm for positions and about 0.003° for rotations.
