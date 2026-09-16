import { normalizeProject } from './createProject';
import type { Project, ProjectSummary } from './types';

const DB_NAME = 'forge-engine';
const STORE = 'projects';
const DB_VERSION = 1;

/**
 * IndexedDB persistence for projects (save/load/list/delete) plus JSON
 * export/import. Falls back to an in-memory map when IndexedDB is missing
 * (tests, private windows).
 */
export class ProjectStore {
  private db: IDBDatabase | null = null;
  private memory = new Map<string, Project>();

  constructor(private readonly dbName = DB_NAME) {}

  private get available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  }

  private tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then((db) => new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  /** Persist a project (updates `updatedAt`). */
  async save(project: Project): Promise<Project> {
    project.updatedAt = new Date().toISOString();
    const plain = JSON.parse(JSON.stringify(project)) as Project;
    if (!this.available) { this.memory.set(project.id, plain); return project; }
    await this.tx('readwrite', (s) => s.put(plain));
    return project;
  }

  async load(id: string): Promise<Project | undefined> {
    if (!this.available) return this.memory.get(id);
    const raw = await this.tx<Project | undefined>('readonly', (s) => s.get(id) as IDBRequest<Project | undefined>);
    return raw ? normalizeProject(raw) : undefined;
  }

  async list(): Promise<ProjectSummary[]> {
    const all = this.available ? await this.tx<Project[]>('readonly', (s) => s.getAll() as IDBRequest<Project[]>) : Array.from(this.memory.values());
    return all
      .map((p) => ({ id: p.id, name: p.name, description: p.description ?? '', thumbnail: p.thumbnail ?? '', updatedAt: p.updatedAt, renderer: p.settings?.renderer ?? '2d' }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async delete(id: string): Promise<void> {
    if (!this.available) { this.memory.delete(id); return; }
    await this.tx('readwrite', (s) => s.delete(id));
  }

  async has(id: string): Promise<boolean> {
    return (await this.load(id)) !== undefined;
  }

  /** Serialize to a JSON string (pretty when `pretty`). */
  export(project: Project, pretty = true): string {
    return JSON.stringify(project, null, pretty ? 2 : 0);
  }

  /** Parse a JSON string, validating and normalizing. Optionally assign a new id. */
  import(json: string, opts: { newId?: string } = {}): Project {
    const raw = JSON.parse(json) as Partial<Project>;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.scenes)) throw new Error('Not a Forge project file');
    const project = normalizeProject(raw);
    if (opts.newId) project.id = opts.newId;
    return project;
  }

  /** Trigger a browser download of the project JSON. */
  download(project: Project, filename = `${project.name.replace(/[^\w.-]+/g, '_') || 'project'}.forge.json`): void {
    const blob = new Blob([this.export(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
