import { Shader } from './Shader';
import type { PostSettings } from './PostSettings';
import { BLOOM_DOWN_FS, BLOOM_PREFILTER_FS, BLOOM_UP_FS, COMPOSITE_FS, FXAA_FS, POST_VS } from './shadersPost';

const BLOOM_LEVELS = 5;

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Offscreen scene target plus the post-processing chain: (optionally MSAA and
 * half-float) scene buffer → bloom prefilter + 5-level dual-filter blur →
 * composite (exposure, tonemap, grade, vignette, chromatic aberration) →
 * optional FXAA → default framebuffer. Feature-detects float render targets
 * and falls back to RGBA8. Also implements `renderScale` by rendering the
 * scene at a lower resolution and upscaling in the composite.
 */
export class PostProcess {
  /** Half-float colour targets are renderable. */
  readonly floatSupported: boolean;
  /** Max MSAA samples for the chosen colour format (0 when unsupported). */
  private maxSamples = 0;
  private readonly vao: WebGLVertexArrayObject;
  private readonly prefilter: Shader;
  private readonly down: Shader;
  private readonly up: Shader;
  private readonly composite: Shader;
  private readonly fxaa: Shader;
  private sceneFbo: WebGLFramebuffer | null = null;
  private sceneColorRb: WebGLRenderbuffer | null = null;
  private sceneDepthRb: WebGLRenderbuffer | null = null;
  private resolve: Target | null = null;
  private ldr: Target | null = null;
  private bloomDown: Target[] = [];
  private bloomUp: Target[] = [];
  private curWidth = 0;
  private curHeight = 0;
  private curFormat = 0;
  private curSamples = 0;
  private curFxaa = false;
  /** 1x1 black texture bound to the bloom sampler when bloom is off, so the composite never samples a stale unit. */
  private readonly blackTexture: WebGLTexture;
  /** Draw calls issued by the last `end()`. */
  drawCalls = 0;

  constructor(readonly gl: WebGL2RenderingContext) {
    const ext = gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float');
    this.floatSupported = !!ext;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.prefilter = new Shader(gl, POST_VS, BLOOM_PREFILTER_FS, 'bloom-prefilter');
    this.down = new Shader(gl, POST_VS, BLOOM_DOWN_FS, 'bloom-down');
    this.up = new Shader(gl, POST_VS, BLOOM_UP_FS, 'bloom-up');
    this.composite = new Shader(gl, POST_VS, COMPOSITE_FS, 'composite');
    this.fxaa = new Shader(gl, POST_VS, FXAA_FS, 'fxaa');
    const black = gl.createTexture();
    if (!black) throw new Error('Failed to create texture');
    this.blackTexture = black;
    gl.bindTexture(gl.TEXTURE_2D, black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Internal colour format that will be used for the given settings. */
  colorFormat(settings: PostSettings): number {
    const gl = this.gl;
    return settings.hdr && this.floatSupported ? gl.RGBA16F : gl.RGBA8;
  }

  /** True when the scene is rendered in linear space (float target + tonemapping). */
  isLinear(settings: PostSettings): boolean {
    return settings.enabled && settings.tonemap !== 'none';
  }

  private ensure(width: number, height: number, settings: PostSettings): void {
    const gl = this.gl;
    const format = this.colorFormat(settings);
    let samples = Math.max(0, Math.floor(settings.msaa));
    if (samples > 1) {
      const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES) as Int32Array | null;
      this.maxSamples = supported && supported.length ? supported[0] : 0;
      samples = Math.min(samples, this.maxSamples);
      if (samples < 2) samples = 0;
    } else samples = 0;
    const fxaa = settings.fxaa;
    if (width === this.curWidth && height === this.curHeight && format === this.curFormat && samples === this.curSamples && fxaa === this.curFxaa) return;
    this.release();
    this.curWidth = width; this.curHeight = height; this.curFormat = format; this.curSamples = samples; this.curFxaa = fxaa;
    this.resolve = this.createTarget(width, height, format, gl.LINEAR);
    if (samples > 0) {
      this.sceneFbo = gl.createFramebuffer();
      this.sceneColorRb = gl.createRenderbuffer();
      this.sceneDepthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneColorRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepthRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.sceneColorRb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepthRb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        // MSAA not usable with this format: fall back to a plain target.
        gl.deleteFramebuffer(this.sceneFbo); gl.deleteRenderbuffer(this.sceneColorRb); gl.deleteRenderbuffer(this.sceneDepthRb);
        this.sceneFbo = this.sceneColorRb = null;
        this.sceneDepthRb = null;
        this.curSamples = 0;
      }
    }
    if (this.curSamples === 0) {
      // Depth renderbuffer attached to the resolve target directly.
      this.sceneDepthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolve.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepthRb);
    }
    let w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.bloomDown.push(this.createTarget(w, h, format, gl.LINEAR));
      if (i < BLOOM_LEVELS - 1) this.bloomUp.push(this.createTarget(w, h, format, gl.LINEAR));
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    if (fxaa) this.ldr = this.createTarget(width, height, gl.RGBA8, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  private createTarget(width: number, height: number, format: number, filter: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('Failed to create render target');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo, tex, width, height };
  }

  private deleteTarget(t: Target | null): void {
    if (!t) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  private release(): void {
    const gl = this.gl;
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.sceneColorRb) gl.deleteRenderbuffer(this.sceneColorRb);
    if (this.sceneDepthRb) gl.deleteRenderbuffer(this.sceneDepthRb);
    this.sceneFbo = this.sceneColorRb = null;
    this.sceneDepthRb = null;
    this.deleteTarget(this.resolve); this.resolve = null;
    this.deleteTarget(this.ldr); this.ldr = null;
    for (const t of this.bloomDown) this.deleteTarget(t);
    for (const t of this.bloomUp) this.deleteTarget(t);
    this.bloomDown.length = 0;
    this.bloomUp.length = 0;
  }

  /** Effective MSAA sample count of the current scene target. */
  get samples(): number {
    return this.curSamples;
  }

  /** Bind the scene target (allocating for `width`x`height` scene pixels) so the scene renders offscreen. */
  begin(width: number, height: number, settings: PostSettings): void {
    this.ensure(Math.max(1, width), Math.max(1, height), settings);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo ?? this.resolve!.fbo);
    gl.viewport(0, 0, this.curWidth, this.curHeight);
  }

  /** Resolve, run the chain and write to the default framebuffer at `outWidth`x`outHeight`. */
  end(outWidth: number, outHeight: number, settings: PostSettings): void {
    const gl = this.gl;
    this.drawCalls = 0;
    const resolve = this.resolve!;
    if (this.sceneFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolve.fbo);
      gl.blitFramebuffer(0, 0, this.curWidth, this.curHeight, 0, 0, this.curWidth, this.curHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);

    let bloomTex: WebGLTexture | null = null;
    if (settings.bloom && settings.bloomIntensity > 0) {
      const d0 = this.bloomDown[0];
      this.bindTarget(d0);
      this.prefilter.use();
      this.bindTex(this.prefilter, 'uTex', resolve.tex, 0);
      this.prefilter.setVec2('uTexel', 1 / resolve.width, 1 / resolve.height);
      this.prefilter.setVec2('uThreshold', settings.bloomThreshold, settings.bloomThreshold * settings.bloomSoftKnee);
      this.draw();
      this.down.use();
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        const src = this.bloomDown[i - 1], dst = this.bloomDown[i];
        this.bindTarget(dst);
        this.bindTex(this.down, 'uTex', src.tex, 0);
        this.down.setVec2('uTexel', 0.5 / src.width, 0.5 / src.height);
        this.draw();
      }
      this.up.use();
      let lower = this.bloomDown[BLOOM_LEVELS - 1];
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const dst = this.bloomUp[i];
        this.bindTarget(dst);
        this.bindTex(this.up, 'uTex', lower.tex, 0);
        this.bindTex(this.up, 'uAdd', this.bloomDown[i].tex, 1);
        this.up.setVec2('uTexel', settings.bloomRadius / lower.width, settings.bloomRadius / lower.height);
        this.draw();
        lower = dst;
      }
      bloomTex = lower.tex;
    }

    const useFxaa = settings.fxaa && this.ldr;
    if (useFxaa) this.bindTarget(this.ldr!);
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, outWidth, outHeight);
    }
    const c = this.composite;
    c.use();
    this.bindTex(c, 'uScene', resolve.tex, 0);
    // Unit 1 otherwise still holds the shadow map (a depth-compare texture): sampling it through a plain
    // sampler2D is GL_INVALID_OPERATION and blacks out the frame, even behind a `uHasBloom` branch.
    this.bindTex(c, 'uBloom', bloomTex ?? this.blackTexture, 1);
    c.setBool('uHasBloom', !!bloomTex);
    c.setBool('uLinear', this.isLinear(settings));
    c.setInt('uTonemap', settings.tonemap === 'aces' ? 1 : settings.tonemap === 'reinhard' ? 2 : 0);
    c.setVec4('uParams', settings.exposure, settings.bloomIntensity, settings.saturation, settings.contrast);
    c.setVec3('uLift', settings.lift.r, settings.lift.g, settings.lift.b);
    c.setVec3('uGamma', settings.gamma.r, settings.gamma.g, settings.gamma.b);
    c.setVec3('uGain', settings.gain.r, settings.gain.g, settings.gain.b);
    c.setVec3('uVignette', settings.vignette, settings.vignetteSmoothness, outWidth / Math.max(1, outHeight));
    c.setFloat('uChroma', settings.chromaticAberration);
    this.draw();

    if (useFxaa) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, outWidth, outHeight);
      this.fxaa.use();
      this.bindTex(this.fxaa, 'uTex', this.ldr!.tex, 0);
      this.fxaa.setVec2('uTexel', 1 / this.ldr!.width, 1 / this.ldr!.height);
      this.draw();
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  private bindTarget(t: Target): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.width, t.height);
  }

  private bindTex(shader: Shader, name: string, tex: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    shader.setInt(name, unit);
  }

  private draw(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    this.drawCalls++;
  }

  dispose(): void {
    this.release();
    this.prefilter.dispose(); this.down.dispose(); this.up.dispose(); this.composite.dispose(); this.fxaa.dispose();
    this.gl.deleteTexture(this.blackTexture);
    this.gl.deleteVertexArray(this.vao);
  }
}
