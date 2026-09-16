import type { EditorContext } from '../app/EditorContext';
import { ScriptSourceCommand } from '../commands/ProjectCommands';
import { parseApi, searchApi } from '../scripts/apiDocs';
import { CodeEditor } from '../scripts/CodeEditor';
import { SCRIPT_TEMPLATES } from '../scripts/templates';
import { el, icon, storage } from '../ui/dom';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { contextMenu, showMenu } from '../ui/Menu';
import { toast } from '../ui/Toast';

/**
 * Bottom tab: script file list, CodeMirror editor with compile-on-save,
 * inline diagnostics, API completions and a searchable docs sidebar.
 */
export class ScriptsPanel {
  readonly root = el('div', { class: 'scripts', attrs: { 'data-tour': 'scripts' } });
  private list = el('div', { class: 'script-list', attrs: { role: 'listbox', 'aria-label': 'Scripts' } });
  private editorHost = el('div', { class: 'script-editor-host' });
  private docs = el('aside', { class: 'script-docs' });
  private status = el('div', { class: 'script-status' });
  private banner = el('div', { class: 'script-banner', attrs: { hidden: 'true', role: 'alert' } });
  private nameLabel = el('span', { class: 'script-name' });
  private editor: CodeEditor;
  private current: string | null = null;
  /** Unsaved text per script. */
  private drafts = new Map<string, string>();
  private lastLocalEdit = 0;
  private docsOpen = storage.get('forge.editor.docsOpen', true);

  constructor(private readonly ctx: EditorContext) {
    const newBtn = el('button', { class: 'small', attrs: { type: 'button', 'data-tip': 'New script from a template' } }, icon('plus', 14), el('span', { text: 'New' }));
    newBtn.addEventListener('click', () => showMenu(SCRIPT_TEMPLATES.map((t) => ({ label: t.label, onClick: () => this.create(t.id) })), newBtn));
    const listWrap = el('div', { class: 'script-list-wrap' }, el('div', { class: 'panel-toolbar' }, el('span', { class: 'panel-title', text: 'Scripts' }), el('span', { class: 'spacer' }), newBtn), this.list);
    const saveBtn = el('button', { class: 'small primary', attrs: { type: 'button', 'data-tip': 'Compile and save (Ctrl+S)' } }, icon('save', 14), el('span', { text: 'Save' }));
    saveBtn.addEventListener('click', () => this.save());
    const renameBtn = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Rename script', 'data-tip': 'Rename' } }, icon('type', 14));
    renameBtn.addEventListener('click', () => this.rename());
    const deleteBtn = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Delete script', 'data-tip': 'Delete' } }, icon('trash', 14));
    deleteBtn.addEventListener('click', () => this.remove());
    const docsBtn = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Toggle API docs', 'data-tip': 'API reference', 'aria-pressed': String(this.docsOpen) } }, icon('help', 14));
    docsBtn.addEventListener('click', () => { this.docsOpen = !this.docsOpen; storage.set('forge.editor.docsOpen', this.docsOpen); this.docs.hidden = !this.docsOpen; docsBtn.setAttribute('aria-pressed', String(this.docsOpen)); });
    const bar = el('div', { class: 'panel-toolbar' }, this.nameLabel, el('span', { class: 'spacer' }), saveBtn, renameBtn, deleteBtn, docsBtn);
    const main = el('div', { class: 'script-main' }, bar, this.banner, this.editorHost, this.status);
    this.root.append(listWrap, main, this.docs);
    this.docs.hidden = !this.docsOpen;
    this.editor = new CodeEditor(this.editorHost, {
      onChange: (src) => { if (this.current) { this.drafts.set(this.current, src); this.lastLocalEdit = Date.now(); this.renderList(); this.updateStatus(); } },
      onSave: () => this.save(),
      propsProvider: () => this.propNames(),
    });
    this.buildDocs();
    ctx.project.events.on('scriptsChanged', () => { this.renderList(); this.syncFromProject(); });
    ctx.project.events.on('opened', () => { this.drafts.clear(); this.current = null; this.renderList(); this.open(ctx.project.project.scripts[0]?.name ?? null); });
    ctx.project.events.on('scriptCompiled', ({ name, error }) => { if (name === this.current) this.showCompileResult(error); });
    contextMenu(this.list, (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>('.script-row');
      if (!row) return null;
      const name = row.dataset.name!;
      return [
        { label: 'Open', onClick: () => this.open(name) },
        { label: 'Rename', onClick: () => { this.open(name); void this.rename(); } },
        { label: 'Duplicate', onClick: () => this.duplicate(name) },
        { separator: true },
        { label: 'Delete', danger: true, onClick: () => { this.open(name); void this.remove(); } },
      ];
    });
    this.renderList();
    this.open(ctx.project.project.scripts[0]?.name ?? null);
  }

  private propNames(): string[] {
    const src = this.editor.source;
    const m = /props\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(src);
    if (!m) return [];
    return Array.from(m[1].matchAll(/^\s*(\w+)\s*:/gm)).map((x) => x[1]);
  }

  // ------------------------------------------------------------------ list

  private renderList(): void {
    this.list.textContent = '';
    const scripts = this.ctx.project.project.scripts;
    if (!scripts.length) { this.list.appendChild(el('div', { class: 'panel-empty small dim', text: 'No scripts yet. Click New to start from a template.' })); return; }
    for (const s of scripts) {
      const dirty = this.drafts.has(s.name) && this.drafts.get(s.name) !== s.source;
      const compiled = this.ctx.engine.scripting.definitions.has(s.name);
      const row = el('div', { class: `script-row ${s.name === this.current ? 'active' : ''}`, attrs: { role: 'option', 'aria-selected': String(s.name === this.current), tabindex: '0', 'data-name': s.name } },
        icon('code', 14), el('span', { class: 'script-row-name', text: s.name }),
        dirty ? el('span', { class: 'dirty-dot', title: 'Unsaved changes' }) : null,
        !compiled ? el('span', { class: 'script-err', title: 'Compile error' }, icon('error', 12)) : null,
      );
      row.addEventListener('click', () => this.open(s.name));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.open(s.name); });
      this.list.appendChild(row);
    }
  }

  open(name: string | null): void {
    if (this.current && name !== this.current) this.drafts.set(this.current, this.editor.source);
    this.current = name;
    this.banner.hidden = true;
    const s = name ? this.ctx.project.script(name) : undefined;
    if (!s) {
      this.editor.setSource('');
      this.editor.setReadOnly(true);
      this.nameLabel.textContent = 'No script selected';
      this.updateStatus();
      this.renderList();
      return;
    }
    this.editor.setReadOnly(false);
    this.editor.setSource(this.drafts.get(name!) ?? s.source);
    this.nameLabel.textContent = name;
    const compiled = this.ctx.engine.scripting.definitions.has(name!);
    if (!compiled) this.showCompileResult(this.ctx.project.compile(name!, s.source));
    else this.editor.setProblems([]);
    this.updateStatus();
    this.renderList();
  }

  /** Show a script (switching to the Scripts tab is done by the shell). */
  reveal(name: string): void { this.open(name); this.editor.focus(); }

  /** Called when the project doc changed under us (remote edit, undo). */
  private syncFromProject(): void {
    if (!this.current) { this.open(this.ctx.project.project.scripts[0]?.name ?? null); return; }
    const s = this.ctx.project.script(this.current);
    if (!s) { this.drafts.delete(this.current); this.open(this.ctx.project.project.scripts[0]?.name ?? null); return; }
    const draft = this.drafts.get(this.current);
    if (draft !== undefined && draft !== s.source && Date.now() - this.lastLocalEdit < 2000) {
      this.showConflict(s.source);
      return;
    }
    if (this.editor.source !== s.source) { this.drafts.delete(this.current); this.editor.setSource(s.source); }
    this.updateStatus();
  }

  /** Conflict banner when a collaborator changed the script we are editing. */
  showConflict(remoteSource: string): void {
    const name = this.current!;
    this.banner.hidden = false;
    this.banner.className = 'script-banner warn';
    this.banner.textContent = '';
    this.banner.append(
      icon('warning', 14),
      el('span', { text: 'A collaborator saved this script while you were editing it.' }),
      el('button', { class: 'small', text: 'Keep mine', attrs: { type: 'button' }, on: { click: () => { this.banner.hidden = true; this.save(); } } }),
      el('button', { class: 'small', text: 'Take theirs', attrs: { type: 'button' }, on: { click: () => { this.banner.hidden = true; this.drafts.delete(name); this.editor.setSource(remoteSource); this.updateStatus(); } } }),
    );
  }

  private showCompileResult(error: string | null): void {
    if (!error) {
      this.editor.setProblems([]);
      this.banner.hidden = true;
      this.status.textContent = `Compiled ${this.current} · ${new Date().toLocaleTimeString([], { hour12: false })}`;
      this.status.className = 'script-status ok';
      return;
    }
    const line = /line\s+(\d+)/i.exec(error) ?? /:(\d+):\d+\)?$/m.exec(error);
    if (line) { const r = this.editor.lineRange(Number(line[1])); this.editor.setProblems([{ from: r.from, to: r.to, message: error }]); }
    else this.editor.setProblems([{ from: 0, to: 0, message: error }]);
    this.banner.hidden = false;
    this.banner.className = 'script-banner error';
    this.banner.textContent = '';
    this.banner.append(icon('error', 14), el('span', { text: error }));
    this.status.textContent = 'Compile failed';
    this.status.className = 'script-status err';
  }

  private updateStatus(): void {
    if (!this.current) { this.status.textContent = ''; return; }
    const s = this.ctx.project.script(this.current);
    const dirty = s && this.editor.source !== s.source;
    if (dirty) { this.status.textContent = 'Unsaved changes · Ctrl+S to compile and save'; this.status.className = 'script-status dirty'; }
    else if (!this.status.classList.contains('err')) { this.status.textContent = `${this.editor.source.split('\n').length} lines`; this.status.className = 'script-status'; }
  }

  // --------------------------------------------------------------- actions

  save(): void {
    if (!this.current) return;
    const s = this.ctx.project.script(this.current);
    if (!s) return;
    const src = this.editor.source;
    // Keep the definition name in sync with the file name.
    const nameMatch = /name\s*:\s*(['"`])([^'"`]+)\1/.exec(src);
    if (nameMatch && nameMatch[2] !== this.current) toast(`Script defines name "${nameMatch[2]}" but the file is "${this.current}"; the file name wins for Script components.`, 'warn', { duration: 5000 });
    if (src === s.source) { this.showCompileResult(this.ctx.project.compile(this.current, src)); return; }
    this.ctx.commands.push(new ScriptSourceCommand(this.ctx.project, this.current, s.source, src));
    this.drafts.delete(this.current);
    this.renderList();
    this.updateStatus();
  }

  hasUnsaved(): boolean {
    for (const [name, draft] of this.drafts) { const s = this.ctx.project.script(name); if (s && s.source !== draft) return true; }
    return false;
  }

  create(templateId: string): void {
    const tpl = SCRIPT_TEMPLATES.find((t) => t.id === templateId) ?? SCRIPT_TEMPLATES[0];
    const base = tpl.id === 'blank' ? 'NewScript' : tpl.label.replace(/\W+/g, '');
    const name = this.ctx.project.uniqueScriptName(base);
    const source = tpl.source(name);
    this.ctx.commands.push({ label: `New script ${name}`, execute: () => this.ctx.project.apply({ kind: 'script-add', name, source }), undo: () => this.ctx.project.apply({ kind: 'script-remove', name }) });
    this.open(name);
    this.editor.focus();
  }

  private duplicate(name: string): void {
    const s = this.ctx.project.script(name);
    if (!s) return;
    const copy = this.ctx.project.uniqueScriptName(`${name}Copy`);
    const source = s.source.replace(new RegExp(`name:\\s*(['"\`])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`), `name: $1${copy}$1`);
    this.ctx.commands.push({ label: `Duplicate ${name}`, execute: () => this.ctx.project.apply({ kind: 'script-add', name: copy, source }), undo: () => this.ctx.project.apply({ kind: 'script-remove', name: copy }) });
    this.open(copy);
  }

  private async rename(): Promise<void> {
    if (!this.current) return;
    const from = this.current;
    const to = await promptDialog('Rename script', 'New name', from, { validate: (v) => (!/^[A-Za-z_]\w*$/.test(v) ? 'Use letters, digits and underscores (start with a letter)' : v !== from && this.ctx.project.script(v) ? 'A script with that name exists' : null) });
    if (!to || to === from) return;
    const usages = this.ctx.scene.all().filter((e) => (this.ctx.engine.world.getComponent(e, 'Script') as unknown as { script: string } | undefined)?.script === from);
    this.ctx.commands.transaction(`Rename script ${from}`, () => {
      this.ctx.commands.push({ label: 'Rename script', execute: () => this.ctx.project.apply({ kind: 'script-rename', from, to }), undo: () => this.ctx.project.apply({ kind: 'script-rename', from: to, to: from }) });
      for (const e of usages) { const g = this.ctx.scene.guidOf(e); if (g) this.ctx.scene.setField(g, 'Script', 'script', to); }
    });
    this.drafts.delete(from);
    this.open(to);
  }

  private async remove(): Promise<void> {
    if (!this.current) return;
    const name = this.current;
    const s = this.ctx.project.script(name);
    if (!s) return;
    const usages = this.ctx.scene.all().filter((e) => (this.ctx.engine.world.getComponent(e, 'Script') as unknown as { script: string } | undefined)?.script === name).length;
    const ok = await confirmDialog('Delete script', `Delete "${name}"?${usages ? ` It is used by ${usages} entit${usages === 1 ? 'y' : 'ies'} in this scene.` : ''}`, { okLabel: 'Delete', danger: true });
    if (!ok) return;
    const source = s.source;
    this.ctx.commands.push({ label: `Delete script ${name}`, execute: () => this.ctx.project.apply({ kind: 'script-remove', name }), undo: () => this.ctx.project.apply({ kind: 'script-add', name, source }) });
    this.drafts.delete(name);
    this.open(this.ctx.project.project.scripts[0]?.name ?? null);
  }

  // ------------------------------------------------------------------ docs

  private buildDocs(): void {
    const search = el('input', { class: 'text-input search-input', attrs: { type: 'search', placeholder: 'Search API…', 'aria-label': 'Search scripting API' } });
    const body = el('div', { class: 'docs-body' });
    const render = (): void => {
      body.textContent = '';
      const q = search.value;
      const api = searchApi(q, parseApi());
      const order = ['ScriptDefinition', 'ScriptContext', 'Transform', 'InputSnapshot', 'MathNS'];
      api.sort((a, b) => (order.indexOf(a.name) === -1 ? 99 : order.indexOf(a.name)) - (order.indexOf(b.name) === -1 ? 99 : order.indexOf(b.name)));
      for (const iface of api) {
        const det = el('details', { attrs: q || iface.name === 'ScriptContext' ? { open: 'true' } : {} });
        det.appendChild(el('summary', {}, el('code', { text: iface.name }), iface.doc ? el('span', { class: 'dim small', text: ` ${iface.doc}` }) : null));
        for (const m of iface.members) {
          const row = el('div', { class: 'doc-member' }, el('code', { text: m.signature }), m.doc ? el('div', { class: 'dim small', text: m.doc }) : null);
          row.addEventListener('dblclick', () => { this.editor.view.dispatch(this.editor.view.state.replaceSelection(m.kind === 'method' ? `${m.name}(` : m.name)); this.editor.focus(); });
          det.appendChild(row);
        }
        body.appendChild(det);
      }
      if (!api.length) body.appendChild(el('div', { class: 'dim small', text: 'No matches' }));
    };
    search.addEventListener('input', render);
    this.docs.append(el('div', { class: 'panel-toolbar' }, el('span', { class: 'panel-title', text: 'API reference' })), search, body, el('div', { class: 'dim small docs-hint', text: 'Double-click a member to insert it. Scripts call defineScript({...}) once and receive ctx in every hook.' }));
    render();
  }
}
