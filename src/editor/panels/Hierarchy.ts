import { NULL_ENTITY, type Entity } from '../../core/ecs/Entity';
import { createPrefab, type PrefabData } from '../../core/ecs/Scene';
import type { EditorContext } from '../app/EditorContext';
import { AddComponentCommand, CreateEntityCommand, DeleteEntitiesCommand, RenameCommand, ReparentCommand, SetMetaCommand } from '../commands/SceneCommands';
import { makePreset, PRESETS } from '../project/EntityFactory';
import { SceneEditor, type EntitySnapshot } from '../project/SceneEditor';
import { el, icon } from '../ui/dom';
import { contextMenu, showMenu, type MenuItem } from '../ui/Menu';
import { toast } from '../ui/Toast';

type DropPos = 'before' | 'after' | 'inside';

/**
 * Left panel: entity tree with multi-select, inline rename, drag-drop
 * reparenting, visibility/lock toggles, search filter and a context menu.
 */
export class Hierarchy {
  readonly root = el('div', { class: 'hierarchy', attrs: { 'data-tour': 'hierarchy' } });
  private tree = el('div', { class: 'tree', attrs: { role: 'tree', 'aria-label': 'Scene entities', 'aria-multiselectable': 'true' } });
  private search = el('input', { class: 'text-input search-input', attrs: { type: 'search', placeholder: 'Search entities…', 'aria-label': 'Search entities' } });
  private expanded = new Set<string>();
  private rows = new Map<Entity, HTMLElement>();
  private raf = 0;
  private renaming: Entity | null = null;
  private anchor: Entity | null = null;

  constructor(private readonly ctx: EditorContext) {
    const addBtn = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Create entity', 'data-tip': 'Create entity' } }, icon('plus'));
    addBtn.addEventListener('click', () => showMenu(this.createMenu(null), addBtn));
    const collapseBtn = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Collapse all', 'data-tip': 'Collapse all' } }, icon('layers'));
    collapseBtn.addEventListener('click', () => { this.expanded.clear(); this.schedule(); });
    const toolbar = el('div', { class: 'panel-toolbar' }, this.search, addBtn, collapseBtn);
    this.root.append(toolbar, this.tree);
    this.search.addEventListener('input', () => this.schedule());
    ctx.scene.events.on('structure', () => this.schedule());
    ctx.scene.events.on('loaded', () => { this.expanded.clear(); this.schedule(); });
    ctx.state.events.on('selection', () => this.updateSelection());
    ctx.state.events.on('reveal', (e) => this.reveal(e));
    ctx.state.events.on('pickEntity', (fn) => this.tree.classList.toggle('picking', !!fn));
    this.tree.addEventListener('keydown', (e) => this.onKey(e));
    contextMenu(this.tree, (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>('.tree-row');
      const e = row ? Number(row.dataset.entity) : null;
      if (e !== null && !ctx.state.isSelected(e)) ctx.state.select(e);
      return this.contextItems(e);
    });
    // Drop on empty area = move to root.
    this.tree.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('application/x-forge-entities') && ev.target === this.tree) { ev.preventDefault(); this.tree.classList.add('drop-root'); } });
    this.tree.addEventListener('dragleave', () => this.tree.classList.remove('drop-root'));
    this.tree.addEventListener('drop', (ev) => { this.tree.classList.remove('drop-root'); if (ev.target === this.tree) { ev.preventDefault(); this.dropEntities(ev, null, 'inside'); } });
    this.tree.addEventListener('click', (ev) => { if (ev.target === this.tree) ctx.state.select(null); });
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  // ---------------------------------------------------------------- render

  render(): void {
    const { scene } = this.ctx;
    this.rows.clear();
    this.tree.textContent = '';
    const q = this.search.value.trim().toLowerCase();
    const roots = scene.roots();
    if (!roots.length) {
      this.tree.appendChild(el('div', { class: 'panel-empty' }, icon('layers', 22), el('p', { text: 'No entities yet.' }), el('p', { class: 'dim', text: 'Use + or right-click the viewport to create one.' })));
      return;
    }
    const matches = q ? this.matchSet(q) : null;
    for (const r of roots) this.renderNode(r, 1, matches);
    this.updateSelection();
  }

  private matchSet(q: string): Set<Entity> {
    const { scene, engine } = this.ctx;
    const out = new Set<Entity>();
    for (const e of scene.all()) {
      const name = engine.world.nameOf(e).toLowerCase();
      const types = engine.world.getComponentTypes(e).join(' ').toLowerCase();
      if (name.includes(q) || types.includes(q)) {
        out.add(e);
        let p = engine.world.getParent(e);
        while (p !== NULL_ENTITY) { out.add(p); p = engine.world.getParent(p); }
      }
    }
    return out;
  }

  private renderNode(e: Entity, level: number, matches: Set<Entity> | null): void {
    const { scene, engine } = this.ctx;
    if (matches && !matches.has(e)) return;
    const guid = scene.guidOf(e) ?? String(e);
    const children = engine.world.getChildren(e).filter((c) => !matches || matches.has(c));
    const isExpanded = matches ? true : this.expanded.has(guid);
    const meta = scene.metaOf(e);
    const row = el('div', { class: 'tree-row', attrs: { role: 'treeitem', tabindex: '-1', 'aria-level': String(level), 'aria-selected': 'false', 'data-entity': String(e), draggable: 'true' } });
    if (children.length) row.setAttribute('aria-expanded', String(isExpanded));
    row.style.setProperty('--level', String(level - 1));
    const caret = el('button', { class: `tree-caret ${children.length ? '' : 'leaf'}`, attrs: { type: 'button', tabindex: '-1', 'aria-hidden': 'true' } }, children.length ? icon(isExpanded ? 'chevron-down' : 'chevron', 12) : null);
    caret.addEventListener('click', (ev) => { ev.stopPropagation(); this.toggle(guid); });
    const label = el('span', { class: 'tree-label', text: engine.world.nameOf(e) || `Entity ${e}` });
    const remoteColors = scene.guidOf(e) ? this.ctx.remoteSelectionColors(scene.guidOf(e)!) : [];
    const dots = el('span', { class: 'tree-remote' }, ...remoteColors.map((c) => el('span', { class: 'remote-dot', style: { background: c } })));
    const vis = el('button', { class: `tree-tool ${meta?.hidden ? 'on' : ''}`, attrs: { type: 'button', tabindex: '-1', 'aria-label': meta?.hidden ? 'Show' : 'Hide', 'data-tip': meta?.hidden ? 'Show in editor' : 'Hide in editor' } }, icon(meta?.hidden ? 'eye-off' : 'eye', 13));
    vis.addEventListener('click', (ev) => { ev.stopPropagation(); this.ctx.commands.push(new SetMetaCommand(scene, guid, 'hidden', !meta?.hidden)); });
    const lock = el('button', { class: `tree-tool ${meta?.locked ? 'on' : ''}`, attrs: { type: 'button', tabindex: '-1', 'aria-label': meta?.locked ? 'Unlock' : 'Lock', 'data-tip': meta?.locked ? 'Unlock' : 'Lock (prevents viewport edits)' } }, icon(meta?.locked ? 'lock' : 'unlock', 13));
    lock.addEventListener('click', (ev) => { ev.stopPropagation(); this.ctx.commands.push(new SetMetaCommand(scene, guid, 'locked', !meta?.locked)); });
    row.append(caret, icon(this.ctx.entityIcon(e), 14), label, dots, vis, lock);
    if (scene.isHidden(e)) row.classList.add('hidden-entity');
    if (scene.isLocked(e)) row.classList.add('locked-entity');
    row.addEventListener('click', (ev) => this.onRowClick(e, ev));
    row.addEventListener('dblclick', (ev) => { ev.stopPropagation(); if ((ev.target as HTMLElement).closest('.tree-tool')) return; this.beginRename(e); });
    this.bindDrag(row, e);
    this.tree.appendChild(row);
    this.rows.set(e, row);
    if (isExpanded) for (const c of children) this.renderNode(c, level + 1, matches);
  }

  private toggle(guid: string): void {
    if (this.expanded.has(guid)) this.expanded.delete(guid); else this.expanded.add(guid);
    this.schedule();
  }

  private updateSelection(): void {
    const { state } = this.ctx;
    for (const [e, row] of this.rows) {
      const on = state.isSelected(e);
      row.classList.toggle('selected', on);
      row.setAttribute('aria-selected', String(on));
      row.tabIndex = -1;
    }
    const primary = state.primary;
    const row = primary !== null ? this.rows.get(primary) : undefined;
    if (row) row.tabIndex = 0; else { const first = this.tree.querySelector<HTMLElement>('.tree-row'); if (first) first.tabIndex = 0; }
  }

  private onRowClick(e: Entity, ev: MouseEvent): void {
    if ((ev.target as HTMLElement).closest('.tree-tool, .tree-caret')) return;
    const { state } = this.ctx;
    if (state.picking) { state.endPick(e); return; }
    if (ev.shiftKey && this.anchor !== null) {
      const visible = Array.from(this.rows.keys());
      const a = visible.indexOf(this.anchor), b = visible.indexOf(e);
      if (a >= 0 && b >= 0) { state.select(visible.slice(Math.min(a, b), Math.max(a, b) + 1), 'add'); return; }
    }
    if (ev.ctrlKey || ev.metaKey) state.select(e, 'toggle');
    else state.select(e);
    this.anchor = e;
    this.rows.get(e)?.focus();
  }

  private onKey(ev: KeyboardEvent): void {
    const { state } = this.ctx;
    const visible = Array.from(this.rows.keys());
    const cur = state.primary;
    const i = cur !== null ? visible.indexOf(cur) : -1;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = visible[Math.max(0, Math.min(visible.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
      if (n !== undefined) { state.select(n, ev.shiftKey ? 'add' : 'replace'); this.rows.get(n)?.focus(); }
    } else if (ev.key === 'ArrowRight' && cur !== null) {
      ev.preventDefault();
      const g = this.ctx.scene.guidOf(cur);
      if (g && this.ctx.engine.world.getChildren(cur).length) { if (this.expanded.has(g)) { const c = this.ctx.engine.world.getChildren(cur)[0]; state.select(c); this.rows.get(c)?.focus(); } else { this.expanded.add(g); this.schedule(); } }
    } else if (ev.key === 'ArrowLeft' && cur !== null) {
      ev.preventDefault();
      const g = this.ctx.scene.guidOf(cur);
      if (g && this.expanded.has(g)) { this.expanded.delete(g); this.schedule(); }
      else { const p = this.ctx.engine.world.getParent(cur); if (p !== NULL_ENTITY) { state.select(p); this.rows.get(p)?.focus(); } }
    } else if (ev.key === 'F2' && cur !== null) { ev.preventDefault(); this.beginRename(cur); }
    else if (ev.key === 'Enter' && cur !== null && !this.renaming) { ev.preventDefault(); this.ctx.viewport.frameSelected(); }
  }

  private beginRename(e: Entity): void {
    const row = this.rows.get(e);
    if (!row || this.renaming !== null) return;
    const label = row.querySelector<HTMLElement>('.tree-label')!;
    const input = el('input', { class: 'tree-rename', attrs: { type: 'text', 'aria-label': 'Entity name' } });
    input.value = this.ctx.engine.world.nameOf(e);
    label.replaceWith(input);
    this.renaming = e;
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      this.renaming = null;
      const guid = this.ctx.scene.guidOf(e);
      const v = input.value.trim();
      if (commit && guid && v && v !== this.ctx.engine.world.nameOf(e)) this.ctx.commands.push(new RenameCommand(this.ctx.scene, guid, v));
      else this.schedule();
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.focus();
    input.select();
  }

  /** Expand ancestors and scroll to an entity. */
  reveal(e: Entity): void {
    let p = this.ctx.engine.world.getParent(e);
    while (p !== NULL_ENTITY) { const g = this.ctx.scene.guidOf(p); if (g) this.expanded.add(g); p = this.ctx.engine.world.getParent(p); }
    this.render();
    const row = this.rows.get(e);
    row?.scrollIntoView({ block: 'nearest' });
    row?.classList.add('flash');
    setTimeout(() => row?.classList.remove('flash'), 1000);
  }

  // ------------------------------------------------------------- drag-drop

  private bindDrag(row: HTMLElement, e: Entity): void {
    row.addEventListener('dragstart', (ev) => {
      const { state, scene } = this.ctx;
      if (!state.isSelected(e)) state.select(e);
      const guids = state.selection.map((s) => scene.guidOf(s)).filter((g): g is string => !!g);
      ev.dataTransfer?.setData('application/x-forge-entities', JSON.stringify(guids));
      ev.dataTransfer!.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (ev) => {
      const dt = ev.dataTransfer;
      if (!dt) return;
      const isEntity = dt.types.includes('application/x-forge-entities');
      const isAsset = dt.types.includes('application/x-forge-asset');
      if (!isEntity && !isAsset) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pos = isAsset ? 'inside' : this.dropPos(row, ev);
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      row.classList.add(`drop-${pos}`);
      dt.dropEffect = isAsset ? 'copy' : 'move';
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    row.addEventListener('drop', (ev) => {
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      ev.preventDefault();
      ev.stopPropagation();
      const asset = ev.dataTransfer?.getData('application/x-forge-asset');
      if (asset) { this.dropAsset(e, JSON.parse(asset) as { id: string; kind: string }); return; }
      this.dropEntities(ev, e, this.dropPos(row, ev));
    });
  }

  private dropPos(row: HTMLElement, ev: DragEvent): DropPos {
    const r = row.getBoundingClientRect();
    const y = (ev.clientY - r.top) / r.height;
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
  }

  private dropEntities(ev: DragEvent, target: Entity | null, pos: DropPos): void {
    const raw = ev.dataTransfer?.getData('application/x-forge-entities');
    if (!raw) return;
    const { scene, commands, engine } = this.ctx;
    const guids = (JSON.parse(raw) as string[]).filter((g) => scene.entityOf(g) !== undefined);
    let parent: string | null;
    let index: number;
    if (target === null) { parent = null; index = -1; }
    else if (pos === 'inside') { parent = scene.guidOf(target) ?? null; index = -1; if (parent) this.expanded.add(parent); }
    else {
      const p = engine.world.getParent(target);
      parent = p === NULL_ENTITY ? null : scene.guidOf(p) ?? null;
      index = scene.indexOf(target) + (pos === 'after' ? 1 : 0);
    }
    // Skip drops onto self / descendants.
    const valid = guids.filter((g) => { const e = scene.entityOf(g)!; const pe = parent ? scene.entityOf(parent) : undefined; return pe === undefined || (pe !== e && !engine.world.isDescendantOf(pe, e)); });
    if (!valid.length) return;
    commands.transaction(`Move ${valid.length} entit${valid.length === 1 ? 'y' : 'ies'}`, () => {
      valid.forEach((g, i) => commands.push(new ReparentCommand(scene, g, parent, index < 0 ? -1 : index + i, true)));
    });
  }

  private dropAsset(e: Entity, asset: { id: string; kind: string }): void {
    const { scene, commands, engine } = this.ctx;
    const guid = scene.guidOf(e);
    if (!guid) return;
    if (asset.kind === 'audio') {
      commands.push(new AddComponentCommand(scene, guid, 'AudioSource', { clip: asset.id, playOnStart: false }));
      toast(`AudioSource with "${asset.id}" added to ${engine.world.nameOf(e)}`, 'success');
    } else if (asset.kind === 'image' || asset.kind === 'atlas') {
      commands.push(new AddComponentCommand(scene, guid, 'Sprite', { texture: asset.id }));
      toast(`Sprite texture set to "${asset.id}"`, 'success');
    } else toast(`Cannot drop a ${asset.kind} asset on an entity`, 'warn');
  }

  // ------------------------------------------------------------------ menus

  createMenu(parent: Entity | null): MenuItem[] {
    const { scene, commands, state, project } = this.ctx;
    const renderer = project.project.settings.renderer;
    const parentGuid = parent !== null ? scene.guidOf(parent) ?? null : null;
    return PRESETS.filter((p) => p.renderer === 'both' || p.renderer === renderer).map((p) => ({
      label: p.label, icon: p.icon,
      onClick: () => {
        const snap = makePreset(p.id, { parent: parentGuid });
        const cmd = new CreateEntityCommand(scene, snap);
        commands.push(cmd);
        if (parentGuid) this.expanded.add(parentGuid);
        const e = cmd.entity;
        if (e !== undefined) { state.select(e); state.reveal(e); }
      },
    }));
  }

  private contextItems(e: Entity | null): MenuItem[] {
    const { scene, state, commands, engine, project } = this.ctx;
    const sel = state.selection.filter((s) => scene.isEditable(s));
    const items: MenuItem[] = [{ label: 'Create', icon: 'plus', submenu: this.createMenu(e) }];
    if (project.project.prefabs.length) {
      items.push({
        label: 'Instantiate prefab', icon: 'copy',
        submenu: project.project.prefabs.map((p) => ({ label: p.name, onClick: () => this.instantiate(p, e) })),
      });
    }
    if (e === null || !sel.length) return items;
    const meta = scene.metaOf(e);
    items.push(
      { separator: true },
      { label: 'Rename', shortcut: 'F2', onClick: () => this.beginRename(e) },
      { label: 'Duplicate', shortcut: 'Mod+D', icon: 'copy', onClick: () => this.ctx.actions.run('entity.duplicate') },
      { label: 'Focus in viewport', shortcut: 'F', icon: 'frame', onClick: () => this.ctx.viewport.frameSelected() },
      { separator: true },
      { label: meta?.hidden ? 'Show' : 'Hide', icon: meta?.hidden ? 'eye' : 'eye-off', onClick: () => commands.transaction('Toggle visibility', () => sel.forEach((s) => { const g = scene.guidOf(s); if (g) commands.push(new SetMetaCommand(scene, g, 'hidden', !meta?.hidden)); })) },
      { label: meta?.locked ? 'Unlock' : 'Lock', icon: meta?.locked ? 'unlock' : 'lock', onClick: () => commands.transaction('Toggle lock', () => sel.forEach((s) => { const g = scene.guidOf(s); if (g) commands.push(new SetMetaCommand(scene, g, 'locked', !meta?.locked)); })) },
      { separator: true },
      {
        label: 'Create prefab from entity', icon: 'box', disabled: sel.length !== 1, onClick: () => {
          const prefab = createPrefab(engine.world, e, engine.world.nameOf(e) || 'Prefab');
          let name = prefab.name;
          let i = 2;
          while (project.project.prefabs.some((p) => p.name === name)) name = `${prefab.name} ${i++}`;
          prefab.name = name;
          commands.push({ label: `Create prefab ${name}`, execute: () => project.apply({ kind: 'prefab-add', prefab }), undo: () => project.apply({ kind: 'prefab-remove', name }) });
          toast(`Prefab "${name}" created (see Assets)`, 'success');
        },
      },
      { separator: true },
      { label: 'Delete', shortcut: 'Delete', icon: 'trash', danger: true, onClick: () => commands.push(new DeleteEntitiesCommand(scene, sel.map((s) => scene.guidOf(s)!).filter(Boolean))) },
    );
    return items;
  }

  private instantiate(prefab: PrefabData, parent: Entity | null): void {
    const { scene, commands, state } = this.ctx;
    const snap = prefabToSnapshot(prefab, parent !== null ? scene.guidOf(parent) ?? null : null);
    const cmd = new CreateEntityCommand(scene, snap, `Instantiate ${prefab.name}`);
    commands.push(cmd);
    if (cmd.entity !== undefined) { state.select(cmd.entity); state.reveal(cmd.entity); }
  }
}

/** Convert prefab data (document ids) into an editor snapshot with fresh guids. */
export function prefabToSnapshot(prefab: PrefabData, parent: string | null, position?: { x: number; y: number; z?: number }): EntitySnapshot {
  const guidOf = new Map<number, string>();
  for (const ed of prefab.entities) guidOf.set(ed.id, `${Math.random().toString(36).slice(2, 12)}`);
  const byId = new Map(prefab.entities.map((ed) => [ed.id, ed]));
  const build = (id: number, parentGuid: string | null, index: number): EntitySnapshot => {
    const ed = byId.get(id)!;
    const children = prefab.entities.filter((c) => c.parent === id);
    const snap: EntitySnapshot = {
      guid: guidOf.get(id)!, name: ed.name, parent: parentGuid, index,
      components: ed.components.map((c) => ({ type: c.type, data: encodeRefs(c.data, guidOf) })),
      children: children.map((c, i) => build(c.id, guidOf.get(id)!, i)),
    };
    return snap;
  };
  const root = prefab.entities[0];
  const snap = build(root.id, parent, -1);
  if (position) {
    const t = snap.components.find((c) => c.type === 'Transform');
    const pos = { x: position.x, y: position.y, z: position.z ?? 0 };
    if (t) t.data.position = pos; else snap.components.unshift({ type: 'Transform', data: { position: pos } });
  }
  return SceneEditor.regenerate(snap);
}

function encodeRefs(data: Record<string, unknown>, guidOf: Map<number, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'parent') continue;
    out[k] = typeof v === 'number' && guidOf.has(v) && (k === 'follow' || k === 'lookAt' || k === 'target') ? { $ref: guidOf.get(v) } : v;
  }
  return out;
}
