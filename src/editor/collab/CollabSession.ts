import { EventEmitter } from '../../core/EventEmitter';
import type { Entity } from '../../core/ecs/Entity';
import type { Project } from '../../project/types';
import type { EditorState } from '../app/EditorState';
import type { CommandStack } from '../commands/CommandStack';
import type { ProjectService } from '../project/ProjectService';
import type { SceneEditor } from '../project/SceneEditor';
import type { CameraPose } from '../viewport/EditorCamera';
import type { CollabChannel } from './Channel';
import { OpModel, type CollabOp } from './OpModel';

/** What each collaborator broadcasts about themselves. */
export interface Presence {
  id: string;
  name: string;
  color: string;
  scene: string;
  cursor: { x: number; y: number; z: number } | null;
  /** Selected entity guids. */
  selection: string[];
  camera: CameraPose | null;
  lastSeen: number;
  editingScript: string | null;
}

type Message =
  | { t: 'op'; op: CollabOp }
  | { t: 'ops'; ops: CollabOp[] }
  | { t: 'state-request' }
  | { t: 'state'; project: Project; clocks: ReturnType<OpModel['export']>; pending: CollabOp[] }
  | { t: 'presence'; presence: Omit<Presence, 'lastSeen'> }
  | { t: 'bye' };

export interface CollabEvents extends Record<string, unknown> {
  presence: Presence[];
  status: 'connecting' | 'syncing' | 'connected' | 'disconnected';
  /** A remote op touched a script we edited within the last two seconds. */
  scriptConflict: { name: string; remoteSource: string };
  /** Full state arrived from the host. */
  stateLoaded: void;
}

export const PRESENCE_COLORS = ['#ff7a3d', '#4cc2ff', '#8b7dff', '#7ee787', '#ffd166', '#ff5c7a', '#5ce1e6', '#f4a261'];

export interface CollabDeps {
  scene: SceneEditor;
  project: ProjectService;
  commands: CommandStack;
  state: EditorState;
}

/**
 * Operation-based collaborative editing over a {@link CollabChannel}: local
 * scene/project mutations become ops (Lamport-clocked, last-writer-wins for
 * fields and script files); remote ops are applied through the same
 * SceneEditor / ProjectService APIs without touching the local undo stack.
 * New peers receive the host's full project state and clock registers.
 */
export class CollabSession {
  readonly events = new EventEmitter<CollabEvents>();
  readonly model: OpModel;
  readonly presence = new Map<string, Presence>();
  readonly me: Presence;
  status: CollabEvents['status'] = 'connecting';
  /** Peer we are following (camera + scene), if any. */
  following: string | null = null;
  /** Ops for scenes that are not open locally, applied when the scene is switched to. */
  private pending = new Map<string, CollabOp[]>();
  private off: (() => void)[] = [];
  private presenceTimer = 0;
  private presenceDirty = false;
  private heartbeat = 0;
  private applyingRemote = false;
  private stateTimeout = 0;
  /** Local scripts edited recently (name to ms) for conflict detection. */
  localScriptEdits = new Map<string, number>();

  constructor(private readonly deps: CollabDeps, readonly channel: CollabChannel, displayName: string, color?: string) {
    this.model = new OpModel(channel.localId);
    this.me = { id: channel.localId, name: displayName, color: color ?? PRESENCE_COLORS[hash(channel.localId) % PRESENCE_COLORS.length], scene: deps.scene.sceneName, cursor: null, selection: [], camera: null, lastSeen: Date.now(), editingScript: null };
  }

  get isHost(): boolean { return this.channel.isHost; }

  /** Wire everything up. Guests ask the host for the full state. */
  start(opts: { requestState?: boolean } = {}): void {
    const { scene, project, state } = this.deps;
    this.off.push(
      this.channel.onMessage((from, data) => this.onMessage(from, data as Message)),
      this.channel.onPeerJoin((id) => { this.touch(id); this.sendPresence(true); }),
      this.channel.onPeerLeave((id) => { this.presence.delete(id); if (this.following === id) this.following = null; this.emitPresence(); }),
      scene.events.on('mutated', ({ mutation, remote }) => { if (!remote && !this.applyingRemote) this.broadcast({ kind: 'scene', scene: scene.sceneName, mutation, clock: this.model.tick() }); }),
      project.events.on('mutated', ({ mutation, remote }) => {
        if (remote || this.applyingRemote) return;
        if (mutation.kind === 'script-set') this.localScriptEdits.set(mutation.name, Date.now());
        this.broadcast({ kind: 'project', mutation, clock: this.model.tick() });
      }),
      project.events.on('sceneSwitched', (name) => { this.replayPending(name); this.me.scene = name; this.sendPresence(); }),
      state.events.on('selection', (sel) => { this.me.selection = sel.map((e) => scene.guidOf(e)).filter((g): g is string => !!g); this.sendPresence(); }),
    );
    this.heartbeat = window.setInterval(() => { this.sendPresence(true); this.prune(); }, 3000);
    const wantState = opts.requestState ?? (!this.channel.isHost && this.channel.peers().length > 0);
    if (wantState) {
      this.setStatus('syncing');
      this.channel.send('host', { t: 'state-request' } satisfies Message);
      this.stateTimeout = window.setTimeout(() => { if (this.status === 'syncing') this.setStatus('connected'); }, 4000);
    } else this.setStatus('connected');
    this.sendPresence(true);
  }

  stop(): void {
    this.channel.send('all', { t: 'bye' } satisfies Message);
    for (const o of this.off) o();
    this.off = [];
    clearInterval(this.heartbeat);
    clearTimeout(this.stateTimeout);
    this.channel.close();
    this.setStatus('disconnected');
  }

  private setStatus(s: CollabEvents['status']): void {
    this.status = s;
    this.events.emit('status', s);
  }

  // ------------------------------------------------------------------ ops

  private broadcast(op: CollabOp): void {
    this.model.recordLocal(op);
    this.channel.send('all', { t: 'op', op } satisfies Message);
  }

  /** Apply a remote op (public for tests). Returns false when LWW rejected it. */
  applyOp(op: CollabOp): boolean {
    if (!this.model.accept(op)) return false;
    const { scene, project } = this.deps;
    this.applyingRemote = true;
    try {
      if (op.kind === 'scene') {
        if (op.scene !== scene.sceneName) {
          if (project.project.scenes.some((s) => s.name === op.scene)) this.queue(op);
          return true;
        }
        scene.applyRemote(op.mutation);
      } else {
        const m = op.mutation;
        if (m.kind === 'script-set') {
          const edited = this.localScriptEdits.get(m.name) ?? 0;
          if (Date.now() - edited < 2000) this.events.emit('scriptConflict', { name: m.name, remoteSource: m.source });
        }
        if (m.kind === 'scene-remove') this.pending.delete(m.name);
        if (m.kind === 'scene-rename') this.pending.delete(m.from);
        project.apply(m, true);
      }
    } finally {
      this.applyingRemote = false;
    }
    return true;
  }

  private queue(op: CollabOp & { kind: 'scene' }): void {
    let list = this.pending.get(op.scene);
    if (!list) this.pending.set(op.scene, (list = []));
    list.push(op);
  }

  private replayPending(sceneName: string): void {
    const list = this.pending.get(sceneName);
    if (!list) return;
    this.pending.delete(sceneName);
    this.applyingRemote = true;
    try { for (const op of list) if (op.kind === 'scene') this.deps.scene.applyRemote(op.mutation); }
    finally { this.applyingRemote = false; }
  }

  private allPending(): CollabOp[] {
    return [...this.pending.values()].flat();
  }

  // ------------------------------------------------------------- messages

  private onMessage(from: string, msg: Message): void {
    switch (msg.t) {
      case 'op': this.applyOp(msg.op); break;
      case 'ops': for (const op of msg.ops) this.applyOp(op); break;
      case 'state-request':
        if (this.channel.isHost || this.channel.peers().length === 0) this.sendState(from);
        break;
      case 'state': void this.receiveState(msg); break;
      case 'presence': {
        const p: Presence = { ...msg.presence, lastSeen: Date.now() };
        this.presence.set(from, p);
        this.emitPresence();
        break;
      }
      case 'bye': this.presence.delete(from); this.emitPresence(); break;
    }
  }

  sendState(to: string): void {
    const project = this.deps.project.snapshot();
    this.channel.send(to, { t: 'state', project, clocks: this.model.export(), pending: this.allPending() } satisfies Message);
  }

  private async receiveState(msg: Extract<Message, { t: 'state' }>): Promise<void> {
    clearTimeout(this.stateTimeout);
    this.model.import(msg.clocks);
    for (const op of msg.pending) if (op.kind === 'scene') this.queue(op);
    this.applyingRemote = true;
    try {
      const current = this.deps.project.currentSceneName;
      this.deps.project.autosaveEnabled = false;
      await this.deps.project.open(msg.project, 'remote');
      if (msg.project.scenes.some((s) => s.name === current)) this.deps.project.switchScene(current);
      this.deps.commands.clear();
    } finally {
      this.applyingRemote = false;
    }
    this.replayPending(this.deps.project.currentSceneName);
    this.events.emit('stateLoaded', undefined);
    this.setStatus('connected');
  }

  // ------------------------------------------------------------- presence

  private touch(id: string): void {
    if (!this.presence.has(id)) this.presence.set(id, { id, name: id, color: PRESENCE_COLORS[hash(id) % PRESENCE_COLORS.length], scene: '', cursor: null, selection: [], camera: null, lastSeen: Date.now(), editingScript: null });
  }

  private prune(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.presence) if (now - p.lastSeen > 12000) { this.presence.delete(id); changed = true; }
    if (changed) this.emitPresence();
  }

  private emitPresence(): void {
    this.events.emit('presence', [...this.presence.values()]);
  }

  /** Throttled presence broadcast. */
  sendPresence(immediate = false): void {
    this.presenceDirty = true;
    if (immediate) { this.flushPresence(); return; }
    if (this.presenceTimer) return;
    this.presenceTimer = window.setTimeout(() => { this.presenceTimer = 0; this.flushPresence(); }, 60);
  }

  private flushPresence(): void {
    if (!this.presenceDirty) return;
    this.presenceDirty = false;
    const { lastSeen: _ls, ...p } = this.me;
    this.channel.send('all', { t: 'presence', presence: p } satisfies Message);
  }

  setCursor(c: Presence['cursor']): void { this.me.cursor = c; this.sendPresence(); }
  setCamera(pose: CameraPose): void { this.me.camera = pose; this.sendPresence(); }
  setEditingScript(name: string | null): void { if (this.me.editingScript !== name) { this.me.editingScript = name; this.sendPresence(); } }

  /** Peers' selections as entity ids (current scene only). */
  remoteSelections(): { id: string; color: string; name: string; entities: Entity[]; cursor: Presence['cursor'] }[] {
    const out = [];
    for (const p of this.presence.values()) {
      if (p.scene && p.scene !== this.deps.scene.sceneName) continue;
      out.push({ id: p.id, color: p.color, name: p.name, entities: p.selection.map((g) => this.deps.scene.entityOf(g)).filter((e): e is Entity => e !== undefined), cursor: p.cursor });
    }
    return out;
  }

  /** Colors of peers selecting a guid. */
  colorsFor(guid: string): string[] {
    const out: string[] = [];
    for (const p of this.presence.values()) if (p.selection.includes(guid)) out.push(p.color);
    return out;
  }

  /** Follow a peer: switch to their scene; returns their camera pose to apply. */
  follow(id: string | null): CameraPose | null {
    this.following = id;
    if (!id) return null;
    const p = this.presence.get(id);
    if (!p) return null;
    if (p.scene && p.scene !== this.deps.project.currentSceneName) this.deps.project.switchScene(p.scene);
    return p.camera;
  }

  /** Invite link for this room. */
  inviteUrl(): string {
    const u = new URL(location.href);
    u.searchParams.set('room', this.channel.roomId);
    u.searchParams.delete('template');
    u.searchParams.delete('new');
    return u.toString();
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
