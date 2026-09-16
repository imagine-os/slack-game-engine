/** Peer identifier assigned by the transport / signalling server. */
export type PeerId = string;

/** Message target: a specific peer or everyone else in the room. */
export type SendTarget = PeerId | 'all';

/** Payload accepted by {@link Transport.send}. Binary for snapshots, JSON for RPC/control. */
export type NetPayload = ArrayBuffer | Uint8Array | object;

export interface TransportEvents extends Record<string, unknown> {
  /** Connected to the room; `localId` is now valid. */
  connected: { localId: PeerId; isHost: boolean; roomId: string; peers: PeerId[]; hostId?: PeerId };
  disconnected: { reason: string };
  message: { from: PeerId; data: NetPayload; reliable: boolean };
  /** A peer joined the room. `displayName` is present when the transport carries names. */
  'peer-join': { peerId: PeerId; displayName?: string };
  'peer-leave': { peerId: PeerId };
  /** Host migrated to a new peer. */
  'host-changed': { hostId: PeerId };
  /** Transport-level problem (connection refused, ICE failure, ...). `fatal` means the transport gave up. */
  error: { error: unknown; message?: string; fatal?: boolean };
}

export interface ConnectOptions {
  /** Room to join or create. */
  roomId: string;
  /** Optional display name propagated to other peers by the server. */
  displayName?: string;
  /** Signalling / relay server URL (transport-specific). */
  serverUrl?: string;
  /** Ask to become host if the room is empty. Default true. */
  wantHost?: boolean;
  /** Extra transport-specific settings. */
  [key: string]: unknown;
}

export interface SendOptions {
  /** Reliable ordered delivery (default true). Unreliable is preferred for snapshots. */
  reliable?: boolean;
}

/**
 * Low-level peer messaging. Implemented by the networking worker (e.g.
 * WebSocket relay, WebRTC data channels). The core only depends on this
 * interface; {@link NullTransport} is the offline default.
 *
 * Contract:
 * - `connect` resolves once `localId` and `isHost` are known and emits `connected`.
 * - `send('all', ...)` never echoes back to the sender.
 * - Events are emitted on the main thread, in order, via `on`.
 */
export interface Transport {
  /** Human-readable transport name (`"null"`, `"ws"`, `"webrtc"`). */
  readonly name: string;
  /** This peer's id (empty until connected). */
  readonly localId: PeerId;
  /** Whether this peer is the authoritative host of the room. */
  readonly isHost: boolean;
  /** Peer id of the current host (equals `localId` when `isHost`; empty when unknown). */
  readonly hostId: PeerId;
  /** Current room id (empty when disconnected). */
  readonly roomId: string;
  /** Connected peers excluding self. */
  readonly peers: readonly PeerId[];
  readonly connected: boolean;

  connect(opts: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  send(to: SendTarget, data: NetPayload, opts?: SendOptions): void;
  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof TransportEvents>(event: K, fn: (payload: TransportEvents[K]) => void): () => void;
  /** Round-trip time estimate to the host (or average to peers when host), in ms. */
  rtt(peerId?: PeerId): number;
}
