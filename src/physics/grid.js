// L3 physics — uniform broadphase grid over XZ. ARCHITECTURE.md: cell ~8m,
// rebuilt only when statics change (not every frame).
//
// Determinism: cell buckets are plain Arrays in insertion order (deterministic
// given deterministic addStatic* call order). The Map here is only ever used
// for O(1) key->bucket lookup; nothing iterates the Map itself — every query
// walks a bounded, explicitly ascending (cx, cz) range and then the bucket
// Arrays, so there is no Map/Set iteration-order dependency in the hot path.

const KEY_OFFSET = 1_000_000;
const KEY_STRIDE = 4_000_000; // > 2 * KEY_OFFSET, keeps keys collision-free

export class UniformGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this._epoch = 0;
  }

  _key(cx, cz) {
    return (cx + KEY_OFFSET) * KEY_STRIDE + (cz + KEY_OFFSET);
  }

  clear() {
    this.cells.clear();
  }

  insert(shape, minX, minZ, maxX, maxZ) {
    const cx0 = Math.floor(minX / this.cellSize);
    const cz0 = Math.floor(minZ / this.cellSize);
    const cx1 = Math.floor(maxX / this.cellSize);
    const cz1 = Math.floor(maxZ / this.cellSize);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = this._key(cx, cz);
        let bucket = this.cells.get(k);
        if (!bucket) this.cells.set(k, (bucket = []));
        bucket.push(shape);
      }
    }
  }

  /**
   * Fills `out` (caller-owned scratch array, truncated then re-used — no
   * allocation in steady state) with every non-removed shape whose cell
   * range overlaps the given XZ box. Returns out.length.
   */
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const cx0 = Math.floor(minX / this.cellSize);
    const cz0 = Math.floor(minZ / this.cellSize);
    const cx1 = Math.floor(maxX / this.cellSize);
    const cz1 = Math.floor(maxZ / this.cellSize);
    const epoch = ++this._epoch;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const bucket = this.cells.get(this._key(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const s = bucket[i];
          if (s.removed || s._stamp === epoch) continue;
          s._stamp = epoch;
          out.push(s);
        }
      }
    }
    return out.length;
  }
}
