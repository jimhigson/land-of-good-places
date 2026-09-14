/**
 * **UNFINISHED. Its numbers are not yet trustworthy — read this before quoting
 * them.**
 *
 * The detector works now (see the control below) and the sweep reports
 * `384/384 lost` at 120 m and 140 m against `48/384` at the origin. **That is
 * almost certainly this file's own geometry and not a locomotion fault**, and I
 * am leaving it un-quoted rather than filed as a finding:
 *
 * - It is **not** the play-boundary leash. She reaches x = 166.8 m against an
 *   edge radius of 185.3 m on that bearing, checked directly.
 * - It **is** an unphysical deck. The ramp rises at a fixed gradient in world
 *   `y` across *chart* x, and out at 120 m the real ground falls 23.7 m over
 *   the same span — so the "deck" ends up a tower standing 26 m clear of the
 *   ground, which is not a shape this park contains. Asking whether she keeps
 *   such a surface is not asking anything about the game.
 *
 * To finish it, build the deck at a constant height **above the local ground**
 * along a geodesic — the thing a real bridge or walkway is — rather than at a
 * constant world-`y` gradient over chart x. Until then the coverage gap this
 * file was written to close is still open, and `check:deck-fallthrough` still
 * only ever sees 10.5 degrees of lean.
 *
 * ---
 *
 * **Does she keep a deck under her out where the ground really leans?**
 *
 * `check:deck-fallthrough` is the check that caught the earlier
 * re-derive-position-from-altitude runaway — 401 of 1280 runs losing the
 * surface at gradient 0.1, gaps to 50 m. Its ramp lives at `RAMP_X0 = -40`,
 * length 30, `z = 0`, so the worst lean it ever sees is **10.5 degrees** against
 * the park's own 45.5. A radial fault is about four times more visible at the
 * rim than anywhere that harness looks, so it is green there and largely blind
 * here.
 *
 * Widening the harness itself would double a gradient x delta x phase sweep
 * that sits inside a chain already at ~25 minutes against a 30-minute cap, so
 * this measures the gap from outside instead: the same scenario, at the rim,
 * with a control at the origin.
 *
 * **The control is the point**, twice over.
 *
 * 1. A run at the origin must lose the surface on exactly the same runs as one
 *    at the rim. Any difference between the columns is the sphere leaking into
 *    the walk.
 * 2. **The detector must be able to report a loss at all.** The first version of
 *    this file could not, and read a confident `0/384 lost` at every radius. It
 *    measured the gap between her and `ground(x, z, player.position.y)` — the
 *    sampler asked *from her own height*, which by construction refuses to offer
 *    a surface she cannot reach and hands back the terrain instead. So the
 *    moment she lost the deck, the thing she was being compared against became
 *    the ground under her feet, and the gap collapsed to nothing. It was
 *    circular: it asked "is there a surface she can reach" and then measured her
 *    against the answer.
 *
 *    Caught by clamping the step-up allowance to 0.05 m — she then cannot follow
 *    the ramp at all, is left standing at its foot while the deck climbs away,
 *    and the file still said `0/384 lost, worst gap 0.050 m`. That mutation is
 *    kept below as `DETECTOR_CONTROL` so the next reader can re-arm it in one
 *    edit rather than rediscovering it.
 *
 *    The fix: compare her against the deck's **ground truth** — its height from
 *    the geometry, with no reachability gate — because "did she keep the
 *    surface" is a question about the deck, not about what a sampler is
 *    currently willing to offer her.
 */
import { CollisionWorld } from '../src/world/Collision.ts';
import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { MAX_FRAME_DELTA, PLAYER_MAX_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../src/core/constants.ts';
import { SimPlayer } from '../scripts/playerSim.mts';

const DECK_LENGTH = 24;
const DECK_HALF_WIDTH = 3;
const DECK_RISE = 6;

/**
 * Set to a small number to re-arm the detector control described above: she
 * becomes unable to climb the ramp at all, so every run must report a loss. If
 * it does not, this file has gone back to measuring itself.
 */
const DETECTOR_CONTROL: number | null = null;
const STEP_UP = DETECTOR_CONTROL ?? 0.62;

/** A ramped deck running outward from `(x0, 0)`, on the local ground. */
function deckSampler(x0: number, gradient: number) {
  const base = terrainHeight(x0, 0) + DECK_RISE;
  return (x: number, z: number, from: number): number => {
    const ground = terrainHeight(x, z);
    if (Math.abs(z) > DECK_HALF_WIDTH) return ground;
    const along = x - x0;
    if (along < -0.001 || along > DECK_LENGTH + 0.001) return ground;
    const deck = base + Math.min(Math.max(along, 0), DECK_LENGTH) * gradient;
    // A surface is only offered if it is reachable from where she is asking —
    // the same rule `WalkSurfaces.sample` applies, and the reason a long frame
    // can lose a deck at all.
    if (deck - from > STEP_UP) return ground;
    return Math.max(deck, ground);
  };
}

const GRADIENTS = [0.1, 0.2, 0.3, 0.5, 0.7, 1.0];
const DELTAS = [MAX_FRAME_DELTA, 1 / 15, 1 / 30, 1 / 60];
const PHASES = Array.from({ length: 16 }, (_, i) => i / 16);

/**
 * The deck's height from the geometry alone — **no reachability gate**. This is
 * the ground truth a loss is measured against; see the docblock.
 */
function deckTruth(x0: number, gradient: number, x: number): number {
  const base = terrainHeight(x0, 0) + DECK_RISE;
  return base + Math.min(Math.max(x - x0, 0), DECK_LENGTH) * gradient;
}

/** Runs that ended up off the deck when they should have been on it. */
function sweep(x0: number): { lost: number; runs: number; worstGap: number } {
  let lost = 0;
  let runs = 0;
  let worstGap = 0;
  for (const gradient of GRADIENTS) {
    for (const dt of DELTAS) {
      for (const phase of PHASES) {
        const collision = new CollisionWorld();
        collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
        const ground = deckSampler(x0, gradient);
        const player = new SimPlayer(collision, { ground });
        player.placeOnGround(x0 + phase * 0.5, 0);
        runs += 1;
        let worst = 0;
        for (let t = 0; t < 6; t += dt) {
          player.step(dt, 1, 0, true);
          const along = player.position.x - x0;
          if (along < 0.5 || along > DECK_LENGTH - 0.5) continue;
          // Against the deck itself, not against what the sampler will offer.
          const gap = deckTruth(x0, gradient, player.position.x) - player.position.y;
          if (gap > worst) worst = gap;
        }
        if (worst > 1.0) lost += 1;
        if (worst > worstGap) worstGap = worst;
      }
    }
  }
  return { lost, runs, worstGap };
}

const speed = PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER;
process.stderr.write(
  `rim-deck — a sprinting child (${speed.toFixed(2)} m/s) up a ramped deck, ` +
    `${GRADIENTS.length} gradients x ${DELTAS.length} frame rates x ${PHASES.length} phases\n\n`,
);
for (const [label, x0] of [
  ['CONTROL  origin (lean  0.0 deg)', 0],
  ['         d= 80 m (lean 21.3 deg)', 80],
  ['         d=120 m (lean 33.1 deg)', 120],
  ['         d=140 m (lean 39.5 deg)', 140],
] as const) {
  const { lost, runs, worstGap } = sweep(x0);
  process.stderr.write(
    `${label}: lost the surface on ${lost}/${runs} runs, worst gap ${worstGap.toFixed(3)} m\n`,
  );
}
