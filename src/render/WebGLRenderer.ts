import { Color, Mat4, Vec2, Vec3, type Vec3Like } from '../core/math';
import type { World } from '../core/ecs/World';
import { Transform } from '../core/ecs/Transform';
import { NULL_ENTITY } from '../core/ecs/Entity';
import { DebugDraw } from './DebugDraw';
import type { Renderer, RendererHost, RendererOptions, RenderStats } from './Renderer';
import { Camera3D, Light, MeshRenderer } from './components';
import { Shader } from './webgl/Shader';
import { GPUMesh, type MeshData } from './webgl/Mesh';
import { PRIMITIVES } from './webgl/primitives';
import type { GLTFAsset } from './webgl/GLTFLoader';
import { LIT_FS, LIT_VS, LINE_FS, LINE_VS, MAX_POINT_LIGHTS, SKY_FS, SKY_VS, UNLIT_FS, UNLIT_VS } from './webgl/shaders';

interface Batch {
  key: string;
  mesh: GPUMesh;
  material: MeshRenderer;
  baseColor: [number, number, number, number] | undefined;
  matrices: Float32Array;
  count: number;
  transparent: boolean;
  depth: number;
}

const _view = new Mat4();
const _proj = new Mat4();
const _viewProj = new Mat4();
const _invViewProj = new Mat4();
const _camPos = new Vec3();
const _dir = new Vec3();
const _tmp = new Vec3();

/**
 * WebGL2 renderer: instanced mesh drawing with a lit (directional + point
 * lights, roughness/metallic approximation) and an unlit shader, built-in
 * primitives, GLTF meshes, gradient skybox, distance fog, wireframe and debug
 * lines. Transparent batches are sorted back-to-front after opaque ones.
 */
export class WebGLRenderer implements Renderer {
  readonly kind = '3d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly debug = new DebugDraw();
  readonly clearColor = new Color(0.1, 0.11, 0.14, 1);
  readonly stats: RenderStats = { drawCalls: 0, primitives: 0, batches: 0 };
  pixelsPerUnit: number;
  hidpi: boolean;
  width = 0;
  height = 0;
  pixelRatio = 1;

  /** Camera matrices of the last frame. */
  readonly viewProj = new Mat4();
  readonly cameraPosition = new Vec3();

  private host: RendererHost | null = null;
  private lit: Shader;
  private unlit: Shader;
  private sky: Shader;
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

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.pixelsPerUnit = opts.pixelsPerUnit ?? 1;
    this.hidpi = opts.hidpi ?? true;
    if (opts.clearColor) this.clearColor.setHex(opts.clearColor);
    this.lit = new Shader(gl, LIT_VS, LIT_FS, 'lit');
    this.unlit = new Shader(gl, UNLIT_VS, UNLIT_FS, 'unlit');
    this.sky = new Shader(gl, SKY_VS, SKY_FS, 'sky');
    this.line = new Shader(gl, LINE_VS, LINE_FS, 'line');
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

  // ------------------------------------------------------------ resources

  /** Register a mesh under a name usable by `MeshRenderer.mesh`. */
  addMesh(name: string, data: MeshData): void {
    this.meshes.get(name)?.dispose();
    this.meshes.set(name, new GPUMesh(this.gl, data));
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
    Mat4.multiply(_proj, _view, _viewProj);
    this.viewProj.copy(_viewProj);
    this.cameraPosition.copy(_camPos);
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

  // --------------------------------------------------------------- render

  render(world: World, _alpha: number): void {
    const gl = this.gl;
    const stats = this.stats;
    stats.drawCalls = stats.primitives = stats.batches = 0;
    const { cam, t } = this.findCamera(world);
    this.setupCamera(world, cam, t);
    const clear = cam?.clearColor ?? this.clearColor;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(clear.r, clear.g, clear.b, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (cam?.skybox ?? true) this.drawSky(cam);
    this.collectBatches(world);
    this.collectLights(world);

    // Opaque first (front to back is a wash for instancing; keep insertion), then transparent back to front.
    const list = this.batchList;
    list.sort((a, b) => Number(a.transparent) - Number(b.transparent) || (a.transparent ? b.depth - a.depth : 0));
    gl.enable(gl.DEPTH_TEST);
    for (const b of list) this.drawBatch(b, cam);
    this.drawDebug();
    gl.disable(gl.BLEND);
  }

  private drawSky(cam: Camera3D | null): void {
    const gl = this.gl;
    const top = cam?.skyTop ?? new Color(0.25, 0.4, 0.7, 1);
    const bottom = cam?.skyBottom ?? new Color(0.8, 0.85, 0.9, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this.sky.use();
    this.sky.setVec3('uTop', top.r, top.g, top.b);
    this.sky.setVec3('uBottom', bottom.r, bottom.g, bottom.b);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this.stats.drawCalls++;
  }

  private materialKey(m: MeshRenderer): string {
    return `${m.mesh}|${m.color.toHex(true)}|${m.metallic}|${m.roughness}|${m.emissive.toHex(false)}|${m.texture}|${Number(m.unlit)}${Number(m.wireframe)}${Number(m.doubleSided)}|${m.opacity}`;
  }

  private collectBatches(world: World): void {
    for (const b of this.batches.values()) b.count = 0;
    this.batchList.length = 0;
    for (const mr of world.componentsOfType(MeshRenderer)) {
      if (!mr.visible) continue;
      const t = world.getComponent(mr.entity, Transform);
      if (!t) continue;
      const meshes = this.resolveMeshes(mr.mesh);
      const baseKey = mr.instanced ? this.materialKey(mr) : `${this.materialKey(mr)}|e${mr.entity}`;
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        const key = meshes.length > 1 ? `${baseKey}#${i}` : baseKey;
        let batch = this.batches.get(key);
        if (!batch) {
          batch = { key, mesh, material: mr, baseColor: mesh.data.baseColor, matrices: new Float32Array(16 * 16), count: 0, transparent: false, depth: 0 };
          this.batches.set(key, batch);
        }
        batch.material = mr;
        batch.mesh = mesh;
        if ((batch.count + 1) * 16 > batch.matrices.length) {
          const bigger = new Float32Array(batch.matrices.length * 2);
          bigger.set(batch.matrices);
          batch.matrices = bigger;
        }
        batch.matrices.set(t.worldMatrix.m, batch.count * 16);
        batch.count++;
      }
    }
    for (const b of this.batches.values()) {
      if (b.count === 0) continue;
      const m = b.material;
      b.transparent = m.opacity < 1 || m.color.a < 1 || (b.baseColor !== undefined && b.baseColor[3] < 1);
      if (b.transparent) {
        // Depth of the first instance (approximation for sorting).
        const dx = b.matrices[12] - _camPos.x, dy = b.matrices[13] - _camPos.y, dz = b.matrices[14] - _camPos.z;
        b.depth = dx * dx + dy * dy + dz * dz;
      }
      this.batchList.push(b);
    }
    // Drop stale batches occasionally to avoid unbounded growth.
    if (this.batches.size > this.batchList.length * 4 + 64) {
      for (const [k, b] of this.batches) if (b.count === 0) this.batches.delete(k);
    }
  }

  private ambient = new Color(0.15, 0.15, 0.18, 1);
  private dirDir = new Vec3(0.4, -1, 0.3).normalize();
  private dirColor = new Color(1, 1, 1, 1);
  private dirIntensity = 1;
  private pointCount = 0;

  private collectLights(world: World): void {
    this.ambient.set(0, 0, 0, 1);
    this.pointCount = 0;
    let hasDir = false;
    let hasAmbient = false;
    for (const l of world.componentsOfType(Light)) {
      if (!l.enabled) continue;
      const t = world.getComponent(l.entity, Transform);
      if (l.kind === 'ambient') {
        this.ambient.r += l.color.r * l.intensity;
        this.ambient.g += l.color.g * l.intensity;
        this.ambient.b += l.color.b * l.intensity;
        hasAmbient = true;
      } else if (l.kind === 'directional' && !hasDir && t) {
        t.forward(this.dirDir);
        this.dirColor.copy(l.color);
        this.dirIntensity = l.intensity;
        hasDir = true;
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
    if (!hasAmbient) this.ambient.set(0.15, 0.15, 0.18, 1);
  }

  private drawBatch(b: Batch, cam: Camera3D | null): void {
    const gl = this.gl;
    const m = b.material;
    const shader = m.unlit ? this.unlit : this.lit;
    shader.use();
    shader.setMat4('uViewProj', _viewProj.m);
    shader.setVec3('uCameraPos', _camPos.x, _camPos.y, _camPos.z);
    const bc = b.baseColor ?? [1, 1, 1, 1];
    shader.setVec4('uColor', m.color.r * bc[0], m.color.g * bc[1], m.color.b * bc[2], m.color.a * bc[3]);
    shader.setVec3('uEmissive', m.emissive.r, m.emissive.g, m.emissive.b);
    shader.setFloat('uOpacity', m.opacity);
    shader.setBool('uHasTexture', m.texture !== '');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(m.texture));
    shader.setInt('uTexture', 0);
    const fog = cam?.fogEnabled ?? false;
    shader.setBool('uFogEnabled', fog);
    if (fog && cam) {
      shader.setVec3('uFogColor', cam.fogColor.r, cam.fogColor.g, cam.fogColor.b);
      shader.setVec2('uFogRange', cam.fogNear, cam.fogFar);
    }
    if (!m.unlit) {
      shader.setFloat('uMetallic', m.metallic);
      shader.setFloat('uRoughness', m.roughness);
      shader.setVec3('uAmbient', this.ambient.r, this.ambient.g, this.ambient.b);
      shader.setVec3('uDirLightDir', this.dirDir.x, this.dirDir.y, this.dirDir.z);
      shader.setVec3('uDirLightColor', this.dirColor.r * this.dirIntensity, this.dirColor.g * this.dirIntensity, this.dirColor.b * this.dirIntensity);
      shader.setInt('uPointCount', this.pointCount);
      if (this.pointCount) {
        shader.setVec3Array('uPointPos', this.pointPos);
        shader.setVec3Array('uPointColor', this.pointColor);
        shader.setFloatArray('uPointRange', this.pointRange);
      }
    }
    if (m.doubleSided) gl.disable(gl.CULL_FACE);
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
      this.stats.primitives += (b.mesh.indexCount / 3) * b.count;
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    this.stats.drawCalls++;
    this.stats.batches++;
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
    this.sky.dispose();
    this.line.dispose();
    this.gl.deleteVertexArray(this.skyVao);
    this.gl.deleteVertexArray(this.lineVao);
    this.gl.deleteBuffer(this.lineBuffer);
  }
}
