import type { MeshData } from './Mesh';

/** Unit cube centred at the origin (size 1). */
export function createCube(size = 1): MeshData {
  const h = size / 2;
  // 6 faces x 4 verts
  const faces: [number[], number[]][] = [
    [[0, 0, 1], [1, 0, 0]], [[0, 0, -1], [-1, 0, 0]], [[1, 0, 0], [0, 0, -1]], [[-1, 0, 0], [0, 0, 1]], [[0, 1, 0], [1, 0, 0]], [[0, -1, 0], [1, 0, 0]],
  ];
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  faces.forEach(([n, t], fi) => {
    const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [u, v] of corners) {
      positions.push((n[0] + t[0] * u + b[0] * v) * h, (n[1] + t[1] * u + b[1] * v) * h, (n[2] + t[2] * u + b[2] * v) * h);
      normals.push(n[0], n[1], n[2]);
      uvs.push((u + 1) / 2, (v + 1) / 2);
    }
    const o = fi * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { name: 'cube', positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

/** UV sphere. */
export function createSphere(radius = 0.5, widthSegments = 24, heightSegments = 16): MeshData {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const phi = v * Math.PI;
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const theta = u * Math.PI * 2;
      const nx = -Math.cos(theta) * Math.sin(phi), ny = Math.cos(phi), nz = Math.sin(theta) * Math.sin(phi);
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      uvs.push(u, 1 - v);
    }
  }
  const w = widthSegments + 1;
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * w + x, b = a + w;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { name: 'sphere', positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

/** Plane in XZ facing +Y. */
export function createPlane(width = 1, depth = 1, segments = 1): MeshData {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let z = 0; z <= segments; z++) {
    for (let x = 0; x <= segments; x++) {
      positions.push((x / segments - 0.5) * width, 0, (z / segments - 0.5) * depth);
      normals.push(0, 1, 0);
      uvs.push(x / segments, 1 - z / segments);
    }
  }
  const w = segments + 1;
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * w + x, b = a + w;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { name: 'plane', positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

/** Cylinder along Y with caps. */
export function createCylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, segments = 24): MeshData {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const h = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  for (let y = 0; y <= 1; y++) {
    const r = y === 0 ? radiusTop : radiusBottom;
    const py = y === 0 ? h : -h;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const s = Math.sin(theta), c = Math.cos(theta);
      positions.push(r * s, py, r * c);
      const nl = Math.hypot(s, slope, c);
      normals.push(s / nl, slope / nl, c / nl);
      uvs.push(i / segments, 1 - y);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i, b = i + segments + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const cap = (py: number, r: number, ny: number) => {
    const center = positions.length / 3;
    positions.push(0, py, 0); normals.push(0, ny, 0); uvs.push(0.5, 0.5);
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      positions.push(r * Math.sin(theta), py, r * Math.cos(theta));
      normals.push(0, ny, 0);
      uvs.push(Math.sin(theta) * 0.5 + 0.5, Math.cos(theta) * 0.5 + 0.5);
    }
    for (let i = 0; i < segments; i++) {
      if (ny > 0) indices.push(center, center + 1 + i + 1, center + 1 + i);
      else indices.push(center, center + 1 + i, center + 1 + i + 1);
    }
  };
  if (radiusTop > 0) cap(h, radiusTop, 1);
  if (radiusBottom > 0) cap(-h, radiusBottom, -1);
  return { name: 'cylinder', positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

/** Built-in primitive names accepted by `MeshRenderer.mesh`. */
export const PRIMITIVES: Record<string, () => MeshData> = {
  cube: () => createCube(),
  sphere: () => createSphere(),
  plane: () => createPlane(),
  cylinder: () => createCylinder(),
  cone: () => createCylinder(0, 0.5, 1),
};
