import type { Entity } from '../core/ecs/Entity';
import type { InputSnapshot, InputMergeStrategy } from '../input/InputSnapshot';
import type { PeerId, Transport } from './Transport';

/** Network mode chosen in project settings. */
export type NetworkMode = 'none' | 'host-authoritative' | 'lockstep';

export interface NetSyncOptions {
  mode: NetworkMode;
  /** Snapshot / input ticks per second. */
  tickRate: number;
  maxPlayers: number;
  /** Allow several peers to control the same entity. */
  sharedControl: boolean;
  /** How simultaneous inputs are combined for shared control. */
  mergeStrategy: InputMergeStrategy;
}

export interface NetSyncEvents extends Record<string, unknown> {
  /** A remote peer spawned an entity that now exists locally. */
  spawned: { entity: Entity; netId: number; ownerId: PeerId };
  despawned: { entity: Entity; netId: number };
  /** Ownership of an entity changed. */
  ownershipChanged: { entity: Entity; ownerId: PeerId; previous: PeerId };
  /** A peer joined/left the game (after handshake). */
  playerJoined: { peerId: PeerId; displayName: string };
  playerLeft: { peerId: PeerId };
  /** An RPC arrived. */
  rpc: { name: string; from: PeerId; args: unknown[]; entity?: Entity };
  /** Sync handshake finished: the local peer is part of the game. */
  connected: { localId: PeerId; isHost: boolean; hostId: PeerId };
  /** Transport dropped or the sync was stopped. */
  disconnected: { reason: string };
  /** Host migrated. `isHost` tells whether the local peer took over. */
  hostChanged: { hostId: PeerId; previous: PeerId; isHost: boolean };
  /** Lockstep only: the simulation diverged from another peer. */
  desync: { tick: number; peerId: PeerId };
}

/** RPC handler signature. */
export type RpcHandler = (args: unknown[], from: PeerId, entity?: Entity) => void;

/**
 * High-level synchronisation on top of a {@link Transport}. Implemented by
 * the networking worker; see `src/net/README.md` for the sync model.
 *
 * Lifecycle: `start` after the engine and transport are ready, `update` once
 * per frame (sends at `tickRate`), `stop` on disconnect.
 */
export interface NetSync {
  readonly transport: Transport;
  readonly options: NetSyncOptions;
  readonly tick: number;
  readonly isHost: boolean;
  readonly localId: PeerId;

  start(): void;
  stop(): void;
  /** Called by the engine each frame with the frame delta. */
  update(dt: number): void;
  /** Called by the engine each fixed step before scripts run. */
  fixedUpdate(dt: number): void;

  /** Spawn a replicated entity from a prefab (host or owner authority). Returns the local entity. */
  spawn(prefab: string, opts?: { ownerId?: PeerId; position?: { x: number; y: number; z?: number }; authority?: 'host' | 'owner' }): Entity;
  /** Despawn everywhere. */
  despawn(entity: Entity): void;
  /** Transfer ownership (host only, or owner handing off). */
  setOwner(entity: Entity, ownerId: PeerId): void;
  /** Grant/revoke shared control of an entity to an extra peer. */
  shareControl(entity: Entity, peerId: PeerId, enabled: boolean): void;

  /** Submit the local input snapshot for this tick (clients relay to host). */
  submitInput(snapshot: InputSnapshot): void;
  /** Latest merged snapshot for an entity the local peer may not control (host side). */
  inputFor(entity: Entity): InputSnapshot | undefined;

  /** Register an RPC handler. */
  onRpc(name: string, handler: RpcHandler): () => void;
  /** Call an RPC on the host, a peer, or all peers. */
  rpc(name: string, args: unknown[], target?: PeerId | 'host' | 'all' | 'others', entity?: Entity): void;

  on<K extends keyof NetSyncEvents>(event: K, fn: (payload: NetSyncEvents[K]) => void): () => void;
  /** Connected players including the local one. `rtt` is the measured round trip in ms when known. */
  players(): { peerId: PeerId; displayName: string; isHost: boolean; rtt?: number }[];
}

/** Default network options used when a project does not specify them. */
export const DEFAULT_NET_OPTIONS: NetSyncOptions = {
  mode: 'none',
  tickRate: 20,
  maxPlayers: 8,
  sharedControl: false,
  mergeStrategy: 'average',
};
