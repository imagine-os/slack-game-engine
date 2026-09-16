import { EventEmitter } from '../core/EventEmitter';
import type { NetSync } from './NetSync';
import { NullTransport } from './NullTransport';
import type { PeerId, Transport } from './Transport';

export interface NetHubEvents extends Record<string, unknown> {
  transportChanged: Transport;
  syncChanged: NetSync | null;
}

/**
 * `engine.net`: the single place the engine, scripts and the networking
 * worker meet. Holds the active {@link Transport} (NullTransport by default)
 * and an optional {@link NetSync} implementation. Scripts read `localId` /
 * `isHost` here so they behave identically offline and online.
 */
export class NetHub {
  readonly events = new EventEmitter<NetHubEvents>();
  private _transport: Transport = new NullTransport();
  private _sync: NetSync | null = null;

  get transport(): Transport {
    return this._transport;
  }

  get sync(): NetSync | null {
    return this._sync;
  }

  /** Install a transport (the net worker calls this). */
  setTransport(t: Transport): void {
    this._transport = t;
    this.events.emit('transportChanged', t);
  }

  /** Install a sync implementation; `null` returns to offline mode. */
  setSync(s: NetSync | null): void {
    this._sync = s;
    this.events.emit('syncChanged', s);
  }

  get localId(): PeerId {
    return this._transport.localId;
  }

  get isHost(): boolean {
    return this._transport.isHost;
  }

  get connected(): boolean {
    return this._transport.connected;
  }

  get roomId(): string {
    return this._transport.roomId;
  }

  /** True when a real sync layer is running. */
  get online(): boolean {
    return this._sync !== null && this._transport.connected && this._transport.name !== 'null';
  }
}
