import { describe, it, expect } from 'vitest';
import { Vec2, Vec3, Quat, Mat4, Color, Rect, Random, lerp, clamp, wrapAngle, lerpAngle, remap, damp } from '../src/index';

describe('scalar', () => {
  it('lerp/clamp/remap', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(lerpAngle(0.1, Math.PI * 2 - 0.1, 0.5)).toBeCloseTo(0);
    expect(damp(0, 10, 5, 100)).toBeCloseTo(10);
  });
});

describe('Vec2/Vec3', () => {
  it('performs basic arithmetic and normalization', () => {
    const v = new Vec2(3, 4);
    expect(v.length()).toBe(5);
    expect(v.clone().normalize().length()).toBeCloseTo(1);
    expect(new Vec2(1, 0).rotate(Math.PI / 2).y).toBeCloseTo(1);
    expect(Vec2.cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    const out = new Vec2();
    Vec2.reflect(new Vec2(1, -1), new Vec2(0, 1), out);
    expect(out.x).toBe(1);
    expect(out.y).toBe(1);
    const c = new Vec3(1, 0, 0).cross(new Vec3(0, 1, 0));
    expect(c.z).toBe(1);
    expect(new Vec3(1, 2, 3).toJSON()).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('Quat', () => {
  it('rotates vectors and round trips euler/2D angles', () => {
    const q = Quat.fromAxisAngle(new Vec3(0, 0, 1), Math.PI / 2);
    const v = q.rotateVec3(new Vec3(1, 0, 0), new Vec3());
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
    expect(Quat.fromAngle2D(0.7).angle2D()).toBeCloseTo(0.7);
    const e = Quat.fromEuler(0.3, 0.5, -0.2).toEuler();
    expect(e.x).toBeCloseTo(0.3);
    expect(e.y).toBeCloseTo(0.5);
    expect(e.z).toBeCloseTo(-0.2);
    const a = new Quat(), b = Quat.fromAngle2D(1);
    expect(a.slerp(b, 0.5).angle2D()).toBeCloseTo(0.5);
    expect(q.clone().multiply(q.clone().invert()).equals(Quat.IDENTITY)).toBe(true);
  });

  it('lookRotation faces the target', () => {
    const q = new Quat().lookRotation(new Vec3(0, 0, -1));
    expect(q.equals(Quat.IDENTITY, 1e-5)).toBe(true);
    const right = new Quat().lookRotation(new Vec3(1, 0, 0));
    const f = right.rotateVec3(Vec3.FORWARD, new Vec3());
    expect(f.x).toBeCloseTo(1);
    expect(f.z).toBeCloseTo(0);
  });
});

describe('Mat4', () => {
  it('composes, decomposes and inverts', () => {
    const p = new Vec3(1, 2, 3), r = Quat.fromEuler(0.2, 0.4, 0.1), s = new Vec3(2, 3, 4);
    const m = new Mat4().compose(p, r, s);
    const p2 = new Vec3(), r2 = new Quat(), s2 = new Vec3();
    m.decompose(p2, r2, s2);
    expect(p2.equals(p)).toBe(true);
    expect(s2.equals(s, 1e-5)).toBe(true);
    expect(Math.abs(r2.dot(r))).toBeCloseTo(1, 5);
    const inv = m.clone().invert();
    expect(Mat4.multiply(m, inv, new Mat4()).equals(Mat4.identity(), 1e-4)).toBe(true);
    const pt = m.transformPoint(new Vec3(0, 0, 0), new Vec3());
    expect(pt.equals(p)).toBe(true);
  });

  it('builds projection and view matrices', () => {
    const view = new Mat4().lookAt(new Vec3(0, 0, 5), new Vec3(0, 0, 0));
    const p = view.transformPoint(new Vec3(0, 0, 0), new Vec3());
    expect(p.z).toBeCloseTo(-5);
    const proj = new Mat4().perspective(Math.PI / 2, 1, 0.1, 100);
    const clip = Mat4.multiply(proj, view, new Mat4()).transformPoint(new Vec3(0, 0, 0), new Vec3());
    expect(clip.x).toBeCloseTo(0);
    expect(Math.abs(clip.z)).toBeLessThan(1);
    const ortho = new Mat4().orthographic(-1, 1, -1, 1, 0.1, 10);
    expect(ortho.transformPoint(new Vec3(1, 1, -5), new Vec3()).x).toBeCloseTo(1);
  });
});

describe('Color', () => {
  it('parses and formats hex/css', () => {
    const c = Color.fromHex('#ff8000');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0.502, 2);
    expect(c.toHex()).toBe('#ff8000');
    expect(Color.fromHex('#f00').toHex()).toBe('#ff0000');
    expect(Color.fromHex('#00ff0080').a).toBeCloseTo(0.502, 2);
    expect(new Color(0, 0, 1, 0.5).toCSS()).toBe('rgba(0,0,255,0.5)');
    expect(Color.fromHSL(120, 1, 0.5).toHex()).toBe('#00ff00');
    expect(Color.fromInt(0x123456).toHex()).toBe('#123456');
  });
});

describe('Rect', () => {
  it('tests containment and intersection', () => {
    const r = new Rect(0, 0, 10, 5);
    expect(r.contains({ x: 5, y: 2 })).toBe(true);
    expect(r.contains({ x: 11, y: 2 })).toBe(false);
    expect(r.intersects(new Rect(9, 4, 5, 5))).toBe(true);
    expect(r.intersects(new Rect(10, 5, 5, 5))).toBe(false);
    expect(r.clone().union(new Rect(-5, -5, 1, 1)).x).toBe(-5);
  });
});

describe('Random', () => {
  it('is deterministic for a seed and uniform-ish', () => {
    const a = new Random(123), b = new Random(123);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Random(1).next()).not.toBe(new Random(2).next());
    const r = new Random(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
    const state = r.getState();
    const x = r.next();
    r.setState(state);
    expect(r.next()).toBe(x);
    expect(r.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});
