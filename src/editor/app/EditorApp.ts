import type { Engine } from '../../core/Engine';
import type { Entity } from '../../core/ecs/Entity';
import { NULL_ENTITY } from '../../core/ecs/Entity';
import { Transform } from '../../core/ecs/Transform';
import { Vec3 } from '../../core/math';
import type { Project } from '../../project/types';
import { VERSION } from '../../index';
import { openChannel, type CollabChannel } from '../collab/Channel';
import { CollabSession } from '../collab/CollabSession';
import { CommandStack } from '../commands/CommandStack';
import { ProjectCommand } from '../commands/ProjectCommands';
import { CreateEntityCommand, DeleteEntitiesCommand } from '../commands/SceneCommands';
import { Inspector } from '../inspector/Inspector';
import { startTour, tourDone } from '../onboarding/Tour';
import { AssetsPanel } from '../panels/Assets';
import { ConsolePanel } from '../panels/Console';
import { Hierarchy, prefabToSnapshot } from '../panels/Hierarchy';
import { HistoryPanel } from '../panels/History';
import { ScriptsPanel } from '../panels/Scripts';
import { SettingsPanel } from '../panels/Settings';
import { makePreset, PRESETS } from '../project/EntityFactory';
import { ProjectService, type ProjectOrigin } from '../project/ProjectService';
import { SceneEditor, type EntitySnapshot } from '../project/SceneEditor';
import { openCommandPalette } from '../ui/CommandPalette';
import { openDialog, promptDialog } from '../ui/Dialog';
import { el, formatShortcut, icon, storage, shortId } from '../ui/dom';
import { openDocsDialog, openShortcutsDialog } from '../ui/Help';
import { MenuBar, showMenu, type MenuItem } from '../ui/Menu';
import { Tabs } from '../ui/Tabs';
import { toast } from '../ui/Toast';
import { installTooltips } from '../ui/Tooltip';
import { Viewport } from '../viewport/Viewport';
import { ActionRegistry } from './Actions';
import type { EditorContext } from './EditorContext';
import { EditorState, type Tool } from './EditorState';
import { Layout } from './Layout';
import { Shortcuts } from './Shortcuts';
import editorGuide from '../../../docs/EDITOR.md?raw';
import apiDoc from '../../../docs/API.md?raw';
import archDoc from '../../../docs/ARCHITECTURE.md?raw';
import contribDoc from '../../../docs/CONTRIBUTING-WORKERS.md?raw';

export interface EditorAppOptions {
  room?: string;
  /** Pre-opened channel (guest that received state before boot). */
  channel?: CollabChannel;
  displayName?: string;
}

const REPO = 'https://github.com/imagine-os/slack-game-engine';

/**
 * Composition root: builds the shell (menus, toolbar, panels), wires the
 * project, scene editor, commands, viewport and collaboration together and
 * registers every editor action.
 */
export class EditorApp implements EditorContext {
  readonly layout: Layout;
  readonly state = new EditorState();
  readonly commands = new CommandStack();
  readonly actions = new ActionRegistry();
  readonly shortcuts = new Shortcuts(this.actions);
  readonly engine: Engine;
  readonly project: ProjectService;
  readonly scene: SceneEditor;
  readonly viewport: Viewport;
  readonly is3d: boolean;
  readonly hierarchy: Hierarchy;
  readonly inspector: Inspector;
  readonly tabs = new Tabs('dock');
  readonly assets: AssetsPanel;
  readonly scripts: ScriptsPanel;
  readonly console: ConsolePanel;
  readonly settings: SettingsPanel;
  readonly history: HistoryPanel;
  collab: CollabSession | null = null;
  private menubar = new MenuBar();
  private toolbar = el('div', { class: 'toolbar' });
  private presenceHost = el('div', { class: 'presence' });
  private statusLeft = el('div', { class: 'status-left' });
  private statusRight = el('div', { class: 'status-right' });
  private playStats = el('span', { class: 'status-item mono' });
  private clipboard: EntitySnapshot[] = [];
  private displayName: string;

  constructor(host: HTMLElement, doc: Project, origin: ProjectOrigin, private readonly opts: EditorAppOptions = {}) {
    this.displayName = opts.displayName ?? storage.get('forge.editor.displayName', `User ${shortId(3)}`);
    storage.set('forge.editor.displayName', this.displayName);
    this.layout = new Layout(host);
    this.is3d = doc.settings.renderer === '3d';
    const canvas = el('canvas', { attrs: { 'aria-label': 'Scene canvas' } });
    this.engine = Viewport.createEngine(canvas, doc.settings.renderer, doc.settings.pixelsPerUnit);
    this.project = new ProjectService(this.engine);
    this.scene = this.project.scene;
    this.viewport = new Viewport(this.state, this.scene, this.commands, this.engine);
    this.layout.center.appendChild(this.viewport.root);
    this.layout.center.appendChild(this.viewportTools());
    this.hierarchy = new Hierarchy(this);
    this.layout.left.appendChild(this.hierarchy.root);
    this.inspector = new Inspector(this);
    this.layout.right.appendChild(this.inspector.root);
    this.assets = new AssetsPanel(this);
    this.scripts = new ScriptsPanel(this);
    this.console = new ConsolePanel(this);
    this.settings = new SettingsPanel(this);
    this.history = new HistoryPanel(this);
    this.tabs.add('assets', 'Assets', this.assets.root, { icon: icon('image', 14) });
    this.tabs.add('scripts', 'Scripts', this.scripts.root, { icon: icon('code', 14) });
    this.tabs.add('console', 'Console', this.console.root, { icon: icon('console', 14), onShow: () => { this.console.acknowledge(); } });
    this.tabs.add('settings', 'Project', this.settings.root, { icon: icon('settings', 14) });
    this.tabs.add('history', 'History', this.history.root, { icon: icon('history', 14) });
    this.tabs.root.setAttribute('data-tour', 'dock');
    this.layout.bottom.appendChild(this.tabs.root);
    this.tabs.show(storage.get('forge.editor.tab', 'assets'));
    this.tabs.onChange = (id) => storage.set('forge.editor.tab', id);
    this.console.onCounts = (c) => { this.tabs.setBadge('console', c.error + c.warn, c.error ? 'err' : 'warn'); };
    this.layout.menubarHost.appendChild(this.menubar.root);
    this.layout.toolbarHost.appendChild(this.toolbar);
    this.layout.statusbar.append(this.statusLeft, this.statusRight);
    this.registerActions();
    this.buildMenus();
    this.buildToolbar();
    this.shortcuts.install();
    installTooltips();
    this.wire();
    void this.boot(doc, origin);
  }

  private async boot(doc: Project, origin: ProjectOrigin): Promise<void> {
    await this.project.open(doc, origin);
    this.commands.clear();
    this.updateStatus();
    if (this.opts.room || this.opts.channel) await this.startCollab(this.opts.room ?? this.opts.channel!.roomId, this.opts.channel);
    if (!tourDone()) setTimeout(() => this.tour(), 600);
    if (origin === 'template') toast('Opened as a template. Use File › Save as my project to keep your changes.', 'info', { duration: 6000 });
  }

  // --------------------------------------------------------------- context

  openScript(name: string): void {
    this.layout.toggle('bottom', true);
    this.tabs.show('scripts');
    this.scripts.reveal(name);
    this.collab?.setEditingScript(name);
  }

  showTab(id: 'assets' | 'scripts' | 'console' | 'settings' | 'history'): void {
    this.layout.toggle('bottom', true);
    this.tabs.show(id);
  }

  log(level: 'log' | 'warn' | 'error', message: string): void {
    this.console.push(level, message, 'editor');
  }

  remoteSelectionColors(guid: string): string[] {
    return this.collab?.colorsFor(guid) ?? [];
  }

  entityIcon(e: Entity): string {
    const w = this.engine.world;
    const has = (t: string): boolean => w.hasComponent(e, t);
    if (has('Camera2D') || has('Camera3D')) return 'camera';
    if (has('Sprite')) return 'image';
    if (has('Shape')) return 'shapes';
    if (has('Text')) return 'type';
    if (has('Tilemap')) return 'grid';
    if (has('ParticleEmitter')) return 'sparkles';
    if (has('Light2D') || has('Light')) return 'sun';
    if (has('MeshRenderer')) return 'box';
    if (has('AudioSource') || has('AudioListener')) return 'audio';
    if (has('Script')) return 'code';
    if (has('RigidBody2D') || has('RigidBody3D')) return 'atom';
    if (has('PlayerInput')) return 'gamepad';
    return 'entity';
  }

  // ---------------------------------------------------------------- wiring

  private wire(): void {
    const { state, project, scene, viewport, commands } = this;
    project.onDirtyChange = (d) => { state.dirty = d; this.updateStatus(); };
    project.events.on('saved', () => this.updateStatus());
    project.events.on('opened', () => { state.select(null); this.updateStatus(); this.buildToolbar(); });
    project.events.on('originChanged', () => this.updateStatus());
    project.events.on('scenesChanged', () => this.buildToolbar());
    project.events.on('sceneSwitched', () => { state.select(null); this.buildToolbar(); this.updateStatus(); });
    project.events.on('settingsChanged', () => this.updateStatus());
    scene.events.on('mutated', () => { state.prune((e) => scene.isEditable(e)); });
    scene.events.on('structure', () => this.updateStatus());
    state.events.on('selection', () => { this.updateStatus(); });
    state.events.on('tool', () => this.buildToolbar());
    state.events.on('snap', () => this.buildToolbar());
    state.events.on('overlays', () => this.buildToolbar());
    commands.events.on('change', () => this.buildToolbar());
    viewport.play.events.on('change', (s) => { state.play = s; this.buildToolbar(); this.updateStatus(); });
    viewport.play.onStats = (t) => { this.playStats.textContent = t; };
    viewport.events.on('camera', (pose) => { scene.editorSettings.camera = pose as unknown as Record<string, unknown>; this.collab?.setCamera(pose); });
    viewport.events.on('cursor', (c) => this.collab?.setCursor(c));
    viewport.events.on('assetDrop', ({ id, kind, position }) => this.dropAsset(id, kind, position));
    viewport.events.on('contextMenu', ({ x, y, world, entity }) => {
      if (entity !== null && !state.isSelected(entity)) state.select(entity);
      showMenu(this.viewportMenu(world, entity), { x, y });
    });
    window.addEventListener('beforeunload', (e) => {
      if (project.dirty && project.origin !== 'template' && project.origin !== 'remote') { void project.save(true); }
      if (project.dirty && (project.origin === 'template' || this.scripts.hasUnsaved())) { e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('pagehide', () => this.collab?.stop());
  }

  private dropAsset(id: string, kind: string, position: Vec3): void {
    if (kind === 'image' || kind === 'atlas') {
      if (this.is3d) {
        const snap = makePreset('cube', { position: { x: position.x, y: 0.5, z: position.z }, name: id });
        snap.components.find((c) => c.type === 'MeshRenderer')!.data.texture = id;
        const cmd = new CreateEntityCommand(this.scene, snap, `Create ${id}`);
        this.commands.push(cmd);
        if (cmd.entity !== undefined) this.state.select(cmd.entity);
        return;
      }
      const cmd = new CreateEntityCommand(this.scene, makePreset('sprite', { position, name: id, texture: id }), `Create sprite ${id}`);
      this.commands.push(cmd);
      if (cmd.entity !== undefined) { this.state.select(cmd.entity); this.state.reveal(cmd.entity); }
    } else if (kind === 'audio') toast('Drop audio onto an entity in the hierarchy to add an AudioSource.', 'info');
    else toast(`Cannot place a ${kind} asset in the scene.`, 'warn');
  }

  // --------------------------------------------------------------- actions

  private registerActions(): void {
    const { state, commands, scene, project, viewport } = this;
    const hasSel = (): boolean => state.selection.length > 0 && !state.isPlaying;
    const editing = (): boolean => !state.isPlaying;
    const tool = (id: Tool, title: string, key: string, ic: string) => ({ id: `tool.${id}`, title, category: 'Tools', shortcut: key, icon: ic, checked: () => state.tool === id, run: () => { state.tool = id; } });
    this.actions.register(
      { id: 'file.save', title: 'Save project', category: 'File', shortcut: 'Mod+S', icon: 'save', global: true, run: () => this.save() },
      { id: 'file.saveAs', title: 'Save as my project…', category: 'File', run: () => this.saveAs() },
      { id: 'file.export', title: 'Export project JSON', category: 'File', shortcut: 'Mod+Shift+E', icon: 'download', run: () => { project.download(); toast('Project exported', 'success'); } },
      { id: 'file.import', title: 'Import project JSON…', category: 'File', icon: 'upload', run: () => this.importProject() },
      { id: 'file.new2d', title: 'New 2D project', category: 'File', run: () => this.navigateNew('2d') },
      { id: 'file.new3d', title: 'New 3D project', category: 'File', run: () => this.navigateNew('3d') },
      { id: 'file.open', title: 'Open project…', category: 'File', shortcut: 'Mod+O', run: () => this.openProjectDialog() },
      { id: 'file.launcher', title: 'Back to launcher', category: 'File', run: () => { location.href = './index.html'; } },
      { id: 'file.settings', title: 'Project settings', category: 'File', shortcut: 'Mod+Alt+P', run: () => this.showTab('settings') },
      { id: 'edit.undo', title: 'Undo', category: 'Edit', shortcut: 'Mod+Z', icon: 'undo', enabled: () => commands.canUndo, run: () => { commands.undo(); } },
      { id: 'edit.redo', title: 'Redo', category: 'Edit', shortcut: 'Mod+Shift+Z,Mod+Y', icon: 'redo', enabled: () => commands.canRedo, run: () => { commands.redo(); } },
      { id: 'entity.duplicate', title: 'Duplicate', category: 'Entity', shortcut: 'Mod+D', icon: 'copy', enabled: hasSel, run: () => this.duplicate() },
      { id: 'entity.delete', title: 'Delete selected', category: 'Entity', shortcut: 'Delete,Backspace', icon: 'trash', enabled: hasSel, run: () => this.deleteSelected() },
      { id: 'entity.copy', title: 'Copy', category: 'Entity', shortcut: 'Mod+C', enabled: hasSel, run: () => this.copy() },
      { id: 'entity.paste', title: 'Paste', category: 'Entity', shortcut: 'Mod+V', enabled: () => this.clipboard.length > 0 && editing(), run: () => this.paste() },
      { id: 'entity.selectAll', title: 'Select all', category: 'Entity', shortcut: 'Mod+A', enabled: editing, run: () => state.select(scene.all().filter((e) => !scene.isLocked(e))) },
      { id: 'entity.deselect', title: 'Deselect', category: 'Entity', shortcut: 'Escape', enabled: () => hasSel() && !state.picking, run: () => state.select(null) },
      { id: 'entity.rename', title: 'Rename selected', category: 'Entity', shortcut: 'F2', enabled: () => state.selection.length === 1, run: () => { const e = state.primary; if (e !== null) { state.reveal(e); this.hierarchy.root.querySelector<HTMLElement>(`.tree-row[data-entity="${e}"]`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); } } },
      { id: 'entity.createEmpty', title: 'Create empty entity', category: 'Entity', shortcut: 'Mod+Shift+N', icon: 'plus', enabled: editing, run: () => this.create('empty') },
      { id: 'entity.parent', title: 'Parent to first selected', category: 'Entity', enabled: () => state.selection.length > 1, run: () => this.parentSelection() },
      { id: 'entity.unparent', title: 'Move to root', category: 'Entity', shortcut: 'Shift+P', enabled: hasSel, run: () => this.unparentSelection() },
      tool('select', 'Select tool', 'Q', 'select'), tool('move', 'Move tool', 'W', 'move'), tool('rotate', 'Rotate tool', 'E', 'rotate'), tool('scale', 'Scale tool', 'R', 'scale'),
      { id: 'view.frame', title: 'Frame selected', category: 'View', shortcut: 'F', icon: 'frame', run: () => viewport.frameSelected() },
      { id: 'view.resetCamera', title: 'Reset camera', category: 'View', shortcut: 'Home', run: () => { viewport.camera.reset(); } },
      { id: 'view.grid', title: 'Toggle grid', category: 'View', shortcut: 'G', icon: 'grid', checked: () => state.overlays.grid, run: () => state.setOverlay({ grid: !state.overlays.grid }) },
      { id: 'view.colliders', title: 'Toggle collider overlay', category: 'View', shortcut: 'C', icon: 'collider', checked: () => state.overlays.colliders, run: () => state.setOverlay({ colliders: !state.overlays.colliders }) },
      { id: 'view.bounds', title: 'Toggle bounds of all entities', category: 'View', checked: () => state.overlays.bounds, run: () => state.setOverlay({ bounds: !state.overlays.bounds }) },
      { id: 'view.gizmos', title: 'Toggle gizmos', category: 'View', checked: () => state.overlays.gizmos, run: () => state.setOverlay({ gizmos: !state.overlays.gizmos }) },
      { id: 'view.snap', title: 'Toggle snapping', category: 'View', shortcut: 'S', icon: 'magnet', checked: () => state.snap.enabled, run: () => state.setSnap({ enabled: !state.snap.enabled }) },
      { id: 'view.snapSettings', title: 'Snap settings…', category: 'View', run: () => this.snapSettings() },
      { id: 'view.left', title: 'Toggle hierarchy panel', category: 'View', shortcut: 'Mod+1', checked: () => this.layout.isOpen('left'), run: () => this.layout.toggle('left') },
      { id: 'view.right', title: 'Toggle inspector panel', category: 'View', shortcut: 'Mod+2', checked: () => this.layout.isOpen('right'), run: () => this.layout.toggle('right') },
      { id: 'view.bottom', title: 'Toggle bottom dock', category: 'View', shortcut: 'Mod+3', checked: () => this.layout.isOpen('bottom'), run: () => this.layout.toggle('bottom') },
      { id: 'view.resetLayout', title: 'Reset layout', category: 'View', run: () => this.layout.reset() },
      { id: 'view.bookmark', title: 'Add camera bookmark…', category: 'View', icon: 'bookmark', run: () => this.addBookmark() },
      { id: 'view.assets', title: 'Show Assets tab', category: 'View', run: () => this.showTab('assets') },
      { id: 'view.scripts', title: 'Show Scripts tab', category: 'View', run: () => this.showTab('scripts') },
      { id: 'view.console', title: 'Show Console tab', category: 'View', run: () => this.showTab('console') },
      { id: 'view.history', title: 'Show History tab', category: 'View', run: () => this.showTab('history') },
      { id: 'play.toggle', title: 'Play / Pause', category: 'Play', shortcut: 'Space', icon: 'play', run: () => this.togglePlay() },
      { id: 'play.play', title: 'Play', category: 'Play', shortcut: 'Mod+P', icon: 'play', enabled: () => state.play !== 'playing', run: () => this.play() },
      { id: 'play.pause', title: 'Pause', category: 'Play', icon: 'pause', enabled: () => state.play === 'playing', run: () => viewport.play.pause() },
      { id: 'play.stop', title: 'Stop', category: 'Play', shortcut: 'Mod+Shift+P', icon: 'stop', enabled: () => state.isPlaying, run: () => viewport.play.stop() },
      { id: 'play.step', title: 'Step one frame', category: 'Play', shortcut: 'Mod+.', icon: 'step', enabled: () => state.isPlaying, run: () => viewport.play.step() },
      { id: 'play.newTab', title: 'Play in new tab', category: 'Play', icon: 'external', run: () => this.playInTab(false) },
      { id: 'play.multiplayer', title: 'Play multiplayer (new room)', category: 'Play', icon: 'globe', run: () => this.playInTab(true) },
      { id: 'scene.new', title: 'New scene…', category: 'Scene', run: () => this.settings.addScene() },
      { id: 'scene.rename', title: 'Rename current scene…', category: 'Scene', run: () => this.settings.renameScene(project.currentSceneName) },
      { id: 'scene.delete', title: 'Delete current scene', category: 'Scene', enabled: () => project.project.scenes.length > 1, run: () => this.settings.deleteScene(project.currentSceneName) },
      { id: 'scene.setStart', title: 'Set current scene as start scene', category: 'Scene', run: () => commands.push(new ProjectCommand('Start scene', project, { kind: 'start-scene', name: project.currentSceneName }, { kind: 'start-scene', name: project.project.startScene })) },
      { id: 'script.new', title: 'New script', category: 'Scripts', run: () => { this.showTab('scripts'); this.scripts.create('blank'); } },
      { id: 'asset.upload', title: 'Upload assets…', category: 'Assets', run: () => { this.showTab('assets'); this.assets.root.querySelector<HTMLInputElement>('input[type=file]')?.click(); } },
      { id: 'collab.start', title: 'Start collaboration session', category: 'Collaborate', icon: 'users', enabled: () => !this.collab, run: () => this.startCollab(shortId(6)) },
      { id: 'collab.invite', title: 'Copy invite link', category: 'Collaborate', icon: 'link', enabled: () => !!this.collab, run: () => this.copyInvite() },
      { id: 'collab.leave', title: 'Leave session', category: 'Collaborate', enabled: () => !!this.collab, run: () => this.leaveCollab() },
      { id: 'collab.name', title: 'Change display name…', category: 'Collaborate', run: () => this.changeName() },
      { id: 'help.palette', title: 'Command palette', category: 'Help', shortcut: 'Mod+K', icon: 'palette', global: true, run: () => openCommandPalette(this.actions) },
      { id: 'help.shortcuts', title: 'Keyboard shortcuts', category: 'Help', shortcut: '?', icon: 'keyboard', run: () => openShortcutsDialog(this.actions) },
      { id: 'help.tour', title: 'Start guided tour', category: 'Help', run: () => this.tour() },
      { id: 'help.editor', title: 'Editor guide', category: 'Help', run: () => openDocsDialog('Editor guide', editorGuide) },
      { id: 'help.api', title: 'API reference', category: 'Help', run: () => openDocsDialog('Public API', apiDoc) },
      { id: 'help.architecture', title: 'Engine architecture', category: 'Help', run: () => openDocsDialog('Architecture', archDoc) },
      { id: 'help.contributing', title: 'Contributing guide', category: 'Help', run: () => openDocsDialog('Contributing', contribDoc) },
      { id: 'help.github', title: 'Open GitHub repository', category: 'Help', run: () => { window.open(REPO, '_blank', 'noopener'); } },
    );
    for (const p of PRESETS) this.actions.register({ id: `create.${p.id}`, title: `Create ${p.label}`, category: 'Create', icon: p.icon, enabled: () => (p.renderer === 'both' || p.renderer === this.project.project.settings.renderer) && !this.state.isPlaying, run: () => this.create(p.id) });
  }

  // ------------------------------------------------------------ operations

  private create(preset: (typeof PRESETS)[number]['id'], position?: Vec3, parent: Entity | null = null): void {
    const pos = position ?? (this.is3d ? new Vec3(this.viewport.camera.orbit?.target.x ?? 0, 0.5, this.viewport.camera.orbit?.target.z ?? 0) : new Vec3(this.viewport.camera.x, this.viewport.camera.y, 0));
    if (this.state.snap.enabled) { const g = this.state.snap.grid; pos.set(Math.round(pos.x / g) * g, Math.round(pos.y / g) * g, Math.round(pos.z / g) * g); }
    const parentGuid = parent !== null ? this.scene.guidOf(parent) ?? null : null;
    const snap = makePreset(preset, { position: pos, parent: parentGuid });
    const cmd = new CreateEntityCommand(this.scene, snap);
    this.commands.push(cmd);
    if (cmd.entity !== undefined) { this.state.select(cmd.entity); this.state.reveal(cmd.entity); }
  }

  private selectedRoots(): Entity[] {
    const sel = this.state.selection.filter((e) => this.scene.isEditable(e));
    return sel.filter((e) => !sel.some((o) => o !== e && this.engine.world.isDescendantOf(e, o)));
  }

  private duplicate(): void {
    const roots = this.selectedRoots().filter((e) => !this.scene.isLocked(e));
    if (!roots.length) return;
    const created: Entity[] = [];
    this.commands.transaction(`Duplicate ${roots.length === 1 ? this.engine.world.nameOf(roots[0]) : roots.length + ' entities'}`, () => {
      for (const e of roots) {
        const snap = SceneEditor.regenerate(this.scene.snapshot(e));
        snap.index = this.scene.indexOf(e) + 1;
        const t = snap.components.find((c) => c.type === Transform.type);
        if (t) { const p = (t.data.position ?? { x: 0, y: 0, z: 0 }) as { x: number; y: number; z: number }; const g = this.state.snap.enabled ? this.state.snap.grid : 0.5; t.data.position = this.is3d ? { x: p.x + g, y: p.y, z: p.z + g } : { x: p.x + g, y: p.y - g, z: p.z }; }
        const cmd = new CreateEntityCommand(this.scene, snap, 'Duplicate');
        this.commands.push(cmd);
        if (cmd.entity !== undefined) created.push(cmd.entity);
      }
    });
    if (created.length) this.state.select(created);
  }

  private deleteSelected(): void {
    const roots = this.selectedRoots().filter((e) => !this.scene.isLocked(e));
    if (!roots.length) return;
    this.commands.push(new DeleteEntitiesCommand(this.scene, roots.map((e) => this.scene.guidOf(e)!).filter(Boolean)));
  }

  private copy(): void {
    const roots = this.selectedRoots();
    this.clipboard = roots.map((e) => this.scene.snapshot(e));
    void navigator.clipboard?.writeText(JSON.stringify({ forgeEntities: this.clipboard }, null, 2)).catch(() => undefined);
    toast(`Copied ${roots.length} entit${roots.length === 1 ? 'y' : 'ies'}`, 'success');
  }

  private paste(): void {
    if (!this.clipboard.length) return;
    const created: Entity[] = [];
    this.commands.transaction('Paste', () => {
      for (const s of this.clipboard) {
        const snap = SceneEditor.regenerate(s);
        snap.parent = snap.parent && this.scene.entityOf(snap.parent) !== undefined ? snap.parent : null;
        snap.index = -1;
        const cmd = new CreateEntityCommand(this.scene, snap, 'Paste');
        this.commands.push(cmd);
        if (cmd.entity !== undefined) created.push(cmd.entity);
      }
    });
    if (created.length) this.state.select(created);
  }

  private parentSelection(): void {
    const sel = this.state.selection;
    const parent = sel[0];
    const pg = this.scene.guidOf(parent);
    if (!pg) return;
    this.commands.transaction('Parent entities', () => {
      for (const e of sel.slice(1)) { const g = this.scene.guidOf(e); if (g && !this.engine.world.isDescendantOf(parent, e)) this.commands.push({ label: 'Reparent', execute: () => this.scene.reparent(g, pg, -1), undo: () => this.scene.reparent(g, null, -1) }); }
    });
  }

  private unparentSelection(): void {
    const roots = this.selectedRoots().filter((e) => this.engine.world.getParent(e) !== NULL_ENTITY);
    if (!roots.length) return;
    this.commands.transaction('Move to root', () => {
      for (const e of roots) {
        const g = this.scene.guidOf(e)!;
        const oldParent = this.scene.guidOf(this.engine.world.getParent(e)) ?? null;
        const oldIndex = this.scene.indexOf(e);
        this.commands.push({ label: 'Move to root', execute: () => this.scene.reparent(g, null, -1), undo: () => this.scene.reparent(g, oldParent, oldIndex) });
      }
    });
  }

  private async save(): Promise<void> {
    if (this.scripts.hasUnsaved()) this.scripts.save();
    if (this.project.origin === 'template') { await this.saveAs(); return; }
    if (this.project.origin === 'remote') { await this.saveAs(); return; }
    this.project.project.thumbnail = this.viewport.thumbnail();
    await this.project.save();
    toast('Project saved', 'success', { duration: 1500 });
    this.updateStatus();
  }

  private async saveAs(): Promise<void> {
    const name = await promptDialog('Save as my project', 'Project name', this.project.project.name, { validate: (v) => (v ? null : 'Required') });
    if (!name) return;
    this.project.project.thumbnail = this.viewport.thumbnail();
    await this.project.saveAsCopy(name);
    history.replaceState(null, '', `?project=${encodeURIComponent(this.project.project.id)}${this.collab ? `&room=${this.collab.channel.roomId}` : ''}`);
    toast(`Saved "${name}" to this browser`, 'success');
    this.updateStatus();
  }

  private importProject(): void {
    const input = el('input', { attrs: { type: 'file', accept: 'application/json,.json' } });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const p = this.project.store.import(await f.text(), { newId: `p_${shortId(8)}` });
        await this.project.store.save(p);
        location.href = `./editor.html?project=${encodeURIComponent(p.id)}`;
      } catch (err) { toast(`Import failed: ${(err as Error).message}`, 'error'); }
    });
    input.click();
  }

  private async navigateNew(renderer: '2d' | '3d'): Promise<void> {
    if (this.project.dirty && this.project.origin !== 'template') await this.project.save(true);
    location.href = `./editor.html?new=${renderer}`;
  }

  private async openProjectDialog(): Promise<void> {
    const list = await this.project.listLocal();
    const body = el('div', { class: 'welcome-list' });
    if (!list.length) body.appendChild(el('p', { class: 'dim', text: 'No saved projects yet.' }));
    let dlg: { close(): void } | null = null;
    for (const p of list) {
      const row = el('button', { class: 'welcome-row', attrs: { type: 'button' } }, p.thumbnail ? el('img', { class: 'welcome-thumb', attrs: { src: p.thumbnail, alt: '' } }) : el('span', { class: 'welcome-thumb' }, icon(p.renderer === '3d' ? 'cube' : 'shapes', 16)), el('span', { class: 'welcome-row-text' }, el('strong', { text: p.name }), el('span', { class: 'dim small', text: `${p.renderer.toUpperCase()} · ${new Date(p.updatedAt).toLocaleString()}` })));
      row.addEventListener('click', async () => { dlg?.close(); if (this.project.dirty && this.project.origin !== 'template') await this.project.save(true); location.href = `./editor.html?project=${encodeURIComponent(p.id)}`; });
      body.appendChild(row);
    }
    dlg = openDialog({ title: 'Open project', size: 'md', body, buttons: [{ label: 'Cancel', onClick: (close) => close() }] });
  }

  private togglePlay(): void {
    if (this.state.play === 'edit') void this.play();
    else if (this.state.play === 'playing') this.viewport.play.pause();
    else this.viewport.play.resume();
  }

  private async play(): Promise<void> {
    if (this.state.play === 'paused') { this.viewport.play.resume(); return; }
    if (this.scripts.hasUnsaved()) this.scripts.save();
    this.showTabIfErrors();
    this.log('log', `Play "${this.project.currentSceneName}"`);
    await this.viewport.play.start(this.project.snapshot(), this.project.currentSceneName);
  }

  private showTabIfErrors(): void {
    if (this.project.project.scripts.some((s) => !this.engine.scripting.definitions.has(s.name))) toast('Some scripts have compile errors; see the Console.', 'warn');
  }

  private async playInTab(multiplayer: boolean): Promise<void> {
    if (this.project.origin === 'template' || this.project.origin === 'remote') { toast('Save the project first (File › Save as my project) so the player can load it.', 'warn'); await this.saveAs(); if ((this.project.origin as string) !== 'local') return; }
    else await this.project.save(true);
    const p = new URLSearchParams({ project: this.project.project.id });
    if (multiplayer) {
      if (this.project.project.settings.network.mode === 'none') toast('Network mode is "none" in Project settings; the room will run single-player.', 'warn', { duration: 5000 });
      p.set('room', shortId(6));
    }
    window.open(`./play.html?${p.toString()}`, '_blank', 'noopener');
  }

  private snapSettings(): void {
    const s = this.state.snap;
    const grid = el('input', { class: 'num-input', attrs: { type: 'number', step: '0.05', min: '0.01', value: String(s.grid) } });
    const angle = el('input', { class: 'num-input', attrs: { type: 'number', step: '1', min: '1', value: String(s.angle) } });
    const scale = el('input', { class: 'num-input', attrs: { type: 'number', step: '0.05', min: '0.01', value: String(s.scale) } });
    const enabled = el('input', { attrs: { type: 'checkbox' } });
    enabled.checked = s.enabled;
    openDialog({
      title: 'Snap settings', size: 'sm',
      body: el('div', { class: 'field-stack' },
        el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Snapping on' }), enabled),
        el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Grid step' }), grid),
        el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Angle (°)' }), angle),
        el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Scale step' }), scale),
        el('p', { class: 'dim small', text: 'Hold Ctrl while dragging to temporarily invert snapping.' })),
      buttons: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Apply', primary: true, onClick: (c) => { this.state.setSnap({ enabled: enabled.checked, grid: Number(grid.value) || 0.5, angle: Number(angle.value) || 15, scale: Number(scale.value) || 0.1 }); c(); } }],
    });
  }

  private async addBookmark(): Promise<void> {
    const name = await promptDialog('Camera bookmark', 'Name', `View ${(this.scene.editorSettings.bookmarks?.length ?? 0) + 1}`);
    if (!name) return;
    const list = (this.scene.editorSettings.bookmarks ??= []);
    list.push({ name, camera: this.viewport.camera.getPose() as unknown as Record<string, unknown> });
    this.project.markDirty();
    toast(`Bookmark "${name}" added`, 'success');
  }

  private async changeName(): Promise<void> {
    const name = await promptDialog('Display name', 'Shown to collaborators', this.displayName, { validate: (v) => (v ? null : 'Required') });
    if (!name) return;
    this.displayName = name;
    storage.set('forge.editor.displayName', name);
    if (this.collab) { this.collab.me.name = name; this.collab.sendPresence(true); }
  }

  // ---------------------------------------------------------------- collab

  async startCollab(room: string, channel?: CollabChannel): Promise<void> {
    if (this.collab) return;
    const toastEl = toast(channel ? 'Joining session…' : 'Starting session…', 'info', { duration: 4000 });
    try {
      const ch = channel ?? await openChannel(this.engine, room, this.displayName);
      const session = new CollabSession({ scene: this.scene, project: this.project, commands: this.commands, state: this.state }, ch, this.displayName);
      this.collab = session;
      session.events.on('presence', () => this.updatePresence());
      session.events.on('status', (s) => { this.updateStatus(); if (s === 'connected') toastEl.remove(); });
      session.events.on('scriptConflict', ({ name, remoteSource }) => { if (this.tabs.current === 'scripts') this.scripts.showConflict(remoteSource); else toast(`Script "${name}" was changed by a collaborator`, 'warn'); });
      session.events.on('stateLoaded', () => { this.buildToolbar(); this.updateStatus(); toast('Synced with host', 'success'); });
      session.start({ requestState: !!channel || (!ch.isHost && ch.peers().length > 0) });
      const url = new URL(location.href);
      url.searchParams.set('room', ch.roomId);
      history.replaceState(null, '', url.toString());
      this.buildToolbar();
      this.updateStatus();
      if (!channel) toast(`Session started. Invite link copied to clipboard.`, 'success');
      if (!channel) void this.copyInvite(true);
    } catch (err) {
      toast(`Could not start collaboration: ${(err as Error).message}`, 'error');
    }
  }

  private async copyInvite(silent = false): Promise<void> {
    if (!this.collab) return;
    const url = this.collab.inviteUrl();
    try { await navigator.clipboard.writeText(url); if (!silent) toast('Invite link copied', 'success'); }
    catch { openDialog({ title: 'Invite link', size: 'sm', body: el('input', { class: 'text-input', attrs: { type: 'text', value: url, readonly: 'true' } }), buttons: [{ label: 'Close', primary: true, onClick: (c) => c() }] }); }
  }

  private leaveCollab(): void {
    this.collab?.stop();
    this.collab = null;
    this.viewport.remote = [];
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url.toString());
    this.updatePresence();
    this.buildToolbar();
    this.updateStatus();
    toast('Left the session', 'info');
  }

  private updatePresence(): void {
    this.presenceHost.textContent = '';
    if (!this.collab) { this.viewport.remote = []; this.hierarchy.render(); return; }
    const remote = this.collab.remoteSelections();
    this.viewport.remote = remote.map((r) => ({ id: r.id, name: r.name, color: r.color, cursor: r.cursor, selection: r.entities }));
    const me = el('span', { class: 'chip user me', style: { borderColor: this.collab.me.color }, attrs: { 'data-tip': `You (${this.collab.me.name})` } }, el('span', { class: 'user-dot', style: { background: this.collab.me.color } }), el('span', { text: this.collab.me.name }));
    this.presenceHost.appendChild(me);
    for (const p of this.collab.presence.values()) {
      const following = this.collab.following === p.id;
      const chip = el('button', { class: `chip user ${following ? 'following' : ''}`, style: { borderColor: p.color }, attrs: { type: 'button', 'data-tip': `${p.name}${p.scene ? ` · ${p.scene}` : ''}${p.editingScript ? ` · editing ${p.editingScript}` : ''} — click to follow` } }, el('span', { class: 'user-dot', style: { background: p.color } }), el('span', { text: p.name }));
      chip.addEventListener('click', () => this.toggleFollow(p.id));
      this.presenceHost.appendChild(chip);
    }
    if (this.collab.following) { const pose = this.collab.follow(this.collab.following); if (pose) this.viewport.camera.setPose(pose); }
    this.hierarchy.render();
  }

  private toggleFollow(id: string): void {
    if (!this.collab) return;
    const next = this.collab.following === id ? null : id;
    const pose = this.collab.follow(next);
    if (pose) this.viewport.camera.setPose(pose);
    toast(next ? `Following ${this.collab.presence.get(id)?.name ?? id}` : 'Stopped following', 'info', { duration: 1500 });
    this.updatePresence();
  }

  // ------------------------------------------------------------------ menus

  private item(id: string, overrides: Partial<MenuItem> = {}): MenuItem {
    const a = this.actions.get(id)!;
    return { label: a.title, icon: a.icon, shortcut: a.shortcut?.split(',')[0], disabled: !(a.enabled?.() ?? true), checked: a.checked?.(), onClick: () => this.actions.run(id), ...overrides };
  }

  private buildMenus(): void {
    const sep: MenuItem = { separator: true };
    this.menubar.add('File', () => [
      this.item('file.new2d'), this.item('file.new3d'), this.item('file.open'), { label: 'Open demo template', icon: 'forge', submenu: this.demoItems() }, sep,
      this.item('file.save'), this.item('file.saveAs'), this.item('file.export'), this.item('file.import'), sep,
      this.item('file.settings'), sep, this.item('file.launcher'),
    ]);
    this.menubar.add('Edit', () => [this.item('edit.undo', { label: `Undo${this.commands.undoLabel ? ` ${this.commands.undoLabel}` : ''}` }), this.item('edit.redo', { label: `Redo${this.commands.redoLabel ? ` ${this.commands.redoLabel}` : ''}` }), sep, this.item('entity.copy'), this.item('entity.paste'), this.item('entity.duplicate'), this.item('entity.delete'), sep, this.item('entity.selectAll'), this.item('entity.deselect'), sep, this.item('view.snap'), this.item('view.snapSettings')]);
    this.menubar.add('Entity', () => [
      { label: 'Create', icon: 'plus', submenu: PRESETS.filter((p) => p.renderer === 'both' || p.renderer === this.project.project.settings.renderer).map((p) => this.item(`create.${p.id}`, { label: p.label })) },
      { label: 'Instantiate prefab', icon: 'box', disabled: !this.project.project.prefabs.length, submenu: this.project.project.prefabs.map((p) => ({ label: p.name, onClick: () => { const cmd = new CreateEntityCommand(this.scene, prefabToSnapshot(p, null, { x: this.viewport.camera.x, y: this.viewport.camera.y }), `Instantiate ${p.name}`); this.commands.push(cmd); if (cmd.entity !== undefined) this.state.select(cmd.entity); } })) },
      sep, this.item('entity.rename'), this.item('entity.duplicate'), this.item('entity.delete'), sep, this.item('entity.parent'), this.item('entity.unparent'), sep, this.item('view.frame'),
    ]);
    this.menubar.add('Scene', () => [
      ...this.project.project.scenes.map((s): MenuItem => ({ label: `${s.name}${s.name === this.project.project.startScene ? '  (start)' : ''}`, checked: s.name === this.project.currentSceneName, onClick: () => this.project.switchScene(s.name) })),
      sep, this.item('scene.new'), this.item('scene.rename'), this.item('scene.setStart'), this.item('scene.delete'),
    ]);
    this.menubar.add('View', () => [
      this.item('tool.select'), this.item('tool.move'), this.item('tool.rotate'), this.item('tool.scale'), sep,
      this.item('view.grid'), this.item('view.colliders'), this.item('view.bounds'), this.item('view.gizmos'), this.item('view.snap'), sep,
      this.item('view.frame'), this.item('view.resetCamera'), this.item('view.bookmark'),
      { label: 'Camera bookmarks', icon: 'bookmark', disabled: !this.scene.editorSettings.bookmarks?.length, submenu: (this.scene.editorSettings.bookmarks ?? []).map((b, i): MenuItem => ({ label: b.name, onClick: () => this.viewport.camera.setPose(b.camera as never), submenu: undefined })).concat(this.scene.editorSettings.bookmarks?.length ? [sep, { label: 'Clear bookmarks', danger: true, onClick: () => { this.scene.editorSettings.bookmarks = []; this.project.markDirty(); } }] : []) },
      sep, this.item('view.left'), this.item('view.right'), this.item('view.bottom'), this.item('view.resetLayout'),
    ]);
    this.menubar.add('Play', () => [this.item('play.play'), this.item('play.pause'), this.item('play.stop'), this.item('play.step'), sep, this.item('play.newTab'), this.item('play.multiplayer')]);
    this.menubar.add('Collaborate', () => [
      this.item('collab.start'), this.item('collab.invite'), this.item('collab.leave'), this.item('collab.name'), sep,
      ...(this.collab ? [...this.collab.presence.values()].map((p): MenuItem => ({ label: `${this.collab!.following === p.id ? 'Unfollow' : 'Follow'} ${p.name}`, icon: 'users', onClick: () => this.toggleFollow(p.id) })) : [{ label: 'Start a session to invite others', disabled: true }]),
    ]);
    this.menubar.add('Help', () => [this.item('help.tour'), this.item('help.shortcuts'), this.item('help.palette'), sep, this.item('help.editor'), this.item('help.api'), this.item('help.architecture'), this.item('help.contributing'), sep, this.item('help.github'), { label: `Forge Engine v${VERSION}`, disabled: true }]);
  }

  private demoItems(): MenuItem[] {
    const items: MenuItem[] = [{ label: 'Loading…', disabled: true }];
    void fetch('./demos/index.json', { cache: 'no-cache' }).then((r) => r.json()).then((data: { demos?: { id: string; title: string }[] } | { id: string; title: string }[]) => {
      const demos = Array.isArray(data) ? data : data.demos ?? [];
      items.length = 0;
      if (!demos.length) items.push({ label: 'No demos available', disabled: true });
      for (const d of demos) items.push({ label: d.title, onClick: () => { location.href = `./editor.html?template=${encodeURIComponent(d.id)}`; } });
    }).catch(() => { items.length = 0; items.push({ label: 'No demos available', disabled: true }); });
    return items;
  }

  private viewportMenu(world: Vec3, entity: Entity | null): MenuItem[] {
    const renderer = this.project.project.settings.renderer;
    const pos = this.is3d ? new Vec3(world.x, 0.5, world.z) : new Vec3(world.x, world.y, 0);
    const items: MenuItem[] = [
      { label: 'Create here', icon: 'plus', submenu: PRESETS.filter((p) => p.renderer === 'both' || p.renderer === renderer).map((p) => ({ label: p.label, icon: p.icon, onClick: () => this.create(p.id, pos.clone()) })) },
      this.item('entity.paste'),
    ];
    if (entity !== null) items.push({ separator: true }, this.item('entity.rename'), this.item('entity.duplicate'), this.item('entity.delete'), { label: 'Create child here', icon: 'plus', submenu: PRESETS.filter((p) => p.renderer === 'both' || p.renderer === renderer).map((p) => ({ label: p.label, icon: p.icon, onClick: () => this.create(p.id, pos.clone(), entity) })) });
    items.push({ separator: true }, this.item('view.frame'), this.item('view.resetCamera'), this.item('view.bookmark'));
    return items;
  }

  // ---------------------------------------------------------------- toolbar

  private tbButton(id: string, opts: { label?: string; className?: string } = {}): HTMLButtonElement {
    const a = this.actions.get(id)!;
    const checked = a.checked?.();
    const b = el('button', { class: `tb-btn ${checked ? 'active' : ''} ${opts.className ?? ''}`, attrs: { type: 'button', 'aria-label': a.title, 'aria-pressed': checked === undefined ? undefined : String(checked), 'data-tip': a.title, 'data-tip-key': a.shortcut ? formatShortcut(a.shortcut.split(',')[0]) : undefined, 'data-action': id } });
    if (a.icon) b.appendChild(icon(a.icon));
    if (opts.label) b.appendChild(el('span', { text: opts.label }));
    b.disabled = !(a.enabled?.() ?? true);
    b.addEventListener('click', () => this.actions.run(id));
    return b;
  }

  private buildToolbar(): void {
    const tb = this.toolbar;
    tb.textContent = '';
    const group = (cls: string, ...children: (HTMLElement | null)[]): HTMLElement => el('div', { class: `tb-group ${cls}` }, ...children);
    tb.appendChild(group('tools', this.tbButton('tool.select'), this.tbButton('tool.move'), this.tbButton('tool.rotate'), this.tbButton('tool.scale')));
    tb.firstElementChild!.setAttribute('data-tour', 'tools');
    const gridStep = el('input', { class: 'num-input tb-num', attrs: { type: 'number', step: '0.05', min: '0.01', value: String(this.state.snap.grid), 'aria-label': 'Grid snap step', 'data-tip': 'Snap step (world units)' } });
    gridStep.addEventListener('change', () => this.state.setSnap({ grid: Number(gridStep.value) || 0.5 }));
    tb.appendChild(group('snap', this.tbButton('view.snap'), gridStep, this.tbButton('view.grid'), this.tbButton('view.colliders')));
    tb.appendChild(group('history', this.tbButton('edit.undo'), this.tbButton('edit.redo')));
    const playGroup = group('play', this.state.play === 'playing' ? this.tbButton('play.pause', { className: 'play-main' }) : this.tbButton('play.play', { className: 'play-main' }), this.tbButton('play.stop'), this.tbButton('play.step'), this.tbButton('play.newTab'), this.tbButton('play.multiplayer'));
    playGroup.setAttribute('data-tour', 'play');
    playGroup.classList.toggle('is-playing', this.state.isPlaying);
    tb.appendChild(playGroup);
    // Scene selector.
    const sceneSel = el('select', { class: 'select-input tb-scene', attrs: { 'aria-label': 'Current scene', 'data-tip': 'Current scene' } });
    for (const s of this.project.project.scenes) sceneSel.appendChild(el('option', { text: `${s.name}${s.name === this.project.project.startScene ? ' ★' : ''}`, attrs: { value: s.name } }));
    sceneSel.appendChild(el('option', { text: '+ New scene…', attrs: { value: '__new' } }));
    sceneSel.value = this.project.currentSceneName;
    sceneSel.addEventListener('change', () => { if (sceneSel.value === '__new') { sceneSel.value = this.project.currentSceneName; void this.settings.addScene(); } else this.project.switchScene(sceneSel.value); });
    tb.appendChild(group('scene', el('span', { class: 'tb-label dim', text: 'Scene' }), sceneSel));
    tb.appendChild(el('span', { class: 'spacer' }));
    tb.appendChild(this.presenceHost);
    const collabBtn = this.collab ? this.tbButton('collab.invite', { label: 'Invite' }) : this.tbButton('collab.start', { label: 'Collaborate' });
    collabBtn.setAttribute('data-tour', 'collab');
    tb.appendChild(group('collab', collabBtn, this.collab ? this.tbButton('collab.leave', { label: 'Leave' }) : null));
    tb.appendChild(group('misc', this.tbButton('file.save'), this.tbButton('help.palette'), this.tbButton('help.shortcuts')));
    this.updatePresence();
  }

  private viewportTools(): HTMLElement {
    const box = el('div', { class: 'viewport-tools' });
    const frame = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Frame selected', 'data-tip': 'Frame selected (F)' } }, icon('frame'));
    frame.addEventListener('click', () => this.viewport.frameSelected());
    const home = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Reset camera', 'data-tip': 'Reset camera (Home)' } }, icon('refresh'));
    home.addEventListener('click', () => this.viewport.camera.reset());
    const bm = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Camera bookmarks', 'data-tip': 'Camera bookmarks' } }, icon('bookmark'));
    bm.addEventListener('click', () => showMenu([
      ...(this.scene.editorSettings.bookmarks ?? []).map((b, i): MenuItem => ({ label: b.name, icon: 'camera', onClick: () => this.viewport.camera.setPose(b.camera as never), submenu: [{ label: 'Go to', onClick: () => this.viewport.camera.setPose(b.camera as never) }, { label: 'Delete', danger: true, onClick: () => { this.scene.editorSettings.bookmarks!.splice(i, 1); this.project.markDirty(); } }] })),
      ...(this.scene.editorSettings.bookmarks?.length ? [{ separator: true } as MenuItem] : []),
      { label: 'Add bookmark…', icon: 'plus', onClick: () => this.addBookmark() },
    ], bm, { align: 'right' }));
    const label = el('span', { class: 'viewport-mode', text: this.is3d ? '3D' : '2D' });
    box.append(label, frame, home, bm);
    return box;
  }

  // ----------------------------------------------------------------- status

  private updateStatus(): void {
    const { project, state } = this;
    this.statusLeft.textContent = '';
    this.statusRight.textContent = '';
    const originLabel = project.origin === 'template' ? 'template (unsaved)' : project.origin === 'remote' ? 'remote session' : project.origin === 'local' ? (state.dirty ? 'unsaved changes' : 'saved') : 'not saved yet';
    this.statusLeft.append(
      el('span', { class: 'status-item project-name' }, icon('forge', 13), el('span', { text: project.project.name })),
      el('span', { class: `status-item dirty ${state.dirty ? 'is-dirty' : ''}`, attrs: { 'data-tip': 'Autosaves to this browser every few seconds' } }, el('span', { class: 'dirty-dot' }), el('span', { text: originLabel })),
      el('span', { class: 'status-item dim', text: `${project.currentSceneName} · ${this.scene.all().length} entities` }),
    );
    if (state.selection.length) this.statusLeft.appendChild(el('span', { class: 'status-item dim', text: state.selection.length === 1 ? `Selected: ${this.engine.world.nameOf(state.selection[0])}` : `${state.selection.length} selected` }));
    if (state.isPlaying) this.statusRight.append(el('span', { class: 'status-item playing' }, icon('play', 12), el('span', { text: state.play === 'paused' ? 'Paused' : 'Playing' })), this.playStats);
    if (this.collab) this.statusRight.append(el('span', { class: `status-item collab ${this.collab.status}` }, icon('users', 12), el('span', { text: `${this.collab.status} · room ${this.collab.channel.roomId} · ${this.collab.presence.size + 1} online${this.collab.isHost ? ' · host' : ''}` })));
    this.statusRight.append(el('span', { class: 'status-item dim', text: this.is3d ? 'Right-drag orbit · middle-drag pan · wheel zoom' : 'Middle/Alt-drag pan · wheel zoom' }));
  }

  private tour(): void {
    this.shortcuts.enabled = false;
    startTour([
      { target: null, title: 'Welcome to Forge Editor', text: 'This short tour shows where things live. Use the arrow keys or the buttons to move on; Escape skips.' },
      { target: '[data-tour="hierarchy"]', title: 'Hierarchy', text: 'Every entity in the scene. Click to select, drag to reparent, double-click to rename, and use the + button or right-click to create entities.' },
      { target: '.viewport', title: 'Viewport', text: 'Click to select, drag to move. W / E / R switch to move, rotate and scale gizmos; F frames the selection. Middle-drag (or Alt-drag) pans, the wheel zooms. Drag an image from Assets here to create a sprite.' },
      { target: '.panel-right', title: 'Inspector', text: 'Edit the selected entity: every component field is editable, drag the small handles to scrub numbers, and Add component opens a searchable list.' },
      { target: '[data-tour="tools"]', title: 'Tools and snapping', text: 'Select, move, rotate and scale tools, snapping (S) with a configurable step, and grid / collider overlays.' },
      { target: '[data-tour="play"]', title: 'Play mode', text: 'Play runs the scene with scripts, physics and input right here. Stop restores the edit-time scene exactly. Space toggles play/pause.' },
      { target: '[data-tour="dock"]', title: 'Assets, Scripts, Console, Project', text: 'Upload assets, write scripts with autocompletion (Ctrl+S compiles), read logs and errors, and tune project settings, scenes and input bindings.' },
      { target: '[data-tour="collab"]', title: 'Collaborate', text: 'Start a session and share the invite link: edits, selections and cursors sync live between everyone in the room.' },
      { target: null, title: 'You are set', text: 'Press ? any time for shortcuts, Ctrl+K for the command palette, and Help › Editor guide for the full documentation.' },
    ], () => { this.shortcuts.enabled = true; });
  }
}
