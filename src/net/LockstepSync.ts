import type { Engine } from '../core/Engine';
import { EventEmitter } from '../core/EventEmitter';
import { type Entity, NULL_ENTITY } from '../core/ecs/Entity';
import { instantiatePrefab } from '../core/ecs/Scene';
import type { System } from '../core/ecs/System';
import { PlayerInput } from '../input/PlayerInput';
import { type EncodedSnapshot, type InputSnapshot, createEmptySnapshot, decodeSnapshot, encodeSnapshot, mergeSnapshots } from '../input/InputSnapshot';
import { NetworkIdentity } from './components';
import type { NetChannel } from './NetHub';
import { DEFAULT_NET_OPTIONS, type NetSync, type NetSyncEvents, type NetSyncOptions, type RpcHandler } from './NetSync';
import type { PeerId, Transport } from './Transport';

/** Options for {@link LockstepSync}. */
export interface LockstepOptions extends NetSyncOptions {
  /** Ticks of input delay hiding network latency. Default 3. */
  inputDelay?: number;
  /** Exchange a world hash every N ticks to detect desyncs (0 = off). Default 60. */
  hashInterval?: number;
  /** Read `engine.input` automatically each fixed step. Default true. */
  autoInput?: boolean;
}

interface QueuedRpc { name: string; args: unknown[]; netId?: number }

type Msg =
  | { t: 'go'; peers: { id: PeerId; name: string }[]; seed: number }
  | { t: 'in'; tick: number; s: EncodedSnapshot; r?: QueuedRpc[] }
  | { t: 'hash'; tick: number; h: number }
  | { t: 'busy' };

interface TickInputs { inputs: Map<PeerId, InputSnapshot>; rpcs: Map<PeerId, QueuedRpc[]> }

/**
 * Deterministic lockstep: every participant runs the same fixed steps from
 * the same inputs. Each peer broadcasts its {@link InputSnapshot} for tick
 * `T + inputDelay` while executing tick `T`; a step runs only when every
 * participant's input for that tick has arrived, otherwise the `fixedUpdate`
 * systems are stalled for that step. RPCs ride along with the inputs and are
 * delivered on every peer at the same tick, so they are deterministic too.
 *
 * Determinism relies on the core: seeded `engine.random`, sorted physics
 * bodies/pairs and no wall-clock reads in `fixedUpdate`. A world hash is
 * exchanged every `hashInterval` ticks and a mismatch emits `desync`.
 *
 * All participants must be connected before the host calls {@link begin}
 * (the lobby's Start button); late joiners are told the room is `busy`.
 */
export class LockstepSync implements NetSync {
  readonly options: Required<LockstepOptions>;
  readonly events = new EventEmitter<NetSyncEvents>();
  /** Ticks executed so far. */
  tick = 0;

  private ch: NetChannel;
  private unsub: (() => void)[] = [];
  private started = false;
  private running = false;
  private participants: { id: PeerId; name: string }[] = [];
  private ticks = new Map<number, TickInputs>();
  private lastSentTick = -1;
  private pendingInput: InputSnapshot | null = null;
  private pendingRpcs: QueuedRpc[] = [];
  private rpcHandlers = new Map<string, Set<RpcHandler>>();
  private stalled = false;
  private stalledSystems: System[] = [];
  private hashes = new Map<number, Map<PeerId, number>>();
  private actionNames: string[] = [];
  private axisNames: string[] = [];
  private byNetId = new Map<number, Entity>();
  private nextNetId = 1;
  /** Steps skipped because inputs were missing (diagnostics). */
  stalls = 0;

  constructor(readonly engine: Engine, options: Partial<LockstepOptions> = {}) {
    this.options = { ...DEFAULT_NET_OPTIONS, mode: 'lockstep', inputDelay: 3, hashInterval: 60, autoInput: true, ...options };
    this.ch = engine.net.channel('_lock');
  }

  get transport(): Transport {
    return this.engine.net.transport;
  }

  get isHost(): boolean {
    return this.transport.isHost;
  }

  get localId(): PeerId {
    return this.transport.localId;
  }

  /** True once `go` was received/sent and steps are executing. */
  get inGame(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------- lifecycle

  start(): void {
    if (this.started) return;
    this.started = true;
    this.actionNames = this.engine.input.actionNames();
    this.axisNames = this.engine.input.axisNames();
    this.unsub.push(
      this.ch.on((from, data) => this.onMessage(from, data as Msg)),
      this.engine.net.events.on('peerLeft', (e) => this.onPeerLeft(e.peerId)),
      this.engine.net.events.on('peerJoined', (e) => { if (this.running && this.isHost) { const busy: Msg = { t: 'busy' }; this.ch.send(e.peerId, busy); } }),
    );
    for (const ni of this.engine.world.componentsOfType(NetworkIdentity)) {
      if (ni.netId === 0) ni.netId = this.nextNetId;
      this.nextNetId = Math.max(this.nextNetId, ni.netId + 1);
      this.byNetId.set(ni.netId, ni.entity);
    }
    const hostId = this.transport.hostId;
    for (const pi of this.engine.world.componentsOfType(PlayerInput)) if (pi.owner === 'local') pi.owner = hostId;
    this.stall(true);
    this.events.emit('connected', { localId: this.localId, isHost: this.isHost, hostId });
  }

  /**
   * Host: lock the roster and start the simulation on every participant.
   * Sends `go` with the ordered peer list and the shared random seed.
   */
  begin(seed: number = (Math.random() * 0xffffffff) >>> 0): void {
    if (!this.isHost || this.running) return;
    const hub = this.engine.net;
    const peers = [{ id: this.localId, name: hub.displayName || this.localId }, ...this.transport.peers.map((id) => ({ id, name: hub.nameOf(id) }))];
    const go: Msg = { t: 'go', peers, seed };
    this.ch.send('all', go);
    this.onGo(peers, seed);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.running = false;
    for (const off of this.unsub) off();
    this.unsub.length = 0;
    this.stall(false);
    this.ticks.clear();
    this.hashes.clear();
    this.events.emit('disconnected', { reason: 'stopped' });
  }

  private onGo(peers: { id: PeerId; name: string }[], seed: number): void {
    this.participants = peers.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.engine.random.seed(seed);
    this.tick = 0;
    this.lastSentTick = -1;
    this.ticks.clear();
    // The first `inputDelay` ticks have no input from anyone.
    for (let t = 0; t < this.options.inputDelay; t++) {
      const ti = this.ticksFor(t);
      for (const p of this.participants) ti.inputs.set(p.id, createEmptySnapshot(t));
    }
    this.running = true;
    for (const p of this.participants) this.events.emit('playerJoined', { peerId: p.id, displayName: p.name });
  }

  private ticksFor(tick: number): TickInputs {
    let ti = this.ticks.get(tick);
    if (!ti) this.ticks.set(tick, (ti = { inputs: new Map(), rpcs: new Map() }));
    return ti;
  }

  // ----------------------------------------------------------- engine hooks

  fixedUpdate(_dt: number): void {
    if (!this.started || !this.running) { this.stall(true); return; }
    // 1. Publish our input for the future tick (once per tick).
    const future = this.tick + this.options.inputDelay;
    if (this.lastSentTick < future) {
      const snap = this.options.autoInput ? this.engine.input.getSnapshot() : this.pendingInput ?? createEmptySnapshot(future);
      const enc = encodeSnapshot(snap, this.actionNames, this.axisNames);
      enc[0] = future;
      const msg: Msg = { t: 'in', tick: future, s: enc };
      if (this.pendingRpcs.length) { msg.r = this.pendingRpcs; this.pendingRpcs = []; }
      this.ch.send('all', msg);
      this.onInput(this.localId, msg);
      this.lastSentTick = future;
    }
    // 2. Execute the current tick only when everyone's input is here.
    const ti = this.ticks.get(this.tick);
    if (!ti || !this.participants.every((p) => ti.inputs.has(p.id))) {
      this.stalls++;
      this.stall(true);
      return;
    }
    this.stall(false);
    this.applyInputs(ti);
    this.deliverRpcs(ti);
    this.ticks.delete(this.tick);
    this.tick++;
    if (this.options.hashInterval > 0 && this.tick % this.options.hashInterval === 0) this.exchangeHash();
  }

  update(_dt: number): void {
    if (!this.started) return;
    this.engine.net.update();
  }

  /** Disable/enable every `fixedUpdate` system so a step without inputs does nothing. */
  private stall(on: boolean): void {
    const world = this.engine.world;
    if (on && !this.stalled) {
      this.stalled = true;
      this.stalledSystems.length = 0;
      for (const s of world.systemsIn('fixedUpdate')) {
        if (s.enabled !== false) { s.enabled = false; this.stalledSystems.push(s); }
      }
    } else if (!on && this.stalled) {
      this.stalled = false;
      for (const s of this.stalledSystems) s.enabled = true;
      this.stalledSystems.length = 0;
    }
  }

  private applyInputs(ti: TickInputs): void {
    const strategyDefault = this.options.mergeStrategy;
    for (const pi of this.engine.world.componentsOfType(PlayerInput)) {
      const owner = pi.owner;
      if (pi.coOwners.length > 0 && this.options.sharedControl) {
        _contrib.length = 0;
        const o = ti.inputs.get(owner);
        if (o) _contrib.push(o);
        for (const co of pi.coOwners) { const s = ti.inputs.get(co); if (s) _contrib.push(s); }
        if (_contrib.length) pi.apply(mergeSnapshots(_contrib, pi.mergeStrategy ?? strategyDefault));
        continue;
      }
      const s = ti.inputs.get(owner);
      if (s) pi.apply(s);
    }
  }

  private deliverRpcs(ti: TickInputs): void {
    // Deterministic order: by participant id.
    for (const p of this.participants) {
      const list = ti.rpcs.get(p.id);
      if (!list) continue;
      for (const r of list) this.deliverRpc(r.name, r.args, p.id, r.netId);
    }
  }

  private exchangeHash(): void {
    const h = this.worldHash();
    const msg: Msg = { t: 'hash', tick: this.tick, h };
    this.ch.send('all', msg);
    this.onHash(this.localId, this.tick, h);
  }

  /** FNV-1a hash of the serialized world (transient fields excluded by the registry). */
  worldHash(): number {
    const json = JSON.stringify(this.engine.saveScene().entities);
    let h = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) {
      h ^= json.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // --------------------------------------------------------------- messages

  private onMessage(from: PeerId, msg: Msg): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'go':
        if (from === this.transport.hostId && !this.running) this.onGo(msg.peers, msg.seed);
        break;
      case 'in':
        this.onInput(from, msg);
        break;
      case 'hash':
        this.onHash(from, msg.tick, msg.h);
        break;
      case 'busy':
        this.engine.warn('lockstep: the game already started; late joining is not supported');
        this.events.emit('disconnected', { reason: 'busy' });
        break;
    }
  }

  private onInput(from: PeerId, msg: Msg & { t: 'in' }): void {
    if (msg.tick < this.tick) return; // too late, already simulated (should not happen with a stable delay)
    const ti = this.ticksFor(msg.tick);
    const snap = decodeSnapshot(msg.s, this.actionNames, this.axisNames);
    snap.tick = msg.tick;
    ti.inputs.set(from, snap);
    if (msg.r?.length) ti.rpcs.set(from, msg.r);
  }

  private onHash(from: PeerId, tick: number, h: number): void {
    let row = this.hashes.get(tick);
    if (!row) this.hashes.set(tick, (row = new Map()));
    row.set(from, h);
    const mine = row.get(this.localId);
    if (mine !== undefined) {
      for (const [peer, other] of row) {
        if (peer !== this.localId && other !== mine) {
          this.engine.warn(`lockstep: desync at tick ${tick} with ${peer}`);
          this.events.emit('desync', { tick, peerId: peer });
        }
      }
    }
    for (const t of Array.from(this.hashes.keys())) if (t < tick - 5 * this.options.hashInterval) this.hashes.delete(t);
  }

  private onPeerLeft(peerId: PeerId): void {
    const i = this.participants.findIndex((p) => p.id === peerId);
    if (i < 0) return;
    this.participants.splice(i, 1);
    this.events.emit('playerLeft', { peerId });
  }

  // ------------------------------------------------------------- NetSync API

  /**
   * Spawn a prefab deterministically on this peer. In lockstep the calling
   * code runs on every peer, so no message is sent; ids are assigned in order.
   */
  spawn(prefab: string, opts: { ownerId?: PeerId; position?: { x: number; y: number; z?: number }; authority?: 'host' | 'owner' } = {}): Entity {
    const data = this.engine.prefabs.get(prefab);
    if (!data) { this.engine.warn(`net.spawn: unknown prefab "${prefab}"`); return NULL_ENTITY; }
    const world = this.engine.world;
    const e = instantiatePrefab(world, data, { position: opts.position });
    const ni = world.getComponent(e, NetworkIdentity) ?? world.addComponent(e, NetworkIdentity);
    ni.netId = this.nextNetId++;
    ni.ownerId = opts.ownerId ?? this.transport.hostId;
    ni.prefab = prefab;
    ni.spawned = true;
    const pi = world.getComponent(e, PlayerInput);
    if (pi) pi.owner = ni.ownerId;
    this.byNetId.set(ni.netId, e);
    this.events.emit('spawned', { entity: e, netId: ni.netId, ownerId: ni.ownerId });
    return e;
  }

  despawn(entity: Entity): void {
    const ni = this.engine.world.getComponent(entity, NetworkIdentity);
    if (ni) { this.byNetId.delete(ni.netId); this.events.emit('despawned', { entity, netId: ni.netId }); }
    this.engine.world.destroyEntityDeferred(entity);
  }

  setOwner(entity: Entity, ownerId: PeerId): void {
    const ni = this.engine.world.getComponent(entity, NetworkIdentity);
    const pi = this.engine.world.getComponent(entity, PlayerInput);
    const previous = ni?.ownerId ?? pi?.owner ?? '';
    if (ni) ni.ownerId = ownerId;
    if (pi) pi.owner = ownerId;
    this.events.emit('ownershipChanged', { entity, ownerId, previous });
  }

  shareControl(entity: Entity, peerId: PeerId, enabled: boolean): void {
    const pi = this.engine.world.getComponent(entity, PlayerInput);
    const ni = this.engine.world.getComponent(entity, NetworkIdentity);
    const apply = (list: string[]): string[] => { const out = list.filter((p) => p !== peerId); if (enabled) out.push(peerId); return out; };
    if (pi) pi.coOwners = apply(pi.coOwners);
    if (ni) ni.sharedWith = apply(ni.sharedWith);
  }

  /** Provide the local input for the next published tick (when `autoInput` is off). */
  submitInput(snapshot: InputSnapshot): void {
    this.pendingInput = snapshot;
  }

  inputFor(entity: Entity): InputSnapshot | undefined {
    return this.engine.world.getComponent(entity, PlayerInput)?.snapshot;
  }

  onRpc(name: string, handler: RpcHandler): () => void {
    let set = this.rpcHandlers.get(name);
    if (!set) this.rpcHandlers.set(name, (set = new Set()));
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  /** Queue an RPC; it is delivered on every peer at the same simulation tick (target is ignored). */
  rpc(name: string, args: unknown[] = [], _target?: PeerId | 'host' | 'all' | 'others', entity?: Entity): void {
    const netId = entity !== undefined ? this.engine.world.getComponent(entity, NetworkIdentity)?.netId : undefined;
    this.pendingRpcs.push({ name, args, netId });
  }

  private deliverRpc(name: string, args: unknown[], from: PeerId, netId?: number): void {
    const entity = netId !== undefined ? this.byNetId.get(netId) : undefined;
    this.events.emit('rpc', { name, from, args, entity });
    const set = this.rpcHandlers.get(name);
    if (set) for (const h of Array.from(set)) h(args, from, entity);
    if (entity !== undefined) this.engine.scripting.rpc(entity, name, args, from);
  }

  on<K extends keyof NetSyncEvents>(event: K, fn: (payload: NetSyncEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  players(): { peerId: PeerId; displayName: string; isHost: boolean; rtt: number }[] {
    const hub = this.engine.net;
    const host = this.transport.hostId;
    const list = this.running ? this.participants : [{ id: this.localId, name: hub.displayName || this.localId }, ...this.transport.peers.map((id) => ({ id, name: hub.nameOf(id) }))];
    return list.map((p) => ({ peerId: p.id, displayName: p.name, isHost: p.id === host, rtt: p.id === this.localId ? 0 : hub.rttTo(p.id) }));
  }
}

const _contrib: InputSnapshot[] = [];
