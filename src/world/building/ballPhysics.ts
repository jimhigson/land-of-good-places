/**
 * Pure, three.js-free physics for the ball pit.
 *
 * Everything here works on flat `Float32Array`s of positions and velocities
 * rather than objects, so 800+ balls cost one cache-friendly sweep instead of
 * chasing pointers — the whole point of the exercise, since this has to stay
 * comfortably under budget on a phone.
 *
 * The approach, per the ball-pit physics spec:
 *
 * - **Broad phase**: a uniform spatial hash grid, cell size = one ball
 *   diameter. Balls hash into buckets by cell; only the 27 neighbouring
 *   buckets are ever examined for a given ball, so collision cost is ~O(n)
 *   instead of O(n²).
 * - **Narrow phase**: AABB-only. Each ball's bounding box is
 *   `[p - r, p + r]` on every axis; two balls collide when all three axis
 *   overlaps are positive. Ball-vs-player is the same test against the
 *   player's column, resolved horizontally only (see {@link PlayerContact}).
 *   Ball-vs-pit-wall is a radial/floor clamp — the natural analogue of an
 *   AABB test for a *round* container, where a literal box would either
 *   leave gaps at the rim or clip the visible bowl.
 * - **Resolution**: minimum translation vector (MTV) — separate along
 *   whichever axis has the smallest overlap, and exchange a fraction of the
 *   velocity along that axis. The fraction (`BALL_SQUASH` etc.) is well
 *   below 1, which is what makes them squishy rather than superballs.
 * - **Sleep**: a ball below `SLEEP_SPEED_SQ` for `SLEEP_TIME` seconds stops
 *   integrating and stops being examined as a collision source entirely. It
 *   still sits in the grid so a moving neighbour (or the player) can wake it
 *   by touching it. Once the pit has settled, a frame with nobody nearby
 *   costs next to nothing.
 * - **Fixed timestep**: stepped independently of render framerate via an
 *   accumulator, so behaviour doesn't change with frame rate. Real `dt` is
 *   already clamped upstream (`MAX_FRAME_DELTA` in `core/constants.ts`), so a
 *   handful of sub-steps is always enough to catch up after a hitch.
 */

const FIXED_DT = 1 / 60;
/** Matches MAX_FRAME_DELTA (core/constants.ts) / FIXED_DT, so one bad frame can
 *  always fully catch up. Duplicated as a plain cap rather than importing the
 *  constant — this file has no dependency on core/. */
const MAX_SUBSTEPS = 5;

const GRAVITY = -20;
/** Exponential per-second velocity decay — chunkier than air, since these
 *  balls are meant to flop rather than fly. */
const LINEAR_DAMPING = 3.2;
/** Fraction of relative velocity exchanged on a ball-ball hit. Below 1 =
 *  soft/squishy; 1 would be a perfectly elastic superball. */
const BALL_SQUASH = 0.3;
/** How much of the overlap is corrected per sub-step (< 1 keeps separation
 *  gentle instead of an instant pop). */
const BALL_POSITION_CORRECTION = 0.55;
const WALL_SQUASH = 0.35;
const FLOOR_SQUASH = 0.28;

/**
 * Below this impact speed, a bounce is cancelled outright instead of
 * reflected with restitution. Without this, resolving *every* contact as a
 * little elastic bounce — even a contact closing at a hundredth of a
 * millimetre a frame, which is what gravity constantly re-creates for a
 * resting stack — has an exact non-zero fixed point (gravity's kick in,
 * restitution's kick back out, forever in balance) and the pile never truly
 * stops. Real materials have this as static friction/damping; this is the
 * cheap equivalent for a squishy ball with no friction model.
 */
const REST_IMPACT_SPEED = 0.35;

/**
 * Extra velocity damping applied to a ball for every sub-step it's touching
 * at least one neighbour. There's no tangential-friction model here — balls
 * only ever get pushed along the collision normal — so a ball buried in a
 * pile with several simultaneous contacts has no other way to shed the
 * "granular chatter" of many pairwise 1-contact-at-a-time impulses fighting
 * each other. This stands in for that friction and is what actually lets a
 * dense pile of hundreds of balls go fully to sleep rather than sitting at a
 * permanent low simmer. Split across `BALL_SOLVER_ITERATIONS` passes below
 * (each pass applies `CONTACT_DAMPING ** (1 / BALL_SOLVER_ITERATIONS)`), so
 * the total damping per sub-step stays the same how many ever passes run.
 */
const CONTACT_DAMPING = 0.5;

/**
 * A single Gauss-Seidel sweep over every touching pair isn't enough to
 * untangle a *deep* pile — a ball with several simultaneous contacts only
 * gets to react to each one once, in whatever order the grid happened to
 * yield them, so a stack more than a few balls tall settles into a
 * perpetual low simmer instead of resting. Repeating the sweep several
 * times against the same broad-phase grid (positions barely move between
 * passes, so it stays valid) is the standard fix — each pass, everyone
 * reacts to how the pile looks *after* the previous pass, and the whole
 * stack converges within one sub-step instead of over many.
 */
const BALL_SOLVER_ITERATIONS = 3;

const SLEEP_SPEED_SQ = 0.01; // (0.1 m/s)^2
const SLEEP_TIME = 0.35;
// A sleeping ball only wakes when whatever hit it was moving faster than
// REST_IMPACT_SPEED (see above) — anything gentler is exactly the kind of
// contact that should stay quiet rather than chain-waking the resting pile.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function nextPow2(n: number): number {
  let p = 16;
  while (p < n) p *= 2;
  return p;
}

/** Cheap seeded PRNG — mulberry32, good enough for scatter, not cryptography. */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Every index used below comes from a bounded `for (i < count)` loop or the
 * grid (which only ever chains indices that were `insert`ed, i.e. < count),
 * so these reads are always in range. `noUncheckedIndexedAccess` can't see
 * that, so this one helper asserts past it instead of `?? 0` scattered
 * everywhere quietly hiding a real bug as a silent zero.
 */
function at(a: Float32Array, i: number): number {
  return a[i] as number;
}

export interface BallPitBounds {
  /** Ball-*centre* containment radius in the XZ plane, pit-local. Already
   *  accounts for the ball's own radius, so a ball never visibly clips the
   *  wall. */
  readonly radius: number;
  /** Pit-local Y a resting ball's centre sits at (floor surface + ball radius). */
  readonly restY: number;
}

/** The player, as a vertical column the balls get shoved out of. Pit-local. */
export interface PlayerContact {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Horizontal push radius. */
  readonly radius: number;
  /** How far above the feet the column still pushes (roughly waist height). */
  readonly height: number;
}

export interface StepStats {
  readonly substeps: number;
  readonly awake: number;
  /** Time spent inside `step()`, in milliseconds — for perf sampling. */
  readonly ms: number;
}

/**
 * Uniform spatial hash grid over ball indices. Insert-only per rebuild (O(n),
 * no allocation): a fixed-size bucket table of linked lists threaded through
 * a `next` array, exactly like a classic hash-map-with-chaining but without
 * ever allocating a node.
 */
class SpatialHash {
  private readonly invCellSize: number;
  private readonly mask: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;

  constructor(count: number, cellSize: number) {
    this.invCellSize = 1 / cellSize;
    const tableSize = nextPow2(Math.max(16, count * 2));
    this.mask = tableSize - 1;
    this.head = new Int32Array(tableSize).fill(-1);
    this.next = new Int32Array(count);
  }

  private cell(v: number): number {
    return Math.floor(v * this.invCellSize);
  }

  private bucket(cx: number, cy: number, cz: number): number {
    const h = (cx * 92_837_111) ^ (cy * 689_287_499) ^ (cz * 283_923_481);
    return (h ^ (h >>> 13)) & this.mask;
  }

  clear(): void {
    this.head.fill(-1);
  }

  insert(i: number, x: number, y: number, z: number): void {
    const b = this.bucket(this.cell(x), this.cell(y), this.cell(z));
    this.next[i] = this.head[b] ?? -1;
    this.head[b] = i;
  }

  /** First ball in the bucket containing (cx, cy, cz); walk with `chain()`. */
  firstIn(cx: number, cy: number, cz: number): number {
    return this.head[this.bucket(cx, cy, cz)] ?? -1;
  }

  chain(i: number): number {
    return this.next[i] ?? -1;
  }

  cellOf(v: number): number {
    return this.cell(v);
  }
}

/**
 * The ball pit's physics state: positions, velocities, sleep state, and the
 * broad-phase grid, all as flat typed arrays.
 */
export class BallPitSimulation {
  readonly count: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly asleep: Uint8Array;
  private readonly sleepTimer: Float32Array;
  /** Set for any ball touched (moved, woken, or put to sleep) during the most
   *  recent `step()` — the caller uses this to skip matrix rewrites for
   *  balls that are frozen in a resting pile. */
  readonly dirty: Uint8Array;

  private readonly grid: SpatialHash;
  private readonly ballRadius: number;
  private readonly bounds: BallPitBounds;
  private accumulator = 0;

  constructor(count: number, ballRadius: number, bounds: BallPitBounds, seed: number) {
    this.count = count;
    this.ballRadius = ballRadius;
    this.bounds = bounds;
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.vz = new Float32Array(count);
    this.asleep = new Uint8Array(count);
    this.sleepTimer = new Float32Array(count);
    this.dirty = new Uint8Array(count);
    this.dirty.fill(1);
    this.grid = new SpatialHash(count, ballRadius * 2.05);

    this.spawn(seed);
  }

  /**
   * Lay the balls out already non-overlapping, in a handful of loosely
   * jittered "sunflower" spirals stacked with a vertical gap between them —
   * a real dense pack of this many balls dropped from one point would take
   * an explosive first few sub-steps to resolve, so we start close to a
   * valid state and let gravity do the last little bit of settling into a
   * natural pile.
   */
  private spawn(seed: number): void {
    const rng = createRandom(seed);
    // Hex-packing a disc of circles of area π·r² fits about 0.907 of the
    // floor area; `4.5` (vs. the ~3.46 that ratio implies) leaves a safety
    // margin so the sunflower spiral's per-ball spacing doesn't start any
    // pair already overlapping.
    const layerCapacity = Math.max(
      24,
      Math.floor(
        (Math.PI * this.bounds.radius * this.bounds.radius) / (this.ballRadius * this.ballRadius * 4.5),
      ),
    );
    const layerHeight = this.ballRadius * 2.05;

    for (let i = 0; i < this.count; i += 1) {
      const layer = Math.floor(i / layerCapacity);
      const indexInLayer = i % layerCapacity;
      const countInLayer = Math.min(layerCapacity, this.count - layer * layerCapacity);
      const spiralRadius = this.bounds.radius * Math.sqrt((indexInLayer + 0.5) / countInLayer);
      const angle = indexInLayer * GOLDEN_ANGLE + layer * 0.6;
      const jitterR = (rng() - 0.5) * this.ballRadius * 0.4;
      const jitterA = (rng() - 0.5) * 0.15;

      const r = Math.max(0, Math.min(this.bounds.radius - this.ballRadius * 0.5, spiralRadius + jitterR));
      const a = angle + jitterA;
      this.px[i] = Math.cos(a) * r;
      this.pz[i] = Math.sin(a) * r;
      // Layers stack upward with a bit of extra drop height so the whole
      // pile still has real falling-and-settling to do on the first frames.
      this.py[i] = this.bounds.restY + layer * layerHeight + rng() * this.ballRadius * 0.3;
    }
  }

  /**
   * A landing or a wading push. `x`/`z` are pit-local. Wakes and shoves every
   * ball within `radius`, hardest at the centre.
   */
  impulse(x: number, z: number, radius: number, outStrength: number, upStrength: number): void {
    for (let i = 0; i < this.count; i += 1) {
      const px = at(this.px, i);
      const pz = at(this.pz, i);
      const dx = px - x;
      const dz = pz - z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      const falloff = (1 - distance / radius) ** 2;
      const push = (outStrength * falloff) / Math.max(0.45, distance);
      this.vx[i] = at(this.vx, i) + dx * push;
      this.vz[i] = at(this.vz, i) + dz * push;
      this.vy[i] = at(this.vy, i) + upStrength * (0.4 + falloff * 0.9);
      this.asleep[i] = 0;
      this.sleepTimer[i] = 0;
      this.dirty[i] = 1;
    }
  }

  /** Advance real time `dt` seconds via fixed sub-steps. */
  step(dt: number, player: PlayerContact | null): StepStats {
    const t0 = performance.now();
    this.dirty.fill(0);
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * MAX_SUBSTEPS);
    let substeps = 0;
    while (this.accumulator >= FIXED_DT) {
      this.substep(FIXED_DT, player);
      this.accumulator -= FIXED_DT;
      substeps += 1;
    }

    let awake = 0;
    for (let i = 0; i < this.count; i += 1) if (!this.asleep[i]) awake += 1;

    return { substeps, awake, ms: performance.now() - t0 };
  }

  private substep(dt: number, player: PlayerContact | null): void {
    const ballRadius = this.ballRadius;
    const diameter = ballRadius * 2;

    // 1. Integrate awake balls: gravity, damping, symplectic Euler.
    const damp = Math.exp(-LINEAR_DAMPING * dt);
    for (let i = 0; i < this.count; i += 1) {
      if (this.asleep[i]) continue;
      this.dirty[i] = 1;
      let vx = at(this.vx, i);
      let vy = at(this.vy, i);
      let vz = at(this.vz, i);
      vy += GRAVITY * dt;
      vx *= damp;
      vy *= damp;
      vz *= damp;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.px[i] = at(this.px, i) + vx * dt;
      this.py[i] = at(this.py, i) + vy * dt;
      this.pz[i] = at(this.pz, i) + vz * dt;
    }

    // 2. Floor + round wall containment (the pit is a bowl, not a box).
    for (let i = 0; i < this.count; i += 1) {
      if (this.asleep[i]) continue;
      let py = at(this.py, i);
      if (py < this.bounds.restY) {
        py = this.bounds.restY;
        this.py[i] = py;
        const vy = at(this.vy, i);
        if (vy < 0) this.vy[i] = -vy < REST_IMPACT_SPEED ? 0 : vy * -FLOOR_SQUASH;
      }
      const px = at(this.px, i);
      const pz = at(this.pz, i);
      const dist = Math.hypot(px, pz);
      if (dist > this.bounds.radius && dist > 1e-6) {
        const nx = px / dist;
        const nz = pz / dist;
        const overlap = dist - this.bounds.radius;
        this.px[i] = px - nx * overlap;
        this.pz[i] = pz - nz * overlap;
        const vx = at(this.vx, i);
        const vz = at(this.vz, i);
        const vn = vx * nx + vz * nz;
        if (vn > 0) {
          const restitution = vn < REST_IMPACT_SPEED ? 0 : WALL_SQUASH;
          this.vx[i] = vx - (1 + restitution) * vn * nx;
          this.vz[i] = vz - (1 + restitution) * vn * nz;
        }
      }
    }

    // 3. Rebuild the broad-phase grid from current positions.
    this.grid.clear();
    for (let i = 0; i < this.count; i += 1) {
      this.grid.insert(i, at(this.px, i), at(this.py, i), at(this.pz, i));
    }

    // 4. Ball-vs-ball: AABB overlap, MTV separation, soft velocity exchange.
    // `i`'s own position/velocity are buffered locally and flushed once at
    // the end of its neighbour scan (Gauss-Seidel): if `i` has several
    // simultaneous contacts, each later one in the scan sees the *already*
    // partly-resolved velocity from the earlier ones, so repeated corrections
    // along the same axis converge instead of summing. `j`'s state is
    // written straight back for the awake-awake case, since a later `i'` in
    // this same pass may need `j`'s up-to-date position/velocity.
    //
    // A sleeping neighbour is treated as immovable rather than an equal-mass
    // partner: it's *meant* to be at rest, so a ball landing on a settled
    // pile bounces off it the same way it bounces off the floor (a full
    // reflection that *replaces* `i`'s velocity along that axis, not a 50/50
    // split that would nudge the "resting" pile).
    //
    // See BALL_SOLVER_ITERATIONS: the whole sweep runs several times against
    // the same broad-phase grid so a multi-contact pile actually converges
    // within this sub-step.
    const perIterationDamping = CONTACT_DAMPING ** (1 / BALL_SOLVER_ITERATIONS);
    for (let iteration = 0; iteration < BALL_SOLVER_ITERATIONS; iteration += 1) {
      for (let i = 0; i < this.count; i += 1) {
        if (this.asleep[i]) continue;
        let pxi = at(this.px, i);
        let pyi = at(this.py, i);
        let pzi = at(this.pz, i);
        let vxi = at(this.vx, i);
        let vyi = at(this.vy, i);
        let vzi = at(this.vz, i);
        const cx = this.grid.cellOf(pxi);
        const cy = this.grid.cellOf(pyi);
        const cz = this.grid.cellOf(pzi);
        let touched = false;

        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let oz = -1; oz <= 1; oz += 1) {
              for (
                let j = this.grid.firstIn(cx + ox, cy + oy, cz + oz);
                j !== -1;
                j = this.grid.chain(j)
              ) {
                if (j === i) continue;
                const jAsleep = this.asleep[j] === 1;
                if (!jAsleep && j <= i) continue; // canonical order: resolve each awake pair once

                const pxj = at(this.px, j);
                const pyj = at(this.py, j);
                const pzj = at(this.pz, j);
                const dx = pxj - pxi;
                const dy = pyj - pyi;
                const dz = pzj - pzi;
                const overlapX = diameter - Math.abs(dx);
                if (overlapX <= 0) continue;
                const overlapY = diameter - Math.abs(dy);
                if (overlapY <= 0) continue;
                const overlapZ = diameter - Math.abs(dz);
                if (overlapZ <= 0) continue;

                // Minimum translation vector: separate along the shallowest axis.
                let axis: 0 | 1 | 2 = 0;
                let overlap = overlapX;
                let sign = dx >= 0 ? 1 : -1;
                if (overlapY < overlap) {
                  axis = 1;
                  overlap = overlapY;
                  sign = dy >= 0 ? 1 : -1;
                }
                if (overlapZ < overlap) {
                  axis = 2;
                  overlap = overlapZ;
                  sign = dz >= 0 ? 1 : -1;
                }
                if (sign === 0) sign = 1;

                touched = true;
                const vi = axis === 0 ? vxi : axis === 1 ? vyi : vzi;

                if (jAsleep) {
                  // Immovable: i takes the full positional correction, and its
                  // velocity along the axis is *replaced* (not summed) with a
                  // reflection — repeated contacts this scan converge rather
                  // than piling up full-strength corrections on top of each
                  // other.
                  const push = overlap * BALL_POSITION_CORRECTION * sign;
                  const closingSpeed = vi * sign;
                  if (axis === 0) pxi -= push;
                  else if (axis === 1) pyi -= push;
                  else pzi -= push;

                  if (closingSpeed > 0) {
                    const restitution = closingSpeed < REST_IMPACT_SPEED ? 0 : BALL_SQUASH;
                    const reflected = -restitution * vi;
                    if (axis === 0) vxi = reflected;
                    else if (axis === 1) vyi = reflected;
                    else vzi = reflected;

                    if (closingSpeed > REST_IMPACT_SPEED) {
                      this.asleep[j] = 0;
                      this.sleepTimer[j] = 0;
                      this.dirty[j] = 1;
                    }
                  }
                  continue;
                }

                // Both awake: even split, standard equal-mass 1D collision
                // response projected onto the MTV axis.
                const push = overlap * 0.5 * BALL_POSITION_CORRECTION * sign;
                const vj =
                  axis === 0 ? at(this.vx, j) : axis === 1 ? at(this.vy, j) : at(this.vz, j);
                const closingSpeed = -(vj - vi) * sign;
                if (axis === 0) {
                  pxi -= push;
                  this.px[j] = pxj + push;
                } else if (axis === 1) {
                  pyi -= push;
                  this.py[j] = pyj + push;
                } else {
                  pzi -= push;
                  this.pz[j] = pzj + push;
                }

                if (closingSpeed > 0) {
                  const restitution = closingSpeed < REST_IMPACT_SPEED ? 0 : BALL_SQUASH;
                  const impulse = -(1 + restitution) * (vj - vi) * 0.5;
                  const newVi = vi - impulse;
                  const newVj = vj + impulse;
                  if (axis === 0) {
                    vxi = newVi;
                    this.vx[j] = newVj;
                  } else if (axis === 1) {
                    vyi = newVi;
                    this.vy[j] = newVj;
                  } else {
                    vzi = newVi;
                    this.vz[j] = newVj;
                  }
                }
              }
            }
          }
        }

        if (touched) {
          this.px[i] = pxi;
          this.py[i] = pyi;
          this.pz[i] = pzi;
          this.vx[i] = vxi * perIterationDamping;
          this.vy[i] = vyi * perIterationDamping;
          this.vz[i] = vzi * perIterationDamping;
          this.dirty[i] = 1;
        }
      }
    } // end BALL_SOLVER_ITERATIONS sweep

    // 5. Ball-vs-player: a vertical column that shoves balls sideways.
    if (player) this.applyPlayer(player);

    // 6. Sleep bookkeeping — only for balls touched this sub-step.
    for (let i = 0; i < this.count; i += 1) {
      if (this.asleep[i] || !this.dirty[i]) continue;
      const vx = at(this.vx, i);
      const vy = at(this.vy, i);
      const vz = at(this.vz, i);
      const speedSq = vx * vx + vy * vy + vz * vz;
      if (speedSq < SLEEP_SPEED_SQ) {
        const timer = at(this.sleepTimer, i) + dt;
        this.sleepTimer[i] = timer;
        if (timer > SLEEP_TIME) {
          this.asleep[i] = 1;
          this.vx[i] = 0;
          this.vy[i] = 0;
          this.vz[i] = 0;
        }
      } else {
        this.sleepTimer[i] = 0;
      }
    }
  }

  /** Push every ball within the player's column horizontally out of the way. */
  private applyPlayer(player: PlayerContact): void {
    const ballRadius = this.ballRadius;
    const pushRadius = player.radius + ballRadius;
    const cx = this.grid.cellOf(player.x);
    const cy = this.grid.cellOf(player.y + player.height * 0.5);
    const cz = this.grid.cellOf(player.z);
    const cellSpan = Math.ceil(pushRadius / (ballRadius * 2.05)) + 1;

    for (let ox = -cellSpan; ox <= cellSpan; ox += 1) {
      for (let oy = -cellSpan; oy <= cellSpan; oy += 1) {
        for (let oz = -cellSpan; oz <= cellSpan; oz += 1) {
          for (
            let i = this.grid.firstIn(cx + ox, cy + oy, cz + oz);
            i !== -1;
            i = this.grid.chain(i)
          ) {
            const px = at(this.px, i);
            const pz = at(this.pz, i);
            const py = at(this.py, i);
            const dx = px - player.x;
            const dz = pz - player.z;
            const dist = Math.hypot(dx, dz);
            if (dist >= pushRadius) continue;
            if (py < player.y - ballRadius || py > player.y + player.height) continue;

            const overlap = pushRadius - dist;
            const nx = dist > 1e-6 ? dx / dist : 1;
            const nz = dist > 1e-6 ? dz / dist : 0;
            this.px[i] = px + nx * overlap;
            this.pz[i] = pz + nz * overlap;
            this.vx[i] = at(this.vx, i) + nx * overlap * 9;
            this.vz[i] = at(this.vz, i) + nz * overlap * 9;
            this.vy[i] = at(this.vy, i) + 0.6;
            this.asleep[i] = 0;
            this.sleepTimer[i] = 0;
            this.dirty[i] = 1;
          }
        }
      }
    }
  }
}
