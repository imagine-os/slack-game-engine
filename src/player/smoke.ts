/**
 * Built-in smoke scenes used by `play.html` when no project is given. They
 * exercise the 2D renderer + physics + scripting, and the WebGL renderer.
 * Not shipped as demos; the demos worker owns `public/demos/`.
 */
import { createEmptyScene, type SceneData } from '../core/ecs/Scene';
import type { ScriptSource } from '../scripting/types';

export const smokeScripts: ScriptSource[] = [
  {
    name: 'PlayerController',
    source: `
defineScript({
  name: 'PlayerController',
  props: { speed: { type: 'number', default: 6 }, jump: { type: 'number', default: 11 } },
  onStart(ctx) {
    const cc = ctx.get('CharacterController2D');
    cc.moveSpeed = ctx.props.speed;
    cc.jumpSpeed = ctx.props.jump;
  },
  onOwnerInput(ctx, snap) {
    const cc = ctx.get('CharacterController2D');
    cc.move(snap.axes.moveX || 0);
    if (snap.pressed.includes('jump')) cc.jump();
    if (snap.released.includes('jump')) cc.jumpReleased();
    const sprite = ctx.get('Shape');
    if (sprite) sprite.fill.setHex(cc.grounded ? '#4cc2ff' : '#ff7a3d');
  },
  onCollisionEnter(ctx, other, info) {
    if (info.impulse > 8) { const cam = ctx.getOn(ctx.find('Camera'), 'Camera2D'); if (cam) cam.shake = 0.15; }
  },
});`,
  },
  {
    name: 'Spinner',
    source: `
defineScript({
  name: 'Spinner',
  props: { speed: { type: 'number', default: 1 } },
  onUpdate(ctx, dt) {
    const t = ctx.transform;
    t.setEuler(ctx.time.elapsed * 0.4 * ctx.props.speed, ctx.time.elapsed * ctx.props.speed, 0);
    t.position.y = 1 + Math.sin(ctx.time.elapsed * 1.5) * 0.3;
    t.markDirty();
  },
});`,
  },
  {
    name: 'Orbit',
    source: `
defineScript({
  name: 'Orbit',
  props: { distance: { type: 'number', default: 9 } },
  onStart(ctx) { ctx.state.yaw = 0.7; ctx.state.pitch = 0.45; ctx.state.dist = ctx.props.distance; },
  onUpdate(ctx, dt) {
    const m = ctx.input.mouse; const s = ctx.state;
    if (m.held(0)) { s.yaw -= m.delta.x * 0.005; s.pitch = ctx.math.clamp(s.pitch + m.delta.y * 0.005, 0.05, 1.5); }
    if (m.wheel) s.dist = ctx.math.clamp(s.dist * (1 + Math.sign(m.wheel) * 0.1), 3, 40);
    if (!m.held(0)) s.yaw += dt * 0.15;
    const cp = Math.cos(s.pitch);
    ctx.transform.setPosition(Math.sin(s.yaw) * cp * s.dist, Math.sin(s.pitch) * s.dist, Math.cos(s.yaw) * cp * s.dist);
  },
});`,
  },
  {
    name: 'Bouncer',
    source: `
defineScript({
  name: 'Bouncer',
  onCollisionEnter(ctx, other, info) {
    if (info.impulse > 6) {
      const em = ctx.get('ParticleEmitter');
      if (em) em.burst(12);
    }
  },
});`,
  },
];

let nextId = 1;
function entity(name: string, components: Record<string, Record<string, unknown>>, parent?: number) {
  const e = { id: nextId++, name, parent, components: Object.entries(components).map(([type, data]) => ({ type, data })) };
  if (parent === undefined) delete (e as { parent?: number }).parent;
  return e;
}

export function smokeScene2D(): SceneData {
  nextId = 1;
  const scene = createEmptyScene('Smoke2D');
  scene.settings = { gravity: { x: 0, y: -24 } };
  const camera = entity('Camera', {
    Transform: { position: { x: 0, y: 2, z: 0 } },
    Camera2D: { zoom: 0.9, followSmoothing: 5, followOffset: { x: 0, y: 1.5 }, backgroundColor: { r: 0.07, g: 0.08, b: 0.12, a: 1 }, ambientLight: { r: 0.55, g: 0.55, b: 0.65, a: 1 } },
    AudioListener: {},
  });
  scene.entities.push(camera);
  scene.entities.push(entity('Ground', {
    Transform: { position: { x: 0, y: -1, z: 0 } },
    RigidBody2D: { bodyType: 'static', friction: 0.8 },
    BoxCollider2D: { width: 40, height: 2 },
    Shape: { kind: 'rect', width: 40, height: 2, fill: { r: 0.22, g: 0.25, b: 0.33, a: 1 }, layer: -5 },
  }));
  for (let i = 0; i < 4; i++) {
    scene.entities.push(entity(`Platform${i}`, {
      Transform: { position: { x: -8 + i * 5.5, y: 1.5 + (i % 2) * 2, z: 0 } },
      RigidBody2D: { bodyType: 'static' },
      BoxCollider2D: { width: 3, height: 0.5 },
      Shape: { kind: 'rect', width: 3, height: 0.5, fill: { r: 0.3, g: 0.35, b: 0.45, a: 1 }, layer: -4 },
    }));
  }
  const player = entity('Player', {
    Transform: { position: { x: -4, y: 1, z: 0 } },
    RigidBody2D: { fixedRotation: true, friction: 0.2, restitution: 0 },
    BoxCollider2D: { width: 0.8, height: 1.4 },
    CharacterController2D: {},
    Shape: { kind: 'rect', width: 0.8, height: 1.4, fill: { r: 0.3, g: 0.76, b: 1, a: 1 }, layer: 1 },
    PlayerInput: { owner: 'local' },
    Script: { script: 'PlayerController', props: { speed: 7, jump: 12 } },
    Light2D: { radius: 6, intensity: 1.2, color: { r: 1, g: 0.95, b: 0.8, a: 1 } },
    Tag: { tags: ['player'] },
  });
  scene.entities.push(player);
  scene.entities.push(entity('Label', {
    Transform: { position: { x: 0, y: 5.5, z: 0 } },
    Text: { text: 'Forge Engine · 2D smoke test', size: 0.6, color: { r: 1, g: 1, b: 1, a: 0.9 }, outlineWidth: 0.04 },
  }));
  const colors = ['#ff7a3d', '#8b7dff', '#4cc2ff', '#ffd166', '#06d6a0', '#ef476f'];
  for (let i = 0; i < 14; i++) {
    const c = colors[i % colors.length];
    const r = parseInt(c.slice(1, 3), 16) / 255, g = parseInt(c.slice(3, 5), 16) / 255, b = parseInt(c.slice(5, 7), 16) / 255;
    const isBall = i % 2 === 0;
    scene.entities.push(entity(`Bouncer${i}`, {
      Transform: { position: { x: -6 + i * 0.95, y: 6 + (i % 3) * 1.5, z: 0 }, rotation: { x: 0, y: 0, z: Math.sin(i * 0.3), w: Math.cos(i * 0.3) } },
      RigidBody2D: { restitution: isBall ? 0.75 : 0.2, friction: 0.5, velocity: { x: (i % 3) - 1, y: 0 } },
      ...(isBall ? { CircleCollider2D: { radius: 0.35 } } : { BoxCollider2D: { width: 0.7, height: 0.7 } }),
      Shape: isBall ? { kind: 'circle', radius: 0.35, fill: { r, g, b, a: 1 } } : { kind: 'rect', width: 0.7, height: 0.7, fill: { r, g, b, a: 1 } },
      ParticleEmitter: { emitting: false, rate: 0, maxParticles: 60, lifetime: 0.5, speed: 3, spread: Math.PI, startSize: 0.15, endSize: 0, startColor: { r, g, b, a: 1 }, endColor: { r, g, b, a: 0 }, gravity: { x: 0, y: -5 } },
      Script: { script: 'Bouncer', props: {} },
    }));
  }
  scene.entities.push(entity('Embers', {
    Transform: { position: { x: 6, y: 0.2, z: 0 } },
    ParticleEmitter: { rate: 25, lifetime: 1.6, speed: 2, spread: 0.4, startSize: 0.25, endSize: 0.02, gravity: { x: 0, y: 1.5 }, startColor: { r: 1, g: 0.6, b: 0.2, a: 0.9 }, endColor: { r: 1, g: 0.1, b: 0, a: 0 } },
    Light2D: { radius: 4, intensity: 0.9, color: { r: 1, g: 0.5, b: 0.2, a: 1 } },
  }));
  // Camera follows the player.
  (camera.components[1].data as { follow: number }).follow = player.id;
  return scene;
}

export function smokeScene3D(): SceneData {
  nextId = 1;
  const scene = createEmptyScene('Smoke3D');
  scene.entities.push(entity('Camera', {
    Transform: { position: { x: 6, y: 4, z: 7 } },
    Camera3D: { fov: 55, fogEnabled: true, fogNear: 15, fogFar: 45, fogColor: { r: 0.8, g: 0.85, b: 0.9, a: 1 }, lookAt: 3 },
    Script: { script: 'Orbit', props: { distance: 10 } },
    AudioListener: {},
  }));
  scene.entities.push(entity('Sun', {
    Transform: { position: { x: 5, y: 10, z: 5 }, rotation: { x: -0.4, y: 0.35, z: 0.15, w: 0.83 } },
    Light: { kind: 'directional', intensity: 1.1, color: { r: 1, g: 0.96, b: 0.9, a: 1 } },
  }));
  scene.entities.push(entity('Cube', {
    Transform: { position: { x: 0, y: 1, z: 0 } },
    MeshRenderer: { mesh: 'cube', color: { r: 1, g: 0.48, b: 0.24, a: 1 }, roughness: 0.35, metallic: 0.2 },
    Script: { script: 'Spinner', props: { speed: 1 } },
  }));
  scene.entities.push(entity('Ambient', { Transform: {}, Light: { kind: 'ambient', intensity: 0.25, color: { r: 0.6, g: 0.7, b: 1, a: 1 } } }));
  scene.entities.push(entity('Ground', {
    Transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 30, y: 1, z: 30 } },
    MeshRenderer: { mesh: 'plane', color: { r: 0.3, g: 0.36, b: 0.3, a: 1 }, roughness: 0.9 },
  }));
  scene.entities.push(entity('Lamp', {
    Transform: { position: { x: -2.5, y: 1.5, z: 1.5 } },
    Light: { kind: 'point', intensity: 2.5, range: 8, color: { r: 0.4, g: 0.7, b: 1, a: 1 } },
    MeshRenderer: { mesh: 'sphere', color: { r: 0.4, g: 0.7, b: 1, a: 1 }, emissive: { r: 0.4, g: 0.7, b: 1, a: 1 }, unlit: true },
  }));
  const ring = 9;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    scene.entities.push(entity(`Pillar${i}`, {
      Transform: { position: { x: Math.cos(a) * 5, y: 0.75 + (i % 3) * 0.25, z: Math.sin(a) * 5 }, scale: { x: 0.6, y: 1.5 + (i % 3) * 0.5, z: 0.6 } },
      MeshRenderer: { mesh: i % 2 ? 'cylinder' : 'cube', color: { r: 0.55 + (i % 3) * 0.1, g: 0.5, b: 0.85 - (i % 3) * 0.1, a: 1 }, roughness: 0.5 },
    }));
  }
  scene.entities.push(entity('Wire', {
    Transform: { position: { x: 0, y: 1, z: 0 }, scale: { x: 3, y: 3, z: 3 } },
    MeshRenderer: { mesh: 'sphere', color: { r: 1, g: 1, b: 1, a: 0.4 }, wireframe: true, unlit: true },
  }));
  return scene;
}
