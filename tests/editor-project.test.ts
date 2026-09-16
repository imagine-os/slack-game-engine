import { describe, it, expect } from 'vitest';
import { Engine } from '../src/core/Engine';
import { createProject } from '../src/project/createProject';
import { ProjectService } from '../src/editor/project/ProjectService';
import { CommandStack } from '../src/editor/commands/CommandStack';
import { CreateEntityCommand, SetMetaCommand } from '../src/editor/commands/SceneCommands';
import { ProjectCommand, SettingsCommand } from '../src/editor/commands/ProjectCommands';
import { makePreset } from '../src/editor/project/EntityFactory';
import { Transform } from '../src/core/ecs/Transform';

describe('ProjectService', () => {
  it('saves and reloads a project with scene edits, editor metadata, scripts, assets and settings', async () => {
    const engine = Engine.create(null, { renderer: 'none' });
    const svc = new ProjectService(engine);
    svc.autosaveEnabled = false;
    await svc.open(createProject({ name: 'Round trip', renderer: '2d' }), 'new');
    const stack = new CommandStack();
    const create = new CreateEntityCommand(svc.scene, makePreset('physicsBox', { name: 'Crate', position: { x: 3, y: 4 } }));
    stack.push(create);
    stack.push(new SetMetaCommand(svc.scene, create.snapshot.guid, 'locked', true));
    stack.push(new ProjectCommand('script', svc, { kind: 'script-add', name: 'Mover', source: 'defineScript({ name: "Mover", props: { speed: { type: "number", default: 2 } } })' }, { kind: 'script-remove', name: 'Mover' }));
    expect(engine.scripting.definitions.has('Mover')).toBe(true);
    stack.push(new ProjectCommand('asset', svc, { kind: 'asset-add', entry: { id: 'blip', kind: 'json', url: 'data:application/json,{}' } }, { kind: 'asset-remove', id: 'blip' }));
    stack.push(new SettingsCommand(svc, 'settings.physics.gravity.y', -5));
    stack.push(new SettingsCommand(svc, 'settings.input.actions.dash', ['ShiftLeft']));
    stack.push(new ProjectCommand('scene', svc, { kind: 'scene-add', scene: svc.makeScene('Level 2') }, { kind: 'scene-remove', name: 'Level 2' }));
    stack.push(new ProjectCommand('start', svc, { kind: 'start-scene', name: 'Level 2' }, { kind: 'start-scene', name: 'Main' }));
    expect(svc.dirty).toBe(true);

    expect(await svc.save()).toBe(true);
    expect(svc.dirty).toBe(false);
    expect(svc.origin).toBe('local');
    const id = svc.project.id;

    // Reload into a fresh engine/service (in-memory store fallback in node).
    const engine2 = Engine.create(null, { renderer: 'none' });
    const svc2 = new ProjectService(engine2);
    (svc2 as unknown as { store: unknown }).store = svc.store;
    expect(await svc2.openLocal(id)).toBe(true);
    expect(svc2.project.name).toBe('Round trip');
    expect(svc2.project.startScene).toBe('Level 2');
    expect(svc2.project.scenes.map((s) => s.name)).toEqual(['Main', 'Level 2']);
    expect(svc2.project.settings.physics.gravity.y).toBe(-5);
    expect(svc2.project.settings.input.actions.dash).toEqual(['ShiftLeft']);
    expect(svc2.project.assets.assets[0].id).toBe('blip');
    expect(engine2.scripting.definitions.has('Mover')).toBe(true);
    expect(engine2.scripting.defaultProps('Mover')).toEqual({ speed: 2 });
    // Start scene was opened; switch to Main and check the entity, guid and lock survived.
    expect(svc2.currentSceneName).toBe('Level 2');
    expect(svc2.switchScene('Main')).toBe(true);
    const crate = svc2.scene.entityOf(create.snapshot.guid);
    expect(crate).toBeDefined();
    expect(engine2.world.nameOf(crate!)).toBe('Crate');
    expect(engine2.world.getComponent(crate!, Transform)!.position.x).toBe(3);
    expect(engine2.world.hasComponent(crate!, 'RigidBody2D')).toBe(true);
    expect(svc2.scene.isLocked(crate!)).toBe(true);
    // Editor entities never leak into saved scenes.
    for (const s of svc2.project.scenes) expect(s.entities.every((e) => e.name !== 'Editor Camera')).toBe(true);

    // Export / import produce an equivalent document.
    const json = svc2.exportJson();
    const imported = svc2.store.import(json);
    expect(imported.scenes).toEqual(svc2.project.scenes);

    // Undo the whole history and confirm the scene is back to the default camera only.
    stack.jumpTo(0);
    expect(svc.scene.all().length).toBe(1);
    expect(svc.project.scripts.length).toBe(0);
    expect(svc.project.scenes.length).toBe(1);
    expect(svc.project.settings.physics.gravity.y).toBe(-20);
  });

  it('templates are not autosaved until saved as a copy', async () => {
    const engine = Engine.create(null, { renderer: 'none' });
    const svc = new ProjectService(engine);
    const demo = createProject({ name: 'Demo', id: 'demo-id' });
    await svc.open(demo, 'template');
    svc.scene.createEntity(makePreset('shape', { name: 'X' }));
    expect(await svc.save()).toBe(false);
    expect(await svc.store.has('demo-id')).toBe(false);
    await svc.saveAsCopy('Mine');
    expect(svc.origin).toBe('local');
    expect(svc.project.id).not.toBe('demo-id');
    expect(svc.project.name).toBe('Mine');
    expect(await svc.store.has(svc.project.id)).toBe(true);
  });
});
