import type { AxisBinding } from '../../input/Input';
import type { EditorContext } from '../app/EditorContext';
import { ProjectCommand, SettingsCommand } from '../commands/ProjectCommands';
import { numberInput } from '../inspector/fields';
import { el, icon } from '../ui/dom';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { showMenu } from '../ui/Menu';
import { toast } from '../ui/Toast';

const GAMEPAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'DpadUp', 'DpadDown', 'DpadLeft', 'DpadRight', 'Home'];

/** Bottom tab: project settings form, scenes list and input bindings editor. */
export class SettingsPanel {
  readonly root = el('div', { class: 'settings', attrs: { 'data-tour': 'settings' } });
  private raf = 0;

  constructor(private readonly ctx: EditorContext) {
    ctx.project.events.on('settingsChanged', () => this.schedule());
    ctx.project.events.on('scenesChanged', () => this.schedule());
    ctx.project.events.on('sceneSwitched', () => this.schedule());
    ctx.project.events.on('opened', () => this.schedule());
    ctx.project.events.on('originChanged', () => this.schedule());
    this.render();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  private set(path: string, value: unknown, live = false): void {
    if (!live) this.ctx.commands.breakMerge();
    this.ctx.commands.push(new SettingsCommand(this.ctx.project, path, value), { merge: live });
  }

  private get<T>(path: string): T { return this.ctx.project.getPath(path) as T; }

  private textField(label: string, path: string, opts: { multiline?: boolean; placeholder?: string } = {}): HTMLElement {
    const v = String(this.get<string>(path) ?? '');
    const input = opts.multiline ? el('textarea', { class: 'text-input', attrs: { rows: '2', 'aria-label': label, placeholder: opts.placeholder ?? '' } }) : el('input', { class: 'text-input', attrs: { type: 'text', 'aria-label': label, placeholder: opts.placeholder ?? '' } });
    input.value = v;
    input.addEventListener('change', () => this.set(path, input.value));
    return el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: label }), input);
  }

  private numField(label: string, path: string, o: { min?: number; max?: number; step?: number; integer?: boolean } = {}): HTMLElement {
    const n = numberInput(Number(this.get<number>(path) ?? 0), (v, live) => this.set(path, v, live), o);
    return el('div', { class: 'field-row' }, el('span', { class: 'field-label', text: label }), n.root);
  }

  private boolField(label: string, path: string, help?: string): HTMLElement {
    const input = el('input', { class: 'check-input', attrs: { type: 'checkbox', 'aria-label': label } });
    input.checked = !!this.get<boolean>(path);
    input.addEventListener('change', () => this.set(path, input.checked));
    return el('label', { class: 'field-row', title: help ?? '' }, el('span', { class: 'field-label', text: label }), el('div', { class: 'check-wrap' }, input));
  }

  private enumField(label: string, path: string, options: string[], help?: string): HTMLElement {
    const select = el('select', { class: 'select-input', attrs: { 'aria-label': label } }, ...options.map((o) => el('option', { text: o, attrs: { value: o } })));
    select.value = String(this.get<string>(path));
    select.addEventListener('change', () => this.set(path, select.value));
    return el('label', { class: 'field-row', title: help ?? '' }, el('span', { class: 'field-label', text: label }), select);
  }

  private section(title: string, ...children: HTMLElement[]): HTMLElement {
    return el('section', { class: 'settings-section' }, el('h3', { text: title }), ...children);
  }

  render(): void {
    const { project } = this.ctx;
    const p = project.project;
    this.root.textContent = '';
    const origin = project.origin;
    if (origin === 'template') this.root.appendChild(el('div', { class: 'inspector-warning' }, icon('info', 14), el('span', { text: 'This project is a template: changes are not saved until you use File › Save as my project.' })));
    const grid = el('div', { class: 'settings-grid' });
    grid.append(
      this.section('General',
        this.textField('Name', 'name'),
        this.textField('Description', 'description', { multiline: true }),
        this.textField('Author', 'author'),
        this.textField('Version', 'projectVersion'),
        el('div', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Id' }), el('code', { class: 'dim small', text: p.id })),
      ),
      this.section('Renderer',
        el('div', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Mode' }), el('span', {}, el('strong', { text: p.settings.renderer.toUpperCase() }), el('span', { class: 'dim small', text: ' · set when the project is created' }))),
        this.numField('Pixels per unit', 'settings.pixelsPerUnit', { min: 1, max: 512, integer: true }),
        this.boolField('Pixel perfect', 'settings.pixelPerfect', 'Snap sprites to whole pixels (pixel art).'),
        this.numField('Fixed rate (Hz)', 'settings.fixedRate', { min: 10, max: 240, integer: true }),
        this.numField('Viewport width', 'settings.viewport.width', { min: 64, max: 8192, integer: true }),
        this.numField('Viewport height', 'settings.viewport.height', { min: 64, max: 8192, integer: true }),
      ),
      this.section('Physics',
        this.numField('Gravity X', 'settings.physics.gravity.x', { step: 0.5 }),
        this.numField('Gravity Y', 'settings.physics.gravity.y', { step: 0.5 }),
        this.numField('Gravity 3D X', 'settings.physics.gravity3d.x', { step: 0.5 }),
        this.numField('Gravity 3D Y', 'settings.physics.gravity3d.y', { step: 0.5 }),
        this.numField('Gravity 3D Z', 'settings.physics.gravity3d.z', { step: 0.5 }),
      ),
      this.section('Network',
        this.enumField('Mode', 'settings.network.mode', ['none', 'host-authoritative', 'lockstep'], 'none disables multiplayer for this project.'),
        this.numField('Max players', 'settings.network.maxPlayers', { min: 1, max: 64, integer: true }),
        this.numField('Tick rate', 'settings.network.tickRate', { min: 1, max: 120, integer: true }),
        this.boolField('Shared control', 'settings.multiUser.sharedControl', 'Several players may control the same entity.'),
        this.enumField('Merge strategy', 'settings.multiUser.mergeStrategy', ['first-wins', 'average', 'additive']),
      ),
      this.section('Touch',
        this.boolField('Touch controls', 'settings.touchControls'),
        (() => {
          const input = el('input', { class: 'text-input', attrs: { type: 'text', 'aria-label': 'Touch buttons' } });
          input.value = (p.settings.touchButtons ?? []).join(', ');
          input.addEventListener('change', () => this.set('settings.touchButtons', input.value.split(',').map((s) => s.trim()).filter(Boolean)));
          return el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Touch buttons' }), input);
        })(),
      ),
      this.scenesSection(),
    );
    this.root.appendChild(grid);
    this.root.appendChild(this.inputSection());
  }

  // ------------------------------------------------------------------ scenes

  private scenesSection(): HTMLElement {
    const { project, commands } = this.ctx;
    const p = project.project;
    const list = el('div', { class: 'scene-list' });
    for (const s of p.scenes) {
      const isStart = p.startScene === s.name;
      const isCurrent = project.currentSceneName === s.name;
      const row = el('div', { class: `scene-row ${isCurrent ? 'active' : ''}` },
        el('button', { class: 'scene-open', text: s.name, attrs: { type: 'button', title: 'Open scene' }, on: { click: () => project.switchScene(s.name) } }),
        el('span', { class: 'dim small', text: `${s.entities.length} entities${isCurrent ? ' · open' : ''}` }),
        el('span', { class: 'spacer' }),
        el('button', { class: `small ${isStart ? 'primary' : 'ghost'}`, text: isStart ? 'Start scene' : 'Set as start', attrs: { type: 'button' }, on: { click: () => { if (!isStart) commands.push(new ProjectCommand(`Start scene ${s.name}`, project, { kind: 'start-scene', name: s.name }, { kind: 'start-scene', name: p.startScene })); } } }),
      );
      const more = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `${s.name} options` } }, icon('more', 14));
      more.addEventListener('click', () => showMenu([
        { label: 'Rename…', onClick: () => void this.renameScene(s.name) },
        { label: 'Duplicate', onClick: () => { const copy = structuredClone(s); copy.name = project.uniqueSceneName(`${s.name} copy`); commands.push(new ProjectCommand(`Duplicate scene`, project, { kind: 'scene-add', scene: copy }, { kind: 'scene-remove', name: copy.name })); } },
        { separator: true },
        { label: 'Delete', danger: true, disabled: p.scenes.length <= 1, onClick: () => void this.deleteScene(s.name) },
      ], more, { align: 'right' }));
      row.appendChild(more);
      list.appendChild(row);
    }
    const add = el('button', { class: 'small', attrs: { type: 'button' } }, icon('plus', 14), el('span', { text: 'New scene' }));
    add.addEventListener('click', () => void this.addScene());
    return this.section('Scenes', list, add);
  }

  async addScene(): Promise<void> {
    const { project, commands } = this.ctx;
    const name = await promptDialog('New scene', 'Scene name', project.uniqueSceneName('Scene'), { validate: (v) => (!v ? 'Required' : project.project.scenes.some((s) => s.name === v) ? 'Name already used' : null) });
    if (!name) return;
    const scene = project.makeScene(name);
    commands.push(new ProjectCommand(`Add scene ${name}`, project, { kind: 'scene-add', scene }, { kind: 'scene-remove', name }));
    project.switchScene(name);
  }

  async renameScene(from: string): Promise<void> {
    const { project, commands } = this.ctx;
    const to = await promptDialog('Rename scene', 'Scene name', from, { validate: (v) => (!v ? 'Required' : v !== from && project.project.scenes.some((s) => s.name === v) ? 'Name already used' : null) });
    if (!to || to === from) return;
    commands.push(new ProjectCommand(`Rename scene ${from}`, project, { kind: 'scene-rename', from, to }, { kind: 'scene-rename', from: to, to: from }));
  }

  async deleteScene(name: string): Promise<void> {
    const { project, commands } = this.ctx;
    if (project.project.scenes.length <= 1) { toast('A project needs at least one scene', 'warn'); return; }
    const ok = await confirmDialog('Delete scene', `Delete scene "${name}"? This can be undone.`, { okLabel: 'Delete', danger: true });
    if (!ok) return;
    if (project.currentSceneName === name) project.syncScene();
    const scene = project.project.scenes.find((s) => s.name === name)!;
    commands.push(new ProjectCommand(`Delete scene ${name}`, project, { kind: 'scene-remove', name }, { kind: 'scene-add', scene }));
  }

  // ------------------------------------------------------------------- input

  private inputSection(): HTMLElement {
    const p = this.ctx.project.project;
    const actions = el('div', { class: 'bindings' });
    for (const [name, bindings] of Object.entries(p.settings.input.actions)) {
      const chips = el('div', { class: 'chips' });
      for (const b of bindings) {
        chips.appendChild(el('span', { class: 'chip' }, el('span', { text: b }), el('button', { class: 'chip-x', attrs: { type: 'button', 'aria-label': `Remove ${b}` }, on: { click: () => this.set(`settings.input.actions.${name}`, bindings.filter((x) => x !== b)) } }, icon('close', 10))));
      }
      const add = el('button', { class: 'small ghost', attrs: { type: 'button', 'data-tip': 'Capture a key, mouse button or pick a gamepad button' } }, icon('keyboard', 14), el('span', { text: 'Add binding' }));
      add.addEventListener('click', () => this.captureBinding(add, (b) => { if (!bindings.includes(b)) this.set(`settings.input.actions.${name}`, [...bindings, b]); }));
      const del = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `Delete action ${name}` } }, icon('trash', 14));
      del.addEventListener('click', () => { const next = { ...p.settings.input.actions }; delete next[name]; this.set('settings.input.actions', next); });
      actions.appendChild(el('div', { class: 'binding-row' }, el('code', { class: 'binding-name', text: name }), chips, add, del));
    }
    const addAction = el('button', { class: 'small', attrs: { type: 'button' } }, icon('plus', 14), el('span', { text: 'New action' }));
    addAction.addEventListener('click', async () => {
      const name = await promptDialog('New input action', 'Action name', '', { validate: (v) => (!/^\w+$/.test(v) ? 'Letters, digits, underscore' : p.settings.input.actions[v] ? 'Exists' : null) });
      if (name) this.set('settings.input.actions', { ...p.settings.input.actions, [name]: [] });
    });

    const axes = el('div', { class: 'bindings' });
    for (const [name, axis] of Object.entries(p.settings.input.axes)) {
      const side = (label: string, key: 'negative' | 'positive'): HTMLElement => {
        const chips = el('div', { class: 'chips' }, el('span', { class: 'dim small', text: label }));
        for (const b of axis[key] ?? []) chips.appendChild(el('span', { class: 'chip' }, el('span', { text: b }), el('button', { class: 'chip-x', attrs: { type: 'button', 'aria-label': `Remove ${b}` }, on: { click: () => this.set(`settings.input.axes.${name}.${key}`, (axis[key] ?? []).filter((x) => x !== b)) } }, icon('close', 10))));
        const add = el('button', { class: 'chip-add', attrs: { type: 'button', 'aria-label': `Add ${label} binding` } }, icon('plus', 10));
        add.addEventListener('click', () => this.captureBinding(add, (b) => this.set(`settings.input.axes.${name}.${key}`, [...(axis[key] ?? []), b])));
        chips.appendChild(add);
        return chips;
      };
      const gp = el('select', { class: 'select-input small', attrs: { 'aria-label': 'Gamepad axis' } }, el('option', { text: 'no stick', attrs: { value: '' } }), ...['0', '1', '2', '3'].map((i) => el('option', { text: `stick axis ${i}`, attrs: { value: i } })));
      gp.value = axis.gamepadAxis === undefined ? '' : String(axis.gamepadAxis);
      gp.addEventListener('change', () => this.set(`settings.input.axes.${name}.gamepadAxis`, gp.value === '' ? undefined : Number(gp.value)));
      const inv = el('input', { class: 'check-input', attrs: { type: 'checkbox', 'aria-label': 'Invert gamepad' } });
      inv.checked = !!axis.invertGamepad;
      inv.addEventListener('change', () => this.set(`settings.input.axes.${name}.invertGamepad`, inv.checked));
      const joy = el('select', { class: 'select-input small', attrs: { 'aria-label': 'Touch joystick axis' } }, el('option', { text: 'no touch', attrs: { value: '' } }), el('option', { text: 'joystick x', attrs: { value: 'x' } }), el('option', { text: 'joystick y', attrs: { value: 'y' } }));
      joy.value = axis.touchJoystick ?? '';
      joy.addEventListener('change', () => this.set(`settings.input.axes.${name}.touchJoystick`, joy.value || undefined));
      const del = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `Delete axis ${name}` } }, icon('trash', 14));
      del.addEventListener('click', () => { const next = { ...p.settings.input.axes }; delete next[name]; this.set('settings.input.axes', next); });
      axes.appendChild(el('div', { class: 'binding-row axis-row' }, el('code', { class: 'binding-name', text: name }), side('−', 'negative'), side('+', 'positive'), gp, el('label', { class: 'small dim' }, inv, ' invert'), joy, del));
    }
    const addAxis = el('button', { class: 'small', attrs: { type: 'button' } }, icon('plus', 14), el('span', { text: 'New axis' }));
    addAxis.addEventListener('click', async () => {
      const name = await promptDialog('New input axis', 'Axis name', '', { validate: (v) => (!/^\w+$/.test(v) ? 'Letters, digits, underscore' : p.settings.input.axes[v] ? 'Exists' : null) });
      if (name) this.set('settings.input.axes', { ...p.settings.input.axes, [name]: { negative: [], positive: [] } as AxisBinding });
    });
    return this.section('Input',
      el('p', { class: 'dim small', text: 'Actions are buttons (jump, fire); axes combine negative/positive keys, a gamepad stick and the touch joystick. Scripts read them through ctx.input or the PlayerInput snapshot.' }),
      el('h4', { text: 'Actions' }), actions, addAction,
      el('h4', { text: 'Axes' }), axes, addAxis,
    );
  }

  /** Capture the next key/mouse press (or choose a gamepad/touch binding). */
  private captureBinding(anchor: HTMLElement, done: (binding: string) => void): void {
    const overlay = el('div', { class: 'capture-overlay', attrs: { role: 'dialog', 'aria-label': 'Press a key', tabindex: '0' } },
      el('div', { class: 'capture-box' }, icon('keyboard', 28), el('h3', { text: 'Press a key or mouse button' }), el('p', { class: 'dim', text: 'Escape cancels. Or pick a gamepad / touch binding:' }),
        el('div', { class: 'chips' }, ...GAMEPAD_BUTTONS.map((b) => el('button', { class: 'chip', text: `Gamepad${b}`, attrs: { type: 'button' }, on: { click: (e) => { e.stopPropagation(); finish(`Gamepad${b}`); } } }))),
        (() => { const i = el('input', { class: 'text-input', attrs: { type: 'text', placeholder: 'Touch:<name> or any code…', 'aria-label': 'Custom binding' } }); i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && i.value.trim()) finish(i.value.trim()); if (e.key === 'Escape') finish(null); }); return i; })(),
      ));
    let closed = false;
    const finish = (b: string | null): void => {
      if (closed) return;
      closed = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouse, true);
      if (b) done(b);
      anchor.focus();
    };
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      e.preventDefault(); e.stopPropagation();
      finish(e.key === 'Escape' ? null : e.code);
    };
    const onMouse = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest('.chip, input')) return;
      e.preventDefault(); e.stopPropagation();
      finish(e.button === 0 ? 'MouseLeft' : e.button === 1 ? 'MouseMiddle' : e.button === 2 ? 'MouseRight' : `Mouse${e.button}`);
    };
    document.body.appendChild(overlay);
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    setTimeout(() => { document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onMouse, true); overlay.focus(); });
  }
}
