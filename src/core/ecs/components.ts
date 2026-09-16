import { Component } from './Component';
import { registerComponent } from './Registry';

/** Human-readable entity name. */
export class Name extends Component {
  static override readonly type = 'Name';
  name = 'Entity';
}
registerComponent(Name, {
  category: 'Core',
  description: 'Display name used by the editor and find-by-name lookups.',
  fields: { name: { type: 'string' } },
});

/** Set of string tags for grouping/lookup (`world.findByTag`). */
export class Tag extends Component {
  static override readonly type = 'Tag';
  tags: string[] = [];

  has(tag: string): boolean {
    return this.tags.includes(tag);
  }

  add(tag: string): this {
    if (!this.has(tag)) this.tags.push(tag);
    return this;
  }

  remove(tag: string): this {
    const i = this.tags.indexOf(tag);
    if (i >= 0) this.tags.splice(i, 1);
    return this;
  }
}
registerComponent(Tag, {
  category: 'Core',
  description: 'String tags for grouping entities.',
  fields: { tags: { type: 'json', label: 'Tags' } },
});
