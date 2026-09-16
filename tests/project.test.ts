import { describe, it, expect } from 'vitest';
import { createProject, normalizeProject, ProjectStore, PROJECT_VERSION, Engine, runProject, engineOptionsFor, Camera2D, Transform, saveScene, World, MeshRenderer } from '../src/index';

describe('Project', () => {
  it('creates a project with defaults and a start scene', () => {
    const p = createProject({ name: 'Test', renderer: '2d' });
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.scenes).toHaveLength(1);
    expect(p.startScene).toBe('Main');
    expect(p.settings.renderer).toBe('2d');
    expect(p.settings.network.mode).toBe('none');
    expect(p.settings.input.actions.jump).toContain('Space');
    const p3 = createProject({ renderer: '3d' });
    expect(p3.scenes[0].entities.some((e) => e.components.some((c) => c.type === 'Camera3D'))).toBe(true);
  });

  it('round trips through JSON export/import and normalizes partial docs', () => {
    const store = new ProjectStore();
    const p = createProject({ name: 'RT' });
    p.scripts.push({ name: 'A', source: 'defineScript({ name: "A" })' });
    const json = store.export(p);
    const back = store.import(json);
    expect(back).toEqual(p);
    const partial = normalizeProject({ name: 'Partial', scenes: [{ version: 1, name: 'Only', entities: [] }], settings: { renderer: '3d' } as never });
    expect(partial.startScene).toBe('Only');
    expect(partial.settings.renderer).toBe('3d');
    expect(partial.settings.physics.gravity.y).toBe(-20);
    expect(partial.settings.network.tickRate).toBe(20);
    expect(() => store.import('{"nope":1}')).toThrow();
    expect(() => normalizeProject({ version: 99 })).toThrow();
  });

  it('saves, lists, loads and deletes via the in-memory fallback store', async () => {
    const store = new ProjectStore('test-db');
    const p = createProject({ name: 'Stored' });
    await store.save(p);
    const list = await store.list();
    expect(list.map((x) => x.id)).toContain(p.id);
    const loaded = await store.load(p.id);
    expect(loaded?.name).toBe('Stored');
    await store.delete(p.id);
    expect(await store.has(p.id)).toBe(false);
  });

  it('loads scenes with round-trip fidelity including 3D components', () => {
    const w = new World();
    const e = w.createEntity('Box');
    w.addComponent(e, MeshRenderer, { mesh: 'sphere', color: { r: 1, g: 0, b: 0, a: 1 } });
    const scene = saveScene(w);
    const p = createProject({ renderer: '3d' });
    p.scenes = [scene];
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.scenes[0].entities[0].components.find((c) => c.type === 'MeshRenderer')?.data.mesh).toBe('sphere');
  });
});

describe('runProject (headless)', () => {
  it('applies settings, compiles scripts and loads the start scene', async () => {
    const p = createProject({ name: 'Run' });
    p.settings.physics.gravity = { x: 0, y: -5 };
    p.settings.fixedRate = 30;
    p.scripts.push({ name: 'Hello', source: 'defineScript({ name: "Hello", onStart(ctx) { ctx.state.started = true; } })' });
    p.scenes[0].entities.push({ id: 2, name: 'Scripted', components: [{ type: 'Transform', data: {} }, { type: 'Script', data: { script: 'Hello', props: {} } }] });
    const engine = Engine.create(null, engineOptionsFor(p));
    expect(engine.renderer).toBeNull();
    await runProject(engine, p);
    expect(engine.physics.gravity.y).toBe(-5);
    expect(engine.clock.fixedRate).toBeCloseTo(30);
    expect(engine.world.findByName('Camera')).toBeDefined();
    expect(engine.world.getComponent(engine.world.findByName('Camera')!, Camera2D)).toBeDefined();
    engine.step(1 / 30);
    const scripted = engine.world.findByName('Scripted')!;
    expect(engine.scripting.instanceOf(scripted)?.ctx.state.started).toBe(true);
    expect(engine.world.getComponent(scripted, Transform)).toBeDefined();
    engine.dispose();
  });
});
