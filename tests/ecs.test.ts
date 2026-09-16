import { describe, it, expect } from 'vitest';
import {
  World, Component, registerComponent, Transform, Tag, saveScene, loadScene,
  createPrefab, instantiatePrefab, NULL_ENTITY, Vec2, Color, createSystem, Registry,
} from '../src/index';

class Health extends Component {
  static override readonly type = 'Health';
  hp = 10;
  max = 10;
  target = 0; // entity ref
  tint = new Color(1, 0, 0, 1);
  offset = new Vec2(1, 2);
}
registerComponent(Health, { fields: { target: { type: 'entity' } } });

class Velocity extends Component {
  static override readonly type = 'Velocity';
  v = new Vec2();
}
registerComponent(Velocity);

describe('World', () => {
  it('creates and destroys entities with generation-safe ids', () => {
    const w = new World();
    const a = w.createEntity('A');
    expect(w.isAlive(a)).toBe(true);
    expect(w.nameOf(a)).toBe('A');
    w.destroyEntity(a);
    expect(w.isAlive(a)).toBe(false);
    const b = w.createEntity();
    expect(b).not.toBe(a); // reused slot, new generation
    expect(w.isAlive(a)).toBe(false);
    expect(w.isAlive(b)).toBe(true);
    expect(w.entityCount).toBe(1);
  });

  it('adds components with init and finds by name/tag', () => {
    const w = new World();
    const e = w.createEntity('Player');
    const h = w.addComponent(e, Health, { hp: 3, tint: { r: 0, g: 1, b: 0, a: 1 } });
    expect(h.hp).toBe(3);
    expect(h.tint.g).toBe(1);
    expect(h.tint).toBeInstanceOf(Color);
    w.addComponent(e, Tag).add('hero');
    expect(w.findByName('Player')).toBe(e);
    expect(w.findByTag('hero')).toEqual([e]);
    expect(() => w.addComponent(e, Health)).toThrow();
  });

  it('keeps queries cached and up to date', () => {
    const w = new World();
    const q = w.query([Health, Velocity]);
    const a = w.createEntity();
    w.addComponent(a, Health);
    expect(q.size).toBe(0);
    w.addComponent(a, Velocity);
    expect(q.size).toBe(1);
    const b = w.createEntity();
    w.addComponent(b, Health);
    w.addComponent(b, Velocity);
    expect(q.size).toBe(2);
    expect(w.query([Health, Velocity])).toBe(q);
    w.removeComponent(a, Velocity);
    expect(q.size).toBe(1);
    expect(q.has(b)).toBe(true);
    w.destroyEntity(b);
    expect(q.size).toBe(0);
    const excl = w.query([Health], [Velocity]);
    expect(excl.size).toBe(1);
    let n = 0;
    w.each(Health, (_e, h) => { n++; expect(h).toBeInstanceOf(Health); });
    expect(n).toBe(1);
  });

  it('runs systems by phase and priority', () => {
    const w = new World();
    const order: string[] = [];
    w.addSystem(createSystem('b', 'update', () => order.push('b'), 10));
    w.addSystem(createSystem('a', 'update', () => order.push('a'), -10));
    w.addSystem(createSystem('r', 'render', () => order.push('r')));
    w.runPhase('update', 0.016);
    expect(order).toEqual(['a', 'b']);
    w.runPhase('render', 0.016);
    expect(order).toEqual(['a', 'b', 'r']);
  });
});

describe('Transform hierarchy', () => {
  it('composes world matrices from parents', () => {
    const w = new World();
    const parent = w.createEntity('P');
    const child = w.createEntity('C');
    w.setParent(child, parent);
    const pt = w.getComponent(parent, Transform)!;
    const ct = w.getComponent(child, Transform)!;
    pt.setPosition(10, 0);
    pt.angle = Math.PI / 2;
    ct.setPosition(1, 0);
    w.updateTransforms();
    const wp = ct.getWorldPosition();
    expect(wp.x).toBeCloseTo(10);
    expect(wp.y).toBeCloseTo(1);
    expect(ct.getWorldAngle()).toBeCloseTo(Math.PI / 2);
    expect(w.getChildren(parent)).toEqual([child]);
    expect(w.roots()).toEqual([parent]);
    expect(() => w.setParent(parent, child)).toThrow();
    // Destroying the parent destroys children.
    w.destroyEntity(parent);
    expect(w.isAlive(child)).toBe(false);
  });

  it('keeps world transform when reparenting with keepWorld', () => {
    const w = new World();
    const p = w.createEntity();
    const c = w.createEntity();
    w.getComponent(p, Transform)!.setPosition(5, 5);
    w.getComponent(c, Transform)!.setPosition(7, 7);
    w.updateTransforms();
    w.setParent(c, p, true);
    w.updateTransforms();
    const ct = w.getComponent(c, Transform)!;
    expect(ct.position.x).toBeCloseTo(2);
    expect(ct.getWorldPosition().x).toBeCloseTo(7);
  });
});

describe('Scene serialization', () => {
  it('round trips a scene with hierarchy and entity refs', () => {
    const w = new World();
    const a = w.createEntity('A');
    const b = w.createEntity('B');
    w.setParent(b, a);
    const bt = w.getComponent(b, Transform)!;
    bt.setPosition(1, 2, 3).setScale(2);
    bt.angle = 0.5;
    w.addComponent(a, Health, { hp: 7, target: b, tint: { r: 0.5, g: 0.25, b: 0, a: 1 } });
    w.addComponent(b, Tag, { tags: ['x', 'y'] });
    const scene = saveScene(w, 'Test', { gravity: -9 });
    const json = JSON.stringify(scene);
    const w2 = new World();
    const res = loadScene(w2, JSON.parse(json));
    expect(w2.entityCount).toBe(2);
    const a2 = w2.findByName('A')!;
    const b2 = w2.findByName('B')!;
    expect(w2.getParent(b2)).toBe(a2);
    expect(res.roots).toEqual([a2]);
    const h2 = w2.getComponent(a2, Health)!;
    expect(h2.hp).toBe(7);
    expect(h2.target).toBe(b2);
    expect(h2.tint.r).toBeCloseTo(0.5);
    const t2 = w2.getComponent(b2, Transform)!;
    expect(t2.position.z).toBe(3);
    expect(t2.scale.x).toBe(2);
    expect(t2.angle).toBeCloseTo(0.5);
    expect(w2.getComponent(b2, Tag)!.tags).toEqual(['x', 'y']);
    // Re-saving yields identical data.
    const scene2 = saveScene(w2, 'Test', { gravity: -9 });
    expect(scene2).toEqual(scene);
  });

  it('instantiates prefabs with fresh ids', () => {
    const w = new World();
    const root = w.createEntity('Root');
    const kid = w.createEntity('Kid');
    w.setParent(kid, root);
    w.addComponent(kid, Health, { target: root });
    const prefab = createPrefab(w, root);
    expect(prefab.entities).toHaveLength(2);
    const inst = instantiatePrefab(w, prefab, { position: { x: 9, y: 9 }, name: 'Clone' });
    expect(inst).not.toBe(root);
    expect(w.nameOf(inst)).toBe('Clone');
    expect(w.getComponent(inst, Transform)!.position.x).toBe(9);
    const kids = w.getChildren(inst);
    expect(kids).toHaveLength(1);
    expect(w.getComponent(kids[0], Health)!.target).toBe(inst);
    expect(w.getParent(inst)).toBe(NULL_ENTITY);
  });

  it('exposes inspector metadata via the Registry', () => {
    const r = new Registry();
    r.register(Health, { fields: { target: { type: 'entity' }, hp: { min: 0, max: 100, type: 'number' } } });
    const f = r.fields('Health');
    expect(f.hp).toMatchObject({ type: 'number', min: 0, max: 100 });
    expect(f.tint.type).toBe('color');
    expect(f.offset.type).toBe('vec2');
    expect(f.target.type).toBe('entity');
    expect(r.defaults('Health')).toEqual({ hp: 10, max: 10, target: 0, tint: { r: 1, g: 0, b: 0, a: 1 }, offset: { x: 1, y: 2 } });
  });
});
