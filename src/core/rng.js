// L1 core — seeded RNG streams. ARCHITECTURE.md §7.3.
// Each subsystem takes its own named stream so adding a particle can never
// shift a bullet. Math.random() is banned everywhere else under src/.

/** xorshift128+ — fast, well-distributed, fully deterministic. */
export class Rng {
  constructor(seed) {
    // splitmix64-ish expansion of a 32-bit seed into two 32-bit state pairs.
    let s = seed >>> 0 || 0x9e3779b9;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
    this._s0 = next();
    this._s1 = next();
    this._s2 = next();
    this._s3 = next();
    if ((this._s0 | this._s1 | this._s2 | this._s3) === 0) this._s0 = 1;
    this._seed = seed;
  }

  /** @returns {number} uint32 */
  nextUint() {
    let t = this._s1 << 9;
    this._s2 ^= this._s0;
    this._s3 ^= this._s1;
    this._s1 ^= this._s2;
    this._s0 ^= this._s3;
    this._s2 ^= t;
    this._s3 = (this._s3 << 11) | (this._s3 >>> 21);
    return (Math.imul(this._s1, 5) >>> 0) + (this._s0 >>> 0);
  }

  /** @returns {number} [0,1) */
  next() {
    return (this.nextUint() >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  bool(p = 0.5) {
    return this.next() < p;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Box-Muller, cached second sample. */
  gaussian() {
    if (this._spare !== undefined) {
      const v = this._spare;
      this._spare = undefined;
      return v;
    }
    let u, v, s;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this._spare = v * m;
    return u * m;
  }

  /** Uniform point in a unit disc — weapon spread. */
  disc(out) {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next());
    out[0] = Math.cos(a) * r;
    out[1] = Math.sin(a) * r;
    return out;
  }

  /** Uniform direction on the unit sphere. */
  sphere(out) {
    const z = this.next() * 2 - 1;
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    out[0] = Math.cos(a) * r;
    out[1] = Math.sin(a) * r;
    out[2] = z;
    return out;
  }

  reset() {
    const s = this._seed;
    const fresh = new Rng(s);
    this._s0 = fresh._s0;
    this._s1 = fresh._s1;
    this._s2 = fresh._s2;
    this._s3 = fresh._s3;
    this._spare = undefined;
  }
}

let sessionSeed = 1337;
const streams = new Map();

/** Hash a stream name into a distinct seed derived from the session seed. */
function hashName(name, base) {
  let h = base >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Named RNG stream. Stable for a given session seed. */
export function rng(name) {
  let r = streams.get(name);
  if (!r) {
    r = new Rng(hashName(name, sessionSeed));
    streams.set(name, r);
  }
  return r;
}

/** Re-seed the whole session. Called once at boot and by deterministic capture. */
export function setSessionSeed(seed) {
  sessionSeed = seed >>> 0;
  for (const [name] of streams) {
    streams.set(name, new Rng(hashName(name, sessionSeed)));
  }
}

export function getSessionSeed() {
  return sessionSeed;
}

/** Reset every stream to its start-of-session state without changing the seed. */
export function resetAllStreams() {
  setSessionSeed(sessionSeed);
}
