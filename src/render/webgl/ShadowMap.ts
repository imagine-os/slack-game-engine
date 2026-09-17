/** Depth-only framebuffer with a comparison-sampled depth texture for shadow mapping. */
export class ShadowMap {
  /** Current framebuffer; replaced (not resized in place) by {@link resize}. */
  fbo!: WebGLFramebuffer;
  /** Current depth texture; replaced by {@link resize}. */
  texture!: WebGLTexture;
  size = 0;

  constructor(readonly gl: WebGL2RenderingContext, size: number) {
    this.resize(size);
  }

  /**
   * (Re)allocate the depth texture. No-op when the size is unchanged. A new
   * texture and framebuffer are created and the old ones deleted, so a
   * texture still bound to a sampler unit from the previous frame is never
   * redefined while attached (which logged a GL warning for one frame).
   */
  resize(size: number): void {
    size = Math.max(16, Math.min(8192, Math.floor(size)));
    if (size === this.size) return;
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();
    if (!fbo || !tex) throw new Error('Failed to create shadow map');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (this.size > 0) {
      // Drop the old sampler binding before deleting so no unit refers to a deleted texture.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteFramebuffer(this.fbo);
      gl.deleteTexture(this.texture);
    }
    this.fbo = fbo;
    this.texture = tex;
    this.size = size;
  }

  /** Bind for the depth pass and clear. */
  begin(): void {
    const gl = this.gl;
    // The lit pass left this texture on unit 1; unbind it while it is the render target.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.size, this.size);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  end(): void {
    const gl = this.gl;
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
  }
}
