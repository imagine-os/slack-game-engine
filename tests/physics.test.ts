import { describe, it, expect } from 'vitest';
import {
  World, Transform, RigidBody2D, BoxCollider2D, CircleCollider2D, PolygonCollider2D, Physics2DWorld,
  collideShapes, createManifold, transformPolygon, boxPoints, type CircleShape, saveScene, loadScene,
  CharacterController2D, Physics2DSystem, RigidBody3D, BoxCollider3D, SphereCollider3D, Physics3DWorld,
} from '../src/index';

function makeBox(world: World, x: number, y: number, w: number, h: number, type: 'dynamic' | 'static' = 'dynamic') {
  const e = world.createEntity();
  world.getComponent(e, Transform)!.setPosition(x, y);
  world.addComponent(e, RigidBody2D, { bodyType: type });
  world.addComponent(e, BoxCollider2D, { width: w, height: h });
  return e;
}

describe('collision2d', () => {
  it('detects circle-circle with correct normal', () => {
    const a: CircleShape = { kind: 'circle', x: 0, y: 0, r: 1 };
    const b: CircleShape = { kind: 'circle', x: 1.5, y: 0, r: 1 };
    const m = createManifold();
    expect(collideShapes(a, b, m)).toBe(true);
    expect(m.nx).toBeCloseTo(1);
    expect(m.penetration).toBeCloseTo(0.5);
    b.x = 3;
    expect(collideShapes(a, b, m)).toBe(false);
  });

  it('detects box-box via SAT with two contact points', () => {
    const a = transformPolygon(boxPoints(2, 2), 0, 0, 0, 1, 1, 0, 0);
    const b = transformPolygon(boxPoints(2, 2), 0, 1.8, 0, 1, 1, 0, 0);
    const m = createManifold();
    expect(collideShapes(a, b, m)).toBe(true);
    expect(m.ny).toBeCloseTo(1);
    expect(m.penetration).toBeCloseTo(0.2);
    expect(m.count).toBe(2);
    const c = transformPolygon(boxPoints(2, 2), 0, 2.5, 0, 1, 1, 0, 0);
    expect(collideShapes(a, c, m)).toBe(false);
  });

  it('detects rotated box vs circle', () => {
    const box = transformPolygon(boxPoints(2, 2), 0, 0, Math.PI / 4, 1, 1, 0, 0);
    const circle: CircleShape = { kind: 'circle', x: 0, y: 1.6, r: 0.5 };
    const m = createManifold();
    expect(collideShapes(circle, box, m)).toBe(true);
    expect(m.ny).toBeLessThan(0); // normal from circle toward box
  });
});

describe('Physics2DWorld', () => {
  it('lets a box fall and rest on the ground', () => {
    const w = new World();
    const phys = new Physics2DWorld();
    makeBox(w, 0, -1, 20, 2, 'static');
    const box = makeBox(w, 0, 5, 1, 1);
    const events: string[] = [];
    phys.events.on('collisionEnter', () => events.push('enter'));
    for (let i = 0; i < 240; i++) phys.step(w, 1 / 60);
    const t = w.getComponent(box, Transform)!;
    const rb = w.getComponent(box, RigidBody2D)!;
    expect(t.position.y).toBeCloseTo(0.5, 1);
    expect(Math.abs(rb.velocity.y)).toBeLessThan(0.5);
    expect(rb.grounded).toBe(true);
    expect(events).toEqual(['enter']);
  });

  it('bounces a ball with restitution and respects layers', () => {
    const w = new World();
    const phys = new Physics2DWorld();
    makeBox(w, 0, -1, 20, 2, 'static');
    const ball = w.createEntity();
    w.getComponent(ball, Transform)!.setPosition(0, 3);
    w.addComponent(ball, RigidBody2D, { restitution: 0.9, layer: 1 });
    w.addComponent(ball, CircleCollider2D, { radius: 0.5 });
    let maxAfterBounce = 0;
    let bounced = false;
    for (let i = 0; i < 180; i++) {
      phys.step(w, 1 / 60);
      const rb = w.getComponent(ball, RigidBody2D)!;
      if (rb.velocity.y > 0) bounced = true;
      if (bounced) maxAfterBounce = Math.max(maxAfterBounce, w.getComponent(ball, Transform)!.position.y);
    }
    expect(bounced).toBe(true);
    expect(maxAfterBounce).toBeGreaterThan(1.5);
    // Disable layer 0 vs 1: ball falls through.
    const w2 = new World();
    const phys2 = new Physics2DWorld();
    phys2.setLayerCollision(0, 1, false);
    makeBox(w2, 0, -1, 20, 2, 'static');
    const ball2 = w2.createEntity();
    w2.getComponent(ball2, Transform)!.setPosition(0, 3);
    w2.addComponent(ball2, RigidBody2D, { layer: 1 });
    w2.addComponent(ball2, CircleCollider2D, { radius: 0.5 });
    for (let i = 0; i < 120; i++) phys2.step(w2, 1 / 60);
    expect(w2.getComponent(ball2, Transform)!.position.y).toBeLessThan(-5);
  });

  it('fires trigger events without resolving', () => {
    const w = new World();
    const phys = new Physics2DWorld();
    phys.gravity.set(0, 0);
    const zone = w.createEntity();
    w.addComponent(zone, RigidBody2D, { bodyType: 'static' });
    w.addComponent(zone, BoxCollider2D, { width: 2, height: 2, isTrigger: true });
    const mover = w.createEntity();
    w.getComponent(mover, Transform)!.setPosition(-3, 0);
    w.addComponent(mover, RigidBody2D, { velocity: { x: 4, y: 0 } });
    w.addComponent(mover, CircleCollider2D, { radius: 0.5 });
    const log: string[] = [];
    phys.events.on('triggerEnter', () => log.push('enter'));
    phys.events.on('triggerExit', () => log.push('exit'));
    for (let i = 0; i < 120; i++) phys.step(w, 1 / 60);
    expect(log).toEqual(['enter', 'exit']);
    expect(w.getComponent(mover, RigidBody2D)!.velocity.x).toBeCloseTo(4);
  });

  it('raycasts against colliders', () => {
    const w = new World();
    const phys = new Physics2DWorld();
    makeBox(w, 5, 0, 2, 2, 'static');
    const tri = w.createEntity();
    w.getComponent(tri, Transform)!.setPosition(0, 5);
    w.addComponent(tri, RigidBody2D, { bodyType: 'static' });
    w.addComponent(tri, PolygonCollider2D, { points: [-1, -1, 1, -1, 0, 1] });
    phys.refresh(w);
    const hit = phys.raycast({ x: 0, y: 0 }, { x: 1, y: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(4);
    expect(hit!.normal.x).toBeCloseTo(-1);
    const up = phys.raycast({ x: 0, y: 0 }, { x: 0, y: 1 });
    expect(up!.entity).toBe(tri);
    expect(up!.distance).toBeCloseTo(4);
    expect(phys.raycast({ x: 0, y: 0 }, { x: -1, y: 0 })).toBeNull();
    expect(phys.overlapCircle({ x: 5, y: 0 }, 0.1)).toHaveLength(1);
    expect(phys.queryPoint({ x: 0, y: 5 })).toEqual([tri]);
  });

  it('is deterministic for identical inputs', () => {
    const run = () => {
      const w = new World();
      const phys = new Physics2DWorld();
      makeBox(w, 0, -1, 40, 2, 'static');
      for (let i = 0; i < 12; i++) {
        const e = makeBox(w, (i % 4) * 1.1 - 2, 2 + Math.floor(i / 4) * 1.5, 1, 1);
        w.getComponent(e, RigidBody2D)!.angularVelocity = (i % 3) - 1;
      }
      const ball = w.createEntity();
      w.getComponent(ball, Transform)!.setPosition(-6, 3);
      w.addComponent(ball, RigidBody2D, { velocity: { x: 9, y: 0 }, restitution: 0.5 });
      w.addComponent(ball, CircleCollider2D, { radius: 0.6 });
      for (let i = 0; i < 300; i++) phys.step(w, 1 / 60);
      return saveScene(w);
    };
    const a = JSON.stringify(run());
    const b = JSON.stringify(run());
    expect(a).toBe(b);
  });

  it('resumes deterministically from serialized state', () => {
    const w = new World();
    const phys = new Physics2DWorld();
    makeBox(w, 0, -1, 40, 2, 'static');
    const box = makeBox(w, 0, 6, 1, 1);
    w.getComponent(box, RigidBody2D)!.velocity.set(2, 0);
    for (let i = 0; i < 30; i++) phys.step(w, 1 / 60);
    const snapshot = saveScene(w);
    for (let i = 0; i < 60; i++) phys.step(w, 1 / 60);
    const expected = w.getComponent(w.findByName('Entity 2') ?? box, Transform)!.position.clone();
    const w2 = new World();
    loadScene(w2, snapshot);
    const phys2 = new Physics2DWorld();
    for (let i = 0; i < 60; i++) phys2.step(w2, 1 / 60);
    const boxes = w2.with(RigidBody2D).filter((e) => w2.getComponent(e, RigidBody2D)!.bodyType === 'dynamic');
    const p2 = w2.getComponent(boxes[0], Transform)!.position;
    expect(p2.x).toBeCloseTo(expected.x, 5);
    expect(p2.y).toBeCloseTo(expected.y, 5);
  });

  it('drives a CharacterController2D with jump and coyote time', () => {
    const w = new World();
    const phys = new Physics2DWorld();
    const sys = new Physics2DSystem(phys);
    makeBox(w, 0, -1, 40, 2, 'static');
    const hero = makeBox(w, 0, 0.5, 0.8, 1.6);
    w.getComponent(hero, RigidBody2D)!.fixedRotation = true;
    const cc = w.addComponent(hero, CharacterController2D, { moveSpeed: 5, jumpSpeed: 10 });
    for (let i = 0; i < 30; i++) sys.update(w, 1 / 60);
    expect(cc.grounded).toBe(true);
    cc.move(1);
    for (let i = 0; i < 60; i++) sys.update(w, 1 / 60);
    const rb = w.getComponent(hero, RigidBody2D)!;
    expect(rb.velocity.x).toBeCloseTo(5, 0);
    expect(w.getComponent(hero, Transform)!.position.x).toBeGreaterThan(2);
    cc.move(0);
    cc.jump();
    sys.update(w, 1 / 60);
    expect(rb.velocity.y).toBeGreaterThan(5);
    let maxY = 0;
    for (let i = 0; i < 120; i++) { sys.update(w, 1 / 60); maxY = Math.max(maxY, w.getComponent(hero, Transform)!.position.y); }
    expect(maxY).toBeGreaterThan(2);
    expect(cc.grounded).toBe(true);
  });
});

describe('Physics3DWorld', () => {
  it('drops a sphere onto a box floor', () => {
    const w = new World();
    const phys = new Physics3DWorld();
    const floor = w.createEntity();
    w.getComponent(floor, Transform)!.setPosition(0, -0.5, 0);
    w.addComponent(floor, RigidBody3D, { bodyType: 'static', restitution: 0 });
    w.addComponent(floor, BoxCollider3D, { size: { x: 20, y: 1, z: 20 } });
    const ball = w.createEntity();
    w.getComponent(ball, Transform)!.setPosition(0, 4, 0);
    w.addComponent(ball, RigidBody3D, { restitution: 0 });
    w.addComponent(ball, SphereCollider3D, { radius: 0.5 });
    let entered = 0;
    phys.events.on('collisionEnter', () => entered++);
    for (let i = 0; i < 240; i++) phys.step(w, 1 / 60);
    expect(w.getComponent(ball, Transform)!.position.y).toBeCloseTo(0.5, 1);
    expect(w.getComponent(ball, RigidBody3D)!.grounded).toBe(true);
    expect(entered).toBe(1);
    const hit = phys.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(hit?.entity).toBe(ball);
  });
});
