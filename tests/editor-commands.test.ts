import { describe, it, expect } from 'vitest';
import { CommandStack } from '../src/editor/commands/CommandStack';
import { FnCommand, type Command } from '../src/editor/commands/Command';
import { Engine } from '../src/core/Engine';
import { SceneEditor } from '../src/editor/project/SceneEditor';
import { CreateEntityCommand, DeleteEntitiesCommand, ReparentCommand, SetFieldsCommand, AddComponentCommand, RemoveComponentCommand, RenameCommand } from '../src/editor/commands/SceneCommands';
import { makePreset } from '../src/editor/project/EntityFactory';
import { Transform } from '../src/core/ecs/Transform';
import { defaultScene } from '../src/project/createProject';
import { Shape } from '../src/render/components';

class Counter implements Command {
  readonly label = 'inc';
  readonly mergeKey = 'counter';
  constructor(private readonly target: { n: number }, public by: number) {}
  execute(): void { this.target.n += this.by; }
  undo(): void { this.target.n -= this.by; }
  merge(next: Command): boolean {
    if (!(next instanceof Counter)) return false;
    // Merged command must undo both steps at once.
    this.by += next.by;
    return true;
  }
}

describe('CommandStack', () => {
  it('executes, undoes and redoes in order', () => {
    const s = new CommandStack();
    const log: string[] = [];
    s.push(new FnCommand('a', () => log.push('+a'), () => log.push('-a')));
    s.push(new FnCommand('b', () => log.push('+b'), () => log.push('-b')));
    expect(s.canUndo).toBe(true);
    expect(s.undoLabel).toBe('b');
    s.undo();
    s.undo();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);
    s.redo();
    expect(log).toEqual(['+a', '+b', '-b', '-a', '+a']);
    expect(s.redoLabel).toBe('b');
  });

  it('truncates the redo branch on a new push and respects the limit', () => {
    const s = new CommandStack();
    s.limit = 3;
    for (let i = 0; i < 5; i++) s.push(new FnCommand(`c${i}`, () => undefined, () => undefined));
    expect(s.length).toBe(3);
    s.undo();
    s.push(new FnCommand('new', () => undefined, () => undefined));
    expect(s.canRedo).toBe(false);
    expect(s.history.map((c) => c.label)).toEqual(['c2', 'c3', 'new']);
  });

  it('merges consecutive mergeable commands into one undo step', () => {
    const s = new CommandStack();
    const t = { n: 0 };
    s.push(new Counter(t, 1));
    s.push(new Counter(t, 2));
    s.push(new Counter(t, 3));
    expect(t.n).toBe(6);
    expect(s.length).toBe(1);
    s.undo();
    expect(t.n).toBe(0);
    s.breakMerge();
    s.redo();
    s.push(new Counter(t, 10), { merge: false });
    expect(s.length).toBe(2);
  });

  it('groups pushes into a compound step and supports jumpTo', () => {
    const s = new CommandStack();
    const t = { n: 0 };
    s.transaction('group', () => { s.push(new FnCommand('x', () => { t.n += 1; }, () => { t.n -= 1; })); s.push(new FnCommand('y', () => { t.n += 10; }, () => { t.n -= 10; })); });
    s.push(new FnCommand('z', () => { t.n += 100; }, () => { t.n -= 100; }));
    expect(s.length).toBe(2);
    expect(t.n).toBe(111);
    s.jumpTo(0);
    expect(t.n).toBe(0);
    s.jumpTo(2);
    expect(t.n).toBe(111);
    s.suspended = true;
    s.push(new FnCommand('ignored', () => { t.n += 1000; }, () => undefined));
    expect(t.n).toBe(1111);
    expect(s.length).toBe(2);
  });
});

describe('Scene commands', () => {
  function setup() {
    const engine = Engine.create(null, { renderer: 'none' });
    const scene = new SceneEditor(engine);
    scene.load(defaultScene('2d'));
    const stack = new CommandStack();
    return { engine, scene, stack };
  }

  it('creates, renames, reparents and deletes entities with full undo', () => {
    const { engine, scene, stack } = setup();
    const w = engine.world;
    const a = new CreateEntityCommand(scene, makePreset('shape', { name: 'A', position: { x: 1, y: 2 } }));
    const b = new CreateEntityCommand(scene, makePreset('circle', { name: 'B' }));
    stack.push(a);
    stack.push(b);
    expect(scene.all().length).toBe(3);
    stack.push(new RenameCommand(scene, b.snapshot.guid, 'Bee'));
    expect(w.nameOf(b.entity!)).toBe('Bee');
    stack.push(new ReparentCommand(scene, b.snapshot.guid, a.snapshot.guid, -1, true));
    expect(w.getParent(b.entity!)).toBe(a.entity);
    // World position preserved when reparenting.
    const wp = engine.transformOf(b.entity!)!.getWorldPosition();
    expect(wp.x).toBeCloseTo(0);
    expect(wp.y).toBeCloseTo(0);
    stack.push(new DeleteEntitiesCommand(scene, [a.snapshot.guid, b.snapshot.guid]));
    expect(scene.all().length).toBe(1);
    stack.undo(); // delete
    expect(scene.all().length).toBe(3);
    const bb = scene.entityOf(b.snapshot.guid)!;
    expect(w.nameOf(bb)).toBe('Bee');
    expect(w.getParent(bb)).toBe(scene.entityOf(a.snapshot.guid));
    stack.undo(); // reparent
    expect(w.getParent(scene.entityOf(b.snapshot.guid)!)).toBe(0);
    stack.undo(); // rename
    expect(w.nameOf(scene.entityOf(b.snapshot.guid)!)).toBe('B');
    stack.undo(); stack.undo();
    expect(scene.all().length).toBe(1);
    stack.redo(); stack.redo();
    expect(scene.all().length).toBe(3);
  });

  it('sets fields with merge and add/removes components with requires', () => {
    const { engine, scene, stack } = setup();
    const a = new CreateEntityCommand(scene, makePreset('shape', { name: 'A' }));
    stack.push(a);
    const guid = a.snapshot.guid;
    stack.push(new SetFieldsCommand(scene, [{ guid, type: 'Transform', field: 'position', value: { x: 1, y: 0, z: 0 } }]));
    stack.push(new SetFieldsCommand(scene, [{ guid, type: 'Transform', field: 'position', value: { x: 2, y: 0, z: 0 } }]));
    expect(stack.length).toBe(2); // merged
    expect(engine.transformOf(a.entity!)!.position.x).toBe(2);
    stack.undo();
    expect(engine.transformOf(a.entity!)!.position.x).toBe(0);
    stack.redo();
    stack.push(new SetFieldsCommand(scene, [{ guid, type: 'Shape', field: 'fill', value: { r: 1, g: 0, b: 0, a: 1 } }]));
    expect(engine.world.getComponent(a.entity!, Shape)!.fill.r).toBe(1);
    stack.push(new AddComponentCommand(scene, guid, 'BoxCollider2D', { width: 3 }));
    expect(engine.world.hasComponent(a.entity!, 'RigidBody2D')).toBe(true); // requires
    expect((engine.world.getComponent(a.entity!, 'BoxCollider2D') as unknown as { width: number }).width).toBe(3);
    stack.undo();
    expect(engine.world.hasComponent(a.entity!, 'RigidBody2D')).toBe(false);
    stack.redo();
    stack.push(new RemoveComponentCommand(scene, guid, 'BoxCollider2D'));
    expect(engine.world.hasComponent(a.entity!, 'BoxCollider2D')).toBe(false);
    stack.undo();
    expect((engine.world.getComponent(a.entity!, 'BoxCollider2D') as unknown as { width: number }).width).toBe(3);
    expect(engine.world.hasComponent(a.entity!, Transform)).toBe(true);
  });

  it('round-trips entity references through guid encoding and serialization', () => {
    const { engine, scene } = setup();
    const target = scene.createEntity(makePreset('shape', { name: 'Target' }));
    const camGuid = scene.guidOf(engine.world.findByName('Camera')!)!;
    scene.setField(camGuid, 'Camera2D', 'follow', scene.encodeRef(target));
    const cam = engine.world.getComponent(engine.world.findByName('Camera')!, 'Camera2D') as unknown as { follow: number };
    expect(cam.follow).toBe(target);
    const data = scene.serialize('Main');
    expect(data.settings?.editor).toBeDefined();
    const meta = (data.settings!.editor as { entities: Record<string, { guid: string }> }).entities;
    expect(Object.values(meta).some((m) => m.guid === camGuid)).toBe(true);
    // Reload: guids survive and the reference is remapped to the new runtime id.
    scene.load(data);
    const cam2 = engine.world.getComponent(scene.entityOf(camGuid)!, 'Camera2D') as unknown as { follow: number };
    expect(engine.world.nameOf(cam2.follow)).toBe('Target');
    expect(scene.editorEntities.size).toBe(0);
  });
});
