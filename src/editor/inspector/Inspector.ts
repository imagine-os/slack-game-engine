import type { FieldMeta } from '../../core/ecs/Component';
import type { Entity } from '../../core/ecs/Entity';
import type { RegistryEntry } from '../../core/ecs/Registry';
import { Transform } from '../../core/ecs/Transform';
import { Name } from '../../core/ecs/components';
import { Script } from '../../scripting/Script';
import type { EditorContext } from '../app/EditorContext';
import { AddComponentCommand, RemoveComponentCommand, RenameCommand, SetFieldsCommand, SetMetaCommand, type FieldTarget } from '../commands/SceneCommands';
import type { Mutation } from '../project/SceneEditor';
import { el, icon } from '../ui/dom';
import { showMenu, type MenuItem } from '../ui/Menu';
import { toast } from '../ui/Toast';
import { createFieldRow, type FieldContext, type FieldEditor } from './fields';

const ICON_MAP: Record<string, string> = { move: 'move', camera: 'camera', image: 'image', film: 'film', shapes: 'shapes', type: 'type', grid: 'grid', sparkles: 'sparkles', sun: 'sun', box: 'box', atom: 'atom', circle: 'circle', code: 'code', audio: 'audio', ear: 'ear', globe: 'globe', gamepad: 'gamepad', tag: 'tag' };

/**
 * Right panel: edits the selected entities' components with generic field
 * editors driven by Registry field metadata. Supports multi-selection (shared
 * components/fields), add/remove/reset components and a dedicated Script
 * editor for script props.
 */
export class Inspector {
  readonly root = el('div', { class: 'inspector' });
  private body = el('div', { class: 'inspector-body' });
  private editors = new Map<string, FieldEditor>();
  private renderedTypes = '';
  private renderedSelection = '';
  private raf = 0;
  private fieldCtx: FieldContext;

  constructor(private readonly ctx: EditorContext) {
    this.root.appendChild(this.body);
    const { state, scene } = ctx;
    this.fieldCtx = {
      assets: (kind) => ctx.project.project.assets.assets.filter((a) => !kind || a.kind === kind).map((a) => ({ id: a.id, kind: a.kind, url: a.url })),
      refName: (ref) => {
        const e = scene.decodeRef(ref) as Entity;
        return e ? ctx.engine.world.nameOf(e) || `Entity ${e}` : '(none)';
      },
      pickEntity: () => new Promise((resolve) => {
        toast('Click an entity in the hierarchy or viewport (Esc to cancel)', 'info');
        state.beginPick((e) => resolve(e === null ? undefined : scene.encodeRef(e)));
      }),
      revealRef: (ref) => { const e = scene.decodeRef(ref) as Entity; if (e) { state.select(e); state.reveal(e); } },
      is3d: ctx.is3d,
    };
    state.events.on('selection', () => this.schedule(true));
    scene.events.on('mutated', ({ mutation }) => this.onMutation(mutation));
    scene.events.on('loaded', () => this.schedule(true));
    ctx.project.events.on('scriptsChanged', () => this.schedule(true));
    ctx.project.events.on('assetsChanged', () => this.schedule(false));
    this.render();
  }

  private schedule(force: boolean): void {
    if (force) this.renderedTypes = '';
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  private onMutation(m: Mutation): void {
    const sel = this.ctx.state.selection;
    if (m.kind === 'field-set') {
      const e = this.ctx.scene.entityOf(m.guid);
      if (e === undefined || !sel.includes(e)) return;
      if (m.type === Name.type) { this.schedule(true); return; }
      this.refreshField(m.type, m.field);
      if (m.type === Script.type && m.field === 'script') this.schedule(true);
      return;
    }
    if (m.kind === 'entity-delete' || m.kind === 'component-add' || m.kind === 'component-remove' || m.kind === 'entity-rename' || m.kind === 'meta-set') this.schedule(true);
  }

  /** Update one field editor from the live components (multi-edit aware). */
  private refreshField(type: string, field: string): void {
    const key = `${type}.${field}`;
    const ed = this.editors.get(key);
    if (!ed) { if (type === Script.type) this.schedule(true); return; }
    const { value, mixed } = this.valueOf(type, field);
    ed.update(value, mixed);
  }

  /** Shared value across the selection (or `mixed`). */
  private valueOf(type: string, field: string): { value: unknown; mixed: boolean } {
    let first: unknown; let has = false; let mixed = false;
    for (const e of this.ctx.state.selection) {
      const c = this.ctx.engine.world.getComponent(e, type);
      if (!c) continue;
      const v = this.ctx.scene.serializeComponent(c)[field];
      if (!has) { first = v; has = true; }
      else if (JSON.stringify(v) !== JSON.stringify(first)) mixed = true;
    }
    return { value: first, mixed };
  }

  private setField(type: string, field: string, value: unknown, live: boolean): void {
    const targets: FieldTarget[] = [];
    for (const e of this.ctx.state.selection) {
      const guid = this.ctx.scene.guidOf(e);
      if (!guid || !this.ctx.engine.world.hasComponent(e, type)) continue;
      targets.push({ guid, type, field, value: structuredClone(value) });
    }
    if (!targets.length) return;
    if (!live) this.ctx.commands.breakMerge();
    this.ctx.commands.push(new SetFieldsCommand(this.ctx.scene, targets), { merge: live });
    if (!live) this.ctx.commands.breakMerge();
  }

  // --------------------------------------------------------------- render

  render(): void {
    const { state, engine, scene } = this.ctx;
    const sel = state.selection.filter((e) => scene.isEditable(e));
    const selKey = sel.join(',');
    const typeLists = sel.map((e) => engine.world.getComponentTypes(e));
    const shared = typeLists.length ? typeLists.reduce((acc, t) => acc.filter((x) => t.includes(x))) : [];
    const typesKey = `${selKey}|${shared.join(',')}|${sel.map((e) => scene.metaOf(e)?.hidden ? 'h' : '' + (scene.metaOf(e)?.locked ? 'l' : '')).join('')}`;
    if (typesKey === this.renderedTypes && selKey === this.renderedSelection) {
      // Values may have changed (e.g. undo): refresh all editors.
      for (const key of this.editors.keys()) { const [type, field] = key.split('.'); const { value, mixed } = this.valueOf(type, field); this.editors.get(key)!.update(value, mixed); }
      return;
    }
    this.renderedTypes = typesKey;
    this.renderedSelection = selKey;
    this.editors.clear();
    this.body.textContent = '';
    if (!sel.length) {
      this.body.appendChild(el('div', { class: 'panel-empty' }, icon('cursor', 24), el('p', { text: 'Select an entity in the hierarchy or viewport to inspect its components.' }), el('p', { class: 'dim', text: 'Tip: right-click the viewport to create entities.' })));
      return;
    }
    this.body.appendChild(this.header(sel));
    const order = [Transform.type, ...shared.filter((t) => t !== Transform.type && t !== Name.type)];
    for (const type of order) {
      if (!shared.includes(type)) continue;
      const entry = engine.registry.get(type);
      if (!entry) continue;
      this.body.appendChild(type === Script.type ? this.scriptCard(entry, sel) : this.componentCard(entry, sel));
    }
    if (sel.length > 1) {
      const all = new Set(typeLists.flat());
      const notShared = [...all].filter((t) => !shared.includes(t) && t !== Name.type);
      if (notShared.length) this.body.appendChild(el('div', { class: 'inspector-note', text: `Not on all selected: ${notShared.join(', ')}` }));
    }
    const addBtn = el('button', { class: 'add-component', attrs: { type: 'button', 'data-tour': 'add-component' } }, icon('plus'), el('span', { text: 'Add component' }));
    addBtn.addEventListener('click', () => this.openAddMenu(addBtn, sel, shared));
    this.body.appendChild(addBtn);
  }

  private header(sel: Entity[]): HTMLElement {
    const { engine, scene, state, commands } = this.ctx;
    const primary = sel[sel.length - 1];
    const name = el('input', { class: 'text-input inspector-name', attrs: { type: 'text', 'aria-label': 'Entity name', spellcheck: 'false' } });
    name.value = sel.length === 1 ? engine.world.nameOf(primary) : `${sel.length} entities`;
    name.disabled = sel.length !== 1;
    name.addEventListener('change', () => {
      const guid = scene.guidOf(primary);
      if (guid && name.value.trim()) commands.push(new RenameCommand(scene, guid, name.value.trim()));
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    const meta = scene.metaOf(primary);
    const hiddenBtn = el('button', { class: `icon-btn ${meta?.hidden ? 'active' : ''}`, attrs: { type: 'button', 'aria-pressed': String(!!meta?.hidden), 'data-tip': meta?.hidden ? 'Hidden in editor (click to show)' : 'Visible in editor (click to hide)' } }, icon(meta?.hidden ? 'eye-off' : 'eye'));
    hiddenBtn.addEventListener('click', () => commands.transaction('Toggle visibility', () => { for (const e of sel) { const g = scene.guidOf(e); if (g) commands.push(new SetMetaCommand(scene, g, 'hidden', !meta?.hidden)); } }));
    const lockBtn = el('button', { class: `icon-btn ${meta?.locked ? 'active' : ''}`, attrs: { type: 'button', 'aria-pressed': String(!!meta?.locked), 'data-tip': meta?.locked ? 'Locked (click to unlock)' : 'Unlocked (click to lock)' } }, icon(meta?.locked ? 'lock' : 'unlock'));
    lockBtn.addEventListener('click', () => commands.transaction('Toggle lock', () => { for (const e of sel) { const g = scene.guidOf(e); if (g) commands.push(new SetMetaCommand(scene, g, 'locked', !meta?.locked)); } }));
    const idLabel = el('span', { class: 'inspector-id dim', text: sel.length === 1 ? `id ${primary} · ${scene.guidOf(primary) ?? ''}` : sel.map((e) => engine.world.nameOf(e)).join(', ') });
    const head = el('div', { class: 'inspector-head' }, el('div', { class: 'inspector-head-row' }, icon(this.ctx.entityIcon(primary), 18), name, hiddenBtn, lockBtn), idLabel);
    void state;
    return head;
  }

  private componentCard(entry: RegistryEntry, sel: Entity[]): HTMLElement {
    const card = el('section', { class: 'component-card', attrs: { 'data-type': entry.type } });
    const collapsedKey = `forge.editor.collapsed.${entry.type}`;
    let collapsed = sessionStorage.getItem(collapsedKey) === '1';
    const caret = el('button', { class: 'icon-btn caret', attrs: { type: 'button', 'aria-expanded': String(!collapsed), 'aria-label': `Toggle ${entry.type}` } }, icon('chevron-down', 14));
    const title = el('h3', { text: entry.type, title: entry.meta.description ?? '' });
    const menuBtn = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `${entry.type} options`, 'data-tip': 'Component options' } }, icon('more', 14));
    menuBtn.addEventListener('click', () => showMenu(this.componentMenu(entry, sel), menuBtn, { align: 'right' }));
    const head = el('header', { class: 'component-head' }, caret, icon(ICON_MAP[entry.meta.icon ?? ''] ?? 'dot', 14), title, menuBtn);
    const body = el('div', { class: 'component-body' });
    body.hidden = collapsed;
    caret.addEventListener('click', () => { collapsed = !collapsed; body.hidden = collapsed; caret.setAttribute('aria-expanded', String(!collapsed)); card.classList.toggle('collapsed', collapsed); sessionStorage.setItem(collapsedKey, collapsed ? '1' : '0'); });
    card.classList.toggle('collapsed', collapsed);
    for (const [field, meta] of Object.entries(entry.fields)) {
      if (meta.hidden || meta.transient) continue;
      if (entry.type === Transform.type && field === 'parent') continue;
      const row = this.fieldRow(entry.type, field, meta);
      body.appendChild(row.root);
    }
    if (!body.children.length) body.appendChild(el('div', { class: 'dim small', text: 'No editable fields.' }));
    card.append(head, body);
    return card;
  }

  private fieldRow(type: string, field: string, meta: FieldMeta): FieldEditor {
    const { value, mixed } = this.valueOf(type, field);
    const label = meta.label ?? humanize(field);
    const displayMeta: FieldMeta = type === Transform.type && field === 'rotation' ? { ...meta, label: this.ctx.is3d ? 'Rotation' : 'Angle' } : meta;
    const row = createFieldRow({ meta: displayMeta, label: displayMeta.label ?? label, value, mixed, context: this.fieldCtx, onChange: (v, live) => this.setField(type, field, v, live) });
    this.editors.set(`${type}.${field}`, row);
    return row;
  }

  private componentMenu(entry: RegistryEntry, sel: Entity[]): MenuItem[] {
    const { scene, commands, engine } = this.ctx;
    const isTransform = entry.type === Transform.type;
    return [
      {
        label: 'Reset to defaults', icon: 'refresh', onClick: () => {
          const defaults = scene.encodeData(entry.type, engine.registry.defaults(entry.type));
          commands.transaction(`Reset ${entry.type}`, () => {
            for (const [field, meta] of Object.entries(entry.fields)) {
              if (meta.transient || meta.readonly || !(field in defaults)) continue;
              if (isTransform && field === 'parent') continue;
              this.setField(entry.type, field, defaults[field], false);
            }
          });
        },
      },
      {
        label: 'Copy values', icon: 'copy', onClick: () => {
          const c = engine.world.getComponent(sel[sel.length - 1], entry.type);
          if (c) { void navigator.clipboard?.writeText(JSON.stringify({ type: entry.type, data: scene.serializeComponent(c) }, null, 2)); toast('Component values copied', 'success'); }
        },
      },
      {
        label: 'Paste values', icon: 'copy', onClick: async () => {
          try {
            const text = await navigator.clipboard.readText();
            const parsed = JSON.parse(text) as { type: string; data: Record<string, unknown> };
            if (parsed.type !== entry.type) { toast(`Clipboard holds ${parsed.type}, not ${entry.type}`, 'warn'); return; }
            commands.transaction(`Paste ${entry.type}`, () => { for (const [k, v] of Object.entries(parsed.data)) if (!isTransform || k !== 'parent') this.setField(entry.type, k, v, false); });
          } catch { toast('Clipboard does not contain component values', 'warn'); }
        },
      },
      { separator: true },
      {
        label: 'Remove component', icon: 'trash', danger: true, disabled: isTransform, onClick: () => {
          commands.transaction(`Remove ${entry.type}`, () => { for (const e of sel) { const g = scene.guidOf(e); if (g) commands.push(new RemoveComponentCommand(scene, g, entry.type)); } });
        },
      },
    ];
  }

  private scriptCard(entry: RegistryEntry, sel: Entity[]): HTMLElement {
    const { engine, project, commands, scene } = this.ctx;
    const card = this.componentCard(entry, sel);
    const body = card.querySelector<HTMLElement>('.component-body')!;
    body.textContent = '';
    this.editors.delete('Script.props');
    const primary = sel[sel.length - 1];
    const script = engine.world.getComponent(primary, Script)!;
    const select = el('select', { class: 'select-input', attrs: { 'aria-label': 'Script' } }, el('option', { text: '(none)', attrs: { value: '' } }));
    for (const s of project.project.scripts) select.appendChild(el('option', { text: s.name, attrs: { value: s.name } }));
    if (script.script && !project.project.scripts.some((s) => s.name === script.script)) select.appendChild(el('option', { text: `${script.script} (missing)`, attrs: { value: script.script } }));
    select.value = script.script;
    select.addEventListener('change', () => {
      commands.transaction('Change script', () => {
        this.setField(Script.type, 'script', select.value, false);
        this.setField(Script.type, 'props', {}, false);
      });
    });
    const editBtn = el('button', { class: 'small', attrs: { type: 'button', 'data-tip': 'Open in the Scripts tab' } }, icon('code', 14), el('span', { text: 'Edit' }));
    editBtn.disabled = !script.script;
    editBtn.addEventListener('click', () => this.ctx.openScript(script.script));
    const newBtn = el('button', { class: 'small', attrs: { type: 'button', 'data-tip': 'Create a new script and attach it' } }, icon('plus', 14));
    newBtn.addEventListener('click', () => {
      const name = project.uniqueScriptName(`${engine.world.nameOf(primary).replace(/\W+/g, '') || 'Script'}Behaviour`);
      commands.transaction('New script', () => {
        commands.push({ label: 'Add script', execute: () => project.apply({ kind: 'script-add', name, source: `defineScript({\n  name: '${name}',\n  props: {},\n\n  onStart(ctx) {\n  },\n\n  onUpdate(ctx, dt) {\n  },\n});\n` }), undo: () => project.apply({ kind: 'script-remove', name }) });
        this.setField(Script.type, 'script', name, false);
      });
      this.ctx.openScript(name);
    });
    body.appendChild(el('div', { class: 'field-row' }, el('label', { class: 'field-label', text: 'Script' }), el('div', { class: 'script-pick' }, select, editBtn, newBtn)));
    body.appendChild(this.fieldRow(Script.type, 'enabled', entry.fields.enabled).root);
    const def = engine.scripting.definitions.get(script.script);
    if (script.script && !def) body.appendChild(el('div', { class: 'inspector-warning' }, icon('warning', 14), el('span', { text: 'Script failed to compile or is missing. Check the Console.' })));
    const props = def?.props ?? {};
    const keys = Object.keys(props);
    if (keys.length) {
      body.appendChild(el('h4', { class: 'props-title', text: 'Properties' }));
      const defaults = engine.scripting.defaultProps(script.script);
      for (const k of keys) {
        const p = props[k];
        const meta: FieldMeta = { type: p.type, label: p.label, description: p.description, min: p.min, max: p.max, step: p.step, options: p.options, assetKind: p.assetKind };
        const values = sel.map((e) => (engine.world.getComponent(e, Script)?.props ?? {})[k] ?? defaults[k]);
        const mixed = values.some((v) => JSON.stringify(v) !== JSON.stringify(values[0]));
        const value = p.type === 'entity' ? scene.encodeRef(values[0]) : values[0];
        const row = createFieldRow({
          meta, label: p.label ?? humanize(k), value, mixed, context: this.fieldCtx,
          onChange: (v, live) => {
            const targets: FieldTarget[] = [];
            for (const e of sel) {
              const g = scene.guidOf(e);
              const sc = engine.world.getComponent(e, Script);
              if (!g || !sc) continue;
              const next = { ...defaults, ...structuredClone(sc.props), [k]: p.type === 'entity' ? scene.decodeRef(v) : structuredClone(v) };
              targets.push({ guid: g, type: Script.type, field: 'props', value: next });
            }
            if (!live) commands.breakMerge();
            commands.push(new SetFieldsCommand(scene, targets, `Set ${k}`), { merge: live });
          },
        });
        body.appendChild(row.root);
        this.editors.set(`Script.props.${k}`, row);
      }
      const reset = el('button', { class: 'small ghost', text: 'Reset props to defaults', attrs: { type: 'button' } });
      reset.addEventListener('click', () => this.setField(Script.type, 'props', {}, false));
      body.appendChild(reset);
    } else if (def) body.appendChild(el('div', { class: 'dim small', text: 'This script declares no props. Add a `props` object to defineScript to expose settings here.' }));
    return card;
  }

  private openAddMenu(anchor: HTMLElement, sel: Entity[], shared: string[]): void {
    const { engine, scene, commands } = this.ctx;
    const pop = el('div', { class: 'add-popover', attrs: { role: 'dialog', 'aria-label': 'Add component' } });
    const search = el('input', { class: 'text-input', attrs: { type: 'text', placeholder: 'Search components…', 'aria-label': 'Search components' } });
    const list = el('div', { class: 'add-list', attrs: { role: 'listbox' } });
    pop.append(search, list);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(innerWidth - 300, r.left))}px`;
    pop.style.top = `${Math.min(innerHeight - 360, r.bottom + 4)}px`;
    const close = (): void => { pop.remove(); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey, true); };
    const onDoc = (e: MouseEvent): void => { if (!pop.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    setTimeout(() => { document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey, true); });
    const primaryIs3d = this.ctx.is3d;
    const render = (): void => {
      list.textContent = '';
      const q = search.value.trim().toLowerCase();
      for (const [cat, entries] of engine.registry.byCategory()) {
        const items = entries.filter((en) => en.type !== Transform.type && en.type !== Name.type && !(en.meta.unique !== false && shared.includes(en.type)) && (!q || `${cat} ${en.type} ${en.meta.description ?? ''}`.toLowerCase().includes(q)));
        if (!items.length) continue;
        const dimCat = (primaryIs3d && /2D/.test(cat)) || (!primaryIs3d && /3D/.test(cat));
        list.appendChild(el('div', { class: `add-cat ${dimCat ? 'dim' : ''}`, text: cat }));
        for (const en of items) {
          const row = el('button', { class: 'add-row', attrs: { type: 'button', role: 'option', title: en.meta.description ?? '' } }, icon(ICON_MAP[en.meta.icon ?? ''] ?? 'dot', 14), el('span', { class: 'add-name', text: en.type }), el('span', { class: 'add-desc dim', text: en.meta.description ?? '' }));
          row.addEventListener('click', () => {
            close();
            commands.transaction(`Add ${en.type}`, () => { for (const e of sel) { const g = scene.guidOf(e); if (g) commands.push(new AddComponentCommand(scene, g, en.type)); } });
          });
          list.appendChild(row);
        }
      }
      if (!list.children.length) list.appendChild(el('div', { class: 'dim small', text: 'No matching components' }));
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { (list.querySelector<HTMLElement>('.add-row'))?.click(); } if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector<HTMLElement>('.add-row')?.focus(); } });
    list.addEventListener('keydown', (e) => {
      const rows = Array.from(list.querySelectorAll<HTMLElement>('.add-row'));
      const i = rows.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); rows[Math.min(rows.length - 1, i + 1)]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) search.focus(); else rows[i - 1].focus(); }
    });
    render();
    search.focus();
  }
}

/** `followSmoothing` → `Follow smoothing`. */
export function humanize(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}
