import type { ProjectMutation, ProjectService } from '../project/ProjectService';
import type { Command } from './Command';

/** Generic project mutation with an explicit inverse. */
export class ProjectCommand implements Command {
  constructor(readonly label: string, private readonly project: ProjectService, private readonly forward: ProjectMutation, private readonly inverse: ProjectMutation) {}
  execute(): void { this.project.apply(this.forward); }
  undo(): void { this.project.apply(this.inverse); }
}

/** Script source change; consecutive saves of the same script merge into one step. */
export class ScriptSourceCommand implements Command {
  readonly label: string;
  readonly mergeKey: string;
  constructor(private readonly project: ProjectService, private readonly name: string, private readonly oldSource: string, private newSource: string) {
    this.label = `Edit script ${name}`;
    this.mergeKey = `script:${name}`;
  }
  execute(): void { this.project.apply({ kind: 'script-set', name: this.name, source: this.newSource, ts: Date.now() }); }
  undo(): void { this.project.apply({ kind: 'script-set', name: this.name, source: this.oldSource, ts: Date.now() }); }
  merge(next: Command): boolean {
    if (!(next instanceof ScriptSourceCommand) || next.mergeKey !== this.mergeKey) return false;
    this.newSource = next.newSource;
    return true;
  }
}

/** Settings edit (dot path); merges consecutive edits of the same path. */
export class SettingsCommand implements Command {
  readonly label: string;
  readonly mergeKey: string;
  private old: unknown;
  constructor(private readonly project: ProjectService, private readonly path: string, private value: unknown) {
    this.label = `Set ${path.split('.').pop()}`;
    this.mergeKey = `settings:${path}`;
    this.old = structuredClone(project.getPath(path));
  }
  execute(): void { this.project.apply({ kind: 'settings-set', path: this.path, value: this.value }); }
  undo(): void { this.project.apply({ kind: 'settings-set', path: this.path, value: this.old }); }
  merge(next: Command): boolean {
    if (!(next instanceof SettingsCommand) || next.mergeKey !== this.mergeKey) return false;
    this.value = next.value;
    return true;
  }
}
