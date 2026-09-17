import { describe, it, expect } from 'vitest';
import {
  Engine, Transform, PlayerInput, RigidBody2D, Script, Name, NULL_ENTITY,
  NetworkIdentity, NetTransform, MemoryNetwork, HostAuthoritativeSync, LockstepSync,
  ByteWriter, ByteReader, packQuat, unpackQuat, encodeWorldSnapshot, decodeWorldSnapshot, newEntityState, captureTransform, DEFAULT_POLICY,
  createEmptySnapshot, markReplicated, parseNetParams, createTransport, inviteUrl, switchTransportUrl,
  type PrefabData, type InputSnapshot, type WorldState, type MemoryTransport, type Entity, Component, registerComponent,
} from '../src/index';

// ------------------------------------------------------------------ helpers

function headless(): Engine {
  return Engine.create(null, { seed: 1, audio: false });
}

const playerPrefab: PrefabData = {
  version: 1,
  name: 'Player',
  entities: [{
    id: 1,
    name: 'Player',
    components: [
      { type: 'Transform', data: {} },
      { type: 'NetworkIdentity', data: {} },
      { type: 'NetTransform', data: {} },
      { type: 'PlayerInput', data: {} },
      { type: 'RigidBody2D', data: { gravityScale: 0 } },
    ],
  }],
};

interface Peer { engine: Engine; transport: MemoryTransport; sync: HostAuthoritativeSync }

async function makePeer(net: MemoryNetwork, room = 'r1', name?: string, opts: Partial<ConstructorParameters<typeof HostAuthoritativeSync>[1]> = {}): Promise<Peer> {
  const engine = headless();
  engine.prefabs.set('Player', playerPrefab);
  const transport = net.createTransport();
  engine.net.displayName = name ?? transport.localId;
  engine.net.setTransport(transport);
  await transport.connect({ roomId: room, displayName: engine.net.displayName });
  const sync = new HostAuthoritativeSync(engine, { autoInput: false, sharedControl: true, ...opts });
  engine.net.setSync(sync);
  sync.start();
  return { engine, transport, sync };
}

/** Step every engine one frame, then deliver all messages. */
function pump(peers: Peer[], net: MemoryNetwork, frames = 1, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) {
    for (const p of peers) p.engine.step(dt);
    net.flush();
  }
}

function snap(tick: number, axes: Record<string, number> = {}, held: string[] = [], pressed: string[] = []): InputSnapshot {
  return { tick, held, pressed, released: [], axes };
}

// --------------------------------------------------------------------- wire

describe('wire', () => {
  it('round-trips ints, varints and strings', () => {
    const w = new ByteWriter(8);
    w.u8(200).i16(-1234).u32(0xdeadbeef).varint(300).svarint(-77).svarint(123456789).string('héllo').f32(1.5);
    const r = new ByteReader(w.toBytes());
    expect(r.u8()).toBe(200);
    expect(r.i16()).toBe(-1234);
    expect(r.u32()).toBe(0xdeadbeef);
    expect(r.varint()).toBe(300);
    expect(r.svarint()).toBe(-77);
    expect(r.svarint()).toBe(123456789);
    expect(r.string()).toBe('héllo');
    expect(r.f32()).toBe(1.5);
    expect(r.remaining).toBe(0);
  });

  it('packs quaternions with smallest-three within tolerance', () => {
    const cases = [[0, 0, 0, 1], [0.5, 0.5, 0.5, 0.5], [-0.7071, 0, 0.7071, 0], [0.1, -0.2, 0.3, -0.927]];
    const ints = new Int32Array(4);
    for (const [x, y, z, w] of cases) {
      const len = Math.hypot(x, y, z, w);
      packQuat(x / len, y / len, z / len, w / len, ints);
      const out = { x: 0, y: 0, z: 0, w: 0 };
      unpackQuat(ints, 0, out);
      // Sign may flip (q and -q are the same rotation).
      const dot = Math.abs(out.x * x + out.y * y + out.z * z + out.w * w) / len;
      expect(dot).toBeGreaterThan(0.99999);
    }
  });
});

// ----------------------------------------------------------------- snapshot

describe('snapshot encoding', () => {
  function state(netId: number, x: number, y: number, angle = 0, props: [string, string][] = []) {
    const s = newEntityState(netId);
    captureTransform(s, { x, y, z: 0 }, { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }, { x: 1, y: 1, z: 1 }, { x: 1.25, y: -0.5 });
    for (const [t, j] of props) { s.propTypes.push(t); s.props.push(j); }
    return s;
  }

  it('quantizes and round-trips a full snapshot', () => {
    const cur: WorldState = new Map([[1, state(1, 1.2344, -6.7891, 0.5, [['Health', '{"hp":90}']])], [2, state(2, 100.001, 0)]]);
    const w = new ByteWriter();
    const count = encodeWorldSnapshot(w, 10, 0, cur, null, () => DEFAULT_POLICY);
    expect(count).toBe(2);
    const seen: Record<number, { x: number; y: number; props: string[] }> = {};
    const h = decodeWorldSnapshot(new ByteReader(w.toBytes()), (id, flags, ints, types, props) => {
      seen[id] = { x: ints[0] / 1000, y: ints[1] / 1000, props: props.slice() };
      expect(flags & 1).toBe(1);
      void types;
    });
    expect(h.tick).toBe(10);
    expect(h.baselineTick).toBe(0);
    expect(seen[1].x).toBeCloseTo(1.2344, 3);
    expect(seen[1].y).toBeCloseTo(-6.7891, 3);
    expect(seen[1].props).toEqual(['{"hp":90}']);
    expect(seen[2].x).toBeCloseTo(100.001, 3);
  });

  it('sends only changed groups against a baseline and skips unchanged entities', () => {
    const base: WorldState = new Map([[1, state(1, 1, 1)], [2, state(2, 5, 5, 0, [['Health', '{"hp":100}']])]]);
    const cur: WorldState = new Map([[1, state(1, 1, 1)], [2, state(2, 5, 5, 0, [['Health', '{"hp":50}']])]]);
    const w = new ByteWriter();
    const count = encodeWorldSnapshot(w, 11, 10, cur, base, () => DEFAULT_POLICY);
    expect(count).toBe(1);
    const full = new ByteWriter();
    encodeWorldSnapshot(full, 11, 0, cur, null, () => DEFAULT_POLICY);
    expect(w.offset).toBeLessThan(full.offset);
    decodeWorldSnapshot(new ByteReader(w.toBytes()), (id, flags, _ints, types, props) => {
      expect(id).toBe(2);
      expect(flags).toBe(16); // PROPS only
      expect(types).toEqual(['Health']);
      expect(props).toEqual(['{"hp":50}']);
    });
  });
});

// ------------------------------------------------------------ memory network

describe('MemoryNetwork', () => {
  it('assigns the host to the first peer, tracks rooms and migrates the host on leave', async () => {
    const net = new MemoryNetwork();
    const [a, b, c] = net.createTransports(3);
    const joins: string[] = [];
    a.on('peer-join', (e) => joins.push(e.peerId));
    await a.connect({ roomId: 'x' });
    await b.connect({ roomId: 'x' });
    await c.connect({ roomId: 'y' });
    expect(a.isHost).toBe(true);
    expect(b.isHost).toBe(false);
    expect(b.hostId).toBe(a.localId);
    expect(a.peers).toEqual([b.localId]);
    expect(c.isHost).toBe(true);
    expect(joins).toEqual([b.localId]);
    let newHost = '';
    b.on('host-changed', (e) => { newHost = e.hostId; });
    await a.disconnect();
    expect(newHost).toBe(b.localId);
    expect(b.isHost).toBe(true);
    expect(net.roomPeers('x')).toEqual([b.localId]);
  });

  it('delivers with latency in order and drops unreliable packets under loss', async () => {
    const net = new MemoryNetwork({ latency: 50, loss: 0.5, seed: 7 });
    const [a, b] = net.createTransports(2);
    await a.connect({ roomId: 'x' });
    await b.connect({ roomId: 'x' });
    const got: number[] = [];
    b.on('message', (m) => got.push((m.data as { n: number }).n));
    for (let i = 0; i < 20; i++) a.send(b.localId, { n: i }, { reliable: true });
    for (let i = 100; i < 200; i++) a.send('all', { n: i }, { reliable: false });
    net.advance(49);
    expect(got).toHaveLength(0);
    net.advance(1);
    expect(got.slice(0, 20)).toEqual([...Array(20).keys()]);
    const unreliable = got.filter((n) => n >= 100).length;
    expect(unreliable).toBeGreaterThan(20);
    expect(unreliable).toBeLessThan(80);
    expect(net.dropped).toBe(100 - unreliable);
  });
});

// ------------------------------------------------------------------ channels

describe('NetHub channels and presence', () => {
  it('multiplexes named channels (JSON and binary) before any sync exists', async () => {
    const net = new MemoryNetwork();
    const a = headless(), b = headless();
    const ta = net.createTransport(), tb = net.createTransport();
    a.net.displayName = 'Alice';
    b.net.displayName = 'Bob';
    a.net.setTransport(ta);
    b.net.setTransport(tb);
    await ta.connect({ roomId: 'edit' });
    await tb.connect({ roomId: 'edit' });
    const editorA: unknown[] = [];
    const chatB: unknown[] = [];
    a.net.channel('editor').on((_from, data) => editorA.push(data));
    b.net.channel('chat').on((_from, data) => chatB.push(data));
    b.net.channel('editor').send('host', { op: 'move', id: 3 });
    b.net.channel('editor').send('all', new Uint8Array([1, 2, 3]), { reliable: false });
    a.net.channel('chat').send(tb.localId, { text: 'hi' });
    a.net.channel('editor').send('all', { op: 'ignored-by-a' }); // never echoed to itself
    net.flush();
    expect(editorA).toHaveLength(2);
    expect(editorA[0]).toEqual({ op: 'move', id: 3 });
    expect(Array.from(editorA[1] as Uint8Array)).toEqual([1, 2, 3]);
    expect(chatB).toEqual([{ text: 'hi' }]);
    // Presence: hello exchanged on connect.
    expect(a.net.presence.map((p) => p.displayName).sort()).toEqual(['Alice', 'Bob']);
    expect(b.net.nameOf(ta.localId)).toBe('Alice');
    expect(a.net.stats.bytesIn).toBeGreaterThan(0);
    // 'host' target from the host itself is delivered locally.
    a.net.channel('editor').send('host', { op: 'self' });
    expect(editorA[2]).toEqual({ op: 'self' });
    a.dispose();
    b.dispose();
  });
});

// ------------------------------------------------------- host authoritative

describe('HostAuthoritativeSync', () => {
  it('re-sends hello every second until the host answers when the first one is lost', async () => {
    const net = new MemoryNetwork();
    let dropped = 0;
    // Drop the very first control message the client sends (its hello).
    net.filter = ({ data }) => {
      const t = (data as { d?: { t?: string } })?.d?.t ?? (data as { t?: string })?.t;
      if (t === 'hello' && dropped === 0) { dropped++; return false; }
      return true;
    };
    const h = await makePeer(net, 'g', 'Host');
    const c = await makePeer(net, 'g', 'Client');
    expect(dropped).toBe(1); // the hello sent on connect was dropped at the network
    pump([h, c], net, 3);
    expect(c.sync.handshakeComplete).toBe(false);
    expect(c.sync.players().length).toBeLessThan(2);
    // Under a second: no retry yet.
    pump([h, c], net, 30);
    expect(c.sync.helloAttempts).toBe(1);
    // Past a second: a second hello goes out and the host welcomes the client.
    pump([h, c], net, 40);
    expect(c.sync.helloAttempts).toBe(2);
    expect(c.sync.handshakeComplete).toBe(true);
    expect(c.sync.players().map((p) => p.displayName).sort()).toEqual(['Client', 'Host']);
    expect(h.sync.players().map((p) => p.displayName).sort()).toEqual(['Client', 'Host']);
    // Once welcomed, no further hellos are sent.
    pump([h, c], net, 130);
    expect(c.sync.helloAttempts).toBe(2);
  });

  it('gives up re-sending hello after HELLO_MAX_TRIES', async () => {
    const net = new MemoryNetwork();
    net.filter = ({ data }) => ((data as { d?: { t?: string } })?.d?.t ?? (data as { t?: string })?.t) !== 'hello';
    const h = await makePeer(net, 'g', 'Host');
    const c = await makePeer(net, 'g', 'Client');
    pump([h, c], net, 60 * 12);
    expect(c.sync.helloAttempts).toBe(HostAuthoritativeSync.HELLO_MAX_TRIES);
    expect(c.sync.handshakeComplete).toBe(false);
  });

  it('handshakes, exposes the roster and emits playerJoined', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g', 'Host');
    const joined: string[] = [];
    h.sync.on('playerJoined', (e) => joined.push(e.displayName));
    const c = await makePeer(net, 'g', 'Client');
    pump([h, c], net, 3);
    expect(h.sync.players().map((p) => p.displayName).sort()).toEqual(['Client', 'Host']);
    expect(c.sync.players().map((p) => p.displayName).sort()).toEqual(['Client', 'Host']);
    expect(c.sync.players().find((p) => p.isHost)!.peerId).toBe(h.transport.localId);
    expect(joined.sort()).toEqual(['Client', 'Host']);
    expect(h.engine.net.online).toBe(true);
  });

  it('replicates spawned entities and positions with quantization', async () => {
    const net = new MemoryNetwork({ latency: 20, jitter: 5, loss: 0.2, seed: 3 });
    const h = await makePeer(net, 'g');
    const c = await makePeer(net, 'g');
    pump([h, c], net, 2);
    const spawnedOnClient: number[] = [];
    c.sync.on('spawned', (e) => spawnedOnClient.push(e.netId));
    const e = h.sync.spawn('Player', { ownerId: c.transport.localId, position: { x: 2, y: 3 } });
    expect(e).not.toBe(NULL_ENTITY);
    const ni = h.engine.world.getComponent(e, NetworkIdentity)!;
    pump([h, c], net, 2);
    expect(spawnedOnClient).toEqual([ni.netId]);
    const ce = c.sync.entityOf(ni.netId);
    expect(ce).not.toBe(NULL_ENTITY);
    expect(c.engine.world.getComponent(ce, PlayerInput)!.owner).toBe(c.transport.localId);
    // Remote copies are kinematic so local physics does not fight the interpolation.
    expect(c.engine.world.getComponent(ce, RigidBody2D)!.bodyType).toBe('kinematic');
    expect(h.engine.world.getComponent(e, RigidBody2D)!.bodyType).toBe('dynamic');
    // Move on the host; the client converges despite loss.
    h.engine.world.getComponent(e, Transform)!.setPosition(7.1234, -1.5);
    pump([h, c], net, 40);
    const ct = c.engine.world.getComponent(ce, Transform)!;
    expect(ct.x).toBeCloseTo(7.1234, 2);
    expect(ct.y).toBeCloseTo(-1.5, 2);
    expect(c.engine.net.stats.snapshotBytes).toBeGreaterThan(0);
  });

  it('uses delta compression: idle world costs nothing after the baseline is acked', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const c = await makePeer(net, 'g');
    for (let i = 0; i < 5; i++) h.sync.spawn('Player', { position: { x: i, y: 0 } });
    pump([h, c], net, 12);
    const before = h.transport.bytesOut;
    pump([h, c], net, 12); // nothing moves: deltas are empty and skipped
    const idle = h.transport.bytesOut - before;
    h.engine.world.getComponent(h.sync.entityOf(1 + 0), Transform)?.setPosition(50, 50);
    for (const ni of h.engine.world.componentsOfType(NetworkIdentity)) h.engine.world.getComponent(ni.entity, Transform)!.translate(1, 1);
    pump([h, c], net, 3);
    const moving = h.transport.bytesOut - before - idle;
    expect(moving).toBeGreaterThan(idle);
  });

  it('replicates marked component fields', async () => {
    class Health extends Component { static override readonly type = 'Health'; hp = 100; label = 'x'; }
    registerComponent(Health, {});
    markReplicated('Health', ['hp']);
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const c = await makePeer(net, 'g');
    const e = h.sync.spawn('Player');
    h.engine.world.addComponent(e, Health);
    const netId = h.sync.netIdOf(e);
    pump([h, c], net, 2);
    const ce = c.sync.entityOf(netId);
    c.engine.world.addComponent(ce, Health); // prefab does not contain it in this test
    h.engine.world.getComponent(e, Health)!.hp = 42;
    h.engine.world.getComponent(e, Health)!.label = 'not-synced';
    pump([h, c], net, 6);
    expect(c.engine.world.getComponent(ce, Health)!.hp).toBe(42);
    expect(c.engine.world.getComponent(ce, Health)!.label).toBe('x');
  });

  it('gives late joiners the full state', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const a = h.sync.spawn('Player', { position: { x: 1, y: 1 } });
    const b = h.sync.spawn('Player', { position: { x: 9, y: 9 } });
    pump([h], net, 5);
    h.sync.despawn(a);
    pump([h], net, 2);
    const late = await makePeer(net, 'g', 'Late');
    pump([h, late], net, 10);
    const ids = Array.from(late.engine.world.componentsOfType(NetworkIdentity)).map((n) => n.netId).sort();
    expect(ids).toEqual([h.sync.netIdOf(b)]);
    const lt = late.engine.world.getComponent(late.sync.entityOf(h.sync.netIdOf(b)), Transform)!;
    expect(lt.x).toBeCloseTo(9, 2);
    expect(late.sync.players()).toHaveLength(2);
  });

  it('relays client input to the entity that client owns', async () => {
    const net = new MemoryNetwork({ latency: 10 });
    const h = await makePeer(net, 'g');
    const c = await makePeer(net, 'g');
    pump([h, c], net, 2);
    const e = h.sync.spawn('Player', { ownerId: c.transport.localId });
    const pi = h.engine.world.getComponent(e, PlayerInput)!;
    for (let t = 1; t <= 5; t++) {
      c.sync.submitInput(snap(t, { moveX: 0.75 }, ['jump'], t === 1 ? ['jump'] : []));
      pump([h, c], net, 1);
    }
    expect(pi.axis('moveX')).toBeCloseTo(0.75, 3);
    expect(pi.held('jump')).toBe(true);
    expect(h.sync.inputOf(c.transport.localId)!.tick).toBe(5);
  });

  it('merges shared control from several clients (average and first-wins)', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const c1 = await makePeer(net, 'g');
    const c2 = await makePeer(net, 'g');
    pump([h, c1, c2], net, 2);
    const e = h.sync.spawn('Player', { ownerId: c1.transport.localId });
    h.sync.shareControl(e, c2.transport.localId, true);
    pump([h, c1, c2], net, 2);
    const pi = h.engine.world.getComponent(e, PlayerInput)!;
    expect(pi.coOwners).toEqual([c2.transport.localId]);
    const c2pi = c2.engine.world.getComponent(c2.sync.entityOf(h.sync.netIdOf(e)), PlayerInput)!;
    expect(c2pi.coOwners).toEqual([c2.transport.localId]);

    pi.mergeStrategy = 'average';
    c1.sync.submitInput(snap(1, { moveX: 1 }, ['jump']));
    c2.sync.submitInput(snap(1, { moveX: -1 }, ['fire']));
    pump([h, c1, c2], net, 2);
    expect(pi.axis('moveX')).toBeCloseTo(0, 3);
    expect(pi.held('jump')).toBe(true);
    expect(pi.held('fire')).toBe(true);
    c2.sync.submitInput(snap(2, { moveX: 0 }));
    pump([h, c1, c2], net, 2);
    expect(pi.axis('moveX')).toBeCloseTo(0.5, 3);

    pi.mergeStrategy = 'first-wins';
    c1.sync.submitInput(snap(3, { moveX: 0 }));
    c2.sync.submitInput(snap(3, { moveX: -1 }));
    pump([h, c1, c2], net, 2);
    expect(pi.axis('moveX')).toBeCloseTo(-1, 3);
    expect(h.sync.inputFor(e)!.axes.moveX).toBeCloseTo(-1, 3);

    pi.mergeStrategy = 'additive';
    c1.sync.submitInput(snap(4, { moveX: 0.8 }));
    c2.sync.submitInput(snap(4, { moveX: 0.8 }));
    pump([h, c1, c2], net, 2);
    expect(pi.axis('moveX')).toBeCloseTo(1, 3);
  });

  it('delivers RPCs to host, all, others, a peer and entity scripts', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const c1 = await makePeer(net, 'g');
    const c2 = await makePeer(net, 'g');
    pump([h, c1, c2], net, 2);
    const log: Record<string, string[]> = { h: [], c1: [], c2: [] };
    h.sync.onRpc('ping', (args, from) => log.h.push(`${args[0]}@${from}`));
    c1.sync.onRpc('ping', (args, from) => log.c1.push(`${args[0]}@${from}`));
    c2.sync.onRpc('ping', (args, from) => log.c2.push(`${args[0]}@${from}`));
    c1.sync.rpc('ping', ['toHost'], 'host');
    c1.sync.rpc('ping', ['toAll'], 'all');
    h.sync.rpc('ping', ['fromHostOthers'], 'others');
    c2.sync.rpc('ping', ['toC1'], c1.transport.localId);
    pump([h, c1, c2], net, 2);
    const id = (p: Peer) => p.transport.localId;
    expect(log.h).toEqual([`toHost@${id(c1)}`, `toAll@${id(c1)}`]);
    expect(log.c1).toEqual([`toAll@${id(c1)}`, `fromHostOthers@${id(h)}`, `toC1@${id(c2)}`]);
    expect(log.c2.sort()).toEqual([`fromHostOthers@${id(h)}`, `toAll@${id(c1)}`]);

    // Entity RPC routed to the script's onRpc on every peer.
    for (const p of [h, c1, c2]) {
      p.engine.scripting.consoleLogging = false;
      p.engine.scripting.compile(`defineScript({ name: 'Rx', onRpc(ctx, name, args, from) { ctx.state.got = name + ':' + args[0]; } })`);
    }
    const scriptedPrefab: PrefabData = { version: 1, name: 'Scripted', entities: [{ id: 1, components: [{ type: 'Transform', data: {} }, { type: 'NetworkIdentity', data: {} }, { type: 'Script', data: { script: 'Rx' } }] }] };
    for (const p of [h, c1, c2]) p.engine.prefabs.set('Scripted', scriptedPrefab);
    const e = h.sync.spawn('Scripted');
    pump([h, c1, c2], net, 3); // scripts start
    h.sync.rpc('hit', [9], 'all', e);
    pump([h, c1, c2], net, 2);
    const netId = h.sync.netIdOf(e);
    for (const p of [h, c1, c2]) {
      const ent = p.sync.entityOf(netId);
      expect(p.engine.scripting.instanceOf(ent)!.ctx.state.got).toBe('hit:9');
    }
    expect(h.engine.world.hasComponent(e, Script)).toBe(true);
  });

  it('transfers ownership and updates PlayerInput.owner everywhere', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const c = await makePeer(net, 'g');
    pump([h, c], net, 2);
    const e = h.sync.spawn('Player');
    pump([h, c], net, 2);
    const changed: string[] = [];
    c.sync.on('ownershipChanged', (ev) => changed.push(`${ev.previous}>${ev.ownerId}`));
    h.sync.setOwner(e, c.transport.localId);
    pump([h, c], net, 2);
    const ce = c.sync.entityOf(h.sync.netIdOf(e));
    expect(c.engine.world.getComponent(ce, NetworkIdentity)!.ownerId).toBe(c.transport.localId);
    expect(c.engine.world.getComponent(ce, PlayerInput)!.owner).toBe(c.transport.localId);
    expect(changed).toEqual([`${h.transport.localId}>${c.transport.localId}`]);
    // The owner may hand it back through the host.
    c.sync.setOwner(ce, h.transport.localId);
    pump([h, c], net, 2);
    expect(h.engine.world.getComponent(e, NetworkIdentity)!.ownerId).toBe(h.transport.localId);
  });

  it('maps PlayerInput.owner "local" to the host peer id', async () => {
    const net = new MemoryNetwork();
    const engine = headless();
    const e = engine.world.createEntity('Hero');
    engine.world.addComponent(e, PlayerInput);
    engine.world.addComponent(e, NetworkIdentity);
    const t = net.createTransport();
    engine.net.setTransport(t);
    await t.connect({ roomId: 'g' });
    const sync = new HostAuthoritativeSync(engine, { autoInput: false });
    engine.net.setSync(sync);
    sync.start();
    expect(engine.world.getComponent(e, PlayerInput)!.owner).toBe(t.localId);
    expect(engine.world.getComponent(e, NetworkIdentity)!.ownerId).toBe(t.localId);
    expect(engine.world.getComponent(e, NetworkIdentity)!.netId).toBe(1);
  });

  it('supports owner authority: the owner streams state through the host', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const c1 = await makePeer(net, 'g');
    const c2 = await makePeer(net, 'g');
    pump([h, c1, c2], net, 2);
    const e = h.sync.spawn('Player', { ownerId: c1.transport.localId, authority: 'owner' });
    pump([h, c1, c2], net, 2);
    const netId = h.sync.netIdOf(e);
    const owned = c1.sync.entityOf(netId);
    expect(c1.engine.world.getComponent(owned, RigidBody2D)!.bodyType).toBe('dynamic');
    expect(h.engine.world.getComponent(e, RigidBody2D)!.bodyType).toBe('kinematic');
    c1.engine.world.getComponent(owned, Transform)!.setPosition(-4, 12);
    pump([h, c1, c2], net, 30);
    expect(h.engine.world.getComponent(e, Transform)!.x).toBeCloseTo(-4, 2);
    const other = c2.engine.world.getComponent(c2.sync.entityOf(netId), Transform)!;
    expect(other.x).toBeCloseTo(-4, 2);
    expect(other.y).toBeCloseTo(12, 2);
    // The owner keeps its own pose (never overwritten by host snapshots).
    expect(c1.engine.world.getComponent(owned, Transform)!.x).toBe(-4);
  });

  it('migrates the host when the host leaves and keeps replicating', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g', 'H');
    const c1 = await makePeer(net, 'g', 'C1');
    const c2 = await makePeer(net, 'g', 'C2');
    pump([h, c1, c2], net, 3);
    const e = h.sync.spawn('Player', { ownerId: c2.transport.localId, position: { x: 3, y: 3 } });
    pump([h, c1, c2], net, 10);
    const netId = h.sync.netIdOf(e);
    const hostEvents: string[] = [];
    c1.sync.on('hostChanged', (ev) => hostEvents.push(`${ev.isHost}`));
    c2.sync.on('hostChanged', (ev) => hostEvents.push(`${ev.isHost}`));
    await h.transport.disconnect();
    pump([c1, c2], net, 5);
    expect(c1.sync.isHost).toBe(true);
    expect(c2.sync.isHost).toBe(false);
    expect(hostEvents.sort()).toEqual(['false', 'true']);
    expect(c1.sync.players().map((p) => p.displayName).sort()).toEqual(['C1', 'C2']);
    expect(c2.sync.players().map((p) => p.displayName).sort()).toEqual(['C1', 'C2']);
    // The new host simulates the entity again and its moves reach the remaining client.
    const ne = c1.sync.entityOf(netId);
    expect(ne).not.toBe(NULL_ENTITY);
    expect(c1.engine.world.getComponent(ne, RigidBody2D)!.bodyType).toBe('dynamic');
    c1.engine.world.getComponent(ne, Transform)!.setPosition(20, 21);
    pump([c1, c2], net, 30);
    expect(c2.engine.world.getComponent(c2.sync.entityOf(netId), Transform)!.x).toBeCloseTo(20, 2);
    // Late joiner after migration still gets state from the new host.
    const c3 = await makePeer(net, 'g', 'C3');
    pump([c1, c2, c3], net, 10);
    expect(c3.sync.entityOf(netId)).not.toBe(NULL_ENTITY);
    expect(c3.sync.players()).toHaveLength(3);
  });

  it('spawnPlayers gives every player an avatar and cleans up on leave', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g', 'H');
    const stop = h.sync.spawnPlayers('Player', { position: (i) => ({ x: i * 2, y: 0 }) });
    pump([h], net, 3);
    const c = await makePeer(net, 'g', 'C');
    pump([h, c], net, 4);
    const owners = Array.from(h.engine.world.componentsOfType(NetworkIdentity)).map((n) => n.ownerId).sort();
    expect(owners).toEqual([h.transport.localId, c.transport.localId].sort());
    await c.transport.disconnect();
    pump([h], net, 3);
    expect(Array.from(h.engine.world.componentsOfType(NetworkIdentity)).map((n) => n.ownerId)).toEqual([h.transport.localId]);
    stop();
  });
});

// ------------------------------------------------------------------ lockstep

describe('HostAuthoritativeSync spawn state and client scripts', () => {
  const avatarPrefab = (script: string): PrefabData => ({
    version: 1,
    name: 'Avatar',
    entities: [{
      id: 1,
      name: 'Avatar',
      components: [
        { type: 'Transform', data: {} },
        { type: 'NetworkIdentity', data: {} },
        { type: 'NetTransform', data: {} },
        { type: 'PlayerInput', data: {} },
        { type: 'RigidBody2D', data: { gravityScale: 0 } },
        { type: 'Script', data: { script } },
      ],
    }],
  });

  async function scriptedPeers(net: MemoryNetwork, source: string, scriptName: string): Promise<Peer[]> {
    const h = await makePeer(net, 'g', 'Host');
    const c = await makePeer(net, 'g', 'Client');
    for (const p of [h, c]) {
      p.engine.scripting.consoleLogging = false;
      p.engine.scripting.compile(source);
      p.engine.prefabs.set('Avatar', avatarPrefab(scriptName));
    }
    pump([h, c], net, 2);
    return [h, c];
  }

  it('replicates Script.props and Name written right after spawn(), before the remote script starts', async () => {
    const net = new MemoryNetwork();
    const source = `defineScript({ name: 'Look', props: { color: { type: 'string', default: '#000000' }, label: { type: 'string', default: 'P?' } }, onStart(ctx) { ctx.state.seen = ctx.props.color + '/' + ctx.props.label; } })`;
    const [h, c] = await scriptedPeers(net, source, 'Look');
    const e = h.sync.spawn('Avatar', { ownerId: c.transport.localId, position: { x: 1, y: 2 } });
    // The demos' GameManagers do exactly this: configure the prefab instance after spawn().
    const script = h.engine.world.getComponent(e, Script)!;
    script.props.color = '#ff7a3d';
    script.props.label = 'P2';
    h.engine.world.getComponent(e, Name)!.name = 'Avatar P2';
    pump([h, c], net, 3);
    const ce = c.sync.entityOf(h.sync.netIdOf(e));
    expect(ce).not.toBe(NULL_ENTITY);
    expect(c.engine.world.getComponent(ce, Script)!.props).toMatchObject({ color: '#ff7a3d', label: 'P2' });
    expect(c.engine.world.nameOf(ce)).toBe('Avatar P2');
    expect(c.engine.scripting.instanceOf(ce)!.ctx.state.seen).toBe('#ff7a3d/P2');
    // Late joiners receive the same values with the welcome.
    const late = await makePeer(net, 'g', 'Late');
    late.engine.scripting.consoleLogging = false;
    late.engine.scripting.compile(source);
    late.engine.prefabs.set('Avatar', avatarPrefab('Look'));
    pump([h, c, late], net, 5);
    const le = late.sync.entityOf(h.sync.netIdOf(e));
    expect(le).not.toBe(NULL_ENTITY);
    expect(late.engine.scripting.instanceOf(le)!.ctx.state.seen).toBe('#ff7a3d/P2');
  });

  it('drops a spawn that is despawned in the same frame instead of announcing it', async () => {
    const net = new MemoryNetwork();
    const [h, c] = await scriptedPeers(net, `defineScript({ name: 'Noop' })`, 'Noop');
    const spawnedOnClient: number[] = [];
    c.sync.on('spawned', (ev) => spawnedOnClient.push(ev.netId));
    const e = h.sync.spawn('Avatar');
    h.sync.despawn(e);
    pump([h, c], net, 3);
    expect(spawnedOnClient).toEqual([]);
    expect(Array.from(c.engine.world.componentsOfType(NetworkIdentity)).filter((n) => n.spawned)).toHaveLength(0);
  });

  it('runs onOwnerInput only where the entity is simulated: on the host, not on the client copy', async () => {
    const net = new MemoryNetwork();
    const source = `defineScript({ name: 'Counter', onOwnerInput(ctx) { ctx.state.n = (ctx.state.n || 0) + 1; } })`;
    const [h, c] = await scriptedPeers(net, source, 'Counter');
    const e = h.sync.spawn('Avatar', { ownerId: c.transport.localId });
    pump([h, c], net, 3);
    const ce = c.sync.entityOf(h.sync.netIdOf(e));
    expect(ce).not.toBe(NULL_ENTITY);
    for (let t = 1; t <= 5; t++) {
      c.sync.submitInput(snap(t, { moveX: 1 }));
      pump([h, c], net, 1);
    }
    expect(h.sync.simulatesEntity(e)).toBe(true);
    expect(c.sync.simulatesEntity(ce)).toBe(false);
    expect(h.engine.scripting.instanceOf(e)!.ctx.state.n).toBeGreaterThan(3);
    expect(c.engine.scripting.instanceOf(ce)!.ctx.state.n).toBeUndefined();
  });

  it('runs onHostChanged on the new host, which takes over spawning and despawns the old host\'s avatar', async () => {
    const net = new MemoryNetwork();
    // A GameManager-style script: spawns one Avatar per player, adopts what exists when it takes over.
    const source = `defineScript({
      name: 'GM',
      onStart(ctx) { ctx.state.avatars = {}; ctx.state.hostCalls = []; if (ctx.net.isHost) this.serve(ctx); },
      onHostChanged(ctx, isHost, info) { ctx.state.hostCalls.push([isHost, info.previous]); if (isHost) this.serve(ctx); },
      serve(ctx) {
        const s = ctx.state, sync = ctx.net.hub.sync;
        if (s.serving) return;
        s.serving = true;
        for (const e of ctx.world.with('NetworkIdentity')) { const ni = ctx.getOn(e, 'NetworkIdentity'); if (ni.prefab === 'Avatar') s.avatars[ni.ownerId] = e; }
        const spawnFor = (id) => { if (!s.avatars[id]) s.avatars[id] = ctx.net.spawn('Avatar', { ownerId: id }); };
        for (const p of sync.players()) spawnFor(p.peerId);
        sync.on('playerJoined', (e) => spawnFor(e.peerId));
        sync.on('playerLeft', (e) => { const ent = s.avatars[e.peerId]; delete s.avatars[e.peerId]; if (ent !== undefined && ctx.world.isAlive(ent)) sync.despawn(ent); });
      },
    })`;
    const peers: Peer[] = [];
    const addPeer = async (name: string) => {
      const p = await makePeer(net, 'g', name);
      p.engine.scripting.consoleLogging = false;
      p.engine.scripting.compile(source);
      p.engine.prefabs.set('Avatar', avatarPrefab('Look'));
      p.engine.scripting.compile(`defineScript({ name: 'Look' })`);
      const gm = p.engine.world.createEntity('GameManager');
      p.engine.world.addComponent(gm, Script, { script: 'GM' });
      peers.push(p);
      return p;
    };
    const h = await addPeer('H');
    pump(peers, net, 3);
    const c1 = await addPeer('C1');
    const c2 = await addPeer('C2');
    pump(peers, net, 6);
    const avatars = (p: Peer) => Array.from(p.engine.world.componentsOfType(NetworkIdentity)).filter((n) => n.prefab === 'Avatar').map((n) => n.ownerId).sort();
    const ids = [h, c1, c2].map((p) => p.transport.localId).sort();
    for (const p of peers) expect(avatars(p)).toEqual(ids);
    const gmState = (p: Peer) => p.engine.scripting.instanceOf(p.engine.world.findByName('GameManager')!)!.ctx.state as { hostCalls: [boolean, string][]; serving?: boolean };

    await h.transport.disconnect();
    peers.splice(peers.indexOf(h), 1);
    pump(peers, net, 8);
    expect(c1.sync.isHost).toBe(true);
    expect(gmState(c1).hostCalls).toEqual([[true, h.transport.localId]]);
    expect(gmState(c2).hostCalls).toEqual([[false, h.transport.localId]]);
    expect(gmState(c2).serving).toBeUndefined();
    // The new host's manager adopted the two remaining avatars and despawned the old host's.
    const remaining = [c1, c2].map((p) => p.transport.localId).sort();
    expect(avatars(c1)).toEqual(remaining);
    expect(avatars(c2)).toEqual(remaining);
    // Their bodies simulate on the new host again and the roster is clean.
    for (const ni of c1.engine.world.componentsOfType(NetworkIdentity)) expect(c1.engine.world.getComponent(ni.entity, RigidBody2D)!.bodyType).toBe('dynamic');
    expect(c1.sync.players().map((p) => p.displayName).sort()).toEqual(['C1', 'C2']);

    // A late joiner is spawned by the new host and sees everyone.
    const c3 = await addPeer('C3');
    pump(peers, net, 8);
    const all = [c1, c2, c3].map((p) => p.transport.localId).sort();
    for (const p of peers) expect(avatars(p)).toEqual(all);
    // The newcomer's input reaches its avatar on the new host.
    const mine = Array.from(c1.engine.world.componentsOfType(NetworkIdentity)).find((n) => n.ownerId === c3.transport.localId)!;
    c3.sync.submitInput(snap(1, { moveX: 1 }, ['fire']));
    pump(peers, net, 3);
    expect(c1.engine.world.getComponent(mine.entity, PlayerInput)!.axis('moveX')).toBe(1);
  });

  it('hands scene entities and unclaimed spawns of the old host to the new host', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g', 'H');
    const puck = h.engine.world.createEntity('Puck');
    h.engine.world.addComponent(puck, NetworkIdentity);
    h.engine.world.addComponent(puck, RigidBody2D);
    const c1 = await makePeer(net, 'g', 'C1');
    const cPuck = c1.engine.world.createEntity('Puck');
    c1.engine.world.addComponent(cPuck, NetworkIdentity);
    c1.engine.world.addComponent(cPuck, RigidBody2D);
    pump([h, c1], net, 3);
    expect(c1.engine.world.getComponent(cPuck, NetworkIdentity)!.ownerId).toBe(h.transport.localId);
    const avatar = h.sync.spawn('Player', { ownerId: h.transport.localId });
    pump([h, c1], net, 3);
    const netId = h.sync.netIdOf(avatar);
    const order: string[] = [];
    c1.sync.on('hostChanged', () => order.push('hostChanged'));
    c1.sync.on('playerLeft', (e) => order.push(`playerLeft:${e.peerId}`));
    c1.sync.on('ownershipChanged', (e) => order.push(`owner:${c1.engine.world.nameOf(e.entity)}`));
    await h.transport.disconnect();
    pump([c1], net, 3);
    // Scene entity first, then the hook, then the departure, then the leftover avatar.
    expect(order).toEqual(['owner:Puck', 'hostChanged', `playerLeft:${h.transport.localId}`, 'owner:Player']);
    const me = c1.transport.localId;
    expect(c1.engine.world.getComponent(cPuck, NetworkIdentity)!.ownerId).toBe(me);
    const ni = c1.engine.world.getComponent(c1.sync.entityOf(netId), NetworkIdentity)!;
    expect(ni.ownerId).toBe(me);
    expect(c1.engine.world.getComponent(ni.entity, PlayerInput)!.owner).toBe(me);
    expect(c1.engine.world.getComponent(ni.entity, RigidBody2D)!.bodyType).toBe('dynamic');
  });

  it('keeps a press edge when two client ticks arrive between two host steps', async () => {
    const net = new MemoryNetwork();
    const h = await makePeer(net, 'g');
    const c = await makePeer(net, 'g');
    pump([h, c], net, 2);
    const e = h.sync.spawn('Player', { ownerId: c.transport.localId });
    pump([h, c], net, 2);
    const pi = h.engine.world.getComponent(e, PlayerInput)!;
    c.sync.submitInput(snap(1, {}, ['jump'], ['jump']));
    c.sync.submitInput(snap(2, {}, [], [])); // key already released on the client
    net.flush();
    h.engine.step(1 / 60);
    expect(pi.pressed('jump')).toBe(true);
    expect(pi.held('jump')).toBe(false);
    h.engine.step(1 / 60);
    expect(pi.pressed('jump')).toBe(false); // edge delivered exactly once
  });
});

describe('LockstepSync', () => {
  const moverScript = `defineScript({ name: 'Mover', onOwnerInput(ctx, s, dt) { ctx.transform.x += (s.axes.moveX || 0) * 3 * dt; if (s.held.includes('jump')) ctx.state.jumps = (ctx.state.jumps || 0) + 1; ctx.transform.y += ctx.random.range(-0.01, 0.01); } })`;

  function lockPeer(net: MemoryNetwork, ownerIds: string[], transport: MemoryTransport): { engine: Engine; sync: LockstepSync; entities: Entity[] } {
    const engine = headless();
    engine.scripting.consoleLogging = false;
    // Presence pings are wall-clock driven and would consume the seeded jitter RNG at
    // unpredictable points, making the stall pattern (and final tick) flaky under load.
    engine.net.pingIntervalMs = 0;
    engine.scripting.compile(moverScript);
    const entities: Entity[] = [];
    for (const owner of ownerIds) {
      const e = engine.world.createEntity(`P-${owner}`);
      engine.world.addComponent(e, PlayerInput, { owner });
      engine.world.addComponent(e, NetworkIdentity, { ownerId: owner });
      engine.world.addComponent(e, Script, { script: 'Mover' });
      engine.world.addComponent(e, RigidBody2D, { gravityScale: 0 });
      entities.push(e);
    }
    engine.net.setTransport(transport);
    const sync = new LockstepSync(engine, { autoInput: false, inputDelay: 2, hashInterval: 30 });
    engine.net.setSync(sync);
    return { engine, sync, entities };
  }

  it('two engines end in identical state from exchanged inputs (with latency)', async () => {
    const net = new MemoryNetwork({ latency: 30, jitter: 10, seed: 5 });
    const [ta, tb] = net.createTransports(2);
    await ta.connect({ roomId: 'L' });
    await tb.connect({ roomId: 'L' });
    const owners = [ta.localId, tb.localId];
    const A = lockPeer(net, owners, ta);
    const B = lockPeer(net, owners, tb);
    A.sync.start();
    B.sync.start();
    const desyncs: number[] = [];
    A.sync.on('desync', (e) => desyncs.push(e.tick));
    B.sync.on('desync', (e) => desyncs.push(e.tick));
    A.sync.begin(1234);
    net.flush();
    for (let i = 0; i < 120; i++) {
      A.sync.submitInput(snap(0, { moveX: 1 }, i % 2 ? ['jump'] : []));
      B.sync.submitInput(snap(0, { moveX: -0.5 }));
      A.engine.step(1 / 60);
      B.engine.step(1 / 60);
      net.advance(1000 / 60);
    }
    net.flush();
    for (let i = 0; i < 10; i++) { A.engine.step(1 / 60); B.engine.step(1 / 60); net.flush(); }
    // Jitter can leave one peer a tick behind; lockstep only guarantees identical state at
    // equal ticks, so let the laggard catch up (it already holds the other side's inputs).
    for (let guard = 0; guard < 10 && A.sync.tick !== B.sync.tick; guard++) {
      if (A.sync.tick < B.sync.tick) A.engine.step(1 / 60); else B.engine.step(1 / 60);
      net.flush();
    }
    expect(A.sync.tick).toBeGreaterThan(100);
    expect(A.sync.tick).toBe(B.sync.tick);
    expect(A.sync.stalls).toBeGreaterThan(0); // latency really forced waits
    const sa = JSON.stringify(A.engine.saveScene().entities);
    const sb = JSON.stringify(B.engine.saveScene().entities);
    expect(sa).toBe(sb);
    expect(A.sync.worldHash()).toBe(B.sync.worldHash());
    expect(desyncs).toEqual([]);
    const xa = A.engine.world.getComponent(A.entities[0], Transform)!.x;
    const xb = A.engine.world.getComponent(A.entities[1], Transform)!.x;
    expect(xa).toBeGreaterThan(1); // moved right by A's input
    expect(xb).toBeLessThan(-0.5); // moved left by B's input
    expect(A.engine.scripting.instanceOf(A.entities[0])!.ctx.state.jumps).toBeGreaterThan(10);
    expect(A.sync.players().map((p) => p.peerId).sort()).toEqual(owners.slice().sort());
  });
});

// -------------------------------------------------------------------- misc

describe('createTransport / parseNetParams', () => {
  it('parses URL parameters with defaults', () => {
    expect(parseNetParams('?room=ABC&name=Zoe')).toEqual({ room: 'ABC', net: 'peer', server: '', name: 'Zoe' });
    expect(parseNetParams('room=X&net=ws&server=wss://h/ws')).toEqual({ room: 'X', net: 'ws', server: 'wss://h/ws', name: '' });
    expect(parseNetParams('?net=bogus').net).toBe('peer');
    expect(parseNetParams('?net=local').net).toBe('local');
  });

  it('invite links keep the transport and server, keep an explicit net=, and drop the personal name', () => {
    const local = new URL(inviteUrl({ room: 'ABC', net: 'local', server: '', name: 'Zoe' }, 'https://x.test/play.html?project=p&room=OLD&net=local&name=Zoe'));
    expect(local.searchParams.get('room')).toBe('ABC');
    expect(local.searchParams.get('net')).toBe('local');
    expect(local.searchParams.get('project')).toBe('p');
    expect(local.searchParams.has('name')).toBe(false);
    const ws = new URL(inviteUrl({ room: 'R', net: 'ws', server: 'wss://h/ws', name: '' }, 'https://x.test/play.html?project=p'));
    expect(ws.searchParams.get('net')).toBe('ws');
    expect(ws.searchParams.get('server')).toBe('wss://h/ws');
    // Default transport: nothing added, but a `net=` the page already carries is not stripped.
    expect(new URL(inviteUrl({ room: 'R', net: 'peer', server: '', name: '' }, 'https://x.test/play.html?project=p')).searchParams.has('net')).toBe(false);
    expect(new URL(inviteUrl({ room: 'R', net: 'peer', server: '', name: '' }, 'https://x.test/play.html?project=p&net=peer')).searchParams.get('net')).toBe('peer');
    // Switching transport keeps room and name.
    const sw = new URL(switchTransportUrl('local', 'https://x.test/play.html?project=p&room=R&name=Zoe&server=wss://h/ws'));
    expect(sw.searchParams.get('net')).toBe('local');
    expect(sw.searchParams.get('room')).toBe('R');
    expect(sw.searchParams.get('name')).toBe('Zoe');
    expect(sw.searchParams.has('server')).toBe(false);
  });

  it('creates memory transports on a shared network and rejects unknown kinds', async () => {
    const net = new MemoryNetwork();
    const a = createTransport('memory', { network: net });
    const b = createTransport('memory', { network: net });
    await a.connect({ roomId: 'm' });
    await b.connect({ roomId: 'm' });
    expect(a.isHost).toBe(true);
    expect(b.hostId).toBe(a.localId);
    expect(() => createTransport('nope')).toThrow(/Unknown transport/);
    expect(createTransport('null').name).toBe('null');
  });
});

// Keep the snapshot helper referenced for type coverage.
void createEmptySnapshot;
void NetTransform;
