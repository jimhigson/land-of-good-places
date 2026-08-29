/**
 * **Prints the bridge's real shape, as JSON, for the Blender preview to read.**
 *
 * ```
 * npm run dump:bridge-constants
 * ```
 *
 * `art/blend/bridge_stones_render.py` assembles a whole bridge out of the
 * authored stone kit so the shape can be judged by eye. To do that it needs
 * every number the game builds a bridge from — the rise, the ramp gradient,
 * the arch's two spans, the parapet's arc, the course height, the hump's own
 * profile curve.
 *
 * **It used to carry its own copy of them, and they had already drifted.** Peer
 * review of PR #360 found the committed renders showing `HUMP_BLEND` 0.15
 * against the branch's 0.25, `COURSE_RECESS` 0.09 against 0.06, and a ramp run
 * from a *different branch* — five renders of a bridge the game does not build.
 * That is CLAUDE.md's "two definitions of one thing, kept in step by hand", and
 * it is exactly what `art/blend/bridge_stones_build.py` already avoids by
 * reading `src/art/models/bridgeStones.ts` with its `ts_const` regex.
 *
 * A regex could not reach these, though: `BRIDGE_RAMP_GRADIENT` is an
 * expression over `ENTRANCE_RAMP`, `BRIDGE_RISE` is a sum of four constants
 * from three modules, and `profileDrop` is a function. So this imports the
 * game's own modules and evaluates them, which is strictly better than
 * scraping: the preview gets the number the game will actually use, including
 * every derivation the source only describes.
 *
 * `profileDrop` is emitted as a **sampled table** rather than reimplemented in
 * Python. The preview then interpolates the game's own hump curve, so it cannot
 * be drawing a different one — which it was.
 *
 * Prints to stdout. The Python invokes it directly and parses the result, so
 * there is no generated file to go stale between the two.
 */
import {
  ARCH_CLEAR_HALF,
  ARCH_SPAN_HALF,
  COURSE_HEIGHT,
  COURSE_RECESS,
  HUMP_BLEND,
  PARAPET_CROWN_LIFT,
  PARAPET_HEIGHT,
  profileDrop,
} from '../src/world/train/bridges.ts';
import {
  BRIDGE_DECK_DEPTH,
  BRIDGE_RISE,
  BRIDGE_ROAD_BED_DROP,
  TRAIN_CLEARANCE_Y,
} from '../src/world/train/clearance.ts';
import {
  BRIDGE_RAMP_GRADIENT,
  BRIDGE_WALL_THICKNESS,
  MAX_RAMP_GRADIENT,
} from '../src/world/train/bridgeFootprint.ts';
import { ARCH_CROWN_DIP } from '../src/world/train/bridgeStonework.ts';
import {
  COPING_HEIGHT,
  COPING_JOINT,
  COPING_LENGTH,
  COPING_SINK,
  KEYSTONE_PITCH,
  VOUSSOIR_PITCH,
} from '../src/art/models/bridgeStones.ts';

/** How finely `profileDrop` is sampled for the preview to interpolate. At 0.5%
 * of a ramp the error against the real curve is far below a millimetre of
 * height, which is well under anything a render could show. */
const PROFILE_SAMPLES = 201;

const profile: number[] = [];
for (let i = 0; i < PROFILE_SAMPLES; i += 1) {
  profile.push(profileDrop(i / (PROFILE_SAMPLES - 1)));
}

// The ramp run a bridge really gets, derived the way `bridgeFootprint.ts`'s
// `idealRampRunFor` derives it — rise over gradient. A cramped bridge gets less
// (its own `rampRunCap`), but that is a per-crossing solve against neighbours
// the preview has no business inventing; this is the uncramped case, which is
// what a reference render should show.
const idealRampRun = BRIDGE_RISE / BRIDGE_RAMP_GRADIENT;

console.log(
  JSON.stringify(
    {
      ARCH_CLEAR_HALF,
      ARCH_CROWN_DIP,
      ARCH_SPAN_HALF,
      BRIDGE_DECK_DEPTH,
      BRIDGE_RAMP_GRADIENT,
      BRIDGE_RISE,
      BRIDGE_ROAD_BED_DROP,
      BRIDGE_WALL_THICKNESS,
      COPING_HEIGHT,
      COPING_JOINT,
      COPING_LENGTH,
      COPING_SINK,
      COURSE_HEIGHT,
      COURSE_RECESS,
      HUMP_BLEND,
      KEYSTONE_PITCH,
      MAX_RAMP_GRADIENT,
      PARAPET_CROWN_LIFT,
      PARAPET_HEIGHT,
      TRAIN_CLEARANCE_Y,
      VOUSSOIR_PITCH,
      idealRampRun,
      profile,
    },
    null,
    2,
  ),
);
