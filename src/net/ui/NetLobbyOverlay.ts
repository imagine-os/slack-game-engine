import './lobby.css';
import type { Engine } from '../../core/Engine';
import type { NetParams } from '../createTransport';
import { inviteUrl } from '../createTransport';
import type { LockstepSync } from '../LockstepSync';

/** Options for {@link NetLobbyOverlay}. */
export interface NetLobbyOptions {
  /** Parsed URL parameters (room, net, server, name). */
  params: NetParams;
  /** Called when the user chooses to play offline instead. */
  onPlayOffline?: () => void;
  /** Lockstep only: called when the host presses Start. */
  onStart?: () => void;
  /** Start collapsed to the status pill. Default false. */
  collapsed?: boolean;
  /** Refresh period in ms. Default 500. */
  refreshMs?: number;
}

/**
 * DOM lobby shown by the player when `?room=` is present: room code, invite
 * link, player list with host badge and RTT, connection status/errors and a
 * "Play offline" fallback. Collapses to a small pill during play. Reads
 * everything from `engine.net` (presence, stats, sync roster), so it works
 * with any transport and before a sync is installed.
 */
export class NetLobbyOverlay {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private error: HTMLElement;
  private pill: HTMLElement;
  private startBtn: HTMLButtonElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void)[] = [];
  private _collapsed = false;
  private phase: 'connecting' | 'connected' | 'error' | 'offline' = 'connecting';
  private message = '';

  constructor(readonly engine: Engine, readonly container: HTMLElement, readonly opts: NetLobbyOptions) {
    const root = document.createElement('div');
    root.className = 'net-lobby';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Multiplayer lobby');
    root.innerHTML = `
      <div class="net-lobby-panel">
        <div class="net-lobby-head">
          <div>
            <div class="net-lobby-label">Room</div>
            <div class="net-lobby-code"></div>
          </div>
          <div class="net-lobby-actions">
            <button type="button" class="net-copy" title="Copy invite link">Copy invite link</button>
            <button type="button" class="net-collapse" aria-label="Collapse lobby">–</button>
          </div>
        </div>
        <div class="net-lobby-status" aria-live="polite"></div>
        <div class="net-lobby-error" hidden></div>
        <ul class="net-lobby-players"></ul>
        <div class="net-lobby-foot">
          <span class="net-lobby-transport"></span>
          <span class="net-lobby-spacer"></span>
          <button type="button" class="net-start" hidden>Start game</button>
          <button type="button" class="net-offline">Play offline</button>
        </div>
      </div>
      <button type="button" class="net-lobby-pill" hidden aria-label="Expand lobby"></button>
    `;
    container.appendChild(root);
    this.root = root;
    this.list = root.querySelector('.net-lobby-players')!;
    this.status = root.querySelector('.net-lobby-status')!;
    this.error = root.querySelector('.net-lobby-error')!;
    this.pill = root.querySelector('.net-lobby-pill')!;
    root.querySelector('.net-lobby-code')!.textContent = opts.params.room;
    root.querySelector('.net-lobby-transport')!.textContent = describeTransport(opts.params);
    root.querySelector<HTMLButtonElement>('.net-copy')!.addEventListener('click', (ev) => this.copyInvite(ev.currentTarget as HTMLButtonElement));
    root.querySelector<HTMLButtonElement>('.net-collapse')!.addEventListener('click', () => this.setCollapsed(true));
    this.pill.addEventListener('click', () => this.setCollapsed(false));
    root.querySelector<HTMLButtonElement>('.net-offline')!.addEventListener('click', () => {
      this.phase = 'offline';
      this.opts.onPlayOffline?.();
      this.dispose();
    });
    this.startBtn = root.querySelector<HTMLButtonElement>('.net-start');
    this.startBtn?.addEventListener('click', () => { this.opts.onStart?.(); this.setCollapsed(true); });

    const hub = engine.net;
    this.unsub.push(
      hub.events.on('presenceChanged', () => this.render()),
      hub.events.on('connected', () => { this.phase = 'connected'; this.message = ''; this.render(); }),
      hub.events.on('disconnected', (e) => { this.phase = 'error'; this.message = `Disconnected: ${e.reason}`; this.setCollapsed(false); this.render(); }),
      hub.events.on('hostChanged', (e) => { this.flash(e.hostId === hub.localId ? 'You are now the host' : `Host changed to ${hub.nameOf(e.hostId)}`); }),
      hub.events.on('error', (e) => { if (e.fatal) { this.phase = 'error'; this.setCollapsed(false); } this.message = e.message ?? String(e.error); this.render(); }),
    );
    this.timer = setInterval(() => { hub.update(); this.render(); }, opts.refreshMs ?? 500);
    if (opts.collapsed) this.setCollapsed(true);
    this.render();
  }

  /** Show a connecting/progress message. */
  setConnecting(message = 'Connecting…'): void {
    this.phase = 'connecting';
    this.message = message;
    this.render();
  }

  /** Show a fatal error with the Play offline fallback visible. */
  setError(message: string): void {
    this.phase = 'error';
    this.message = message;
    this.setCollapsed(false);
    this.render();
  }

  /** Mark the handshake done (called by `installNetworking`). */
  setConnected(): void {
    this.phase = 'connected';
    this.message = '';
    this.render();
  }

  /** Toggle between the full panel and the status pill. */
  setCollapsed(collapsed: boolean): void {
    this._collapsed = collapsed;
    this.root.classList.toggle('collapsed', collapsed);
    this.pill.hidden = !collapsed;
    this.render();
  }

  get collapsed(): boolean {
    return this._collapsed;
  }

  /** Brief notice in the status line. */
  flash(text: string): void {
    this.message = text;
    this.render();
    setTimeout(() => { if (this.message === text) { this.message = ''; this.render(); } }, 3000);
  }

  private async copyInvite(btn: HTMLButtonElement): Promise<void> {
    const url = inviteUrl(this.opts.params);
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Copied!';
    } catch {
      window.prompt('Copy this invite link', url);
      btn.textContent = 'Copy invite link';
      return;
    }
    setTimeout(() => { btn.textContent = 'Copy invite link'; }, 1500);
  }

  private render(): void {
    const hub = this.engine.net;
    const sync = hub.sync;
    const players = sync ? sync.players().map((p) => ({ ...p, rtt: p.rtt ?? hub.rttTo(p.peerId), isLocal: p.peerId === hub.localId })) : hub.presence;
    const stats = hub.stats;
    // Status line.
    let status = '';
    if (this.phase === 'connecting') status = this.message || 'Connecting…';
    else if (this.phase === 'error') status = 'Connection problem';
    else if (!hub.connected) status = 'Disconnected';
    else {
      const role = hub.isHost ? 'You are the host' : `Connected to ${hub.nameOf(hub.hostId)}`;
      const rtt = stats.rtt ? ` · ${Math.round(stats.rtt)} ms` : '';
      const kb = stats.bytesInPerSec + stats.bytesOutPerSec > 0 ? ` · ${((stats.bytesInPerSec + stats.bytesOutPerSec) / 1024).toFixed(1)} kB/s` : '';
      status = `${role}${rtt}${kb}${this.message ? ` · ${this.message}` : ''}`;
    }
    this.status.textContent = status;
    this.root.dataset.phase = this.phase;
    const showError = this.phase === 'error' && !!this.message;
    this.error.hidden = !showError;
    if (showError) this.error.textContent = this.message;
    // Player list.
    this.list.replaceChildren(...players.map((p) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'net-player-name';
      name.textContent = p.displayName + (p.isLocal ? ' (you)' : '');
      li.appendChild(name);
      if (p.isHost) { const b = document.createElement('span'); b.className = 'net-badge'; b.textContent = 'host'; li.appendChild(b); }
      const rtt = document.createElement('span');
      rtt.className = 'net-player-rtt';
      rtt.textContent = p.isLocal ? '' : p.rtt ? `${Math.round(p.rtt)} ms` : '…';
      li.appendChild(rtt);
      return li;
    }));
    if (players.length === 0) {
      const li = document.createElement('li');
      li.className = 'net-empty';
      li.textContent = this.phase === 'connecting' ? 'Looking for players…' : 'Nobody here yet';
      this.list.appendChild(li);
    }
    // Lockstep start button (host only, before the game began).
    if (this.startBtn) {
      const lock = sync && (sync as LockstepSync).options.mode === 'lockstep' ? (sync as LockstepSync) : null;
      this.startBtn.hidden = !(lock && hub.isHost && !lock.inGame && this.opts.onStart);
    }
    // Pill.
    const count = players.length;
    this.pill.textContent = `Room ${this.opts.params.room} · ${count} player${count === 1 ? '' : 's'}${stats.rtt ? ` · ${Math.round(stats.rtt)} ms` : ''}${this.phase === 'error' ? ' · !' : ''}`;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const off of this.unsub) off();
    this.unsub.length = 0;
    this.root.remove();
  }
}

function describeTransport(p: NetParams): string {
  switch (p.net) {
    case 'local': return 'Same-browser tabs';
    case 'ws': return p.server ? `Relay ${p.server}` : 'Relay server';
    case 'memory': return 'In-memory';
    case 'null': return 'Offline';
    default: return 'Peer-to-peer (WebRTC)';
  }
}
