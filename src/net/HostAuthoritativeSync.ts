import type { Engine } from '../core/Engine';
import { EventEmitter } from '../core/EventEmitter';
import { Quat, Vec3 } from '../core/math';
import { type Entity, NULL_ENTITY } from '../core/ecs/Entity';
import { instantiatePrefab } from '../core/ecs/Scene';
import { Transform } from '../core/ecs/Transform';
import { Name } from '../core/ecs/components';
import { PlayerInput } from '../input/PlayerInput';
import { type InputSnapshot, cloneSnapshot, createEmptySnapshot, mergeSnapshots } from '../input/InputSnapshot';
import { RigidBody2D, type BodyType } from '../physics/components2d';
import { RigidBody3D } from '../physics/physics3d';
import { NetTransform, NetworkIdentity } from './components';
import { InterpolationSystem } from './InterpolationSystem';
import type { NetChannel } from './NetHub';
import { DEFAULT_NET_OPTIONS, type NetSync, type NetSyncEvents, type NetSyncOptions, type RpcHandler } from './NetSync';
import { replicationFieldsFor, serializeReplicated } from './replication';
import {
  DEFAULT_POLICY, type EntityState, type EntitySyncPolicy, POS_STEP, SCALE_STEP, SF, SnapFlag, SnapshotHistory, VEL_STEP,
  captureTransform, decodeWorldSnapshot, encodeWorldSnapshot, newEntityState, type WorldState,
} from './snapshot';
import type { PeerId, Transport } from './Transport';
import { ByteReader, ByteWriter, dequantize, unpackQuat } from './wire';

/** Extra knobs for {@link HostAuthoritativeSync} beyond the project-level {@link NetSyncOptions}. */
export interface HostSyncOptions extends NetSyncOptions {
  /** Read `engine.input` every fixed step and submit it automatically. Default true (tests turn it off). */
  autoInput?: boolean;
  /** Send a full keyframe every N snapshots even when deltas are acked. Default 60. */
  keyframeInterval?: number;
  /** How many past input ticks each input packet repeats. Default 3. */
  inputRedundancy?: number;
  /** Snapshot history kept for delta baselines (ticks). Default 64. */
  historySize?: number;
}

/** Control messages on the `_sync` channel (reliable JSON). */
type Ctl =
  | { t: 'hello'; name: string }
  | { t: 'welcome'; tick: number; hostId: PeerId; players: PlayerRow[]; entities: SpawnInfo[]; nextNetId: number }
  | { t: 'joined'; peerId: PeerId; name: string }
  | { t: 'left'; peerId: PeerId }
  | { t: 'spawn'; e: SpawnInfo }
  | { t: 'despawn'; netId: number }
  | { t: 'owner'; netId: number; ownerId: PeerId }
  | { t: 'share'; netId: number; peers: PeerId[] }
  | { t: 'rpc'; name: string; args: unknown[]; target: string; netId?: number; from: PeerId }
  | { t: 'spawnReq'; prefab: string; ownerId?: PeerId; position?: { x: number; y: number; z?: number }; authority?: 'host' | 'owner' }
  | { t: 'despawnReq'; netId: number }
  | { t: 'ownerReq'; netId: number; ownerId: PeerId }
  | { t: 'shareReq'; netId: number; peerId: PeerId; enabled: boolean }
  | { t: 'takeover'; tick: number };

interface PlayerRow { peerId: PeerId; name: string }

/** Everything a peer needs to (re)create a replicated entity. */
interface SpawnInfo {
  netId: number;
  prefab: string;
  ownerId: PeerId;
  authority: 'host' | 'owner';
  sharedWith: PeerId[];
  syncComponents: string[];
  name?: string;
  pos: [number, number, number];
  rot: [number, number, number, number];
}

/** Binary message kinds on the `_snap` channel (unreliable). */
const enum Bin { SNAPSHOT = 1, INPUT = 2, ACK = 3, OWNER_STATE = 4 }

interface ClientState {
  peerId: PeerId;
  name: string;
  /** Last snapshot tick this client acknowledged (0 = none). */
  acked: number;
  /** Snapshots sent since the last keyframe. */
  sinceKeyframe: number;
}

interface PeerInput {
  snapshot: InputSnapshot;
  /** Tick of the snapshot last applied (edge de-duplication). */
  appliedTick: number;
}

/**
 * Host-authoritative synchronisation (the default multiplayer mode).
 *
 * - The host simulates everything with `authority: 'host'`; clients send
 *   {@link InputSnapshot}s which the host applies to the `PlayerInput`s the
 *   sender owns or co-owns (merged with `mergeSnapshots` for shared control).
 * - At `tickRate` the host captures every `NetworkIdentity` entity into a
 *   quantized {@link EntityState} and sends each client a delta against the
 *   last snapshot that client acknowledged; clients feed the
 *   {@link InterpolationSystem}.
 * - Spawn/despawn/ownership/shared-control/RPC are reliable JSON messages.
 * - Entities with `authority: 'owner'` are simulated by their owner, which
 *   streams their state to the host; the host relays it in its snapshots.
 * - Late joiners get a `welcome` with the full entity list plus a keyframe.
 * - When the transport elects a new host, the new host resumes from the last
 *   state it interpolated to and clients re-handshake.
 *
 * Install with `engine.net.setSync(sync); sync.start()` after the transport
 * connected (see `installNetworking` for the one-call version).
 */
export class HostAuthoritativeSync implements NetSync {
  readonly options: Required<HostSyncOptions>;
  readonly events = new EventEmitter<NetSyncEvents>();
  /** Interpolation system installed on start (clients and, for owner-authority entities, the host). */
  readonly interp: InterpolationSystem;
  tick = 0;

  private ctl: NetChannel;
  private snap: NetChannel;
  private unsub: (() => void)[] = [];
  private started = false;
  private updates = 0;
  private deferred: (() => void)[] = [];

  private byNetId = new Map<number, Entity>();
  private nextNetId = 1;
  private roster = new Map<PeerId, PlayerRow>();
  private clients = new Map<PeerId, ClientState>();
  private inputs = new Map<PeerId, PeerInput>();
  private merged = new Map<Entity, InputSnapshot>();
  private rpcHandlers = new Map<string, Set<RpcHandler>>();
  private savedBodyTypes = new Map<Entity, BodyType>();

  private history = new SnapshotHistory();
  private pool: EntityState[] = [];
  private known = new Map<number, EntityState>();
  private writer = new ByteWriter(4096);
  private reader = new ByteReader(new Uint8Array(0));
  private sendAccum = 0;
  private lastSnapshotTick = 0;
  private inputHistory: InputSnapshot[] = [];
  private actionNames: string[] = [];
  private axisNames: string[] = [];
  private policy: EntitySyncPolicy = { groups: 0, posThreshold: 1, rotThreshold: 1 };
  private hostIdCache: PeerId = '';

  constructor(readonly engine: Engine, options: Partial<HostSyncOptions> = {}) {
    this.options = {
      ...DEFAULT_NET_OPTIONS,
      mode: 'host-authoritative',
      autoInput: true,
      keyframeInterval: 60,
      inputRedundancy: 3,
      historySize: 64,
      ...options,
    };
    this.history = new SnapshotHistory(this.options.historySize);
    this.interp = new InterpolationSystem();
    this.interp.tickRate = this.options.tickRate;
    this.ctl = engine.net.channel('_sync');
    this.snap = engine.net.channel('_snap');
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

  get hostId(): PeerId {
    return this.transport.hostId || this.hostIdCache;
  }

  // -------------------------------------------------------------- lifecycle

  start(): void {
    if (this.started) return;
    this.started = true;
    const hub = this.engine.net;
    const world = this.engine.world;
    if (!world.getSystem(this.interp.name)) world.addSystem(this.interp);
    this.refreshInputNames();
    this.unsub.push(
      this.ctl.on((from, data) => this.onControl(from, data as Ctl)),
      this.snap.on((from, data) => { if (data instanceof Uint8Array) this.onBinary(from, data); }),
      hub.events.on('peerLeft', (e) => this.onPeerLeft(e.peerId)),
      hub.events.on('hostChanged', (e) => this.onHostChanged(e.hostId)),
      hub.events.on('connected', () => this.onConnected()),
      hub.events.on('disconnected', (e) => this.events.emit('disconnected', { reason: e.reason })),
      world.events.on('entityDestroyed', (e) => this.onEntityDestroyed(e)),
    );
    this.assignSceneNetIds();
    if (this.transport.connected) this.onConnected();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const off of this.unsub) off();
    this.unsub.length = 0;
    this.engine.world.removeSystem(this.interp);
    for (const [e, type] of this.savedBodyTypes) {
      const rb = this.engine.world.getComponent(e, RigidBody2D);
      if (rb) rb.bodyType = type;
    }
    this.savedBodyTypes.clear();
    this.clients.clear();
    this.roster.clear();
    this.inputs.clear();
    this.history.clear();
    this.known.clear();
    this.events.emit('disconnected', { reason: 'stopped' });
  }

  private onConnected(): void {
    this.hostIdCache = this.transport.hostId;
    this.retargetLocalOwners(this.hostId);
    for (const ni of this.engine.world.componentsOfType(NetworkIdentity)) this.applyPolicy(ni.entity, ni);
    if (this.isHost) {
      const me = { peerId: this.localId, name: this.engine.net.displayName || this.localId };
      this.roster.set(this.localId, me);
      this.events.emit('connected', { localId: this.localId, isHost: true, hostId: this.localId });
      this.defer(() => this.events.emit('playerJoined', { peerId: me.peerId, displayName: me.name }));
    } else {
      this.sendHello();
    }
  }

  private sendHello(): void {
    const hello: Ctl = { t: 'hello', name: this.engine.net.displayName || this.localId };
    this.ctl.send('host', hello);
  }

  private defer(fn: () => void): void {
    this.deferred.push(fn);
  }

  private flushDeferred(): void {
    if (!this.deferred.length) return;
    const list = this.deferred;
    this.deferred = [];
    for (const fn of list) fn();
  }

  // ----------------------------------------------------------- engine hooks

  fixedUpdate(_dt: number): void {
    if (!this.started) return;
    if (this.isHost) this.tick++;
    if (this.options.autoInput) this.submitInput(this.engine.input.getSnapshot());
    if (this.isHost) this.applyRemoteInputs();
  }

  update(dt: number): void {
    if (!this.started) return;
    this.engine.net.update();
    if (this.updates++ >= 1) this.flushDeferred();
    if (!this.transport.connected) return;
    this.sendAccum += dt;
    const interval = 1 / this.options.tickRate;
    if (this.sendAccum < interval) return;
    this.sendAccum = Math.min(this.sendAccum - interval, interval);
    if (this.isHost) this.sendSnapshots();
    else this.sendOwnerState();
  }

  // ------------------------------------------------------------- identities

  /** Give scene-authored `NetworkIdentity` entities deterministic ids (identical on every peer). */
  private assignSceneNetIds(): void {
    const list = this.engine.world.componentsOfType(NetworkIdentity);
    let max = 0;
    for (const ni of list) if (ni.netId > max) max = ni.netId;
    let next = max + 1;
    for (const ni of list) {
      if (ni.netId === 0) ni.netId = next++;
      this.byNetId.set(ni.netId, ni.entity);
    }
    this.nextNetId = Math.max(this.nextNetId, next);
  }

  /** Map `PlayerInput.owner === 'local'` to the host id so scene players belong to the host. */
  private retargetLocalOwners(hostId: PeerId): void {
    if (!hostId) return;
    for (const pi of this.engine.world.componentsOfType(PlayerInput)) {
      if (pi.owner === 'local') pi.owner = hostId;
    }
    for (const ni of this.engine.world.componentsOfType(NetworkIdentity)) {
      if (ni.ownerId === 'host' || ni.ownerId === 'local') ni.ownerId = hostId;
    }
  }

  /** Does this peer run the simulation for `ni`? */
  simulatesLocally(ni: NetworkIdentity): boolean {
    if (ni.authority === 'owner') return ni.ownerId === this.localId;
    return this.isHost;
  }

  /** Switch physics bodies to kinematic on peers that only receive state, and back when authority returns. */
  private applyPolicy(e: Entity, ni: NetworkIdentity): void {
    const world = this.engine.world;
    const local = this.simulatesLocally(ni);
    const rb = world.getComponent(e, RigidBody2D);
    const rb3 = world.getComponent(e, RigidBody3D);
    if (!local) {
      if (rb && rb.bodyType !== 'kinematic') { this.savedBodyTypes.set(e, rb.bodyType); rb.bodyType = 'kinematic'; rb.velocity.set(0, 0); rb.angularVelocity = 0; }
      if (rb3 && rb3.bodyType !== 'kinematic') { this.savedBodyTypes.set(e, rb3.bodyType); rb3.bodyType = 'kinematic'; rb3.velocity.set(0, 0, 0); }
      this.interp.track(ni.netId, e);
    } else {
      const saved = this.savedBodyTypes.get(e);
      if (saved !== undefined) {
        if (rb) rb.bodyType = saved;
        if (rb3) rb3.bodyType = saved;
        this.savedBodyTypes.delete(e);
      }
      this.interp.untrack(ni.netId);
    }
  }

  private identity(e: Entity): NetworkIdentity | undefined {
    return this.engine.world.getComponent(e, NetworkIdentity);
  }

  /** Entity for a network id (NULL_ENTITY when unknown). */
  entityOf(netId: number): Entity {
    return this.byNetId.get(netId) ?? NULL_ENTITY;
  }

  /** Network id of an entity (0 when not replicated). */
  netIdOf(entity: Entity): number {
    return this.identity(entity)?.netId ?? 0;
  }

  private onEntityDestroyed(e: Entity): void {
    // Component is already gone; find by value.
    for (const [netId, ent] of this.byNetId) {
      if (ent === e) {
        this.byNetId.delete(netId);
        this.interp.untrack(netId);
        this.known.delete(netId);
        this.savedBodyTypes.delete(e);
        this.merged.delete(e);
        break;
      }
    }
  }

  private spawnInfoOf(e: Entity, ni: NetworkIdentity): SpawnInfo {
    const t = this.engine.world.getComponent(e, Transform);
    const n = this.engine.world.getComponent(e, Name);
    return {
      netId: ni.netId,
      prefab: ni.prefab,
      ownerId: ni.ownerId,
      authority: ni.authority,
      sharedWith: ni.sharedWith.slice(),
      syncComponents: ni.syncComponents.slice(),
      name: n?.name,
      pos: t ? [t.position.x, t.position.y, t.position.z] : [0, 0, 0],
      rot: t ? [t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w] : [0, 0, 0, 1],
    };
  }

  // ----------------------------------------------------------------- spawn

  spawn(prefab: string, opts: { ownerId?: PeerId; position?: { x: number; y: number; z?: number }; authority?: 'host' | 'owner' } = {}): Entity {
    if (!this.isHost) {
      const req: Ctl = { t: 'spawnReq', prefab, ownerId: opts.ownerId, position: opts.position, authority: opts.authority };
      this.ctl.send('host', req);
      return NULL_ENTITY;
    }
    const data = this.engine.prefabs.get(prefab);
    if (!data) {
      this.engine.warn(`net.spawn: unknown prefab "${prefab}"`);
      return NULL_ENTITY;
    }
    const world = this.engine.world;
    const e = instantiatePrefab(world, data, { position: opts.position });
    const ni = world.getComponent(e, NetworkIdentity) ?? world.addComponent(e, NetworkIdentity);
    ni.netId = this.nextNetId++;
    ni.ownerId = opts.ownerId ?? this.localId;
    if (opts.authority) ni.authority = opts.authority;
    ni.prefab = prefab;
    ni.spawned = true;
    const pi = world.getComponent(e, PlayerInput);
    if (pi) pi.owner = ni.ownerId;
    this.byNetId.set(ni.netId, e);
    this.applyPolicy(e, ni);
    const msg: Ctl = { t: 'spawn', e: this.spawnInfoOf(e, ni) };
    this.ctl.send('all', msg);
    this.events.emit('spawned', { entity: e, netId: ni.netId, ownerId: ni.ownerId });
    return e;
  }

  despawn(entity: Entity): void {
    const ni = this.identity(entity);
    if (!ni) { this.engine.world.destroyEntityDeferred(entity); return; }
    if (!this.isHost) {
      const req: Ctl = { t: 'despawnReq', netId: ni.netId };
      this.ctl.send('host', req);
      return;
    }
    const msg: Ctl = { t: 'despawn', netId: ni.netId };
    this.ctl.send('all', msg);
    this.destroyReplicated(ni.netId);
  }

  private destroyReplicated(netId: number): void {
    const e = this.byNetId.get(netId);
    if (e === undefined) return;
    this.byNetId.delete(netId);
    this.interp.untrack(netId);
    this.known.delete(netId);
    this.events.emit('despawned', { entity: e, netId });
    if (this.engine.world.isAlive(e)) this.engine.world.destroyEntityDeferred(e);
  }

  /** Despawn every entity owned by `peerId` (host). Convenience for `playerLeft` handlers. */
  despawnOwnedBy(peerId: PeerId): number {
    if (!this.isHost) return 0;
    let n = 0;
    for (const ni of Array.from(this.engine.world.componentsOfType(NetworkIdentity))) {
      if (ni.ownerId === peerId && ni.spawned) { this.despawn(ni.entity); n++; }
    }
    return n;
  }

  /**
   * Host helper for the common "one avatar per player" pattern: spawns
   * `prefab` for every current and future player (owner = that player) and
   * despawns their entities when they leave. Returns a function that stops
   * the behaviour. `position(i, peerId)` picks a spawn point.
   */
  spawnPlayers(prefab: string, opts: { position?: (index: number, peerId: PeerId) => { x: number; y: number; z?: number }; authority?: 'host' | 'owner'; despawnOnLeave?: boolean } = {}): () => void {
    const spawned = new Map<PeerId, Entity>();
    let index = 0;
    const spawnFor = (peerId: PeerId) => {
      if (!this.isHost || spawned.has(peerId)) return;
      const e = this.spawn(prefab, { ownerId: peerId, position: opts.position?.(index++, peerId), authority: opts.authority });
      if (e !== NULL_ENTITY) spawned.set(peerId, e);
    };
    for (const p of this.roster.values()) spawnFor(p.peerId);
    const offJoin = this.events.on('playerJoined', (e) => spawnFor(e.peerId));
    const offLeft = this.events.on('playerLeft', (e) => {
      const ent = spawned.get(e.peerId);
      spawned.delete(e.peerId);
      if (opts.despawnOnLeave !== false && ent !== undefined && this.isHost && this.engine.world.isAlive(ent)) this.despawn(ent);
    });
    return () => { offJoin(); offLeft(); };
  }

  // -------------------------------------------------------------- ownership

  setOwner(entity: Entity, ownerId: PeerId): void {
    const ni = this.identity(entity);
    if (!ni) return;
    if (!this.isHost) {
      if (ni.ownerId !== this.localId) { this.engine.warn('net.setOwner: only the host or the current owner may transfer ownership'); return; }
      const req: Ctl = { t: 'ownerReq', netId: ni.netId, ownerId };
      this.ctl.send('host', req);
      return;
    }
    this.applyOwner(ni, ownerId);
    const msg: Ctl = { t: 'owner', netId: ni.netId, ownerId };
    this.ctl.send('all', msg);
  }

  private applyOwner(ni: NetworkIdentity, ownerId: PeerId): void {
    const previous = ni.ownerId;
    if (previous === ownerId) return;
    ni.ownerId = ownerId;
    const pi = this.engine.world.getComponent(ni.entity, PlayerInput);
    if (pi) pi.owner = ownerId;
    this.applyPolicy(ni.entity, ni);
    this.events.emit('ownershipChanged', { entity: ni.entity, ownerId, previous });
  }

  shareControl(entity: Entity, peerId: PeerId, enabled: boolean): void {
    const ni = this.identity(entity);
    if (!ni) return;
    if (!this.isHost) {
      const req: Ctl = { t: 'shareReq', netId: ni.netId, peerId, enabled };
      this.ctl.send('host', req);
      return;
    }
    const peers = ni.sharedWith.filter((p) => p !== peerId);
    if (enabled) peers.push(peerId);
    this.applyShare(ni, peers);
    const msg: Ctl = { t: 'share', netId: ni.netId, peers };
    this.ctl.send('all', msg);
  }

  private applyShare(ni: NetworkIdentity, peers: PeerId[]): void {
    ni.sharedWith = peers.slice();
    const pi = this.engine.world.getComponent(ni.entity, PlayerInput);
    if (pi) pi.coOwners = peers.filter((p) => p !== pi.owner);
  }

  // ------------------------------------------------------------------ input

  private refreshInputNames(): void {
    this.actionNames = this.engine.input.actionNames();
    this.axisNames = this.engine.input.axisNames();
  }

  submitInput(snapshot: InputSnapshot): void {
    if (!this.transport.connected) return;
    if (this.isHost) {
      this.storeInput(this.localId, snapshot);
      return;
    }
    // Keep the last few ticks and resend them so a lost packet does not drop a press.
    const copy = cloneSnapshot(snapshot);
    if (copy.tick === 0) copy.tick = this.engine.clock.tick;
    const last = this.inputHistory[this.inputHistory.length - 1];
    if (last && last.tick === copy.tick) this.inputHistory[this.inputHistory.length - 1] = copy;
    else this.inputHistory.push(copy);
    while (this.inputHistory.length > this.options.inputRedundancy) this.inputHistory.shift();
    const w = this.writer.reset();
    w.u8(Bin.INPUT).u32(this.lastSnapshotTick).u8(this.inputHistory.length);
    for (const s of this.inputHistory) this.writeInput(w, s);
    this.snap.send('host', w.view8(), { reliable: false });
  }

  private writeInput(w: ByteWriter, s: InputSnapshot): void {
    w.u32(s.tick).u32(maskOf(this.actionNames, s.held)).u32(maskOf(this.actionNames, s.pressed)).u32(maskOf(this.actionNames, s.released));
    w.u8(this.axisNames.length);
    for (const a of this.axisNames) w.i16(Math.round(Math.max(-1, Math.min(1, s.axes[a] ?? 0)) * 32767));
    if (s.pointer) w.u8(1).f32(s.pointer.x).f32(s.pointer.y).u8(s.pointer.buttons);
    else w.u8(0);
  }

  private readInput(r: ByteReader): InputSnapshot {
    const s = createEmptySnapshot(r.u32());
    const held = r.u32(), pressed = r.u32(), released = r.u32();
    s.held = unmask(this.actionNames, held);
    s.pressed = unmask(this.actionNames, pressed);
    s.released = unmask(this.actionNames, released);
    const n = r.u8();
    for (let i = 0; i < n; i++) {
      const v = r.i16() / 32767;
      if (i < this.axisNames.length) s.axes[this.axisNames[i]] = v;
    }
    if (r.u8()) s.pointer = { x: r.f32(), y: r.f32(), buttons: r.u8() };
    return s;
  }

  private storeInput(peer: PeerId, snapshot: InputSnapshot): void {
    const entry = this.inputs.get(peer);
    if (!entry) this.inputs.set(peer, { snapshot: cloneSnapshot(snapshot), appliedTick: -1 });
    else if (snapshot.tick >= entry.snapshot.tick) {
      // Reuse the stored object; copy fields (no new snapshot per tick).
      const dst = entry.snapshot;
      dst.tick = snapshot.tick;
      dst.held = snapshot.held.slice();
      dst.pressed = snapshot.pressed.slice();
      dst.released = snapshot.released.slice();
      dst.axes = { ...snapshot.axes };
      dst.pointer = snapshot.pointer ? { ...snapshot.pointer } : undefined;
    }
  }

  /** Latest input received from a peer (host side). */
  inputOf(peer: PeerId): InputSnapshot | undefined {
    return this.inputs.get(peer)?.snapshot;
  }

  inputFor(entity: Entity): InputSnapshot | undefined {
    return this.merged.get(entity) ?? this.engine.world.getComponent(entity, PlayerInput)?.snapshot;
  }

  /** Host: write remote (and merged co-owner) inputs into `PlayerInput`s before scripts run. */
  private applyRemoteInputs(): void {
    const me = this.localId;
    const strategyDefault = this.options.mergeStrategy;
    for (const pi of this.engine.world.componentsOfType(PlayerInput)) {
      const owner = pi.owner === 'local' ? me : pi.owner;
      const shared = pi.coOwners.length > 0 && this.options.sharedControl;
      if (owner === me && !shared) continue; // InputSystem already applied the host's own input
      if (!shared) {
        const entry = this.inputs.get(owner);
        if (!entry) continue;
        this.applyOne(pi, entry);
        continue;
      }
      // Shared control: merge every contributor that has sent input.
      _contrib.length = 0;
      const ownerEntry = this.inputs.get(owner);
      if (ownerEntry) _contrib.push(this.dedupe(ownerEntry));
      for (const co of pi.coOwners) {
        const en = this.inputs.get(co);
        if (en) _contrib.push(this.dedupe(en));
      }
      if (_contrib.length === 0) continue;
      const strategy = pi.mergeStrategy ?? strategyDefault;
      const mergedSnap = mergeSnapshots(_contrib, strategy);
      this.merged.set(pi.entity, mergedSnap);
      pi.apply(mergedSnap);
    }
  }

  private applyOne(pi: PlayerInput, entry: PeerInput): void {
    pi.apply(this.dedupe(entry));
  }

  /** Return the snapshot, stripping edges when the same tick was already applied. */
  private dedupe(entry: PeerInput): InputSnapshot {
    const s = entry.snapshot;
    if (entry.appliedTick === s.tick) {
      _stripped.tick = s.tick;
      _stripped.held = s.held;
      _stripped.pressed = EMPTY_LIST;
      _stripped.released = EMPTY_LIST;
      _stripped.axes = s.axes;
      _stripped.pointer = s.pointer;
      return _stripped;
    }
    entry.appliedTick = s.tick;
    return s;
  }

  // -------------------------------------------------------------- snapshots

  private stateFor(netId: number): EntityState {
    const s = this.pool.pop() ?? newEntityState(netId);
    s.netId = netId;
    s.propTypes.length = 0;
    s.props.length = 0;
    return s;
  }

  private recycle(state: WorldState | undefined): void {
    if (!state) return;
    for (const s of state.values()) this.pool.push(s);
    state.clear();
  }

  /** Capture every replicated entity this peer is authoritative for (or relays, as host). */
  private captureWorld(out: WorldState, onlyOwned: boolean): void {
    const world = this.engine.world;
    const registry = world.registry;
    for (const ni of world.componentsOfType(NetworkIdentity)) {
      if (!ni.replicate || ni.netId === 0) continue;
      if (onlyOwned && !(ni.authority === 'owner' && ni.ownerId === this.localId)) continue;
      const t = world.getComponent(ni.entity, Transform);
      if (!t) continue;
      const s = this.stateFor(ni.netId);
      const rb = world.getComponent(ni.entity, RigidBody2D);
      captureTransform(s, t.position, t.rotation, t.scale, rb ? rb.velocity : null);
      for (const c of world.getComponents(ni.entity)) {
        const fields = replicationFieldsFor(registry, c.type, ni.syncComponents);
        if (!fields) continue;
        s.propTypes.push(c.type);
        s.props.push(serializeReplicated(registry, c, fields));
      }
      out.set(ni.netId, s);
    }
  }

  private policyFor(netId: number): EntitySyncPolicy {
    const e = this.byNetId.get(netId);
    const nt = e !== undefined ? this.engine.world.getComponent(e, NetTransform) : undefined;
    if (!nt) return DEFAULT_POLICY;
    const p = this.policy;
    p.groups = (nt.syncPosition ? SnapFlag.POS : 0) | (nt.syncRotation ? SnapFlag.ROT : 0) | (nt.syncScale ? SnapFlag.SCALE : 0) | SnapFlag.VEL | SnapFlag.PROPS;
    p.posThreshold = Math.max(1, nt.positionThreshold / POS_STEP);
    p.rotThreshold = Math.max(1, nt.rotationThreshold * 32767);
    return p;
  }

  /** Host: capture the world and send a delta (or keyframe) to every client. */
  private sendSnapshots(): void {
    const tick = this.tick;
    if (tick === this.lastSnapshotTick) return;
    this.lastSnapshotTick = tick;
    const state: WorldState = new Map();
    this.captureWorld(state, false);
    this.recycle(this.history.push(tick, state));
    const w = this.writer;
    for (const c of this.clients.values()) {
      let baseline: WorldState | null = null;
      let baseTick = 0;
      if (c.acked > 0 && c.sinceKeyframe < this.options.keyframeInterval) {
        const b = this.history.get(c.acked);
        if (b) { baseline = b; baseTick = c.acked; }
      }
      if (baseline) c.sinceKeyframe++;
      else c.sinceKeyframe = 0;
      w.reset().u8(Bin.SNAPSHOT);
      const owned = c.peerId;
      const count = encodeWorldSnapshot(w, tick, baseTick, state, baseline, (id) => this.policyFor(id), (id) => {
        // Owner-authority entities are not sent back to their owner.
        const e = this.byNetId.get(id);
        const ni = e !== undefined ? this.identity(e) : undefined;
        return !(ni && ni.authority === 'owner' && ni.ownerId === owned);
      });
      if (count === 0 && baseline) continue; // nothing changed for this client
      this.engine.net._reportSnapshot(w.offset);
      this.snap.send(c.peerId, w.view8(), { reliable: false });
    }
  }

  /** Owner-authority client: stream the state of the entities it simulates to the host. */
  private sendOwnerState(): void {
    const state: WorldState = new Map();
    this.captureWorld(state, true);
    if (state.size === 0) return;
    const w = this.writer.reset();
    w.u8(Bin.OWNER_STATE);
    encodeWorldSnapshot(w, this.engine.clock.tick, 0, state, null, (id) => this.policyFor(id));
    this.recycle(state);
    this.snap.send('host', w.view8(), { reliable: false });
  }

  private onBinary(from: PeerId, bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    const r = this.reader.reset(bytes);
    const kind = r.u8();
    switch (kind) {
      case Bin.SNAPSHOT:
        if (from === this.hostId && !this.isHost) this.onSnapshot(r, bytes.byteLength);
        break;
      case Bin.INPUT:
        if (this.isHost) this.onInput(from, r);
        break;
      case Bin.ACK:
        if (this.isHost) this.ack(from, r.u32());
        break;
      case Bin.OWNER_STATE:
        if (this.isHost) this.onOwnerState(from, r);
        break;
    }
  }

  private ack(from: PeerId, tick: number): void {
    const c = this.clients.get(from);
    if (c && tick > c.acked && this.history.get(tick)) c.acked = tick;
  }

  private onInput(from: PeerId, r: ByteReader): void {
    const lastSnap = r.u32();
    if (lastSnap) this.ack(from, lastSnap);
    const n = r.u8();
    const entry = this.inputs.get(from);
    const newestKnown = entry ? entry.snapshot.tick : -1;
    for (let i = 0; i < n; i++) {
      const s = this.readInput(r);
      if (s.tick >= newestKnown) this.storeInput(from, s);
    }
  }

  private onSnapshot(r: ByteReader, bytes: number): void {
    this.engine.net._reportSnapshot(bytes);
    const world = this.engine.world;
    const header = decodeWorldSnapshot(r, (netId, flags, ints, types, props) => {
      const e = this.byNetId.get(netId);
      if (e === undefined || !world.isAlive(e)) return;
      const ni = this.identity(e);
      if (!ni || this.simulatesLocally(ni)) return;
      let k = this.known.get(netId);
      if (!k) {
        k = newEntityState(netId);
        const t = world.getComponent(e, Transform);
        if (t) captureTransform(k, t.position, t.rotation, t.scale, null);
        this.known.set(netId, k);
      }
      const ki = k.ints;
      if (flags & SnapFlag.POS) { ki[SF.PX] = ints[SF.PX]; ki[SF.PY] = ints[SF.PY]; ki[SF.PZ] = ints[SF.PZ]; }
      if (flags & SnapFlag.ROT) { ki[SF.QI] = ints[SF.QI]; ki[SF.QA] = ints[SF.QA]; ki[SF.QB] = ints[SF.QB]; ki[SF.QC] = ints[SF.QC]; }
      if (flags & SnapFlag.SCALE) { ki[SF.SX] = ints[SF.SX]; ki[SF.SY] = ints[SF.SY]; ki[SF.SZ] = ints[SF.SZ]; }
      if (flags & SnapFlag.VEL) { ki[SF.VX] = ints[SF.VX]; ki[SF.VY] = ints[SF.VY]; }
      _pos.set(dequantize(ki[SF.PX], POS_STEP), dequantize(ki[SF.PY], POS_STEP), dequantize(ki[SF.PZ], POS_STEP));
      unpackQuat(ki, SF.QI, _rot);
      _vel.set(dequantize(ki[SF.VX], VEL_STEP), dequantize(ki[SF.VY], VEL_STEP), 0);
      this.interp.push(world, netId, this.tickFromHeader, _pos, _rot, _vel);
      if (flags & SnapFlag.SCALE) {
        const t = world.getComponent(e, Transform);
        if (t) { t.scale.set(dequantize(ki[SF.SX], SCALE_STEP), dequantize(ki[SF.SY], SCALE_STEP), dequantize(ki[SF.SZ], SCALE_STEP)); t.markDirty(); }
      }
      if (flags & SnapFlag.PROPS) {
        for (let i = 0; i < types.length; i++) {
          const c = world.getComponent(e, types[i]);
          if (!c) continue;
          try { world.registry.applyProps(c, JSON.parse(props[i]) as Record<string, unknown>); } catch { /* ignore malformed */ }
        }
      }
    }, this.header);
    void header;
    if (this.header.tick > this.tick) this.tick = this.header.tick;
    this.lastSnapshotTick = this.header.tick;
    const w = this.writer.reset();
    w.u8(Bin.ACK).u32(this.header.tick);
    this.snap.send('host', w.view8(), { reliable: false });
  }

  private header = { tick: 0, baselineTick: 0, count: 0 };
  private get tickFromHeader(): number {
    return this.header.tick;
  }

  /** Host: apply state streamed by an owner-authority client to the host's copy. */
  private onOwnerState(from: PeerId, r: ByteReader): void {
    const world = this.engine.world;
    decodeWorldSnapshot(r, (netId, flags, ints) => {
      const e = this.byNetId.get(netId);
      if (e === undefined) return;
      const ni = this.identity(e);
      if (!ni || ni.authority !== 'owner' || ni.ownerId !== from) return;
      const t = world.getComponent(e, Transform);
      if (!t) return;
      if (flags & SnapFlag.POS) t.position.set(dequantize(ints[SF.PX], POS_STEP), dequantize(ints[SF.PY], POS_STEP), dequantize(ints[SF.PZ], POS_STEP));
      if (flags & SnapFlag.ROT) unpackQuat(ints, SF.QI, t.rotation);
      if (flags & SnapFlag.SCALE) t.scale.set(dequantize(ints[SF.SX], SCALE_STEP), dequantize(ints[SF.SY], SCALE_STEP), dequantize(ints[SF.SZ], SCALE_STEP));
      t.markDirty();
      const rb = world.getComponent(e, RigidBody2D);
      if (rb && flags & SnapFlag.VEL) rb.velocity.set(dequantize(ints[SF.VX], VEL_STEP), dequantize(ints[SF.VY], VEL_STEP));
    }, this.header);
  }

  // ------------------------------------------------------------------- RPC

  onRpc(name: string, handler: RpcHandler): () => void {
    let set = this.rpcHandlers.get(name);
    if (!set) this.rpcHandlers.set(name, (set = new Set()));
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  rpc(name: string, args: unknown[] = [], target: PeerId | 'host' | 'all' | 'others' = 'host', entity?: Entity): void {
    const netId = entity !== undefined ? this.netIdOf(entity) || undefined : undefined;
    const me = this.localId;
    if (target === 'all' || target === me || (target === 'host' && this.isHost)) this.deliverRpc(name, args, me, netId);
    if (target === me || (target === 'host' && this.isHost)) return;
    const msg: Ctl = { t: 'rpc', name, args, target: target === 'all' ? 'others' : target, netId, from: me };
    if (this.isHost) this.routeRpc(msg);
    else this.ctl.send('host', msg);
  }

  /** Host: deliver locally when addressed and forward to the right peers. */
  private routeRpc(msg: Ctl & { t: 'rpc' }): void {
    const me = this.localId;
    const fromMe = msg.from === me;
    if (msg.target === 'host') { if (!fromMe) this.deliverRpc(msg.name, msg.args, msg.from, msg.netId); return; }
    if (msg.target === 'others') {
      if (!fromMe) this.deliverRpc(msg.name, msg.args, msg.from, msg.netId);
      for (const p of this.transport.peers) if (p !== msg.from) this.ctl.send(p, msg);
      return;
    }
    if (msg.target === me) { this.deliverRpc(msg.name, msg.args, msg.from, msg.netId); return; }
    this.ctl.send(msg.target, msg);
  }

  private deliverRpc(name: string, args: unknown[], from: PeerId, netId?: number): void {
    const entity = netId !== undefined ? this.byNetId.get(netId) : undefined;
    this.events.emit('rpc', { name, from, args, entity });
    const set = this.rpcHandlers.get(name);
    if (set) for (const h of Array.from(set)) h(args, from, entity);
    if (entity !== undefined) this.engine.scripting.rpc(entity, name, args, from);
  }

  // ---------------------------------------------------------------- control

  private onControl(from: PeerId, msg: Ctl): void {
    if (!msg || typeof msg !== 'object') return;
    const fromHost = from === this.hostId;
    switch (msg.t) {
      case 'hello':
        if (this.isHost) this.onHello(from, msg.name);
        break;
      case 'welcome':
        if (fromHost && !this.isHost) this.onWelcome(msg);
        break;
      case 'joined':
        if (fromHost && !this.roster.has(msg.peerId)) {
          this.roster.set(msg.peerId, { peerId: msg.peerId, name: msg.name });
          this.events.emit('playerJoined', { peerId: msg.peerId, displayName: msg.name });
        }
        break;
      case 'left':
        if (fromHost) this.removePlayer(msg.peerId);
        break;
      case 'spawn':
        if (fromHost) this.applySpawn(msg.e);
        break;
      case 'despawn':
        if (fromHost) this.destroyReplicated(msg.netId);
        break;
      case 'owner': {
        const e = this.byNetId.get(msg.netId);
        const ni = e !== undefined ? this.identity(e) : undefined;
        if (fromHost && ni) this.applyOwner(ni, msg.ownerId);
        break;
      }
      case 'share': {
        const e = this.byNetId.get(msg.netId);
        const ni = e !== undefined ? this.identity(e) : undefined;
        if (fromHost && ni) this.applyShare(ni, msg.peers);
        break;
      }
      case 'rpc':
        if (this.isHost) this.routeRpc({ ...msg, from });
        else if (fromHost) this.deliverRpc(msg.name, msg.args, msg.from, msg.netId);
        break;
      case 'spawnReq':
        if (this.isHost) this.spawn(msg.prefab, { ownerId: msg.ownerId ?? from, position: msg.position, authority: msg.authority });
        break;
      case 'despawnReq': {
        const e = this.byNetId.get(msg.netId);
        const ni = e !== undefined ? this.identity(e) : undefined;
        if (this.isHost && e !== undefined && ni && (ni.ownerId === from || ni.sharedWith.includes(from))) this.despawn(e);
        break;
      }
      case 'ownerReq': {
        const e = this.byNetId.get(msg.netId);
        const ni = e !== undefined ? this.identity(e) : undefined;
        if (this.isHost && e !== undefined && ni && ni.ownerId === from) this.setOwner(e, msg.ownerId);
        break;
      }
      case 'shareReq': {
        const e = this.byNetId.get(msg.netId);
        const ni = e !== undefined ? this.identity(e) : undefined;
        if (this.isHost && e !== undefined && ni && ni.ownerId === from) this.shareControl(e, msg.peerId, msg.enabled);
        break;
      }
      case 'takeover':
        if (fromHost && !this.isHost) { this.tick = Math.max(this.tick, msg.tick); this.sendHello(); }
        break;
    }
  }

  private onHello(from: PeerId, name: string): void {
    if (this.roster.size >= this.options.maxPlayers && !this.roster.has(from)) {
      this.engine.warn(`net: room full, rejecting ${from}`);
      return;
    }
    const isNew = !this.roster.has(from);
    this.roster.set(from, { peerId: from, name });
    let c = this.clients.get(from);
    if (!c) this.clients.set(from, (c = { peerId: from, name, acked: 0, sinceKeyframe: 0 }));
    c.acked = 0;
    const entities: SpawnInfo[] = [];
    for (const ni of this.engine.world.componentsOfType(NetworkIdentity)) {
      if (ni.netId === 0) continue;
      entities.push(this.spawnInfoOf(ni.entity, ni));
    }
    const welcome: Ctl = {
      t: 'welcome',
      tick: this.tick,
      hostId: this.localId,
      players: Array.from(this.roster.values()),
      entities,
      nextNetId: this.nextNetId,
    };
    this.ctl.send(from, welcome);
    if (isNew) {
      const joined: Ctl = { t: 'joined', peerId: from, name };
      for (const p of this.transport.peers) if (p !== from) this.ctl.send(p, joined);
      this.events.emit('playerJoined', { peerId: from, displayName: name });
    }
    // Keyframe right away so the newcomer sees the world before the next scheduled snapshot.
    this.lastSnapshotTick = -1;
    this.sendSnapshots();
  }

  private onWelcome(msg: Ctl & { t: 'welcome' }): void {
    this.hostIdCache = msg.hostId;
    this.tick = msg.tick;
    this.retargetLocalOwners(msg.hostId);
    const world = this.engine.world;
    const seen = new Set<number>();
    for (const info of msg.entities) {
      seen.add(info.netId);
      this.applySpawn(info, true);
    }
    // Scene entities the host no longer has (despawned before we joined).
    for (const ni of Array.from(world.componentsOfType(NetworkIdentity))) {
      if (ni.netId !== 0 && !seen.has(ni.netId)) this.destroyReplicated(ni.netId);
    }
    this.nextNetId = Math.max(this.nextNetId, msg.nextNetId);
    const known = new Set(this.roster.keys());
    this.roster.clear();
    for (const p of msg.players) this.roster.set(p.peerId, p);
    this.interp.reset();
    this.known.clear();
    this.events.emit('connected', { localId: this.localId, isHost: false, hostId: msg.hostId });
    for (const p of msg.players) {
      if (!known.has(p.peerId)) this.events.emit('playerJoined', { peerId: p.peerId, displayName: p.name });
    }
  }

  /** Client: create or reconcile a replicated entity from the host's description. */
  private applySpawn(info: SpawnInfo, reconcile = false): void {
    const world = this.engine.world;
    let e = this.byNetId.get(info.netId);
    let created = false;
    if (e === undefined || !world.isAlive(e)) {
      if (!info.prefab) return; // scene entity we do not have: nothing to instantiate
      const data = this.engine.prefabs.get(info.prefab);
      if (!data) { this.engine.warn(`net: unknown prefab "${info.prefab}" for netId ${info.netId}`); return; }
      e = instantiatePrefab(world, data, { position: { x: info.pos[0], y: info.pos[1], z: info.pos[2] }, name: info.name });
      created = true;
    }
    const ni = world.getComponent(e, NetworkIdentity) ?? world.addComponent(e, NetworkIdentity);
    const previousOwner = ni.ownerId;
    ni.netId = info.netId;
    ni.prefab = info.prefab;
    ni.authority = info.authority;
    ni.ownerId = info.ownerId;
    ni.sharedWith = info.sharedWith.slice();
    ni.syncComponents = info.syncComponents.slice();
    ni.spawned = created || ni.spawned || !!info.prefab;
    const pi = world.getComponent(e, PlayerInput);
    if (pi) { pi.owner = info.ownerId; pi.coOwners = info.sharedWith.filter((p) => p !== info.ownerId); }
    if (created) {
      const t = world.getComponent(e, Transform);
      if (t) { t.rotation.set(info.rot[0], info.rot[1], info.rot[2], info.rot[3]); t.markDirty(); }
    }
    this.byNetId.set(info.netId, e);
    this.applyPolicy(e, ni);
    if (created) this.events.emit('spawned', { entity: e, netId: info.netId, ownerId: info.ownerId });
    else if (reconcile && previousOwner !== info.ownerId) this.events.emit('ownershipChanged', { entity: e, ownerId: info.ownerId, previous: previousOwner });
  }

  private removePlayer(peerId: PeerId): void {
    if (!this.roster.delete(peerId)) return;
    this.clients.delete(peerId);
    this.inputs.delete(peerId);
    this.events.emit('playerLeft', { peerId });
  }

  private onPeerLeft(peerId: PeerId): void {
    if (this.isHost) {
      if (this.roster.has(peerId)) {
        const left: Ctl = { t: 'left', peerId };
        this.ctl.send('all', left);
        this.removePlayer(peerId);
      }
    } else if (peerId !== this.hostId) {
      // Non-host peers learn about departures from the host's `left` message; nothing to do here.
    }
  }

  private onHostChanged(hostId: PeerId): void {
    const previous = this.hostIdCache;
    this.hostIdCache = hostId;
    this.retargetLocalOwners(hostId);
    this.interp.reset();
    this.known.clear();
    this.clients.clear();
    this.inputs.clear();
    this.history.clear();
    if (previous) this.removePlayer(previous);
    if (hostId === this.localId) {
      // Take over: adopt the entity table, re-enable physics for host-authority entities.
      let max = 0;
      for (const ni of this.engine.world.componentsOfType(NetworkIdentity)) {
        if (ni.netId > max) max = ni.netId;
        if (ni.ownerId === previous) ni.ownerId = hostId;
        const pi = this.engine.world.getComponent(ni.entity, PlayerInput);
        if (pi && pi.owner === previous) pi.owner = hostId;
        this.applyPolicy(ni.entity, ni);
      }
      this.nextNetId = Math.max(this.nextNetId, max + 1);
      this.roster.set(this.localId, { peerId: this.localId, name: this.engine.net.displayName || this.localId });
      for (const p of this.roster.values()) {
        if (p.peerId !== this.localId) this.clients.set(p.peerId, { peerId: p.peerId, name: p.name, acked: 0, sinceKeyframe: 0 });
      }
      const msg: Ctl = { t: 'takeover', tick: this.tick };
      this.ctl.send('all', msg);
    } else {
      for (const ni of this.engine.world.componentsOfType(NetworkIdentity)) this.applyPolicy(ni.entity, ni);
      this.sendHello();
    }
    this.events.emit('hostChanged', { hostId, previous, isHost: hostId === this.localId });
  }

  // ---------------------------------------------------------------- roster

  on<K extends keyof NetSyncEvents>(event: K, fn: (payload: NetSyncEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  players(): { peerId: PeerId; displayName: string; isHost: boolean; rtt: number }[] {
    const hub = this.engine.net;
    const host = this.hostId;
    const out: { peerId: PeerId; displayName: string; isHost: boolean; rtt: number }[] = [];
    for (const p of this.roster.values()) {
      out.push({ peerId: p.peerId, displayName: p.name, isHost: p.peerId === host, rtt: p.peerId === this.localId ? 0 : hub.rttTo(p.peerId) });
    }
    return out;
  }

  /** Is `peerId` a handshaked player? */
  hasPlayer(peerId: PeerId): boolean {
    return this.roster.has(peerId);
  }
}

const _contrib: InputSnapshot[] = [];
const EMPTY_LIST: string[] = [];
const _stripped: InputSnapshot = createEmptySnapshot();
const _pos = new Vec3();
const _rot = new Quat();
const _vel = new Vec3();

function maskOf(names: readonly string[], list: readonly string[]): number {
  let m = 0;
  for (const n of list) {
    const i = names.indexOf(n);
    if (i >= 0 && i < 32) m |= 1 << i;
  }
  return m >>> 0;
}

function unmask(names: readonly string[], m: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < names.length && i < 32; i++) if (m & (1 << i)) out.push(names[i]);
  return out;
}
