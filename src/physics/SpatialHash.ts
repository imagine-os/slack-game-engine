/**
 * Uniform grid broadphase keyed by integer cell coordinates. Items are
 * inserted by AABB; `pairs` yields unique candidate pairs in a deterministic
 * order (sorted by id) so simulation stays reproducible.
 */
export class SpatialHash {
  private cells = new Map<number, number[]>();
  private bounds: number[] = []; // id -> [minx, miny, maxx, maxy] flattened at id*4

  constructor(public cellSize = 2) {}

  clear(): void {
    for (const list of this.cells.values()) list.length = 0;
    this.bounds.length = 0;
  }

  private key(cx: number, cy: number): number {
    // Interleave two 16-bit signed ints into a 32-bit key.
    return ((cx & 0xffff) << 16) | (cy & 0xffff);
  }

  /** Insert an item id with its world AABB. */
  insert(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const b = this.bounds;
    const o = id * 4;
    b[o] = minX; b[o + 1] = minY; b[o + 2] = maxX; b[o + 3] = maxY;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const y0 = Math.floor(minY / cs), y1 = Math.floor(maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(id);
      }
    }
  }

  /** Collect unique overlapping pairs `[a, b]` with a < b, sorted. */
  pairs(out: number[] = []): number[] {
    const seen = new Set<number>();
    out.length = 0;
    const b = this.bounds;
    for (const list of this.cells.values()) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const c = list[j];
          const lo = a < c ? a : c, hi = a < c ? c : a;
          if (lo === hi) continue;
          const k = lo * 4294967296 + hi;
          if (seen.has(k)) continue;
          const ao = lo * 4, co = hi * 4;
          if (b[ao] > b[co + 2] || b[ao + 2] < b[co] || b[ao + 1] > b[co + 3] || b[ao + 3] < b[co + 1]) continue;
          seen.add(k);
          out.push(lo, hi);
        }
      }
    }
    // Deterministic ordering.
    const n = out.length / 2;
    const idx = new Array<number>(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((p, q) => out[p * 2] - out[q * 2] || out[p * 2 + 1] - out[q * 2 + 1]);
    const sorted = new Array<number>(out.length);
    for (let i = 0; i < n; i++) { sorted[i * 2] = out[idx[i] * 2]; sorted[i * 2 + 1] = out[idx[i] * 2 + 1]; }
    for (let i = 0; i < out.length; i++) out[i] = sorted[i];
    return out;
  }

  /** Ids whose AABB overlaps the query box. */
  query(minX: number, minY: number, maxX: number, maxY: number, out: number[] = []): number[] {
    out.length = 0;
    const seen = new Set<number>();
    const cs = this.cellSize;
    const b = this.bounds;
    for (let cx = Math.floor(minX / cs); cx <= Math.floor(maxX / cs); cx++) {
      for (let cy = Math.floor(minY / cs); cy <= Math.floor(maxY / cs); cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const id of list) {
          if (seen.has(id)) continue;
          const o = id * 4;
          if (b[o] > maxX || b[o + 2] < minX || b[o + 1] > maxY || b[o + 3] < minY) continue;
          seen.add(id);
          out.push(id);
        }
      }
    }
    out.sort((p, q) => p - q);
    return out;
  }
}
