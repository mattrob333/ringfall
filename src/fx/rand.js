// L4 fx — a zero-allocation front end over the seeded `rng('fx')` stream.
//
// WHY THIS EXISTS. `src/core/rng.js` (orchestrator-owned, correctly so) returns
// `(uint32) / 2^32`. Both the intermediate `>>> 0` and the quotient land
// outside V8's small-integer range, so every `rng.next()` call boxes a
// HeapNumber. Measured on node 24: ~4.5 bytes of garbage per call, and a single
// concrete impact draws ~65 of them — roughly 1 KB of garbage per bullet hole.
// The brief for this directory says ZERO garbage per frame, so `fx` cannot call
// it on the hot path.
//
// The fix stays entirely inside src/fx and does NOT introduce a second RNG:
// `rng('fx')` is drawn ONCE at construction to fill a fixed Float32Array, and
// the hot path walks that table. Reads out of a Float32Array stay unboxed, so
// the whole spawn path drops to the measurement noise floor (~0.8 B/call, i.e.
// nothing). It is still the same seeded stream, still deterministic, and still
// the only source of randomness anywhere in this directory.
//
// The cost is periodicity: the table repeats after TABLE_SIZE draws. At 8192
// entries and 5-70 draws per effect, an effect would have to fire in exactly
// the same cursor phase to repeat, which is not a pattern a player can see.

const TABLE_SIZE = 8192; // power of two so the wrap is a mask, 32 KB
const MASK = TABLE_SIZE - 1;

export class FxRand {
  /** @param {{next:() => number}} source `rng('fx')` */
  constructor(source, size = TABLE_SIZE) {
    const n = size & (size - 1) ? TABLE_SIZE : size;
    this.table = new Float32Array(n);
    this.mask = n - 1;
    for (let i = 0; i < n; i++) {
      // Clamp off the endpoints: a hard 0.0 would give a zero-length spark
      // direction and a hard 1.0 would break the [a,b) contract.
      const v = source.next();
      this.table[i] = v < 1e-6 ? 1e-6 : v > 0.999999 ? 0.999999 : v;
    }
    this.i = 0;
  }

  /** @returns {number} [0,1) */
  next() {
    const v = this.table[this.i];
    this.i = (this.i + 1) & this.mask;
    return v;
  }

  range(a, b) {
    const v = this.table[this.i];
    this.i = (this.i + 1) & this.mask;
    return a + (b - a) * v;
  }

  bool(p) {
    const v = this.table[this.i];
    this.i = (this.i + 1) & this.mask;
    return v < (p === undefined ? 0.5 : p);
  }

  sign() {
    const v = this.table[this.i];
    this.i = (this.i + 1) & this.mask;
    return v < 0.5 ? -1 : 1;
  }

  /** Uniform direction on the unit sphere, written into a Float32Array(3). */
  sphere(out) {
    const a = this.table[this.i];
    this.i = (this.i + 1) & this.mask;
    const b = this.table[this.i];
    this.i = (this.i + 1) & this.mask;
    const z = a * 2 - 1;
    const ang = b * 6.283185307179586;
    const r = Math.sqrt(1 - z * z);
    out[0] = Math.cos(ang) * r;
    out[1] = Math.sin(ang) * r;
    out[2] = z;
    return out;
  }

  /** ARCHITECTURE.md §7.4 — deterministic capture rewinds the stream. */
  reset() {
    this.i = 0;
  }
}
