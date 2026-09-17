import { Color, Mat4, Vec2, Vec3, type Vec3Like } from '../core/math';
import type { World } from '../core/ecs/World';
import { Transform } from '../core/ecs/Transform';
import { NULL_ENTITY } from '../core/ecs/Entity';
import { DebugDraw } from './DebugDraw';
import { createRenderStats, type Renderer, type RendererHost, type RendererOptions, type RenderStats } from './Renderer';
import { Camera3D, Light, MeshRenderer, PostProcessSettings, SkySettings, WaterMaterial } from './components';
import { AutoQuality, type QualityLevel, type QualityTarget } from './AutoQuality';
import { Shader } from './webgl/Shader';
import { GPUMesh, type MeshData } from './webgl/Mesh';
import { PRIMITIVES } from './webgl/primitives';
import type { GLTFAsset } from './webgl/GLTFLoader';
import { Frustum, selectLod, transformSphere } from './webgl/Frustum';
import { createShadowFit, fitDirectionalShadow, perspectiveNdcDepth, type ShadowFit } from './webgl/ShadowMath';
import { ShadowMap } from './webgl/ShadowMap';
import { PostProcess } from './webgl/PostProcess';
import { copyPostSettings, defaultPostSettings, type PostSettings } from './webgl/PostSettings';
import { createSkyState, evaluateSky, type SkyState } from './webgl/SkyMath';
import {
  DEPTH_FS, DEPTH_VS, LINE_FS, LINE_VS, LIT_FS, LIT_VS, MAX_POINT_LIGHTS, SKY_FS, SKY_VS, UNLIT_FS, UNLIT_VS, WATER_FS, WATER_VS,
} from './webgl/shaders';

interface Batch {
  key: string;
  mesh: GPUMesh;
  material: MeshRenderer;
  water: WaterMaterial | null;
  baseColor: [number, number, number, number] | undefined;
  /** Instances visible to the camera. */
  matrices: Float32Array;
  count: number;
  /** Instances inside the light frustum that cast shadows. */
  shadowMatrices: Float32Array;
  shadowCount: number;
  transparent: boolean;
  depth: number;
}

/** Global wind driving `MeshRenderer.windStrength` sway and cloud drift. */
export interface WindSettings {
  /** World-space direction (normalised by the renderer). */
  direction: Vec3;
  /** Overall strength multiplier (1 = gentle breeze). */
  strength: number;
}

const _view = new Mat4();
const _proj = new Mat4();
const _viewProj = new Mat4();
const _invViewProj = new Mat4();
const _roll = new Mat4();
const _camPos = new Vec3();
const _dir = new Vec3();
const _tmp = new Vec3();
const _sphere = new Float32Array(4);
const _white: [number, number, number, number] = [1, 1, 1, 1];

/** Gamma → linear for a channel (used when the post pipeline tonemaps). */
function toLinear(v: number): number {
  return v <= 0 ? 0 : Math.pow(v, 2.2);
}

/**
 * WebGL2 renderer: instanced mesh drawing with lit (directional + point
 * lights, hemisphere ambient, vertex colours, flat shading, wind sway, PCF
 * shadows, fog) and unlit shaders, stylised water, a procedural sky driven by
 * time of day, and an HDR post-processing chain (bloom, tonemapping, grading,
 * vignette, FXAA). Frustum culling and LOD selection happen per instance.
 * Transparent batches are sorted back-to-front after opaque ones.
 */
export class WebGLRenderer implements Renderer, QualityTarget {
  readonly kind = '3d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly debug = new DebugDraw();
  readonly clearColor = new Color(0.1, 0.11, 0.14, 1);
  readonly stats: RenderStats = createRenderStats();
  pixelsPerUnit: number;
  hidpi: boolean;
  width = 0;
  height = 0;
  pixelRatio = 1;

  /** Camera matrices of the last frame. */
  readonly viewProj = new Mat4();
  readonly cameraPosition = new Vec3();

  /** Post-processing settings (overwritten each frame by an enabled `PostProcessSettings` component when present). */
  readonly post: PostSettings = defaultPostSettings();
  /** Resolved sky/lighting state of the last frame (sun direction, palette, ambient). */
  readonly sky: SkyState = createSkyState();
  /** Wind for foliage sway and clouds. */
  readonly wind: WindSettings = { direction: new Vec3(1, 0, 0.35), strength: 1 };
  /** Frame-time driven quality ladder; enable with `renderer.autoQuality.enabled = true` or the `autoQuality` option. */
  readonly autoQuality: AutoQuality;
  /** Seconds of animation time (wind, waves, clouds). Advances automatically unless `autoTime` is false. */
  time = 0;
  autoTime = true;
  /** Master switch for shadow maps. */
  shadowsEnabled: boolean;
  /** Requested shadow map resolution (the quality ladder may lower the effective size). */
  shadowMapSize: number;
  /** Requested render scale (0.25..1). */
  renderScale: number;
  /** Shadow fit of the last frame (light view/projection), for debugging. */
  readonly shadowFit: ShadowFit = createShadowFit();
  /** True when the last frame was rendered in linear space and tonemapped. */
  linear = false;

  private host: RendererHost | null = null;
  private lit: Shader;
  private unlit: Shader;
  private water: Shader;
  private depth: Shader;
  private skyShader: Shader;
  private line: Shader;
  private skyVao: WebGLVertexArrayObject;
  private lineVao: WebGLVertexArrayObject;
  private lineBuffer: WebGLBuffer;
  private lineData = new Float32Array(7 * 2 * 1024);
  private meshes = new Map<string, GPUMesh>();
  private textures = new Map<string, WebGLTexture>();
  private whiteTexture: WebGLTexture;
  private batches = new Map<string, Batch>();
  private batchList: Batch[] = [];
  private pointPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointColor = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointRange = new Float32Array(MAX_POINT_LIGHTS);
  private frustum = new Frustum();
  private lightFrustum = new Frustum();
  private shadowMap: ShadowMap;
  private postProcess: PostProcess;
  private lastTime = -1;
  private quality: QualityLevel | null = null;
  private shakeAmp = 0;
  private shakeDecay = 5;
  private shakeTime = 0;
  private frameDt = 0;

  // Per-frame lighting state.
  private ambientSky = new Color(0.15, 0.15, 0.18, 1);
  private ambientGround = new Color(0.15, 0.15, 0.18, 1);
  private dirDir = new Vec3(0.4, -1, 0.3).normalize();
  private dirColor = new Color(1, 1, 1, 1);
  private dirIntensity = 1;
  private pointCount = 0;
  private shadowLight: Light | null = null;
  private shadowsActive = false;
  private skySettings: SkySettings | null = null;
  private procedural = false;
  private fogMode = 0;
  private fogColor = new Color();
  private fogParams = new Float32Array(4);
  private fogSun = new Float32Array(4);
  private effectiveShadowSize = 2048;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.pixelsPerUnit = opts.pixelsPerUnit ?? 1;
    this.hidpi = opts.hidpi ?? true;
    this.shadowsEnabled = opts.shadows ?? true;
    this.shadowMapSize = opts.shadowMapSize ?? 2048;
    this.renderScale = opts.renderScale ?? 1;
    if (opts.clearColor) this.clearColor.setHex(opts.clearColor);
    this.lit = new Shader(gl, LIT_VS, LIT_FS, 'lit');
    this.unlit = new Shader(gl, UNLIT_VS, UNLIT_FS, 'unlit');
    this.water = new Shader(gl, WATER_VS, WATER_FS, 'water');
    this.depth = new Shader(gl, DEPTH_VS, DEPTH_FS, 'depth');
    this.skyShader = new Shader(gl, SKY_VS, SKY_FS, 'sky');
    this.line = new Shader(gl, LINE_VS, LINE_FS, 'line');
    this.shadowMap = new ShadowMap(gl, 16);
    this.postProcess = new PostProcess(gl);
    this.autoQuality = new AutoQuality(this);
    this.autoQuality.enabled = opts.autoQuality ?? false;
    // Fullscreen triangle for the sky.
    this.skyVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.skyVao);
    const skyBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Debug lines: interleaved position(3) + color(4).
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    this.lineBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    this.whiteTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
  }

  init(host: RendererHost): void {
    this.host = host;
  }

  resize(width: number, height: number, pixelRatio?: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = pixelRatio ?? (this.hidpi && typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.canvas.width = Math.floor(this.width * this.pixelRatio);
    this.canvas.height = Math.floor(this.height * this.pixelRatio);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Whether half-float render targets are available (HDR bloom). */
  get hdrSupported(): boolean {
    return this.postProcess.floatSupported;
  }

  // ------------------------------------------------------------ resources

  /** Register a mesh under a name usable by `MeshRenderer.mesh`. */
  addMesh(name: string, data: MeshData): void {
    this.meshes.get(name)?.dispose();
    this.meshes.set(name, new GPUMesh(this.gl, data));
  }

  /** True when a mesh name resolves without falling back to the cube. */
  hasMesh(name: string): boolean {
    return this.meshes.has(name) || !!PRIMITIVES[name] || (name.startsWith('gltf:') && !!this.host?.getAsset(name.slice(5).split('#')[0]));
  }

  private resolveMeshes(name: string): GPUMesh[] {
    const cached = this.meshes.get(name);
    if (cached) return [cached];
    if (PRIMITIVES[name]) {
      const m = new GPUMesh(this.gl, PRIMITIVES[name]());
      this.meshes.set(name, m);
      return [m];
    }
    if (name.startsWith('gltf:')) {
      const [assetId, idxStr] = name.slice(5).split('#');
      const asset = this.host?.getAsset<GLTFAsset>(assetId);
      if (!asset) return [];
      const meshIndex = idxStr !== undefined ? parseInt(idxStr, 10) : -1;
      const list: GPUMesh[] = [];
      const meshesToUse = meshIndex >= 0 ? [asset.meshes[meshIndex]].filter(Boolean) : asset.meshes;
      meshesToUse.forEach((gm, mi) => {
        gm.primitives.forEach((prim, pi) => {
          const key = `${name}::${meshIndex >= 0 ? meshIndex : mi}::${pi}`;
          let gpu = this.meshes.get(key);
          if (!gpu) {
            gpu = new GPUMesh(this.gl, prim);
            this.meshes.set(key, gpu);
          }
          list.push(gpu);
        });
      });
      return list;
    }
    this.host?.warn(`Unknown mesh "${name}"`);
    this.meshes.set(name, new GPUMesh(this.gl, PRIMITIVES.cube()));
    return [this.meshes.get(name)!];
  }

  private texture(id: string): WebGLTexture {
    if (!id) return this.whiteTexture;
    const cached = this.textures.get(id);
    if (cached) return cached;
    const img = this.host?.getAsset<HTMLImageElement | HTMLCanvasElement>(id);
    if (!img || !(img instanceof HTMLImageElement || img instanceof HTMLCanvasElement)) return this.whiteTexture;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.textures.set(id, tex);
    return tex;
  }

  // --------------------------------------------------------------- camera

  /**
   * Kick the camera: `amplitude` in world units (decays exponentially at
   * `decay` per second). Repeated calls keep the larger amplitude.
   */
  setCameraShake(amplitude: number, decay = 5): void {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeDecay = decay;
  }

  private findCamera(world: World): { cam: Camera3D | null; t: Transform | null } {
    let best: Camera3D | null = null;
    let bestT: Transform | null = null;
    for (const cam of world.componentsOfType(Camera3D)) {
      if (!cam.active) continue;
      if (!best || cam.priority > best.priority) {
        best = cam;
        bestT = world.getComponent(cam.entity, Transform) ?? null;
      }
    }
    return { cam: best, t: bestT };
  }

  private setupCamera(world: World, cam: Camera3D | null, t: Transform | null): void {
    const aspect = this.width / this.height;
    if (cam && t) {
      if (cam.lookAt !== NULL_ENTITY && world.isAlive(cam.lookAt)) {
        const target = world.getComponent(cam.lookAt, Transform);
        if (target) {
          t.lookAt(target.getWorldPosition(_tmp));
          t.updateWorldMatrix();
        }
      }
      _view.copy(t.worldMatrix).invert();
      t.getWorldPosition(_camPos);
      if (cam.orthographic) {
        const h = cam.orthoSize;
        _proj.orthographic(-h * aspect, h * aspect, -h, h, cam.near, cam.far);
      } else _proj.perspective((cam.fov * Math.PI) / 180, aspect, cam.near, cam.far);
    } else {
      _camPos.set(5, 5, 8);
      _view.lookAt(_camPos, Vec3.ZERO);
      _proj.perspective(Math.PI / 3, aspect, 0.1, 500);
    }
    if (this.shakeAmp > 0.0005) {
      // Smooth pseudo-random offset in view space plus a little roll.
      const s = this.shakeTime * 27;
      const ox = (Math.sin(s * 1.1) * 0.6 + Math.sin(s * 2.7 + 1.3) * 0.4) * this.shakeAmp;
      const oy = (Math.sin(s * 1.7 + 0.7) * 0.6 + Math.sin(s * 3.1 + 2.1) * 0.4) * this.shakeAmp;
      const roll = Math.sin(s * 1.3 + 0.4) * this.shakeAmp * 0.05;
      const c = Math.cos(roll), sn = Math.sin(roll);
      _roll.identity();
      _roll.m[0] = c; _roll.m[1] = sn; _roll.m[4] = -sn; _roll.m[5] = c;
      _roll.m[12] = ox; _roll.m[13] = oy;
      _view.premultiply(_roll);
      this.shakeAmp *= Math.exp(-this.shakeDecay * this.frameDt);
      if (this.shakeAmp < 0.0005) this.shakeAmp = 0;
    }
    Mat4.multiply(_proj, _view, _viewProj);
    _invViewProj.copy(_viewProj).invert();
    this.viewProj.copy(_viewProj);
    this.cameraPosition.copy(_camPos);
    this.frustum.setFromMatrix(_viewProj);
  }

  screenToWorld(sx: number, sy: number, out: Vec3): Vec3 {
    const nx = (sx / this.width) * 2 - 1;
    const ny = 1 - (sy / this.height) * 2;
    _invViewProj.copy(this.viewProj).invert();
    const near = _invViewProj.transformPoint({ x: nx, y: ny, z: -1 }, new Vec3());
    const far = _invViewProj.transformPoint({ x: nx, y: ny, z: 1 }, _tmp);
    _dir.copy(far).sub(near);
    if (Math.abs(_dir.y) < 1e-6) return out.copy(near);
    const tHit = -near.y / _dir.y;
    return out.copy(near).addScaled(_dir, Math.max(0, tHit));
  }

  /** Ray from the camera through a screen pixel. */
  screenRay(sx: number, sy: number, origin: Vec3, direction: Vec3): void {
    const nx = (sx / this.width) * 2 - 1;
    const ny = 1 - (sy / this.height) * 2;
    _invViewProj.copy(this.viewProj).invert();
    _invViewProj.transformPoint({ x: nx, y: ny, z: -1 }, origin);
    _invViewProj.transformPoint({ x: nx, y: ny, z: 1 }, direction);
    direction.sub(origin).normalize();
  }

  worldToScreen(p: Vec3Like, out: Vec2): Vec2 {
    this.viewProj.transformPoint(p, _tmp);
    return out.set(((_tmp.x + 1) / 2) * this.width, ((1 - _tmp.y) / 2) * this.height);
  }

  // -------------------------------------------------------------- quality

  /** Apply a quality ladder level (called by `autoQuality`). */
  applyQuality(level: QualityLevel): void {
    this.quality = level;
  }

  private effectiveRenderScale(): number {
    const s = Math.min(this.renderScale, this.quality?.renderScale ?? 1);
    return Math.min(1, Math.max(0.25, s || 1));
  }

  // --------------------------------------------------------------- render

  render(world: World, _alpha: number): void {
    const gl = this.gl;
    const stats = this.stats;
    stats.drawCalls = stats.primitives = stats.batches = stats.instances = stats.triangles = stats.culled = stats.shadowDrawCalls = stats.postDrawCalls = 0;
    this.advanceTime();
    const { cam, t } = this.findCamera(world);
    this.setupCamera(world, cam, t);
    this.collectSettings(world);
    this.collectLights(world, cam);
    const postActive = this.post.enabled || this.effectiveRenderScale() < 1;
    this.linear = postActive && this.postProcess.isLinear(this.post);
    this.prepareShadows(cam);
    this.collectBatches(world);

    if (this.shadowsActive) this.renderShadowPass();

    const scale = this.effectiveRenderScale();
    const sw = Math.max(1, Math.round(this.canvas.width * scale));
    const sh = Math.max(1, Math.round(this.canvas.height * scale));
    if (postActive) this.postProcess.begin(sw, sh, this.post);
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    const clear = cam?.clearColor ?? this.clearColor;
    if (this.linear) gl.clearColor(toLinear(clear.r), toLinear(clear.g), toLinear(clear.b), 1);
    else gl.clearColor(clear.r, clear.g, clear.b, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (cam?.skybox ?? true) this.drawSky(cam);

    // Opaque first (insertion order), then transparent back to front.
    const list = this.batchList;
    list.sort((a, b) => Number(a.transparent) - Number(b.transparent) || (a.transparent ? b.depth - a.depth : 0));
    gl.enable(gl.DEPTH_TEST);
    this.lastShader = null;
    for (const b of list) if (b.count > 0) this.drawBatch(b, cam);
    this.drawDebug();
    gl.disable(gl.BLEND);

    if (postActive) {
      this.postProcess.end(this.canvas.width, this.canvas.height, this.post);
      stats.drawCalls += this.postProcess.drawCalls;
      stats.postDrawCalls = this.postProcess.drawCalls;
    }
    if (this.autoQuality.enabled) this.autoQuality.sample(this.frameDt);
  }

  private advanceTime(): void {
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
    const dt = this.lastTime < 0 ? 1 / 60 : Math.min(0.25, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    this.frameDt = dt;
    if (this.autoTime) this.time += dt;
    this.shakeTime += dt;
  }

  /** Pick up scene-level settings components (sky, post-processing). */
  private collectSettings(world: World): void {
    this.skySettings = null;
    for (const s of world.componentsOfType(SkySettings)) {
      if (s.enabled) { this.skySettings = s; break; }
    }
    for (const p of world.componentsOfType(PostProcessSettings)) {
      if (p.enabled) { copyPostSettings(p, this.post); break; }
    }
    const q = this.quality;
    if (q) {
      this.post.msaa = Math.min(this.post.msaa, q.msaa);
      if (!q.bloom) this.post.bloom = false;
      if (!q.fxaa) this.post.fxaa = false;
    }
    this.effectiveShadowSize = Math.min(this.shadowMapSize, q?.shadowMapSize ?? Infinity);
    const sky = this.skySettings;
    this.procedural = !!sky && sky.mode === 'procedural';
    if (sky) {
      evaluateSky(sky, this.sky);
      const dir = this.wind.direction;
      if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
    }
  }

  private collectLights(world: World, cam: Camera3D | null): void {
    this.ambientSky.set(0, 0, 0, 1);
    this.ambientGround.set(0, 0, 0, 1);
    this.pointCount = 0;
    this.shadowLight = null;
    let hasDir = false;
    let hasAmbient = false;
    let dirLight: Light | null = null;
    for (const l of world.componentsOfType(Light)) {
      if (!l.enabled) continue;
      const t = world.getComponent(l.entity, Transform);
      if (l.kind === 'ambient') {
        this.ambientSky.r += l.color.r * l.intensity;
        this.ambientSky.g += l.color.g * l.intensity;
        this.ambientSky.b += l.color.b * l.intensity;
        hasAmbient = true;
      } else if (l.kind === 'directional' && !hasDir && t) {
        t.forward(this.dirDir);
        this.dirColor.copy(l.color);
        this.dirIntensity = l.intensity;
        hasDir = true;
        dirLight = l;
      } else if (l.kind === 'point' && t && this.pointCount < MAX_POINT_LIGHTS) {
        const i = this.pointCount++;
        this.pointPos[i * 3] = t.worldMatrix.m[12];
        this.pointPos[i * 3 + 1] = t.worldMatrix.m[13];
        this.pointPos[i * 3 + 2] = t.worldMatrix.m[14];
        this.pointColor[i * 3] = l.color.r * l.intensity;
        this.pointColor[i * 3 + 1] = l.color.g * l.intensity;
        this.pointColor[i * 3 + 2] = l.color.b * l.intensity;
        this.pointRange[i] = l.range;
      }
    }
    if (!hasDir) {
      this.dirDir.set(0.4, -1, 0.3).normalize();
      this.dirColor.set(1, 1, 1, 1);
      this.dirIntensity = 1;
    }
    this.ambientGround.copy(this.ambientSky);
    const sky = this.skySettings;
    if (sky && sky.driveLight) {
      // Sun (or moon) from the time of day; the Light component scales it.
      const s = this.sky;
      this.dirDir.copy(s.lightDir);
      this.dirColor.copy(s.lightColor);
      this.dirIntensity = s.lightIntensity * (dirLight ? dirLight.intensity : 1);
      this.ambientSky.r += s.ambientSky.r; this.ambientSky.g += s.ambientSky.g; this.ambientSky.b += s.ambientSky.b;
      this.ambientGround.r += s.ambientGround.r; this.ambientGround.g += s.ambientGround.g; this.ambientGround.b += s.ambientGround.b;
    } else if (!hasAmbient) {
      this.ambientSky.set(0.15, 0.15, 0.18, 1);
      this.ambientGround.set(0.15, 0.15, 0.18, 1);
    }
    if (this.shadowsEnabled && dirLight && dirLight.castShadows && this.effectiveShadowSize >= 16) this.shadowLight = dirLight;
    // Fog.
    if (sky && sky.fogEnabled) {
      this.fogMode = 2;
      this.fogColor.copy(this.procedural ? this.sky.fogColor : cam?.fogColor ?? this.sky.fogColor);
      this.fogParams[0] = sky.fogDensity; this.fogParams[1] = sky.fogStart; this.fogParams[2] = Math.max(sky.fogHeightFalloff, 1e-4); this.fogParams[3] = sky.fogHeight;
      const sc = this.sky.sunColor;
      this.fogSun[0] = this.lin(sc.r); this.fogSun[1] = this.lin(sc.g); this.fogSun[2] = this.lin(sc.b);
      this.fogSun[3] = this.sky.sunElevation > -0.05 ? sky.fogSunBlend * (1 - this.sky.night) : 0;
    } else if (cam?.fogEnabled) {
      this.fogMode = 1;
      this.fogColor.copy(cam.fogColor);
      this.fogParams[0] = cam.fogNear; this.fogParams[1] = cam.fogFar;
      this.fogSun[3] = 0;
    } else this.fogMode = 0;
  }

  private lin(v: number): number {
    return this.linear ? toLinear(v) : v;
  }

  private prepareShadows(cam: Camera3D | null): void {
    const light = this.shadowLight;
    this.shadowsActive = false;
    if (!light) return;
    const near = cam?.near ?? 0.1, far = cam?.far ?? 500;
    const dist = Math.min(light.shadowDistance, far);
    const ndc = cam?.orthographic ? 1 : perspectiveNdcDepth(dist, near, far);
    this.shadowMap.resize(this.effectiveShadowSize);
    fitDirectionalShadow(_invViewProj, ndc, this.dirDir, this.shadowMap.size, this.shadowFit);
    this.lightFrustum.setFromMatrix(this.shadowFit.viewProj);
    this.shadowsActive = true;
  }

  private materialKey(m: MeshRenderer, meshName: string, water: WaterMaterial | null): string {
    return `${meshName}|${m.color.toHex(true)}|${m.metallic}|${m.roughness}|${m.emissive.toHex(false)}|${m.emissiveStrength}|${m.texture}|${Number(m.unlit)}${Number(m.unlitFog)}${Number(m.wireframe)}${Number(m.doubleSided)}${Number(m.vertexColors)}${Number(m.flatShading)}${Number(m.receiveShadow)}|${m.opacity}|${m.windStrength}${water ? '|W' + water.entity : ''}`;
  }

  private collectBatches(world: World): void {
    for (const b of this.batches.values()) b.count = b.shadowCount = 0;
    this.batchList.length = 0;
    const hasWater = world.componentsOfType(WaterMaterial).length > 0;
    const frustum = this.frustum;
    const lightFrustum = this.lightFrustum;
    const shadows = this.shadowsActive;
    for (const mr of world.componentsOfType(MeshRenderer)) {
      if (!mr.visible) continue;
      const t = world.getComponent(mr.entity, Transform);
      if (!t) continue;
      const m = t.worldMatrix.m;
      const water = hasWater ? world.getComponent(mr.entity, WaterMaterial) ?? null : null;
      // LOD selection by distance to the instance origin.
      let meshName = mr.mesh;
      if (mr.lods.length > 0) {
        const dx = m[12] - _camPos.x, dy = m[13] - _camPos.y, dz = m[14] - _camPos.z;
        const lod = selectLod(mr.lods, Math.sqrt(dx * dx + dy * dy + dz * dz));
        if (lod >= 0) meshName = mr.lods[lod].mesh;
        if (meshName === '') { this.stats.culled++; continue; }
      }
      const meshes = this.resolveMeshes(meshName);
      const baseKey = mr.instanced ? this.materialKey(mr, meshName, water) : `${this.materialKey(mr, meshName, water)}|e${mr.entity}`;
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        transformSphere(m, mesh.boundsCenter, mesh.boundsRadius, _sphere);
        let radius = _sphere[3] + (mr.windStrength > 0 ? mr.windStrength * 1.5 : 0);
        if (water) radius += water.waveAmplitude * 2;
        const visible = !mr.frustumCulled || frustum.containsSphere(_sphere[0], _sphere[1], _sphere[2], radius);
        const caster = shadows && mr.castShadow && !water && !mr.wireframe && mr.opacity >= 0.5 && mr.color.a >= 0.5
          && lightFrustum.containsSphere(_sphere[0], _sphere[1], _sphere[2], radius);
        if (!visible && !caster) { if (i === 0) this.stats.culled++; continue; }
        if (!visible && i === 0) this.stats.culled++;
        const key = meshes.length > 1 ? `${baseKey}#${i}` : baseKey;
        let batch = this.batches.get(key);
        if (!batch) {
          batch = {
            key, mesh, material: mr, water, baseColor: mesh.data.baseColor,
            matrices: new Float32Array(16 * 16), count: 0, shadowMatrices: new Float32Array(16 * 16), shadowCount: 0, transparent: false, depth: 0,
          };
          this.batches.set(key, batch);
        }
        batch.material = mr;
        batch.mesh = mesh;
        batch.water = water;
        if (visible) {
          if ((batch.count + 1) * 16 > batch.matrices.length) batch.matrices = grow(batch.matrices);
          batch.matrices.set(m, batch.count * 16);
          batch.count++;
        }
        if (caster) {
          if ((batch.shadowCount + 1) * 16 > batch.shadowMatrices.length) batch.shadowMatrices = grow(batch.shadowMatrices);
          batch.shadowMatrices.set(m, batch.shadowCount * 16);
          batch.shadowCount++;
        }
      }
    }
    for (const b of this.batches.values()) {
      if (b.count === 0 && b.shadowCount === 0) continue;
      const m = b.material;
      b.transparent = !!b.water || m.opacity < 1 || m.color.a < 1 || (b.baseColor !== undefined && b.baseColor[3] < 1);
      if (b.transparent && b.count > 0) {
        // Depth of the first instance (approximation for sorting).
        const dx = b.matrices[12] - _camPos.x, dy = b.matrices[13] - _camPos.y, dz = b.matrices[14] - _camPos.z;
        b.depth = dx * dx + dy * dy + dz * dz;
      }
      this.batchList.push(b);
    }
    // Drop stale batches occasionally to avoid unbounded growth.
    if (this.batches.size > this.batchList.length * 4 + 64) {
      for (const [k, b] of this.batches) if (b.count === 0 && b.shadowCount === 0) this.batches.delete(k);
    }
  }

  // ---------------------------------------------------------------- passes

  private renderShadowPass(): void {
    const gl = this.gl;
    const sm = this.shadowMap;
    sm.begin();
    const shader = this.depth;
    shader.use();
    shader.setMat4('uViewProj', this.shadowFit.viewProj.m);
    this.setWind(shader);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.1, 2);
    for (const b of this.batchList) {
      if (b.shadowCount === 0) continue;
      const m = b.material;
      if (m.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
      shader.setFloat('uWindStrength', m.windStrength);
      shader.setFloat('uMeshMinY', b.mesh.bounds.min[1]);
      b.mesh.bindInstances(b.shadowMatrices, b.shadowCount);
      gl.drawElementsInstanced(gl.TRIANGLES, b.mesh.indexCount, b.mesh.indexType, 0, b.shadowCount);
      this.stats.shadowDrawCalls++;
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    sm.end();
    this.stats.drawCalls += this.stats.shadowDrawCalls;
  }

  private drawSky(cam: Camera3D | null): void {
    const gl = this.gl;
    const s = this.skyShader;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    s.use();
    if (this.procedural && this.skySettings) {
      const st = this.sky, set = this.skySettings;
      s.setInt('uMode', 1);
      s.setMat4('uInvViewProj', _invViewProj.m);
      s.setVec3('uSunDir', st.sunDir.x, st.sunDir.y, st.sunDir.z);
      this.setColor(s, 'uZenith', st.zenith);
      this.setColor(s, 'uHorizon', st.horizon);
      this.setColor(s, 'uGround', st.ground);
      this.setColor(s, 'uSunColor', st.sunColor);
      s.setVec4('uSunParams', Math.cos((set.sunSize * Math.PI) / 360), set.sunGlow, set.turbidity, st.night);
      s.setVec4('uCloudParams', set.clouds, this.time * set.cloudSpeed, Math.max(0.05, set.cloudHeight), set.stars);
    } else {
      const top = cam?.skyTop ?? new Color(0.25, 0.4, 0.7, 1);
      const bottom = cam?.skyBottom ?? new Color(0.8, 0.85, 0.9, 1);
      s.setInt('uMode', 0);
      this.setColor(s, 'uTop', top);
      this.setColor(s, 'uBottom', bottom);
    }
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this.stats.drawCalls++;
  }

  private lastShader: Shader | null = null;

  /** Set a colour uniform, converting to linear when the pipeline is linear. */
  private setColor(shader: Shader, name: string, c: Color, scale = 1): void {
    if (this.linear) shader.setVec3(name, toLinear(c.r) * scale, toLinear(c.g) * scale, toLinear(c.b) * scale);
    else shader.setVec3(name, c.r * scale, c.g * scale, c.b * scale);
  }

  private setWind(shader: Shader): void {
    _dir.copy(this.wind.direction).normalize().scale(this.wind.strength);
    shader.setVec4('uWind', _dir.x, _dir.y, _dir.z, this.time);
  }

  /** Frame-constant uniforms shared by the lit and water shaders (set once per shader switch). */
  private setSceneUniforms(shader: Shader, lit: boolean): void {
    shader.setMat4('uViewProj', _viewProj.m);
    shader.setVec3('uCameraPos', _camPos.x, _camPos.y, _camPos.z);
    shader.setBool('uLinear', this.linear);
    this.setWind(shader);
    shader.setInt('uFogMode', this.fogMode);
    if (this.fogMode !== 0) {
      this.setColor(shader, 'uFogColor', this.fogColor);
      shader.setVec4('uFogParams', this.fogParams[0], this.fogParams[1], this.fogParams[2], this.fogParams[3]);
      shader.setVec4('uFogSun', this.fogSun[0], this.fogSun[1], this.fogSun[2], this.fogSun[3]);
      shader.setVec3('uSunDir', this.sky.sunDir.x, this.sky.sunDir.y, this.sky.sunDir.z);
    }
    if (!lit) return;
    this.setColor(shader, 'uAmbientSky', this.ambientSky);
    this.setColor(shader, 'uAmbientGround', this.ambientGround);
    shader.setVec3('uDirLightDir', this.dirDir.x, this.dirDir.y, this.dirDir.z);
    this.setColor(shader, 'uDirLightColor', this.dirColor, this.dirIntensity);
    shader.setInt('uPointCount', this.pointCount);
    if (this.pointCount) {
      if (this.linear) {
        for (let i = 0; i < this.pointCount * 3; i++) this.pointLinear[i] = toLinear(this.pointColor[i]);
        shader.setVec3Array('uPointColor', this.pointLinear);
      } else shader.setVec3Array('uPointColor', this.pointColor);
      shader.setVec3Array('uPointPos', this.pointPos);
      shader.setFloatArray('uPointRange', this.pointRange);
    }
    // Shadows: always bind the depth texture so the shadow sampler is valid.
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap.texture);
    shader.setInt('uShadowMap', 1);
    shader.setBool('uShadows', this.shadowsActive);
    if (this.shadowsActive && this.shadowLight) {
      const fit = this.shadowFit, l = this.shadowLight;
      shader.setMat4('uShadowMatrix', fit.viewProj.m);
      const depthRange = Math.max(fit.far - fit.near, 1e-3);
      shader.setVec4('uShadowParams', 1 / this.shadowMap.size, l.shadowBias / depthRange, l.shadowNormalBias * fit.texelSize, l.shadowSoftness);
      shader.setVec2('uShadowFade', l.shadowDistance * 0.8, l.shadowDistance);
    }
  }

  private pointLinear = new Float32Array(MAX_POINT_LIGHTS * 3);

  private drawBatch(b: Batch, _cam: Camera3D | null): void {
    const gl = this.gl;
    const m = b.material;
    const shader = b.water ? this.water : m.unlit ? this.unlit : this.lit;
    if (shader !== this.lastShader) {
      shader.use();
      this.setSceneUniforms(shader, !m.unlit || !!b.water);
      this.lastShader = shader;
    }
    const bc = b.baseColor ?? _white;
    shader.setBool('uVertexColors', m.vertexColors && b.mesh.hasColors);
    if (b.water) this.setWaterUniforms(shader, b.water, m);
    else {
      if (this.linear) shader.setVec4('uColor', toLinear(m.color.r * bc[0]), toLinear(m.color.g * bc[1]), toLinear(m.color.b * bc[2]), m.color.a * bc[3]);
      else shader.setVec4('uColor', m.color.r * bc[0], m.color.g * bc[1], m.color.b * bc[2], m.color.a * bc[3]);
      this.setColor(shader, 'uEmissive', m.emissive);
      shader.setFloat('uEmissiveStrength', m.emissiveStrength);
      shader.setFloat('uOpacity', m.opacity);
      shader.setBool('uHasTexture', m.texture !== '');
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture(m.texture));
      shader.setInt('uTexture', 0);
      shader.setFloat('uWindStrength', m.windStrength);
      shader.setFloat('uMeshMinY', b.mesh.bounds.min[1]);
      if (m.unlit) shader.setBool('uUnlitFog', m.unlitFog);
      else {
        shader.setFloat('uMetallic', m.metallic);
        shader.setFloat('uRoughness', m.roughness);
        shader.setBool('uFlatShading', m.flatShading);
        shader.setBool('uReceiveShadow', m.receiveShadow);
      }
    }
    if (m.doubleSided || b.water) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    if (b.transparent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    } else {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
    b.mesh.bindInstances(b.matrices, b.count);
    if (m.wireframe) {
      b.mesh.bindWireframe();
      gl.drawElementsInstanced(gl.LINES, b.mesh.wireIndexCount, b.mesh.indexType, 0, b.count);
    } else {
      gl.drawElementsInstanced(gl.TRIANGLES, b.mesh.indexCount, b.mesh.indexType, 0, b.count);
      const tris = (b.mesh.indexCount / 3) * b.count;
      this.stats.primitives += tris;
      this.stats.triangles += tris;
    }
    this.stats.instances += b.count;
    gl.bindVertexArray(null);
    gl.depthMask(true);
    this.stats.drawCalls++;
    this.stats.batches++;
  }

  private setWaterUniforms(shader: Shader, w: WaterMaterial, m: MeshRenderer): void {
    this.setColor(shader, 'uDeepColor', w.deepColor);
    this.setColor(shader, 'uShallowColor', w.shallowColor);
    this.setColor(shader, 'uFoamColor', w.foamColor);
    shader.setVec4('uFoam', w.shorelineHeight, w.foamWidth, w.crestFoam, this.time);
    shader.setVec4('uWaterParams', w.fresnel, w.specular, w.opacity * m.opacity, w.flatShading ? 1 : 0);
    shader.setFloat('uTime', this.time);
    shader.setVec4('uWave', w.waveAmplitude, w.waveLength, w.waveSpeed, w.waveSteepness);
    const a = (w.waveDirection * Math.PI) / 180;
    shader.setVec2('uWaveDir', Math.sin(a), Math.cos(a));
    shader.setBool('uReceiveShadow', m.receiveShadow);
  }

  private drawDebug(): void {
    const dbg = this.debug;
    if (!dbg.enabled || dbg.lines.length === 0) { dbg.clear(); return; }
    const gl = this.gl;
    const needed = dbg.lines.length * 14;
    if (needed > this.lineData.length) {
      this.lineData = new Float32Array(needed * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.lineData.byteLength, gl.DYNAMIC_DRAW);
    }
    const d = this.lineData;
    let o = 0;
    for (const l of dbg.lines) {
      d[o++] = l.ax; d[o++] = l.ay; d[o++] = l.az; d[o++] = l.color.r; d[o++] = l.color.g; d[o++] = l.color.b; d[o++] = l.color.a;
      d[o++] = l.bx; d[o++] = l.by; d[o++] = l.bz; d[o++] = l.color.r; d[o++] = l.color.g; d[o++] = l.color.b; d[o++] = l.color.a;
    }
    this.line.use();
    this.line.setMat4('uViewProj', _viewProj.m);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, o);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.LINES, 0, dbg.lines.length * 2);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    this.stats.drawCalls++;
    dbg.clear();
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
    this.meshes.clear();
    for (const t of this.textures.values()) this.gl.deleteTexture(t);
    this.textures.clear();
    this.gl.deleteTexture(this.whiteTexture);
    this.lit.dispose();
    this.unlit.dispose();
    this.water.dispose();
    this.depth.dispose();
    this.skyShader.dispose();
    this.line.dispose();
    this.shadowMap.dispose();
    this.postProcess.dispose();
    this.gl.deleteVertexArray(this.skyVao);
    this.gl.deleteVertexArray(this.lineVao);
    this.gl.deleteBuffer(this.lineBuffer);
  }
}

function grow(a: Float32Array): Float32Array {
  const bigger = new Float32Array(a.length * 2);
  bigger.set(a);
  return bigger;
}
