import type { AssetManifestEntry } from '../../assets/types';
import type { EditorContext } from '../app/EditorContext';
import { ProjectCommand } from '../commands/ProjectCommands';
import { openAtlasEditor } from '../assets/AtlasEditor';
import { el, formatBytes, icon } from '../ui/dom';
import { confirmDialog, openDialog, promptDialog } from '../ui/Dialog';
import { contextMenu, showMenu, type MenuItem } from '../ui/Menu';
import { toast } from '../ui/Toast';
import { prefabToSnapshot } from './Hierarchy';
import { CreateEntityCommand } from '../commands/SceneCommands';

const WARN_BYTES = 1.5 * 1024 * 1024;
const HARD_BYTES = 8 * 1024 * 1024;

function kindOf(file: File): string | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/json' || file.name.endsWith('.json')) return 'json';
  if (/\.(glb|gltf)$/i.test(file.name)) return 'gltf';
  if (file.type.startsWith('text/') || /\.(txt|csv|md)$/i.test(file.name)) return 'text';
  return null;
}

/**
 * Bottom tab: project asset manifest (images, audio, JSON, atlases) with
 * upload, preview, atlas slicing, drag to viewport/hierarchy, plus prefabs.
 */
export class AssetsPanel {
  readonly root = el('div', { class: 'assets', attrs: { 'data-tour': 'assets' } });
  private grid = el('div', { class: 'asset-grid', attrs: { role: 'listbox', 'aria-label': 'Assets' } });
  private prefabList = el('div', { class: 'prefab-list' });
  private search = el('input', { class: 'text-input search-input', attrs: { type: 'search', placeholder: 'Search assets…', 'aria-label': 'Search assets' } });
  private kindFilter = el('select', { class: 'select-input', attrs: { 'aria-label': 'Filter by kind' } }, ...['all', 'image', 'atlas', 'audio', 'json', 'gltf', 'text'].map((k) => el('option', { text: k === 'all' ? 'All kinds' : k, attrs: { value: k } })));
  private selected: string | null = null;
  private fileInput = el('input', { attrs: { type: 'file', multiple: 'true', accept: 'image/*,audio/*,.json,.glb,.gltf,.txt', hidden: 'true' } });

  constructor(private readonly ctx: EditorContext) {
    const upload = el('button', { class: 'small primary', attrs: { type: 'button', 'data-tip': 'Upload images, audio or JSON (stored inside the project)' } }, icon('upload', 14), el('span', { text: 'Upload' }));
    upload.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => { if (this.fileInput.files) void this.addFiles(Array.from(this.fileInput.files)); this.fileInput.value = ''; });
    const bar = el('div', { class: 'panel-toolbar' }, upload, this.search, this.kindFilter, el('span', { class: 'spacer' }), el('span', { class: 'dim small asset-total' }));
    const prefabHead = el('div', { class: 'panel-toolbar' }, el('span', { class: 'panel-title', text: 'Prefabs' }), el('span', { class: 'dim small', text: 'Right-click an entity › Create prefab' }));
    this.root.append(bar, this.grid, prefabHead, this.prefabList, this.fileInput);
    this.search.addEventListener('input', () => this.render());
    this.kindFilter.addEventListener('change', () => this.render());
    ctx.project.events.on('assetsChanged', () => this.render());
    ctx.project.events.on('opened', () => this.render());
    // Drop files anywhere on the panel.
    this.root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); this.root.classList.add('drop'); } });
    this.root.addEventListener('dragleave', () => this.root.classList.remove('drop'));
    this.root.addEventListener('drop', (e) => { this.root.classList.remove('drop'); if (e.dataTransfer?.files.length) { e.preventDefault(); void this.addFiles(Array.from(e.dataTransfer.files)); } });
    contextMenu(this.grid, (ev) => {
      const card = (ev.target as HTMLElement).closest<HTMLElement>('.asset-card');
      if (!card) return [{ label: 'Upload…', icon: 'upload', onClick: () => this.fileInput.click() }];
      const a = this.ctx.project.project.assets.assets.find((x) => x.id === card.dataset.id);
      return a ? this.cardMenu(a) : null;
    });
    this.grid.addEventListener('click', (e) => { if (e.target === this.grid) { this.selected = null; this.render(); } });
    this.render();
  }

  private get assets(): AssetManifestEntry[] { return this.ctx.project.project.assets.assets; }

  private render(): void {
    this.grid.textContent = '';
    const q = this.search.value.trim().toLowerCase();
    const kind = this.kindFilter.value;
    const list = this.assets.filter((a) => (kind === 'all' || a.kind === kind) && (!q || a.id.toLowerCase().includes(q)));
    let total = 0;
    for (const a of this.assets) if (a.url.startsWith('data:')) total += a.url.length * 0.75;
    this.root.querySelector('.asset-total')!.textContent = this.assets.length ? `${this.assets.length} assets · ${formatBytes(total)} embedded` : '';
    if (!list.length) {
      this.grid.appendChild(el('div', { class: 'panel-empty' }, icon('image', 24), el('p', { text: this.assets.length ? 'No assets match.' : 'No assets yet.' }), el('p', { class: 'dim', text: 'Upload or drop images, audio and JSON here. Drag an image onto the viewport to create a sprite; drag audio onto an entity to add an AudioSource.' })));
    }
    for (const a of list) this.grid.appendChild(this.card(a));
    this.renderPrefabs();
  }

  private card(a: AssetManifestEntry): HTMLElement {
    const thumb = el('div', { class: 'asset-thumb' });
    if (a.kind === 'image') { const img = el('img', { attrs: { src: a.url, alt: '', loading: 'lazy' } }); thumb.appendChild(img); }
    else if (a.kind === 'atlas') {
      const imageId = (a.meta?.image as string | undefined) ?? '';
      const img = this.assets.find((x) => x.id === imageId);
      if (img) thumb.appendChild(el('img', { attrs: { src: img.url, alt: '', loading: 'lazy' } }));
      thumb.appendChild(el('span', { class: 'asset-kind-badge', text: 'atlas' }));
    } else thumb.appendChild(icon(a.kind === 'audio' ? 'audio' : a.kind === 'gltf' ? 'cube' : 'file', 28));
    const size = a.url.startsWith('data:') ? formatBytes(Math.round(a.url.length * 0.75)) : 'linked';
    const card = el('div', { class: `asset-card ${this.selected === a.id ? 'selected' : ''}`, attrs: { role: 'option', 'aria-selected': String(this.selected === a.id), tabindex: '0', draggable: 'true', 'data-id': a.id, title: `${a.id} (${a.kind}, ${size})` } }, thumb, el('div', { class: 'asset-name', text: a.id }), el('div', { class: 'asset-meta dim', text: `${a.kind} · ${size}` }));
    card.addEventListener('click', () => { this.selected = a.id; this.render(); });
    card.addEventListener('dblclick', () => this.preview(a));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.preview(a); if (e.key === 'Delete') void this.remove(a); });
    card.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('application/x-forge-asset', JSON.stringify({ id: a.id, kind: a.kind })); e.dataTransfer!.effectAllowed = 'copy'; });
    return card;
  }

  private cardMenu(a: AssetManifestEntry): MenuItem[] {
    return [
      { label: 'Preview', icon: 'eye', onClick: () => this.preview(a) },
      { label: 'Slice into atlas…', icon: 'grid', disabled: a.kind !== 'image', onClick: () => this.slice(a) },
      { label: 'Copy id', icon: 'copy', onClick: () => { void navigator.clipboard?.writeText(a.id); toast('Asset id copied', 'success'); } },
      { label: 'Rename…', icon: 'type', onClick: () => void this.rename(a) },
      { separator: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => void this.remove(a) },
    ];
  }

  // -------------------------------------------------------------- actions

  async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) { toast(`Unsupported file: ${file.name}`, 'warn'); continue; }
      if (file.size > HARD_BYTES) {
        const ok = await confirmDialog('Large asset', `${file.name} is ${formatBytes(file.size)}. Assets are embedded in the project JSON, which slows saving and loading. Add it anyway?`, { okLabel: 'Add anyway' });
        if (!ok) continue;
      } else if (file.size > WARN_BYTES) toast(`${file.name} is ${formatBytes(file.size)}; consider compressing large assets.`, 'warn', { duration: 5000 });
      const url = await readDataUrl(file);
      const id = this.ctx.project.uniqueAssetId(file.name);
      const entry: AssetManifestEntry = { id, kind, url };
      this.ctx.commands.push(new ProjectCommand(`Add asset ${id}`, this.ctx.project, { kind: 'asset-add', entry }, { kind: 'asset-remove', id }));
      this.selected = id;
    }
    if (files.length) toast(`${files.length} asset${files.length === 1 ? '' : 's'} added`, 'success');
  }

  /** Add an entry programmatically (atlas editor, collaboration). */
  add(entry: AssetManifestEntry): void {
    this.ctx.commands.push(new ProjectCommand(`Add asset ${entry.id}`, this.ctx.project, { kind: 'asset-add', entry }, { kind: 'asset-remove', id: entry.id }));
  }

  private async remove(a: AssetManifestEntry): Promise<void> {
    const ok = await confirmDialog('Delete asset', `Delete "${a.id}"? Components referencing it will show a placeholder.`, { okLabel: 'Delete', danger: true });
    if (!ok) return;
    this.ctx.commands.push(new ProjectCommand(`Delete asset ${a.id}`, this.ctx.project, { kind: 'asset-remove', id: a.id }, { kind: 'asset-add', entry: a }));
  }

  private async rename(a: AssetManifestEntry): Promise<void> {
    const to = await promptDialog('Rename asset', 'New id', a.id, { validate: (v) => (!v ? 'Required' : v !== a.id && this.assets.some((x) => x.id === v) ? 'Id already used' : null) });
    if (!to || to === a.id) return;
    const renamed = { ...a, id: to };
    this.ctx.commands.transaction(`Rename asset ${a.id}`, () => {
      this.ctx.commands.push(new ProjectCommand('Remove old', this.ctx.project, { kind: 'asset-remove', id: a.id }, { kind: 'asset-add', entry: a }));
      this.ctx.commands.push(new ProjectCommand('Add renamed', this.ctx.project, { kind: 'asset-add', entry: renamed }, { kind: 'asset-remove', id: to }));
    });
    toast('Asset renamed. Update components that referenced the old id.', 'info');
  }

  private slice(a: AssetManifestEntry): void {
    openAtlasEditor({ id: a.id, url: a.url }, this.assets.map((x) => x.id), (res) => {
      this.add(res.entry);
      toast(`Atlas "${res.entry.id}" with ${res.frameCount} frames created`, 'success');
    });
  }

  private preview(a: AssetManifestEntry): void {
    const body = el('div', { class: 'asset-preview' });
    if (a.kind === 'image') {
      const img = el('img', { attrs: { src: a.url, alt: a.id } });
      img.onload = () => body.appendChild(el('div', { class: 'dim small', text: `${img.naturalWidth} × ${img.naturalHeight} px` }));
      body.appendChild(img);
    } else if (a.kind === 'audio') body.appendChild(el('audio', { attrs: { src: a.url, controls: 'true' } }));
    else if (a.kind === 'atlas' || a.kind === 'json' || a.kind === 'text') {
      const pre = el('pre', { class: 'asset-json', text: 'Loading…' });
      body.appendChild(pre);
      fetch(a.url).then((r) => r.text()).then((t) => { pre.textContent = t.length > 20000 ? `${t.slice(0, 20000)}\n…` : t; }).catch(() => { pre.textContent = 'Could not load'; });
    } else body.appendChild(el('p', { class: 'dim', text: `No preview for ${a.kind} assets.` }));
    openDialog({ title: a.id, size: 'lg', body, buttons: [{ label: 'Close', primary: true, onClick: (close) => close() }] });
  }

  // -------------------------------------------------------------- prefabs

  private renderPrefabs(): void {
    this.prefabList.textContent = '';
    const prefabs = this.ctx.project.project.prefabs;
    if (!prefabs.length) { this.prefabList.appendChild(el('div', { class: 'dim small', text: 'No prefabs. Prefabs can be instantiated from scripts with ctx.spawn(name).' })); return; }
    for (const p of prefabs) {
      const row = el('div', { class: 'prefab-row' }, icon('box', 14), el('span', { class: 'prefab-name', text: p.name }), el('span', { class: 'dim small', text: `${p.entities.length} entit${p.entities.length === 1 ? 'y' : 'ies'}` }), el('span', { class: 'spacer' }));
      const inst = el('button', { class: 'small', text: 'Instantiate', attrs: { type: 'button' } });
      inst.addEventListener('click', () => {
        const snap = prefabToSnapshot(p, null, { x: this.ctx.viewport.camera.x, y: this.ctx.viewport.camera.y });
        const cmd = new CreateEntityCommand(this.ctx.scene, snap, `Instantiate ${p.name}`);
        this.ctx.commands.push(cmd);
        if (cmd.entity !== undefined) { this.ctx.state.select(cmd.entity); this.ctx.state.reveal(cmd.entity); }
      });
      const more = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `${p.name} options` } }, icon('more', 14));
      more.addEventListener('click', () => showMenu([
        { label: 'Delete prefab', danger: true, icon: 'trash', onClick: () => this.ctx.commands.push(new ProjectCommand(`Delete prefab ${p.name}`, this.ctx.project, { kind: 'prefab-remove', name: p.name }, { kind: 'prefab-add', prefab: p })) },
      ], more, { align: 'right' }));
      row.append(inst, more);
      this.prefabList.appendChild(row);
    }
  }
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
