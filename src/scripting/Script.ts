import { Component } from '../core/ecs/Component';
import { registerComponent } from '../core/ecs/Registry';

/**
 * Attaches a user script (by definition name) to an entity. `props` override
 * the definition defaults and are what the inspector edits.
 */
export class Script extends Component {
  static override readonly type = 'Script';
  /** Script definition name. */
  script = '';
  props: Record<string, unknown> = {};
  enabled = true;

  /** Runtime instance id (set by the ScriptRuntime). */
  _instance = 0;
}
registerComponent(Script, {
  category: 'Scripting',
  description: 'Runs a user script on this entity.',
  icon: 'code',
  fields: {
    script: { type: 'string', label: 'Script' },
    props: { type: 'json', label: 'Properties' },
    _instance: { type: 'integer', transient: true, hidden: true },
  },
});
