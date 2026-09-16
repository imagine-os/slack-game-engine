import { EventEmitter } from '../core/EventEmitter';
import type { ConnectOptions, NetPayload, PeerId, SendTarget, Transport, TransportEvents } from './Transport';

/**
 * Offline transport: the local peer is always the host of a room with no
 * other peers. Messages are dropped. Lets single-player code paths run the
 * same networking API without a server.
 */
export class NullTransport implements Transport {
  readonly name = 'null';
  localId: PeerId = 'local';
  isHost = true;
  readonly hostId: PeerId = 'local';
  roomId = '';
  readonly peers: PeerId[] = [];
  connected = false;
  private events = new EventEmitter<TransportEvents>();

  async connect(opts: ConnectOptions): Promise<void> {
    this.roomId = opts.roomId;
    this.connected = true;
    this.events.emit('connected', { localId: this.localId, isHost: true, roomId: opts.roomId, peers: [], hostId: this.localId });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.roomId = '';
    this.events.emit('disconnected', { reason: 'local' });
  }

  send(_to: SendTarget, _data: NetPayload): void {
    // Dropped: nobody to talk to.
  }

  on<K extends keyof TransportEvents>(event: K, fn: (payload: TransportEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  rtt(): number {
    return 0;
  }
}
