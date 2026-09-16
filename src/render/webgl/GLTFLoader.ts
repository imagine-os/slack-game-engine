import type { AssetManagerLike, AssetManifestEntry } from '../../assets/types';
import { Mat4 } from '../../core/math';
import type { MeshData } from './Mesh';

/** A GLTF mesh: one entry per primitive. */
export interface GLTFMesh {
  name: string;
  primitives: MeshData[];
}

/** Flattened scene node with its world matrix. */
export interface GLTFNode {
  name: string;
  mesh: number;
  matrix: Mat4;
}

/** Parsed GLTF asset (positions, normals, uvs, indices and base colour only). */
export interface GLTFAsset {
  meshes: GLTFMesh[];
  nodes: GLTFNode[];
}

interface GLTFJson {
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  nodes?: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
}

const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const GLB_MAGIC = 0x46546c67;

/** Parse a `.glb` binary container into JSON + binary chunk. */
export function parseGLB(data: ArrayBuffer): { json: GLTFJson; bin: ArrayBuffer | null } {
  const dv = new DataView(data);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a GLB file');
  const length = dv.getUint32(8, true);
  let offset = 12;
  let json: GLTFJson | null = null;
  let bin: ArrayBuffer | null = null;
  while (offset < length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const chunk = data.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as GLTFJson;
    else if (chunkType === 0x004e4942) bin = chunk;
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

/** Parse GLTF JSON with resolved buffers into meshes and flattened nodes. */
export function parseGLTF(json: GLTFJson, buffers: ArrayBuffer[]): GLTFAsset {
  const accessor = (index: number): { array: Float32Array | Uint16Array | Uint32Array | Uint8Array; size: number } => {
    const acc = json.accessors![index];
    const view = json.bufferViews![acc.bufferView!];
    const buffer = buffers[view.buffer];
    const size = TYPE_SIZE[acc.type];
    const offset = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const count = acc.count * size;
    const stride = view.byteStride;
    const make = (Ctor: typeof Float32Array | typeof Uint16Array | typeof Uint32Array | typeof Uint8Array) => {
      if (stride && stride !== size * Ctor.BYTES_PER_ELEMENT) {
        // De-interleave.
        const out = new Ctor(count);
        const dv = new DataView(buffer);
        for (let i = 0; i < acc.count; i++) {
          for (let c = 0; c < size; c++) {
            const at = offset + i * stride + c * Ctor.BYTES_PER_ELEMENT;
            out[i * size + c] = Ctor === Float32Array ? dv.getFloat32(at, true) : Ctor === Uint16Array ? dv.getUint16(at, true) : Ctor === Uint32Array ? dv.getUint32(at, true) : dv.getUint8(at);
          }
        }
        return out;
      }
      if (offset % Ctor.BYTES_PER_ELEMENT !== 0) return new Ctor(buffer.slice(offset, offset + count * Ctor.BYTES_PER_ELEMENT));
      return new Ctor(buffer, offset, count);
    };
    switch (acc.componentType) {
      case 5126: return { array: make(Float32Array) as Float32Array, size };
      case 5123: return { array: make(Uint16Array) as Uint16Array, size };
      case 5125: return { array: make(Uint32Array) as Uint32Array, size };
      case 5121: return { array: make(Uint8Array) as Uint8Array, size };
      default: throw new Error(`Unsupported GLTF component type ${acc.componentType}`);
    }
  };

  const meshes: GLTFMesh[] = (json.meshes ?? []).map((m, mi) => ({
    name: m.name ?? `mesh${mi}`,
    primitives: m.primitives
      .filter((p) => p.mode === undefined || p.mode === 4)
      .map((p, pi): MeshData => {
        const pos = accessor(p.attributes.POSITION).array as Float32Array;
        const normals = p.attributes.NORMAL !== undefined ? (accessor(p.attributes.NORMAL).array as Float32Array) : undefined;
        const uvs = p.attributes.TEXCOORD_0 !== undefined ? (accessor(p.attributes.TEXCOORD_0).array as Float32Array) : undefined;
        let indices: Uint16Array | Uint32Array;
        if (p.indices !== undefined) {
          const arr = accessor(p.indices).array;
          indices = arr instanceof Uint8Array ? new Uint16Array(arr) : (arr as Uint16Array | Uint32Array);
        } else {
          const n = pos.length / 3;
          indices = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
          for (let i = 0; i < n; i++) indices[i] = i;
        }
        const bc = p.material !== undefined ? json.materials?.[p.material]?.pbrMetallicRoughness?.baseColorFactor : undefined;
        const uvF = uvs instanceof Float32Array ? uvs : undefined;
        return {
          name: `${m.name ?? 'mesh'}#${pi}`,
          positions: pos,
          normals,
          uvs: uvF,
          indices,
          baseColor: bc ? [bc[0], bc[1], bc[2], bc[3] ?? 1] : undefined,
        };
      }),
  }));

  // Flatten node hierarchy of the default scene.
  const nodes: GLTFNode[] = [];
  const visit = (ni: number, parent: Mat4) => {
    const n = json.nodes![ni];
    const local = new Mat4();
    if (n.matrix) local.m.set(n.matrix);
    else {
      const t = n.translation ?? [0, 0, 0];
      const r = n.rotation ?? [0, 0, 0, 1];
      const s = n.scale ?? [1, 1, 1];
      local.compose({ x: t[0], y: t[1], z: t[2] }, { x: r[0], y: r[1], z: r[2], w: r[3] }, { x: s[0], y: s[1], z: s[2] });
    }
    const world = Mat4.multiply(parent, local, new Mat4());
    if (n.mesh !== undefined) nodes.push({ name: n.name ?? `node${ni}`, mesh: n.mesh, matrix: world });
    for (const c of n.children ?? []) visit(c, world);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const rootNodes = scene?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  if (json.nodes) for (const ni of rootNodes) visit(ni, new Mat4());
  return { meshes, nodes };
}

/** Asset loader for `.gltf`/`.glb` files; register with `assets.registerLoader('gltf', loadGLTF)`. */
export async function loadGLTF(url: string, _entry: AssetManifestEntry, manager: AssetManagerLike): Promise<GLTFAsset> {
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  let json: GLTFJson;
  let bin: ArrayBuffer | null = null;
  if (url.toLowerCase().endsWith('.glb') || url.startsWith('data:model/gltf-binary')) {
    ({ json, bin } = parseGLB(await manager.fetchArrayBuffer(url)));
  } else json = await manager.fetchJSON<GLTFJson>(url);
  const buffers = await Promise.all(
    (json.buffers ?? []).map(async (b) => {
      if (!b.uri) {
        if (!bin) throw new Error('GLTF buffer without uri and no GLB binary chunk');
        return bin;
      }
      if (b.uri.startsWith('data:')) return dataUriToBuffer(b.uri);
      return manager.fetchArrayBuffer(base + b.uri);
    }),
  );
  return parseGLTF(json, buffers);
}

function dataUriToBuffer(uri: string): ArrayBuffer {
  const comma = uri.indexOf(',');
  const meta = uri.slice(0, comma);
  const data = uri.slice(comma + 1);
  if (meta.endsWith(';base64')) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  return new TextEncoder().encode(decodeURIComponent(data)).buffer as ArrayBuffer;
}
