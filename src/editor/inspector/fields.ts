import type { FieldMeta } from '../../core/ecs/Component';
import { Color, Quat, Vec3 } from '../../core/math';
import { el, icon } from '../ui/dom';

/** Services field editors need from the surrounding editor. */
export interface FieldContext {
  /** Project assets for asset pickers. */
  assets(kind?: string): { id: string; kind: string; url: string }[];
  /** Display name for a guid-encoded entity reference. */
  refName(ref: unknown): string;
  /** Ask the user to pick an entity; resolves with a guid-encoded reference or null. */
  pickEntity(): Promise<unknown>;
  /** Highlight an entity by reference. */
  revealRef(ref: unknown): void;
  /** Project renderer mode; 2D shows a single rotation angle. */
  is3d: boolean;
}

export interface FieldEditor {
  root: HTMLElement;
  /** Push a new value into the editor without firing onChange. */
  update(value: unknown, mixed?: boolean): void;
}

export interface FieldEditorOptions {
  meta: FieldMeta;
  label: string;
  value: unknown;
  mixed?: boolean;
  /** `live` is true during drags/typing; the caller merges live changes into one undo step. */
  onChange(value: unknown, live: boolean): void;
  context: FieldContext;
}

/** Build a labelled row containing the right editor for a field type. */
export function createFieldRow(opts: FieldEditorOptions): FieldEditor {
  const editor = createFieldEditor(opts);
  const label = el('label', { class: 'field-label', text: opts.label, title: opts.meta.description ?? '' });
  if (opts.meta.description) label.setAttribute('data-tip', opts.meta.description);
  const row = el('div', { class: `field-row field-${opts.meta.type}` }, label, editor.root);
  if (opts.meta.readonly) row.classList.add('readonly');
  return { root: row, update: editor.update };
}

/** Editor without the label. */
export function createFieldEditor(opts: FieldEditorOptions): FieldEditor {
  const { meta } = opts;
  switch (meta.type) {
    case 'number':
    case 'integer': return numberEditor(opts);
    case 'string': return stringEditor(opts);
    case 'boolean': return booleanEditor(opts);
    case 'vec2': return vectorEditor(opts, ['x', 'y']);
    case 'vec3': return vectorEditor(opts, ['x', 'y', 'z']);
    case 'quat': return quatEditor(opts);
    case 'color': return colorEditor(opts);
    case 'rect': return vectorEditor(opts, ['x', 'y', 'width', 'height'], ['X', 'Y', 'W', 'H']);
    case 'enum': return enumEditor(opts);
    case 'asset': return assetEditor(opts);
    case 'entity': return entityEditor(opts);
    case 'json':
    default: return jsonEditor(opts);
  }
}

// ------------------------------------------------------------------ number

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10000) / 10000;
  return String(r);
}

interface NumberOpts { min?: number; max?: number; step?: number; integer?: boolean; readonly?: boolean; axis?: string }

/** Number input with drag-scrub (on the small handle), arrow keys and optional slider. */
export function numberInput(value: number, onChange: (v: number, live: boolean) => void, o: NumberOpts = {}): { root: HTMLElement; set(v: number, mixed?: boolean): void } {
  const input = el('input', { class: 'num-input', attrs: { type: 'text', inputmode: 'decimal', 'aria-label': o.axis ?? 'value', spellcheck: 'false' } });
  input.readOnly = !!o.readonly;
  const handle = el('span', { class: `num-handle ${o.axis ? `axis-${o.axis.toLowerCase()}` : ''}`, text: o.axis ?? '', attrs: { 'aria-hidden': 'true' } });
  const root = el('div', { class: 'num-field' }, handle, input);
  let current = value;
  const step = o.step ?? (o.integer ? 1 : 0.1);
  const clamp = (v: number): number => {
    if (o.integer) v = Math.round(v);
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    return v;
  };
  const set = (v: number, mixed = false): void => {
    current = v;
    input.value = mixed ? '' : fmt(v);
    input.placeholder = mixed ? '—' : '';
    if (slider) slider.value = String(v);
  };
  const commit = (v: number, live: boolean): void => {
    if (!Number.isFinite(v)) { set(current); return; }
    v = clamp(v);
    current = v;
    input.value = fmt(v);
    if (slider) slider.value = String(v);
    onChange(v, live);
  };
  input.addEventListener('change', () => commit(evaluate(input.value, current), false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const k = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * step;
      commit(round(current + k, step), false);
    } else if (e.key === 'Enter') input.blur();
  });
  input.addEventListener('focus', () => input.select());
  // Drag to scrub.
  if (!o.readonly) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX, startV = current;
      let moved = false;
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 2) moved = true;
        if (!moved) return;
        const scale = (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1) * step;
        commit(round(startV + dx * scale * 0.5, step * (ev.altKey ? 0.1 : 1)), true);
      };
      const up = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        if (moved) onChange(current, false);
        else input.focus();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
  let slider: HTMLInputElement | null = null;
  if (o.min !== undefined && o.max !== undefined && Number.isFinite(o.min) && Number.isFinite(o.max) && !o.readonly) {
    slider = el('input', { class: 'num-slider', attrs: { type: 'range', min: String(o.min), max: String(o.max), step: String(o.integer ? 1 : Math.min(step, (o.max - o.min) / 200)), 'aria-label': 'slider' } });
    slider.value = String(value);
    slider.addEventListener('input', () => commit(Number(slider!.value), true));
    slider.addEventListener('change', () => onChange(current, false));
    root.appendChild(slider);
    root.classList.add('has-slider');
  }
  set(value);
  return { root, set };
}

function round(v: number, step: number): number {
  const p = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + 1));
  return Number(v.toFixed(p));
}

/** Evaluate simple arithmetic typed into a number field (`2*3+1`, `+=`, `-=`). */
function evaluate(text: string, current: number): number {
  const t = text.trim();
  if (!t) return current;
  const rel = /^([+\-*/])=\s*(.+)$/.exec(t);
  const expr = rel ? `${current}${rel[1]}(${rel[2]})` : t;
  if (!/^[\d\s+\-*/().e]+$/i.test(expr)) return Number(expr);
  try { return Number(new Function(`return (${expr})`)()); } catch { return NaN; }
}

function numberEditor(opts: FieldEditorOptions): FieldEditor {
  const m = opts.meta;
  const n = numberInput(Number(opts.value ?? 0), (v, live) => opts.onChange(v, live), { min: m.min, max: m.max, step: m.step, integer: m.type === 'integer', readonly: m.readonly });
  if (opts.mixed) n.set(Number(opts.value ?? 0), true);
  return { root: n.root, update: (v, mixed) => n.set(Number(v ?? 0), mixed) };
}

// --------------------------------------------------------- string / bool

function stringEditor(opts: FieldEditorOptions): FieldEditor {
  const input = el('input', { class: 'text-input', attrs: { type: 'text', 'aria-label': opts.label, spellcheck: 'false' } });
  input.readOnly = !!opts.meta.readonly;
  const set = (v: unknown, mixed?: boolean): void => { input.value = mixed ? '' : String(v ?? ''); input.placeholder = mixed ? '— mixed —' : ''; };
  set(opts.value, opts.mixed);
  input.addEventListener('change', () => opts.onChange(input.value, false));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return { root: input, update: set };
}

function booleanEditor(opts: FieldEditorOptions): FieldEditor {
  const input = el('input', { class: 'check-input', attrs: { type: 'checkbox', 'aria-label': opts.label } });
  input.disabled = !!opts.meta.readonly;
  const set = (v: unknown, mixed?: boolean): void => { input.checked = !!v; input.indeterminate = !!mixed; };
  set(opts.value, opts.mixed);
  input.addEventListener('change', () => opts.onChange(input.checked, false));
  return { root: el('div', { class: 'check-wrap' }, input), update: set };
}

// -------------------------------------------------------------- vectors

function vectorEditor(opts: FieldEditorOptions, keys: string[], labels = keys.map((k) => k.toUpperCase())): FieldEditor {
  const root = el('div', { class: `vec-field vec-${keys.length}` });
  const value: Record<string, number> = {};
  const read = (v: unknown): void => { const o = (v ?? {}) as Record<string, number>; for (const k of keys) value[k] = Number(o[k] ?? 0); };
  read(opts.value);
  const inputs = keys.map((k, i) => numberInput(value[k], (v, live) => { value[k] = v; opts.onChange({ ...value }, live); }, { step: opts.meta.step ?? 0.1, axis: labels[i], readonly: opts.meta.readonly }));
  for (const n of inputs) root.appendChild(n.root);
  if (opts.mixed) inputs.forEach((n, i) => n.set(value[keys[i]], true));
  return { root, update: (v, mixed) => { read(v); inputs.forEach((n, i) => n.set(value[keys[i]], mixed)); } };
}

function quatEditor(opts: FieldEditorOptions): FieldEditor {
  const q = new Quat();
  const euler = new Vec3();
  const toDeg = (v: unknown): void => {
    const o = (v ?? { x: 0, y: 0, z: 0, w: 1 }) as { x: number; y: number; z: number; w: number };
    q.set(o.x ?? 0, o.y ?? 0, o.z ?? 0, o.w ?? 1).toEuler(euler);
    euler.scale(180 / Math.PI);
  };
  toDeg(opts.value);
  const emit = (live: boolean): void => {
    const r = Math.PI / 180;
    const out = opts.context.is3d ? Quat.fromEuler(euler.x * r, euler.y * r, euler.z * r) : Quat.fromAngle2D(euler.z * r);
    opts.onChange(out.toJSON(), live);
  };
  const root = el('div', { class: `vec-field vec-${opts.context.is3d ? 3 : 1}` });
  const keys: ('x' | 'y' | 'z')[] = opts.context.is3d ? ['x', 'y', 'z'] : ['z'];
  const inputs = keys.map((k) => numberInput(euler[k], (v, live) => { euler[k] = v; emit(live); }, { step: 1, axis: opts.context.is3d ? k.toUpperCase() : '°', readonly: opts.meta.readonly }));
  for (const n of inputs) root.appendChild(n.root);
  return { root, update: (v, mixed) => { toDeg(v); inputs.forEach((n, i) => n.set(round(euler[keys[i]], 0.01), mixed)); } };
}

// ---------------------------------------------------------------- color

function colorEditor(opts: FieldEditorOptions): FieldEditor {
  const c = new Color();
  const read = (v: unknown): void => { const o = (v ?? {}) as Partial<Color>; c.set(o.r ?? 1, o.g ?? 1, o.b ?? 1, o.a ?? 1); };
  read(opts.value);
  const picker = el('input', { class: 'color-input', attrs: { type: 'color', 'aria-label': `${opts.label} color` } });
  const swatch = el('span', { class: 'color-swatch' });
  const hex = el('input', { class: 'text-input color-hex', attrs: { type: 'text', 'aria-label': `${opts.label} hex`, spellcheck: 'false' } });
  const alpha = numberInput(c.a, (v, live) => { c.a = v; sync(); opts.onChange(c.toJSON(), live); }, { min: 0, max: 1, step: 0.01, axis: 'A' });
  const sync = (): void => {
    const h = c.toHex(false);
    picker.value = h;
    hex.value = c.a < 1 ? c.toHex(true) : h;
    swatch.style.background = c.toCSS();
  };
  picker.addEventListener('input', () => { const a = c.a; c.setHex(picker.value); c.a = a; sync(); opts.onChange(c.toJSON(), true); });
  picker.addEventListener('change', () => opts.onChange(c.toJSON(), false));
  hex.addEventListener('change', () => { try { const a = c.a; c.setHex(hex.value); if (!/^#?[0-9a-f]{8}$/i.test(hex.value)) c.a = a; sync(); opts.onChange(c.toJSON(), false); } catch { sync(); } });
  const wrap = el('label', { class: 'color-wrap' }, swatch, picker);
  const root = el('div', { class: 'color-field' }, wrap, hex, alpha.root);
  sync();
  return { root, update: (v) => { read(v); sync(); alpha.set(c.a); } };
}

// ----------------------------------------------------------------- enum

function enumEditor(opts: FieldEditorOptions): FieldEditor {
  const select = el('select', { class: 'select-input', attrs: { 'aria-label': opts.label } });
  const options = opts.meta.options ?? [];
  for (const o of options) select.appendChild(el('option', { text: o, attrs: { value: o } }));
  const set = (v: unknown, mixed?: boolean): void => {
    if (mixed) { if (!select.querySelector('option[value="__mixed"]')) select.prepend(el('option', { text: '— mixed —', attrs: { value: '__mixed' } })); select.value = '__mixed'; }
    else { select.querySelector('option[value="__mixed"]')?.remove(); select.value = String(v ?? options[0] ?? ''); }
  };
  set(opts.value, opts.mixed);
  select.disabled = !!opts.meta.readonly;
  select.addEventListener('change', () => { if (select.value !== '__mixed') opts.onChange(select.value, false); });
  return { root: select, update: set };
}

// ---------------------------------------------------------------- asset

function assetEditor(opts: FieldEditorOptions): FieldEditor {
  const kind = opts.meta.assetKind && opts.meta.assetKind !== 'any' ? opts.meta.assetKind : undefined;
  const select = el('select', { class: 'select-input', attrs: { 'aria-label': opts.label } });
  const thumb = el('span', { class: 'asset-thumb-mini' });
  const root = el('div', { class: 'asset-field' }, thumb, select);
  const rebuild = (current: string): void => {
    select.textContent = '';
    select.appendChild(el('option', { text: '(none)', attrs: { value: '' } }));
    const list = opts.context.assets(kind);
    // Atlases are valid textures too.
    const extra = kind === 'image' ? opts.context.assets('atlas') : [];
    for (const a of [...list, ...extra]) select.appendChild(el('option', { text: `${a.id}${a.kind !== kind ? ` (${a.kind})` : ''}`, attrs: { value: a.id } }));
    if (current && !Array.from(select.options).some((o) => o.value === current)) select.appendChild(el('option', { text: `${current} (missing)`, attrs: { value: current } }));
    select.value = current;
    const asset = [...list, ...extra].find((a) => a.id === current);
    thumb.style.backgroundImage = asset && asset.kind === 'image' ? `url("${asset.url}")` : '';
    thumb.textContent = asset && asset.kind !== 'image' ? (asset.kind === 'audio' ? '♫' : asset.kind === 'atlas' ? '▦' : '{}') : '';
  };
  rebuild(String(opts.value ?? ''));
  select.addEventListener('focus', () => rebuild(select.value));
  select.addEventListener('change', () => { opts.onChange(select.value, false); rebuild(select.value); });
  root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-forge-asset')) { e.preventDefault(); root.classList.add('drop'); } });
  root.addEventListener('dragleave', () => root.classList.remove('drop'));
  root.addEventListener('drop', (e) => {
    root.classList.remove('drop');
    const raw = e.dataTransfer?.getData('application/x-forge-asset');
    if (!raw) return;
    e.preventDefault();
    const { id } = JSON.parse(raw) as { id: string };
    rebuild(id);
    opts.onChange(id, false);
  });
  return { root, update: (v) => rebuild(String(v ?? '')) };
}

// --------------------------------------------------------------- entity

function entityEditor(opts: FieldEditorOptions): FieldEditor {
  const name = el('button', { class: 'entity-ref', attrs: { type: 'button', title: 'Reveal in hierarchy' } });
  const pick = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Pick entity', 'data-tip': 'Pick an entity in the hierarchy or viewport' } }, icon('cursor', 14));
  const clearBtn = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Clear reference', 'data-tip': 'Clear' } }, icon('close', 14));
  let current: unknown = opts.value ?? null;
  const set = (v: unknown, mixed?: boolean): void => {
    current = v ?? null;
    name.textContent = mixed ? '— mixed —' : current ? opts.context.refName(current) : '(none)';
    name.classList.toggle('empty', !current);
  };
  set(opts.value, opts.mixed);
  name.addEventListener('click', () => { if (current) opts.context.revealRef(current); });
  pick.addEventListener('click', async () => {
    pick.classList.add('active');
    const ref = await opts.context.pickEntity();
    pick.classList.remove('active');
    if (ref !== undefined) { set(ref); opts.onChange(ref, false); }
  });
  clearBtn.addEventListener('click', () => { set(null); opts.onChange(null, false); });
  return { root: el('div', { class: 'entity-field' }, name, pick, clearBtn), update: set };
}

// ----------------------------------------------------------------- json

function jsonEditor(opts: FieldEditorOptions): FieldEditor {
  const ta = el('textarea', { class: 'json-input', attrs: { rows: '2', 'aria-label': opts.label, spellcheck: 'false' } });
  const err = el('div', { class: 'field-error' });
  ta.readOnly = !!opts.meta.readonly;
  const set = (v: unknown, mixed?: boolean): void => {
    ta.value = mixed ? '' : JSON.stringify(v ?? null, null, Array.isArray(v) && (v as unknown[]).length < 12 ? 0 : 1);
    ta.placeholder = mixed ? '— mixed —' : 'null';
    ta.rows = Math.min(12, Math.max(1, ta.value.split('\n').length));
    err.textContent = '';
  };
  set(opts.value, opts.mixed);
  const commit = (): void => {
    try { const v = ta.value.trim() ? JSON.parse(ta.value) : null; err.textContent = ''; opts.onChange(v, false); }
    catch (e) { err.textContent = `Invalid JSON: ${(e as Error).message}`; }
  };
  ta.addEventListener('change', commit);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } });
  ta.addEventListener('input', () => { ta.rows = Math.min(12, Math.max(1, ta.value.split('\n').length)); });
  return { root: el('div', { class: 'json-field' }, ta, err), update: set };
}
