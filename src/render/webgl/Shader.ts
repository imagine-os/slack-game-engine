/** Compiled + linked GLSL program with a uniform location cache. */
export class Shader {
  readonly program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(readonly gl: WebGL2RenderingContext, vsSource: string, fsSource: string, readonly name = 'shader') {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource, name);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, name);
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create WebGL program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Shader "${name}" link failed: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.uniforms.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, l);
    }
    return l;
  }

  setMat4(name: string, m: Float32Array): void { this.gl.uniformMatrix4fv(this.loc(name), false, m); }
  setVec2(name: string, x: number, y: number): void { this.gl.uniform2f(this.loc(name), x, y); }
  setVec3(name: string, x: number, y: number, z: number): void { this.gl.uniform3f(this.loc(name), x, y, z); }
  setVec4(name: string, x: number, y: number, z: number, w: number): void { this.gl.uniform4f(this.loc(name), x, y, z, w); }
  setFloat(name: string, v: number): void { this.gl.uniform1f(this.loc(name), v); }
  setInt(name: string, v: number): void { this.gl.uniform1i(this.loc(name), v); }
  setBool(name: string, v: boolean): void { this.gl.uniform1i(this.loc(name), v ? 1 : 0); }
  setVec3Array(name: string, v: Float32Array): void { this.gl.uniform3fv(this.loc(name), v); }
  setFloatArray(name: string, v: Float32Array): void { this.gl.uniform1fv(this.loc(name), v); }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, name: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader "${name}" compile failed: ${log}`);
  }
  return shader;
}
