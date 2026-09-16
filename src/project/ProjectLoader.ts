import { normalizeProject } from './createProject';
import type { ProjectStore } from './ProjectStore';
import type { Project } from './types';

/**
 * Resolves a project by id or URL: bundled demos (`demos/<id>/project.json`),
 * an explicit URL, or a project saved in the local {@link ProjectStore}.
 */
export class ProjectLoader {
  constructor(
    private readonly store: ProjectStore | null = null,
    /** Base directory holding bundled demo projects (relative to the page). */
    readonly demosBase = './demos/',
  ) {}

  /** Fetch and normalize a project JSON document. */
  async fromUrl(url: string): Promise<Project> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load project from ${url}: ${res.status}`);
    const raw = (await res.json()) as Partial<Project>;
    const project = normalizeProject(raw);
    // Relative asset paths resolve next to the project file unless the manifest says otherwise.
    if (!project.assets.baseUrl) project.assets.baseUrl = url.slice(0, url.lastIndexOf('/') + 1);
    return project;
  }

  /** Load a bundled demo by id. */
  fromDemo(id: string): Promise<Project> {
    return this.fromUrl(`${this.demosBase}${encodeURIComponent(id)}/project.json`);
  }

  /**
   * Resolve `ref`: a URL (contains `/` or ends with .json), a stored project
   * id (checked first when a store is present), or a demo id.
   */
  async resolve(ref: string): Promise<Project> {
    if (/^(https?:)?\/\//.test(ref) || ref.endsWith('.json') || ref.includes('/')) return this.fromUrl(ref);
    if (this.store) {
      const local = await this.store.load(ref);
      if (local) return local;
    }
    return this.fromDemo(ref);
  }
}
