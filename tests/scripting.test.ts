import { describe, it, expect } from 'vitest';
import { Engine, Script, RigidBody2D, BoxCollider2D, Transform, PlayerInput, ScriptCompileError, createEmptySnapshot, NULL_ENTITY, saveScene, loadScene } from '../src/index';
import { smokeScene2D, smokeScene3D, smokeScripts } from '../src/player/smoke';

function headless() {
  return Engine.create(null, { seed: 1, audio: false });
}

describe('ScriptRuntime', () => {
  it('compiles user code in a restricted scope and runs lifecycle hooks', () => {
    const engine = headless();
    const log: string[] = [];
    engine.diagnostics.on('log', (d) => log.push(d.message));
    engine.scripting.consoleLogging = false;
    engine.scripting.compile(`
      defineScript({
        name: 'Mover',
        props: { speed: { type: 'number', default: 2 } },
        onStart(ctx) { ctx.state.updates = 0; ctx.log('start', typeof window, typeof document); },
        onUpdate(ctx, dt) { ctx.state.updates++; ctx.transform.x += ctx.props.speed * dt; },
        onFixedUpdate(ctx) { ctx.state.fixed = (ctx.state.fixed || 0) + 1; },
      });
    `);
    const e = engine.world.createEntity('M');
    engine.world.addComponent(e, Script, { script: 'Mover', props: { speed: 10 } });
    for (let i = 0; i < 6; i++) engine.step(1 / 60);
    const inst = engine.scripting.instanceOf(e)!;
    expect(inst.started).toBe(true);
    expect(inst.ctx.state.updates).toBe(6);
    expect(inst.ctx.state.fixed).toBe(6);
    expect(engine.world.getComponent(e, Transform)!.x).toBeCloseTo(1);
    expect(log[0]).toBe('start undefined undefined');
    expect(engine.scripting.defaultProps('Mover')).toEqual({ speed: 2 });
    engine.dispose();
  });

  it('reports compile errors and isolates runtime errors', () => {
    const engine = headless();
    engine.scripting.consoleLogging = false;
    expect(() => engine.scripting.compile('this is not js')).toThrow(ScriptCompileError);
    expect(() => engine.scripting.compile('const x = 1;', 'NoDefine')).toThrow(/did not call defineScript/);
    const errors: string[] = [];
    engine.diagnostics.on('error', (d) => errors.push(d.message));
    engine.scripting.maxErrors = 2;
    engine.scripting.compile(`defineScript({ name: 'Bad', onUpdate() { throw new Error('boom'); } })`);
    engine.scripting.compile(`defineScript({ name: 'Good', onUpdate(ctx) { ctx.state.n = (ctx.state.n || 0) + 1; } })`);
    const bad = engine.world.createEntity();
    engine.world.addComponent(bad, Script, { script: 'Bad' });
    const good = engine.world.createEntity();
    engine.world.addComponent(good, Script, { script: 'Good' });
    for (let i = 0; i < 5; i++) engine.step(1 / 60);
    expect(errors.filter((m) => m.includes('boom'))).toHaveLength(2); // disabled after maxErrors
    expect(engine.scripting.instanceOf(good)!.ctx.state.n).toBe(5);
    engine.dispose();
  });

  it('hot reloads while preserving state and props', () => {
    const engine = headless();
    engine.scripting.consoleLogging = false;
    engine.scripting.compile(`defineScript({ name: 'Counter', props: { step: { type: 'number', default: 1 } }, onStart(ctx) { ctx.state.count = 100; }, onUpdate(ctx) { ctx.state.count += ctx.props.step; } })`);
    const e = engine.world.createEntity();
    engine.world.addComponent(e, Script, { script: 'Counter', props: { step: 5 } });
    engine.step(1 / 60);
    expect(engine.scripting.instanceOf(e)!.ctx.state.count).toBe(105);
    engine.scripting.reload(`defineScript({ name: 'Counter', props: { step: { type: 'number', default: 1 }, extra: { type: 'string', default: 'x' } }, onReload(ctx) { ctx.state.reloaded = true; }, onUpdate(ctx) { ctx.state.count -= ctx.props.step; } })`, 'Counter');
    engine.step(1 / 60);
    const ctx = engine.scripting.instanceOf(e)!.ctx;
    expect(ctx.state.count).toBe(100);
    expect(ctx.state.reloaded).toBe(true);
    expect(ctx.props.step).toBe(5);
    expect(ctx.props.extra).toBe('x');
    engine.dispose();
  });

  it('delivers collision events, owner input, timers and messages', () => {
    const engine = headless();
    engine.scripting.consoleLogging = false;
    engine.scripting.compile(`defineScript({
      name: 'Hero',
      onStart(ctx) { ctx.state.hits = 0; ctx.timer(0.05, () => { ctx.state.timerFired = true; }); },
      onCollisionEnter(ctx, other, info) { ctx.state.hits++; ctx.state.other = ctx.nameOf(other); ctx.state.normalY = info.normal.y; },
      onOwnerInput(ctx, snap) { if (snap.held.includes('jump')) ctx.state.jumped = true; },
      onMessage(ctx, name, data) { ctx.state.msg = name + ':' + data; },
    })`);
    const ground = engine.world.createEntity('Ground');
    engine.world.getComponent(ground, Transform)!.setPosition(0, -1);
    engine.world.addComponent(ground, RigidBody2D, { bodyType: 'static' });
    engine.world.addComponent(ground, BoxCollider2D, { width: 10, height: 2 });
    const hero = engine.world.createEntity('Hero');
    engine.world.getComponent(hero, Transform)!.setPosition(0, 1.5);
    engine.world.addComponent(hero, RigidBody2D, { fixedRotation: true });
    engine.world.addComponent(hero, BoxCollider2D, { width: 1, height: 1 });
    engine.world.addComponent(hero, PlayerInput, { owner: 'local' });
    engine.world.addComponent(hero, Script, { script: 'Hero' });
    engine.input.keyboard.setDown('Space', true);
    for (let i = 0; i < 60; i++) engine.step(1 / 60);
    const st = engine.scripting.instanceOf(hero)!.ctx.state;
    expect(st.hits).toBe(1);
    expect(st.other).toBe('Ground');
    expect(st.normalY).toBeCloseTo(-1); // normal from hero toward ground
    expect(st.jumped).toBe(true);
    expect(st.timerFired).toBe(true);
    engine.scripting.message('ping', 7);
    expect(st.msg).toBe('ping:7');
    // Remote owner: local keyboard must not drive it.
    const remote = engine.world.createEntity('Remote');
    const pi = engine.world.addComponent(remote, PlayerInput, { owner: 'peer-2' });
    engine.world.addComponent(remote, Script, { script: 'Hero' });
    engine.step(1 / 60);
    expect(engine.scripting.instanceOf(remote)!.ctx.state.jumped).toBeUndefined();
    const s = createEmptySnapshot(1);
    s.held = ['jump'];
    pi.apply(s);
    engine.step(1 / 60);
    expect(engine.scripting.instanceOf(remote)!.ctx.state.jumped).toBe(true);
    engine.dispose();
  });

  it('spawns prefabs and destroys entities from scripts', () => {
    const engine = headless();
    engine.scripting.consoleLogging = false;
    engine.prefabs.set('Bullet', { version: 1, name: 'Bullet', entities: [{ id: 1, name: 'Bullet', components: [{ type: 'Transform', data: {} }, { type: 'Tag', data: { tags: ['bullet'] } }] }] });
    engine.scripting.compile(`defineScript({ name: 'Gun', onStart(ctx) { const b = ctx.spawn('Bullet', { position: { x: 3, y: 4 } }); ctx.state.bullet = b; ctx.destroy(); } })`);
    const gun = engine.world.createEntity('Gun');
    engine.world.addComponent(gun, Script, { script: 'Gun' });
    engine.step(1 / 60);
    expect(engine.world.isAlive(gun)).toBe(false);
    const bullets = engine.world.findByTag('bullet');
    expect(bullets).toHaveLength(1);
    expect(engine.world.getComponent(bullets[0], Transform)!.position.x).toBe(3);
    expect(engine.world.getParent(bullets[0])).toBe(NULL_ENTITY);
    engine.dispose();
  });
});

describe('Engine headless', () => {
  it('runs the fixed-step loop deterministically and pauses', () => {
    const run = () => {
      const engine = headless();
      engine.scripting.consoleLogging = false;
      engine.scripting.load(smokeScripts);
      engine.loadScene(smokeScene2D());
      for (let i = 0; i < 120; i++) engine.step(1 / 60);
      const out = JSON.stringify(engine.saveScene());
      engine.dispose();
      return out;
    };
    expect(run()).toBe(run());
    const engine = headless();
    engine.scripting.load(smokeScripts);
    engine.loadScene(smokeScene3D());
    engine.step(1 / 60);
    expect(engine.clock.tick).toBe(1);
    engine.pause();
    engine.step(1 / 60);
    expect(engine.clock.tick).toBe(2); // accumulator consumed
    expect(engine.paused).toBe(true);
    engine.resume();
    const snap = engine.saveScene('Snap');
    const w2 = engine.world;
    loadScene(w2, snap);
    expect(saveScene(w2, 'Snap')).toEqual(snap);
    engine.dispose();
  });
});
