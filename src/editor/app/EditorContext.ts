import type { Engine } from '../../core/Engine';
import type { Entity } from '../../core/ecs/Entity';
import type { CommandStack } from '../commands/CommandStack';
import type { ProjectService } from '../project/ProjectService';
import type { SceneEditor } from '../project/SceneEditor';
import type { Viewport } from '../viewport/Viewport';
import type { ActionRegistry } from './Actions';
import type { EditorState } from './EditorState';

/** Everything a panel needs from the editor shell (avoids importing the app). */
export interface EditorContext {
  readonly engine: Engine;
  readonly state: EditorState;
  readonly scene: SceneEditor;
  readonly project: ProjectService;
  readonly commands: CommandStack;
  readonly actions: ActionRegistry;
  readonly viewport: Viewport;
  readonly is3d: boolean;
  /** Open a script in the Scripts tab. */
  openScript(name: string): void;
  /** Show a bottom tab. */
  showTab(id: 'assets' | 'scripts' | 'console' | 'settings' | 'history'): void;
  /** Editor log line in the console panel. */
  log(level: 'log' | 'warn' | 'error', message: string): void;
  /** Colors of collaborators that currently select an entity (by guid). */
  remoteSelectionColors(guid: string): string[];
  /** Icon name for an entity (based on its components). */
  entityIcon(e: Entity): string;
}
