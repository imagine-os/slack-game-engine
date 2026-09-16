import type { Engine } from '../../core/Engine';
import { EventEmitter } from '../../core/EventEmitter';
import type { PrefabData, SceneData } from '../../core/ecs/Scene';
import type { AssetManifestEntry } from '../../assets/types';
import { ProjectLoader } from '../../project/ProjectLoader';
import { ProjectStore } from '../../project/ProjectStore';
import { createProject, defaultScene, generateId, normalizeProject } from '../../project/createProject';
import type { Project, ProjectSummary } from '../../project/types';
import type { ScriptSource } from '../../scripting/types';
import { ScriptCompileError } from '../../scripting/types';
import { debounce } from '../ui/dom';
import { SceneEditor } from './SceneEditor';

export type ProjectOrigin = 'new' | 'local' | 'template' | 'imported' | 'remote';

/** Project-level (non scene) changes, mirrored to collaborators. */
export type ProjectMutation =
  | { kind: 'script-set'; name: string; source: string; ts: number }
  | { kind: 'script-add'; name: string; source: string }
  | { kind: 'script-remove'; name: string }
  | { kind: 'script-rename'; from: string; to: string }
  | { kind: 'asset-add'; entry: AssetManifestEntry }
  | { kind: 'asset-remove'; id: string }
  | { kind: 'prefab-add'; prefab: PrefabData }
  | { kind: 'prefab-remove'; name: string }
  | { kind: 'settings-set'; path: string; value: unknown }
  | { kind: 'scene-add'; scene: SceneData }
  | { kind: 'scene-remove'; name: string }
  | { kind: 'scene-rename'; from: string; to: string }
  | { kind: 'start-scene'; name: string };

export interface ProjectServiceEvents extends Record<string, unknown> {
  opened: Project;
  saved: Project;
  /** A project mutation was applied (locally or remotely). */
  mutated: { mutation: ProjectMutation; remote: boolean };
  scriptsChanged: void;
  assetsChanged: void;
  settingsChanged: void;
  scenesChanged: void;
  sceneSwitched: string;
  /** Script compile result after a source change. */
  scriptCompiled: { name: string; error: string | null };
  originChanged: ProjectOrigin;
}

/**
 * Owns the open project document and its persistence: IndexedDB autosave,
 * import/export, scene switching and project-level mutations (scripts,
 * assets, settings). Scene contents live in the {@link SceneEditor}; this
 * service serializes them back into `project.scenes` when saving or
 * switching scenes.
 */
export class ProjectService {
  readonly events = new EventEmitter<ProjectServiceEvents>();
  readonly store = new ProjectStore();
  readonly loader: ProjectLoader;
  readonly scene: SceneEditor;
  project: Project;
  origin: ProjectOrigin = 'new';
  /** Set by the shell; when false autosave is skipped (templates, remote guests). */
  autosaveEnabled = true;
  private _dirty = false;
  private autosave = debounce(() => { void this.save(true); }, 1500);
  onDirtyChange: ((dirty: boolean) => void) | null = null;

  constructor(readonly engine: Engine, demosBase = './demos/') {
    this.loader = new ProjectLoader(this.store, demosBase);
    this.scene = new SceneEditor(engine);
    this.project = createProject();
    this.scene.events.on('mutated', ({ remote }) => this.markDirty(remote));
  }

  get dirty(): boolean { return this._dirty; }

  markDirty(fromRemote = false): void {
    if (!this._dirty) { this._dirty = true; this.onDirtyChange?.(true); }
    if (this.autosaveEnabled && this.origin !== 'template' && !fromRemote) this.autosave();
    else if (this.autosaveEnabled && this.origin !== 'template') this.autosave();
  }

  // ---------------------------------------------------------------- opening

  /** Open a project document, loading scripts/assets into the engine and the start scene. */
  async open(project: Project, origin: ProjectOrigin): Promise<void> {
    this.autosave.cancel();
    this.project = project;
    this.origin = origin;
    await this.applyToEngine();
    const scene = project.scenes.find((s) => s.name === project.startScene) ?? project.scenes[0];
    this.scene.load(scene);
    this._dirty = false;
    this.onDirtyChange?.(false);
    document.title = `${project.name} – Forge Editor`;
    this.events.emit('opened', project);
    this.events.emit('originChanged', origin);
  }

  newProject(renderer: '2d' | '3d', name = 'Untitled Project'): Promise<void> {
    return this.open(createProject({ name, renderer }), 'new');
  }

  async openLocal(id: string): Promise<boolean> {
    const p = await this.store.load(id);
    if (!p) return false;
    await this.open(p, 'local');
    return true;
  }

  async openDemo(id: string): Promise<void> {
    const p = await this.loader.fromDemo(id);
    await this.open(p, 'template');
  }

  /** Resolve `?project=` like the player does (local store first, then demos/URLs). */
  async openRef(ref: string): Promise<void> {
    const local = await this.store.load(ref).catch(() => undefined);
    if (local) { await this.open(local, 'local'); return; }
    const p = await this.loader.resolve(ref);
    await this.open(p, 'template');
  }

  async importJson(text: string): Promise<void> {
    const p = this.store.import(text, { newId: generateId() });
    await this.open(p, 'imported');
    this.markDirty();
  }

  listLocal(): Promise<ProjectSummary[]> {
    return this.store.list().catch(() => []);
  }

  /** Load scripts and assets of the current project into the editing engine. */
  private async applyToEngine(): Promise<void> {
    const e = this.engine;
    const p = this.project;
    if (e.renderer) e.renderer.pixelsPerUnit = p.settings.pixelsPerUnit;
    e.assets.clear();
    for (const name of e.scripting.names()) e.scripting.unregister(name);
    e.scripting.load(p.scripts);
    e.prefabs.clear();
    for (const pf of p.prefabs) e.prefabs.set(pf.name, pf);
    try {
      const { failed } = await e.assets.loadManifest(p.assets, { strict: false });
      for (const f of failed) e.warn(`Asset "${f.id}" failed to load (${f.url.slice(0, 60)})`);
    } catch (err) {
      e.warn(`Asset loading failed: ${(err as Error).message}`);
    }
  }

  // ----------------------------------------------------------------- saving

  /** Write the live scene back into the project document. */
  syncScene(): void {
    const data = this.scene.serialize();
    const i = this.project.scenes.findIndex((s) => s.name === data.name);
    if (i >= 0) this.project.scenes[i] = data; else this.project.scenes.push(data);
  }

  /** Persist to IndexedDB. Templates must be saved as a copy first. */
  async save(auto = false): Promise<boolean> {
    if (this.origin === 'template') return false;
    this.autosave.cancel();
    this.syncScene();
    await this.store.save(this.project);
    if (this.origin === 'new' || this.origin === 'imported') { this.origin = 'local'; this.events.emit('originChanged', 'local'); }
    this._dirty = false;
    this.onDirtyChange?.(false);
    this.events.emit('saved', this.project);
    if (!auto) this.engine.log(`Saved "${this.project.name}"`);
    return true;
  }

  /** Copy a template/demo into a new local project and save it. */
  async saveAsCopy(name?: string): Promise<void> {
    this.syncScene();
    const copy = normalizeProject(structuredClone(this.project));
    copy.id = generateId();
    if (name) copy.name = name;
    copy.createdAt = new Date().toISOString();
    // Inline relative asset URLs so the copy keeps working from the local store.
    if (copy.assets.baseUrl) {
      const base = copy.assets.baseUrl;
      for (const a of copy.assets.assets) if (!/^(data:|https?:|\/)/.test(a.url)) a.url = new URL(a.url, new URL(base, location.href)).toString();
      delete copy.assets.baseUrl;
    }
    this.project = copy;
    this.origin = 'local';
    document.title = `${copy.name} – Forge Editor`;
    await this.save();
    this.events.emit('originChanged', 'local');
    this.events.emit('opened', copy);
  }

  exportJson(): string {
    this.syncScene();
    return this.store.export(this.project);
  }

  download(): void {
    this.syncScene();
    this.store.download(this.project);
  }

  /** Project JSON snapshot including the live scene (for play mode and collaboration). */
  snapshot(): Project {
    this.syncScene();
    return structuredClone(this.project);
  }

  // ----------------------------------------------------------------- scenes

  get currentSceneName(): string { return this.scene.sceneName; }

  switchScene(name: string): boolean {
    const target = this.project.scenes.find((s) => s.name === name);
    if (!target || name === this.scene.sceneName) return false;
    this.syncScene();
    this.scene.load(target);
    this.events.emit('sceneSwitched', name);
    return true;
  }

  // -------------------------------------------------------------- mutations

  /** Apply a project-level mutation (local or remote) and notify listeners. */
  apply(m: ProjectMutation, remote = false): void {
    const p = this.project;
    switch (m.kind) {
      case 'script-add': {
        if (!p.scripts.some((s) => s.name === m.name)) p.scripts.push({ name: m.name, source: m.source });
        this.compile(m.name, m.source);
        this.events.emit('scriptsChanged', undefined);
        break;
      }
      case 'script-set': {
        const s = p.scripts.find((x) => x.name === m.name);
        if (s) s.source = m.source; else p.scripts.push({ name: m.name, source: m.source });
        this.compile(m.name, m.source);
        this.events.emit('scriptsChanged', undefined);
        break;
      }
      case 'script-remove': {
        const i = p.scripts.findIndex((x) => x.name === m.name);
        if (i >= 0) p.scripts.splice(i, 1);
        this.engine.scripting.unregister(m.name);
        this.events.emit('scriptsChanged', undefined);
        break;
      }
      case 'script-rename': {
        const s = p.scripts.find((x) => x.name === m.from);
        if (s) {
          s.name = m.to;
          s.source = s.source.replace(new RegExp(`name:\\s*(['"\`])${escapeRe(m.from)}\\1`), `name: $1${m.to}$1`);
          this.engine.scripting.unregister(m.from);
          this.compile(m.to, s.source);
        }
        this.events.emit('scriptsChanged', undefined);
        break;
      }
      case 'asset-add': {
        const i = p.assets.assets.findIndex((a) => a.id === m.entry.id);
        if (i >= 0) p.assets.assets[i] = m.entry; else p.assets.assets.push(m.entry);
        void this.engine.assets.load(m.entry.kind, m.entry.url, m.entry.id, m.entry.meta).catch((err: unknown) => this.engine.warn(`Asset "${m.entry.id}": ${(err as Error).message}`));
        this.events.emit('assetsChanged', undefined);
        break;
      }
      case 'asset-remove': {
        const i = p.assets.assets.findIndex((a) => a.id === m.id);
        if (i >= 0) p.assets.assets.splice(i, 1);
        this.engine.assets.unload(m.id);
        this.events.emit('assetsChanged', undefined);
        break;
      }
      case 'prefab-add': {
        const i = p.prefabs.findIndex((x) => x.name === m.prefab.name);
        if (i >= 0) p.prefabs[i] = m.prefab; else p.prefabs.push(m.prefab);
        this.engine.prefabs.set(m.prefab.name, m.prefab);
        this.events.emit('assetsChanged', undefined);
        break;
      }
      case 'prefab-remove': {
        const i = p.prefabs.findIndex((x) => x.name === m.name);
        if (i >= 0) p.prefabs.splice(i, 1);
        this.engine.prefabs.delete(m.name);
        this.events.emit('assetsChanged', undefined);
        break;
      }
      case 'settings-set': {
        setPath(p as unknown as Record<string, unknown>, m.path, structuredClone(m.value));
        if (m.path === 'settings.pixelsPerUnit' && this.engine.renderer) this.engine.renderer.pixelsPerUnit = Number(m.value) || 32;
        if (m.path === 'name') document.title = `${p.name} – Forge Editor`;
        this.events.emit('settingsChanged', undefined);
        break;
      }
      case 'scene-add': {
        if (!p.scenes.some((s) => s.name === m.scene.name)) p.scenes.push(m.scene);
        this.events.emit('scenesChanged', undefined);
        break;
      }
      case 'scene-remove': {
        if (p.scenes.length <= 1) break;
        const i = p.scenes.findIndex((s) => s.name === m.name);
        if (i >= 0) p.scenes.splice(i, 1);
        if (p.startScene === m.name) p.startScene = p.scenes[0].name;
        if (this.scene.sceneName === m.name) { this.scene.load(p.scenes[0]); this.events.emit('sceneSwitched', p.scenes[0].name); }
        this.events.emit('scenesChanged', undefined);
        break;
      }
      case 'scene-rename': {
        const s = p.scenes.find((x) => x.name === m.from);
        if (s) s.name = m.to;
        if (p.startScene === m.from) p.startScene = m.to;
        if (this.scene.sceneName === m.from) this.scene.sceneName = m.to;
        this.events.emit('scenesChanged', undefined);
        break;
      }
      case 'start-scene': {
        if (p.scenes.some((s) => s.name === m.name)) p.startScene = m.name;
        this.events.emit('scenesChanged', undefined);
        break;
      }
    }
    this.markDirty(remote);
    this.events.emit('mutated', { mutation: m, remote });
  }

  /** Compile a script into the editing engine, reporting the result. */
  compile(name: string, source: string): string | null {
    try {
      this.engine.scripting.reload(source, name, false);
      this.events.emit('scriptCompiled', { name, error: null });
      return null;
    } catch (err) {
      const msg = err instanceof ScriptCompileError ? err.message : `${(err as Error).message}`;
      this.engine.diagnostics.emit('error', { level: 'error', message: msg, script: name, error: err });
      this.events.emit('scriptCompiled', { name, error: msg });
      return msg;
    }
  }

  /** Read a value from a dot path on the project (`settings.physics.gravity.y`). */
  getPath(path: string): unknown {
    return getPath(this.project as unknown as Record<string, unknown>, path);
  }

  /** A new scene document for this project's renderer. */
  makeScene(name: string): SceneData {
    return defaultScene(this.project.settings.renderer, name);
  }

  script(name: string): ScriptSource | undefined {
    return this.project.scripts.find((s) => s.name === name);
  }

  uniqueScriptName(base: string): string {
    let name = base, i = 2;
    while (this.project.scripts.some((s) => s.name === name)) name = `${base}${i++}`;
    return name;
  }

  uniqueSceneName(base: string): string {
    let name = base, i = 2;
    while (this.project.scenes.some((s) => s.name === name)) name = `${base} ${i++}`;
    return name;
  }

  uniqueAssetId(base: string): string {
    const clean = base.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'asset';
    let id = clean, i = 2;
    while (this.project.assets.assets.some((a) => a.id === id)) id = `${clean}_${i++}`;
    return id;
  }
}

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (next === null || typeof next !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  if (value === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = value;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
