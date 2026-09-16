// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Engine } from '../src/core/Engine';
import { createProject } from '../src/project/createProject';
import { CommandStack } from '../src/editor/commands/CommandStack';
import { EditorState } from '../src/editor/app/EditorState';
import { ProjectService } from '../src/editor/project/ProjectService';
import { CollabSession } from '../src/editor/collab/CollabSession';
import { MemoryHub } from '../src/editor/collab/Channel';
import { OpModel, compareClocks } from '../src/editor/collab/OpModel';
import { CreateEntityCommand, SetFieldsCommand, DeleteEntitiesCommand, ReparentCommand } from '../src/editor/commands/SceneCommands';
import { makePreset } from '../src/editor/project/EntityFactory';
import { ScriptSourceCommand } from '../src/editor/commands/ProjectCommands';
import { Transform } from '../src/core/ecs/Transform';

async function client(hub: MemoryHub, id: string, project = createProject({ name: 'Collab' })) {
  const engine = Engine.create(null, { renderer: 'none' });
  const service = new ProjectService(engine);
  service.autosaveEnabled = false;
  await service.open(structuredClone(project), 'local');
  const commands = new CommandStack();
  const state = new EditorState();
  const channel = hub.join(id);
  const session = new CollabSession({ scene: service.scene, project: service, commands, state }, channel, id);
  session.start({ requestState: false });
  return { engine, service, scene: service.scene, commands, state, channel, session };
}

function flushAll(...clients: { channel: { flush(): void } }[]): void {
  for (let i = 0; i < 4; i++) for (const c of clients) c.channel.flush();
}

/** Scene document without editor-only camera/bookmark noise, for comparing peers. */
function sceneDoc(c: { service: ProjectService }): unknown {
  const s = c.service.scene.serialize('Main');
  const { editor, ...rest } = s.settings ?? {};
  const ed = editor as { entities: Record<string, unknown> };
  return { ...s, settings: { ...rest, editor: { entities: ed.entities } } };
}

describe('OpModel', () => {
  it('orders clocks and applies last-writer-wins per field', () => {
    const a = new OpModel('a');
    const b = new OpModel('b');
    const ca = a.tick();
    const cb = b.tick();
    expect(compareClocks(ca, cb)).toBeLessThan(0); // same time, tie-break by peer id
    const setOp = (peer: OpModel, clock: { t: number; peer: string }, v: number) => ({ kind: 'scene' as const, scene: 'Main', mutation: { kind: 'field-set' as const, guid: 'g', type: 'Transform', field: 'position', value: { x: v, y: 0, z: 0 } }, clock: clock ?? peer.tick() });
    const op1 = setOp(a, { t: 5, peer: 'a' }, 1);
    const op2 = setOp(b, { t: 3, peer: 'b' }, 2);
    const receiver = new OpModel('c');
    expect(receiver.accept(op1)).toBe(true);
    expect(receiver.accept(op2)).toBe(false); // older clock loses
    expect(receiver.accept(setOp(a, { t: 5, peer: 'b' }, 3))).toBe(true); // same time, higher peer wins
    expect(receiver.fieldClock('Main', 'g', 'Transform', 'position')).toEqual({ t: 5, peer: 'b' });
    // Structural ops always pass.
    expect(receiver.accept({ kind: 'scene', scene: 'Main', mutation: { kind: 'entity-delete', guid: 'g' }, clock: { t: 1, peer: 'z' } })).toBe(true);
    // Lamport receive rule advances local time past observed clocks.
    expect(receiver.tick().t).toBeGreaterThan(5);
    const exported = receiver.export();
    const other = new OpModel('d');
    other.import(exported);
    expect(other.accept(op2)).toBe(false);
  });
});

describe('CollabSession', () => {
  it('two clients converge on entity create / field set / reparent / delete', async () => {
    const hub = new MemoryHub();
    const a = await client(hub, 'a');
    // Guests start from the host's document (guids included), as they do after a state hand-off.
    const b = await client(hub, 'b', a.service.snapshot());
    flushAll(a, b);

    const create = new CreateEntityCommand(a.scene, makePreset('shape', { name: 'Box', position: { x: 1, y: 1 } }));
    a.commands.push(create);
    const child = new CreateEntityCommand(a.scene, makePreset('circle', { name: 'Ball' }));
    a.commands.push(child);
    flushAll(a, b);
    expect(b.scene.entityOf(create.snapshot.guid)).toBeDefined();
    expect(b.engine.world.nameOf(b.scene.entityOf(child.snapshot.guid)!)).toBe('Ball');

    // B edits a field, A reparents.
    b.commands.push(new SetFieldsCommand(b.scene, [{ guid: create.snapshot.guid, type: 'Transform', field: 'position', value: { x: 5, y: 6, z: 0 } }]));
    a.commands.push(new ReparentCommand(a.scene, child.snapshot.guid, create.snapshot.guid, -1, false));
    flushAll(a, b);
    expect(a.engine.transformOf(a.scene.entityOf(create.snapshot.guid)!)!.position.x).toBe(5);
    expect(b.engine.world.getParent(b.scene.entityOf(child.snapshot.guid)!)).toBe(b.scene.entityOf(create.snapshot.guid));
    expect(sceneDoc(a)).toEqual(sceneDoc(b));

    // Remote edits do not enter the local undo stack.
    expect(a.commands.length).toBe(3);
    expect(b.commands.length).toBe(1);

    // Concurrent writes to the same field: both peers end with the same value.
    a.commands.push(new SetFieldsCommand(a.scene, [{ guid: create.snapshot.guid, type: 'Transform', field: 'scale', value: { x: 2, y: 2, z: 1 } }]));
    b.commands.push(new SetFieldsCommand(b.scene, [{ guid: create.snapshot.guid, type: 'Transform', field: 'scale', value: { x: 3, y: 3, z: 1 } }]));
    flushAll(a, b);
    const sa = a.engine.transformOf(a.scene.entityOf(create.snapshot.guid)!)!.scale.x;
    const sb = b.engine.transformOf(b.scene.entityOf(create.snapshot.guid)!)!.scale.x;
    expect(sa).toBe(sb);

    // Undo on A propagates as a normal op.
    a.commands.undo();
    flushAll(a, b);
    expect(sceneDoc(a)).toEqual(sceneDoc(b));

    // Delete converges.
    b.commands.push(new DeleteEntitiesCommand(b.scene, [create.snapshot.guid]));
    flushAll(a, b);
    expect(a.scene.entityOf(create.snapshot.guid)).toBeUndefined();
    expect(a.scene.entityOf(child.snapshot.guid)).toBeUndefined();
    expect(sceneDoc(a)).toEqual(sceneDoc(b));
    expect(a.engine.world.hasComponent(a.engine.world.findByName('Camera')!, Transform)).toBe(true);
  });

  it('syncs scripts (whole-file LWW) and flags conflicts, and hands full state to joiners', async () => {
    const hub = new MemoryHub();
    const a = await client(hub, 'a');
    const b = await client(hub, 'b', a.service.snapshot());
    flushAll(a, b);
    a.commands.push({ label: 'add', execute: () => a.service.apply({ kind: 'script-add', name: 'S', source: 'defineScript({ name: "S" })' }), undo: () => a.service.apply({ kind: 'script-remove', name: 'S' }) });
    flushAll(a, b);
    expect(b.service.script('S')?.source).toContain('name: "S"');
    let conflicts = 0;
    // Whoever loses last-writer-wins receives the competing save and gets the conflict banner.
    a.session.events.on('scriptConflict', () => conflicts++);
    b.session.events.on('scriptConflict', () => conflicts++);
    b.commands.push(new ScriptSourceCommand(b.service, 'S', b.service.script('S')!.source, 'defineScript({ name: "S", onStart() {} })'));
    a.commands.push(new ScriptSourceCommand(a.service, 'S', a.service.script('S')!.source, 'defineScript({ name: "S", onUpdate() {} })'));
    flushAll(a, b);
    expect(a.service.script('S')!.source).toBe(b.service.script('S')!.source);
    expect(conflicts).toBe(1); // b edited within 2s and received a competing save

    // A third client joins late and receives the full state from the host.
    const c = await client(hub, 'c', createProject({ name: 'Empty' }));
    c.channel.send('host', { t: 'state-request' });
    flushAll(a, b, c);
    await new Promise((r) => setTimeout(r, 0));
    flushAll(a, b, c);
    await new Promise((r) => setTimeout(r, 10));
    expect(c.service.project.name).toBe('Collab');
    expect(c.service.script('S')!.source).toBe(a.service.script('S')!.source);
    expect(sceneDoc(c)).toEqual(sceneDoc(a));
    a.session.stop(); b.session.stop(); c.session.stop();
  });
});
