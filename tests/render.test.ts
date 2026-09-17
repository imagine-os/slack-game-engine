import { describe, expect, it } from 'vitest';
import {
  AutoQuality, Camera3D, DEFAULT_QUALITY_LEVELS, Engine, Frustum, Light, Mat4, MeshRenderer, PostProcessSettings, SkySettings, Vec3, WaterMaterial,
  boundsSphere, computeBounds, copyPostSettings, createShadowFit, createSkyState, defaultPostSettings, defaultRegistry, evaluateSky,
  fitDirectionalShadow, perspectiveNdcDepth, postSettingsFromJSON, postSettingsToJSON, selectLod, sunDirection, sunElevation, transformSphere,
  type QualityLevel,
} from '../src/index';
import { showcaseMeshes, smokeSceneShowcase, smokeScripts } from '../src/player/smoke';

function cameraViewProj(eye: Vec3, target: Vec3, fovDeg = 60, aspect = 16 / 9, near = 0.1, far = 200): Mat4 {
  const view = new Mat4().lookAt(eye, target);
  const proj = new Mat4().perspective((fovDeg * Math.PI) / 180, aspect, near, far);
  return Mat4.multiply(proj, view, new Mat4());
}

describe('Frustum culling', () => {
  const vp = cameraViewProj(new Vec3(0, 5, 10), new Vec3(0, 0, 0));
  const f = new Frustum().setFromMatrix(vp);

  it('keeps spheres in view and rejects spheres behind or beside the camera', () => {
    expect(f.containsSphere(0, 0, 0, 1)).toBe(true);
    expect(f.containsSphere(0, 0, 20, 1)).toBe(false); // behind the camera
    expect(f.containsSphere(200, 0, 0, 1)).toBe(false); // far to the side
    expect(f.containsSphere(0, 0, -500, 1)).toBe(false); // beyond far plane
    expect(f.containsPoint(0, 1, -5)).toBe(true);
  });

  it('accounts for the sphere radius at the edges', () => {
    // A point just outside the right edge is culled, but a large sphere there is kept.
    expect(f.containsSphere(60, 0, -20, 0.1)).toBe(false);
    expect(f.containsSphere(60, 0, -20, 50)).toBe(true);
  });

  it('transformSphere scales the radius by the largest axis scale and moves the centre', () => {
    const m = new Mat4().compose({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 2, y: 5, z: 1 });
    const out = transformSphere(m.m, [1, 0, 0], 0.5, new Float32Array(4));
    expect(out[0]).toBeCloseTo(3);
    expect(out[1]).toBeCloseTo(2);
    expect(out[2]).toBeCloseTo(3);
    expect(out[3]).toBeCloseTo(2.5);
  });

  it('computes bounds and bounding spheres', () => {
    const b = computeBounds(new Float32Array([-1, 0, 0, 1, 2, 0, 0, 0, 3]));
    expect(b.min).toEqual([-1, 0, 0]);
    expect(b.max).toEqual([1, 2, 3]);
    const s = boundsSphere(b);
    expect(s.center).toEqual([0, 1, 1.5]);
    expect(s.radius).toBeCloseTo(Math.hypot(1, 1, 1.5));
    expect(computeBounds(new Float32Array(0))).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

describe('LOD selection', () => {
  const lods = [{ mesh: 'mid', distance: 20 }, { mesh: 'far', distance: 60 }, { mesh: '', distance: 150 }];
  it('returns -1 within the first distance and the furthest matching level after', () => {
    expect(selectLod(lods, 5)).toBe(-1);
    expect(selectLod(lods, 20)).toBe(0);
    expect(selectLod(lods, 59.9)).toBe(0);
    expect(selectLod(lods, 60)).toBe(1);
    expect(selectLod(lods, 1000)).toBe(2);
    expect(selectLod([], 10)).toBe(-1);
    expect(selectLod(undefined, 10)).toBe(-1);
  });
});

describe('Directional shadow fitting', () => {
  const eye = new Vec3(3, 6, 12), target = new Vec3(0, 0, 0);
  const near = 0.1, far = 300;
  const vp = cameraViewProj(eye, target, 55, 16 / 9, near, far);
  const inv = vp.clone().invert();
  const lightDir = new Vec3(0.4, -1, 0.3).normalize();

  it('perspectiveNdcDepth maps near/far to -1/1 and is monotonic', () => {
    expect(perspectiveNdcDepth(near, near, far)).toBe(-1);
    expect(perspectiveNdcDepth(far, near, far)).toBe(1);
    expect(perspectiveNdcDepth(1000, near, far)).toBe(1);
    const a = perspectiveNdcDepth(10, near, far), b = perspectiveNdcDepth(50, near, far);
    expect(a).toBeLessThan(b);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeLessThan(1);
  });

  it('encloses every corner of the covered frustum slice in the light frustum', () => {
    const ndcFar = perspectiveNdcDepth(60, near, far);
    const fit = fitDirectionalShadow(inv, ndcFar, lightDir, 2048, createShadowFit());
    const p = new Vec3();
    for (let i = 0; i < 8; i++) {
      inv.transformPoint({ x: i & 1 ? 1 : -1, y: i & 2 ? 1 : -1, z: i & 4 ? ndcFar : -1 }, p);
      fit.viewProj.transformPoint(p, p);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-4);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-4);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(1 + 1e-4);
    }
    expect(fit.texelSize).toBeCloseTo((2 * fit.radius) / 2048);
    expect(fit.far).toBeGreaterThan(fit.near);
  });

  it('keeps casters behind the slice (toward the light) inside the depth range', () => {
    const ndcFar = perspectiveNdcDepth(40, near, far);
    const fit = fitDirectionalShadow(inv, ndcFar, lightDir, 1024, createShadowFit());
    // A point above the slice centre, back along the light direction by up to one radius.
    const p = fit.center.clone().addScaled(lightDir, -fit.radius * 0.9);
    fit.viewProj.transformPoint(p, p);
    expect(p.z).toBeGreaterThanOrEqual(-1);
    expect(p.z).toBeLessThanOrEqual(1);
  });

  it('is stable under camera translation: same radius, centre snapped to texels', () => {
    const ndcFar = perspectiveNdcDepth(60, near, far);
    const a = fitDirectionalShadow(inv, ndcFar, lightDir, 1024, createShadowFit());
    const vp2 = cameraViewProj(eye.clone().add({ x: 0.013, y: 0, z: 0.021 }), target.clone().add({ x: 0.013, y: 0, z: 0.021 }), 55, 16 / 9, near, far);
    const b = fitDirectionalShadow(vp2.clone().invert(), ndcFar, lightDir, 1024, createShadowFit());
    expect(b.radius).toBe(a.radius);
    // Centre delta in light space is a whole number of texels in x/y.
    const rot = new Mat4().lookAt(Vec3.ZERO, lightDir, Math.abs(lightDir.y) > 0.99 ? { x: 0, y: 0, z: 1 } : Vec3.UP);
    const ca = rot.transformPoint(a.center, new Vec3()), cb = rot.transformPoint(b.center, new Vec3());
    const dx = (cb.x - ca.x) / a.texelSize, dy = (cb.y - ca.y) / a.texelSize;
    expect(Math.abs(dx - Math.round(dx))).toBeLessThan(1e-3);
    expect(Math.abs(dy - Math.round(dy))).toBeLessThan(1e-3);
  });

  it('handles a light pointing straight down', () => {
    const fit = fitDirectionalShadow(inv, perspectiveNdcDepth(30, near, far), new Vec3(0, -1, 0), 512, createShadowFit());
    for (let i = 0; i < 16; i++) expect(Number.isFinite(fit.viewProj.m[i])).toBe(true);
    expect(fit.radius).toBeGreaterThan(0);
  });
});

describe('Sky and time of day', () => {
  it('sun elevation peaks at noon and is negative at midnight', () => {
    expect(sunElevation(6)).toBeCloseTo(0);
    expect(sunElevation(12)).toBeCloseTo(Math.PI / 2);
    expect(sunElevation(18)).toBeCloseTo(0);
    expect(sunElevation(0)).toBeCloseTo(-Math.PI / 2);
    expect(sunElevation(12, 0.8)).toBeCloseTo(Math.PI / 2 * 0.8);
    expect(sunElevation(36)).toBeCloseTo(sunElevation(12)); // wraps
  });

  it('sun direction is a unit vector that rises in the east and sets in the west', () => {
    const d = new Vec3();
    sunDirection(12, 0, 0.8, d);
    expect(d.length()).toBeCloseTo(1);
    expect(d.y).toBeCloseTo(Math.sin(sunElevation(12, 0.8)));
    const morning = sunDirection(8, 0, 1, new Vec3()), evening = sunDirection(16, 0, 1, new Vec3());
    expect(Math.sign(morning.x)).toBe(-Math.sign(evening.x));
    expect(morning.y).toBeGreaterThan(0);
    expect(sunDirection(0, 0, 1, new Vec3()).y).toBeLessThan(0);
  });

  const params = (timeOfDay: number) => ({ timeOfDay, sunAzimuth: 35, sunElevationScale: 0.8, turbidity: 0.3, exposure: 1, tint: { r: 1, g: 1, b: 1 }, sunIntensity: 1.2, moonIntensity: 0.12, ambientIntensity: 1 });

  it('evaluates a bright blue day and a dark starry night with moonlight', () => {
    const day = evaluateSky(params(12), createSkyState());
    expect(day.night).toBe(0);
    expect(day.zenith.b).toBeGreaterThan(day.zenith.r);
    expect(day.lightIntensity).toBeCloseTo(1.2);
    expect(day.lightDir.y).toBeLessThan(0); // light travels downward
    expect(day.lightDir.x).toBeCloseTo(-day.sunDir.x);
    expect(day.sunColor.r).toBeGreaterThan(0.9);

    const night = evaluateSky(params(0), createSkyState());
    expect(night.night).toBe(1);
    expect(night.lightIntensity).toBeCloseTo(0.12);
    expect(night.lightColor.b).toBeGreaterThan(night.lightColor.r); // moon is bluish
    expect(night.lightDir.y).toBeLessThan(0);
    expect(night.zenith.r + night.zenith.g + night.zenith.b).toBeLessThan(0.2);
  });

  it('golden hour is warm at the horizon and interpolates smoothly', () => {
    const golden = evaluateSky(params(17.5), createSkyState());
    expect(golden.sunElevation).toBeGreaterThan(0);
    expect(golden.sunElevation).toBeLessThan(0.35);
    expect(golden.horizon.r).toBeGreaterThan(golden.horizon.b);
    expect(golden.sunColor.r).toBeGreaterThan(golden.sunColor.b);
    expect(golden.lightIntensity).toBeGreaterThan(0.3);
    expect(golden.lightIntensity).toBeLessThan(1.2);
    // Neighbouring times give nearby colours (no discontinuity).
    const a = evaluateSky(params(17.49), createSkyState()), b = evaluateSky(params(17.51), createSkyState());
    expect(Math.abs(a.horizon.r - b.horizon.r)).toBeLessThan(0.02);
    expect(Math.abs(a.lightIntensity - b.lightIntensity)).toBeLessThan(0.02);
  });

  it('applies exposure and tint and writes hemisphere ambient', () => {
    const base = evaluateSky(params(12), createSkyState());
    const tinted = evaluateSky({ ...params(12), exposure: 2, tint: { r: 1, g: 0.5, b: 1 } }, createSkyState());
    expect(tinted.zenith.r).toBeCloseTo(base.zenith.r * 2);
    expect(tinted.zenith.g).toBeCloseTo(base.zenith.g);
    expect(base.ambientSky.r + base.ambientSky.g + base.ambientSky.b).toBeGreaterThan(base.ambientGround.r + base.ambientGround.g + base.ambientGround.b);
  });
});

describe('Post-processing settings', () => {
  it('round-trips through JSON', () => {
    const s = defaultPostSettings();
    s.enabled = true; s.bloomIntensity = 0.7; s.tonemap = 'reinhard'; s.lift.set(0.02, 0, 0.05, 1); s.vignette = 0.4; s.msaa = 2;
    const json = JSON.parse(JSON.stringify(postSettingsToJSON(s)));
    const back = postSettingsFromJSON(json);
    expect(postSettingsToJSON(back)).toEqual(postSettingsToJSON(s));
    expect(back.lift.r).toBeCloseTo(0.02);
    expect(back.tonemap).toBe('reinhard');
  });

  it('fills defaults, ignores garbage and clamps ranges', () => {
    const s = postSettingsFromJSON({ exposure: -3, vignette: 7, tonemap: 'weird' as never, msaa: 3.7, lift: 'nope' as never, fxaa: 'yes' as never });
    const d = defaultPostSettings();
    expect(s.exposure).toBe(0);
    expect(s.vignette).toBe(1);
    expect(s.tonemap).toBe(d.tonemap);
    expect(s.msaa).toBe(4);
    expect(s.lift.equals(d.lift)).toBe(true);
    expect(s.fxaa).toBe(d.fxaa);
    expect(postSettingsFromJSON(null).enabled).toBe(false);
  });

  it('copies from the PostProcessSettings component', () => {
    const c = new PostProcessSettings();
    c.bloomThreshold = 1.4; c.gain.set(1.1, 1, 0.9, 1); c.chromaticAberration = 0.3;
    const target = defaultPostSettings();
    copyPostSettings(c, target);
    expect(target.enabled).toBe(true);
    expect(target.bloomThreshold).toBe(1.4);
    expect(target.gain.r).toBeCloseTo(1.1);
    expect(target.chromaticAberration).toBe(0.3);
    // The copy does not alias the component's colours.
    c.gain.r = 5;
    expect(target.gain.r).toBeCloseTo(1.1);
  });
});

describe('AutoQuality', () => {
  function run(aq: AutoQuality, dt: number, seconds: number): number[] {
    const changes: number[] = [];
    for (let t = 0; t < seconds; t += dt) { const c = aq.sample(dt); if (c >= 0) changes.push(c); }
    return changes;
  }

  it('steps down after sustained low FPS and back up after sustained high FPS', () => {
    const applied: QualityLevel[] = [];
    const aq = new AutoQuality({ applyQuality: (l) => applied.push(l) });
    aq.enabled = true;
    const down = run(aq, 1 / 25, 6);
    expect(down.length).toBeGreaterThanOrEqual(1);
    expect(aq.level).toBeGreaterThan(0);
    expect(applied.at(-1)).toBe(DEFAULT_QUALITY_LEVELS[aq.level]);
    const before = aq.level;
    run(aq, 1 / 120, 30);
    expect(aq.level).toBeLessThan(before);
  });

  it('ignores hitches and does nothing when disabled or at the last level', () => {
    const aq = new AutoQuality(null);
    expect(run(aq, 1 / 20, 10)).toEqual([]);
    aq.enabled = true;
    expect(aq.sample(2)).toBe(-1);
    expect(aq.sample(0)).toBe(-1);
    aq.setLevel(DEFAULT_QUALITY_LEVELS.length - 1);
    expect(run(aq, 1 / 10, 10)).toEqual([]);
    expect(aq.level).toBe(DEFAULT_QUALITY_LEVELS.length - 1);
    expect(aq.current.name).toBe('potato');
  });
});

describe('Rendering components', () => {
  it('registers the new components with serializable fields', () => {
    for (const type of ['SkySettings', 'PostProcessSettings', 'WaterMaterial']) expect(defaultRegistry.get(type)).toBeDefined();
    const mr = new MeshRenderer();
    mr.lods = [{ mesh: 'lod1', distance: 30 }];
    mr.windStrength = 0.2; mr.castShadow = false; mr.flatShading = true;
    const data = defaultRegistry.serialize(mr);
    expect(data.lods).toEqual([{ mesh: 'lod1', distance: 30 }]);
    expect(data.castShadow).toBe(false);
    const copy = new MeshRenderer();
    defaultRegistry.applyProps(copy, data);
    expect(copy.lods).toEqual(mr.lods);
    expect(copy.lods).not.toBe(mr.lods);
    expect(copy.windStrength).toBe(0.2);
    expect(copy.flatShading).toBe(true);
    const light = new Light();
    expect(light.castShadows).toBe(false);
    expect(defaultRegistry.serialize(new WaterMaterial()).foamWidth).toBe(0);
    expect(new SkySettings().timeOfDay).toBe(17.5);
    expect(new Camera3D().fov).toBe(60);
  });
});

describe('Showcase scene', () => {
  it('builds valid flat-shaded meshes with colours and bounds', () => {
    const meshes = showcaseMeshes();
    for (const [name, m] of Object.entries(meshes)) {
      const n = m.positions.length / 3;
      expect(n, name).toBeGreaterThan(0);
      expect(m.positions.length % 3, name).toBe(0);
      expect(m.colors!.length, name).toBe(n * 3);
      expect(m.indices.length % 3, name).toBe(0);
      expect(m.bounds!.max[1], name).toBeGreaterThanOrEqual(m.bounds!.min[1]);
      for (let i = 0; i < m.indices.length; i++) expect(m.indices[i]).toBeLessThan(n);
    }
    expect(meshes['showcase-tree-lod1'].indices.length).toBeLessThan(meshes['showcase-tree'].indices.length);
  });

  it('loads headlessly and runs without script errors', () => {
    const engine = Engine.create(null, { renderer: 'none', audio: false, seed: 1 });
    const errors: string[] = [];
    engine.diagnostics.on('error', (d) => errors.push(d.message));
    engine.scripting.load(smokeScripts);
    engine.loadScene(smokeSceneShowcase(9, { cycleSpeed: 1 }));
    for (let i = 0; i < 60; i++) engine.step(1 / 60);
    expect(errors).toEqual([]);
    const sky = engine.world.componentsOfType(SkySettings)[0];
    expect(sky.timeOfDay).toBeGreaterThan(9);
    expect(engine.world.componentsOfType(WaterMaterial).length).toBe(1);
    expect(engine.world.componentsOfType(PostProcessSettings)[0].enabled).toBe(true);
    expect(engine.world.componentsOfType(MeshRenderer).some((m) => m.lods.length > 0 && m.windStrength > 0)).toBe(true);
    engine.dispose();
  });
});
