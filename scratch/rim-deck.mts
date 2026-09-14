/**
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
 * **The control is the point.** A run at the origin must lose the surface on
 * exactly the same runs as a run at the rim; any difference between the two
 * columns is the sphere leaking into the walk.
 */
import { CollisionWorld } from '../src/world/Collision.ts';
import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { MAX_FRAME_DELTA, PLAYER_MAX_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../src/core/constants.ts';
import { SimPlayer } from '../scripts/playerSim.mts';

const DECK_LENGTH = 24;
const DECK_HALF_WIDTH = 3;
const DECK_RISE = 6;

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
    if (deck - from > 0.62) return ground;
    return Math.max(deck, ground);
  };
}

const GRADIENTS = [0.1, 0.2, 0.3, 0.5, 0.7, 1.0];
const DELTAS = [MAX_FRAME_DELTA, 1 / 15, 1 / 30, 1 / 60];
const PHASES = Array.from({ length: 16 }, (_, i) => i / 16);

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
          // Where the deck is under her, against where she actually is.
          const deck = ground(player.position.x, player.position.z, player.position.y);
          const gap = deck - player.position.y;
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
