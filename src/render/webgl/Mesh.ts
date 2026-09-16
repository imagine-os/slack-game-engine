/** CPU-side mesh geometry. Indexed triangles. */
export interface MeshData {
  name?: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Base colour factor from the source material (GLTF), multiplied into the material colour. */
  baseColor?: [number, number, number, number];
}

/** Compute flat-ish smooth normals by accumulating face normals. */
export function computeNormals(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) { normals[v] += nx; normals[v + 1] += ny; normals[v + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

/** Unique edge list from triangle indices, for wireframe rendering. */
export function wireframeIndices(indices: ArrayLike<number>, vertexCount: number): Uint16Array | Uint32Array {
  const edges = new Set<number>();
  const out: number[] = [];
  const key = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const k = key(a, b);
      if (!edges.has(k)) { edges.add(k); out.push(a, b); }
    }
  }
  return vertexCount > 65535 ? new Uint32Array(out) : new Uint16Array(out);
}

/** GPU resources for a mesh: VAO with position/normal/uv buffers and an instance matrix buffer. */
export class GPUMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly indexType: number;
  readonly indexCount: number;
  readonly wireIndexCount: number;
  private buffers: WebGLBuffer[] = [];
  private instanceBuffer: WebGLBuffer;
  private instanceCapacity = 0;
  private wireBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer;

  constructor(readonly gl: WebGL2RenderingContext, readonly data: MeshData) {
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const vertexCount = data.positions.length / 3;
    this.attrib(0, data.positions, 3);
    this.attrib(1, data.normals ?? computeNormals(data.positions, data.indices), 3);
    this.attrib(2, data.uvs ?? new Float32Array(vertexCount * 2), 2);
    // Instance matrix: 4 x vec4 at locations 3..6, divisor 1.
    const ib = gl.createBuffer();
    if (!ib) throw new Error('Failed to create buffer');
    this.instanceBuffer = ib;
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(3 + i);
      gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(3 + i, 1);
    }
    const idx = gl.createBuffer();
    if (!idx) throw new Error('Failed to create buffer');
    this.indexBuffer = idx;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    this.indexType = data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.indexCount = data.indices.length;
    const wire = wireframeIndices(data.indices, vertexCount);
    this.wireIndexCount = wire.length;
    this.wireData = wire;
    gl.bindVertexArray(null);
  }

  private wireData: Uint16Array | Uint32Array;

  private attrib(location: number, array: Float32Array, size: number): void {
    const gl = this.gl;
    const buf = gl.createBuffer();
    if (!buf) throw new Error('Failed to create buffer');
    this.buffers.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  /** Upload instance matrices (16 floats each) and bind the VAO. */
  bindInstances(matrices: Float32Array, count: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    if (count > this.instanceCapacity) {
      this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, 16);
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacity * 64, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, matrices, 0, count * 16);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
  }

  /** Bind the wireframe edge index buffer instead of triangles. */
  bindWireframe(): void {
    const gl = this.gl;
    if (!this.wireBuffer) {
      this.wireBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.wireData, gl.STATIC_DRAW);
    } else gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireBuffer);
  }

  dispose(): void {
    const gl = this.gl;
    for (const b of this.buffers) gl.deleteBuffer(b);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.indexBuffer);
    if (this.wireBuffer) gl.deleteBuffer(this.wireBuffer);
    gl.deleteVertexArray(this.vao);
  }
}
