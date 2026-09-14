/**
 * **A hop is the same hop everywhere in the park.**
 *
 * The one assertion this file exists for: a child's jump must carry her the
 * same real height, and land her back where she took off, at the middle of the
 * park and at its rim alike. Nothing about how high she jumps may depend on how
 * far she is standing from the origin.
 *
 * ## Why it asserts a quantity and not a success
 *
 * It would be natural to write this as "she jumps, she clears the wall, she
 * lands" — and that clause could not fail. `Player`'s integration lands her on
 * whatever surface it sampled, so it lands her *somewhere* however wrong the
 * frame is, and a hop 30% short still clears most things. The failure this
 * guards is quiet by construction: before the radial conversion the jump ran
 * along world `+Y`, which at the rim delivers `1.28 · cos 45.5° = 0.90 m` of
 * real height and, in her own frame, `1.28 m` of lurch **towards the middle of
 * the park**. She would have arrived; she would have arrived wrong.
 *
 * So every clause below reads a number off the simulation and compares it
 * against the same number taken at the park's origin, where the sphere
 * contributes nothing and the old and new forms agree exactly. The origin is
 * the control: if the rim disagrees with it, the frame is leaking.
 *
 * ## The instrument
 *
 * `scripts/playerSim.mts` — the single copy of `Player.update`'s integration,
 * driving the real `CollisionWorld`. It is a copy, and this check is one of the
 * things that keeps it honest: it exercises the same vertical loop the game
 * runs, over the real `terrainHeight`, so a divergence between the two shows up
 * here as a number that stops matching the origin's.
 *
 * ## Proved red, and against exactly what
 *
 * The mutation: in `scripts/playerSim.mts`, the one line
 * `liftAlongUp(foot.x, groundY, foot.z, altitude, this.position)` replaced by
 * `this.position.set(foot.x, groundY + altitude, foot.z)` — the altitude put
 * back on world `+Y`. **20 of 21 hops failed**, the origin alone passing, which
 * is what a control is for. On `GROUND_SPHERE_RADIUS = 220` with the wave field
 * as it stands today:
 *
 * ```
 * d=  0 m (lean  0.0): apex 1.2267 m, across 0.0000 (wanted 0.0000)   <- control, passes
 * d= 40 m (lean 10.5): apex 0.9937 m, across 4.4188 (wanted 0.1807)   FAILED
 * d= 80 m (lean 21.3): apex 0.6043 m, across 5.0664 (wanted 0.2197)   FAILED
 * d=120 m (lean 33.1): apex 0.3274 m, across 4.1686 (wanted 0.1786)   FAILED
 * d=157 m (lean 45.5): apex 0.1907 m, across 2.8479 (wanted 0.1361)   FAILED
 * worst apex error 1.0441 m; worst landing drift 5.3149 m
 * ```
 *
 * **That mutation is not a reproduction of the code as it was before this
 * work, and the difference matters if you are reading these numbers as
 * history.** It is the current code with one line put back in `y`, so it keeps
 * the foot-column sampling; the apex therefore decays faster than `cos θ` and
 * the drift compounds frame on frame instead of settling. The genuinely old
 * form — no foot column, `position.y += v · dt` — loses `1 - cos θ` of apex
 * (0.90 m at the rim against 1.28) and lurches `apex · tan θ` inwards without
 * running away. Both are wrong; only the first is what this file was proved
 * against.
 *
 * Run: `pnpm run check:radial-hop`
 */
import { CollisionWorld } from '../src/world/Collision.ts';
import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { planetRadiusAt, terrainHeight } from '../src/world/terrain.ts';
import { JUMP_SPEED, SimPlayer } from './playerSim.mts';

const DT = 1 / 60;
const FRAMES = 200;

/** Distances from the park's origin, and the lean at each. */
const RADII = [0, 40, 80, 120, 157] as const;
/** Several bearings, because the wave field is not radially symmetric. */
const BEARINGS = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3] as const;

interface Hop {
  /** Highest radial altitude above her own ground, in metres. */
  apex: number;
  /** How far she ended up from where she took off, in metres. */
  drift: number;
  /**
   * The furthest her body got from her take-off column, in metres — the
   * **positive** proof that the hop is radial rather than vertical.
   *
   * A hop along the local up carries her `apex · sin θ` across the ground and
   * brings her back; a hop along world `+Y` leaves this at exactly **zero** at
   * every radius, because her `x, z` never change. So this is the clause that
   * can tell the two frames apart, and it is the one that fails loudly if the
   * integration is ever put back in `y`. The apex clause alone cannot: it goes
   * to `apex · cos θ`, which is a smaller number in the same place, and a
   * reader could talk themselves into a tolerance.
   */
  lateral: number;
  /** Frames spent off the ground. */
  airborneFrames: number;
}

function hopAt(x: number, z: number): Hop {
  const collision = new CollisionWorld();
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  const player = new SimPlayer(collision, { ground: (px, pz) => terrainHeight(px, pz) });
  player.placeOnGround(x, z);

  const startX = player.position.x;
  const startZ = player.position.z;
  // Her take-off ground, as a radius from the planet's centre. Every altitude
  // below is measured against this one fixed datum, so the instrument never
  // has to ask "what is the ground under her *now*" — which is the question
  // that is hard to get right mid-hop, and getting it wrong is what made the
  // first version of this file report a confident, wrong 0.60 m at the rim.
  const startRadius = planetRadiusAt(startX, player.groundY, startZ);

  // Take off. `verticalVelocity` and `airborne` are exactly what `Player` sets
  // on a jump, which is what makes this the game's hop rather than a model one.
  player.verticalVelocity = JUMP_SPEED;
  player.airborne = true;

  let apex = 0;
  let lateral = 0;
  let airborneFrames = 0;
  for (let frame = 0; frame < FRAMES; frame += 1) {
    player.step(DT, 0, 0, false);
    if (player.airborne) airborneFrames += 1;
    // Two radii from the same centre, so the planet cancels exactly and what is
    // left is the height a child would feel under her feet. Derived here from
    // `planetRadiusAt` rather than read off `player.hopClearance`, so the check
    // measures the position the game would draw her at rather than echoing the
    // number the code just computed.
    const altitude =
      planetRadiusAt(player.position.x, player.position.y, player.position.z) - startRadius;
    if (altitude > apex) apex = altitude;
    const across = Math.hypot(player.position.x - startX, player.position.z - startZ);
    if (across > lateral) lateral = across;
    if (!player.airborne && frame > 2) break;
  }

  return {
    apex,
    drift: Math.hypot(player.position.x - startX, player.position.z - startZ),
    lateral,
    airborneFrames,
  };
}

let failed = false;
const note = (line: string): void => process.stderr.write(`${line}\n`);

note('check:radial-hop — a hop is the same hop everywhere in the park');
note('');

// The control: the park's origin, where the ground is tangent to horizontal and
// the radial frame and world +Y are the same direction to the last decimal.
const control = hopAt(0, 0);
note(
  `CONTROL (park origin, 0.0 deg of lean): apex ${control.apex.toFixed(4)} m, ` +
    `drift ${control.drift.toFixed(4)} m, ${control.airborneFrames} frames airborne.`,
);
if (!(control.apex > 1.0)) {
  note('CONTROL FAILED: she did not leave the ground. Nothing below means anything.');
  failed = true;
}
if (control.airborneFrames < 10) {
  note(`CONTROL FAILED: only ${control.airborneFrames} frames airborne — the hop is not being simulated.`);
  failed = true;
}
note('');

// How much the apex may differ from the control's. The hop is integrated in
// fixed steps over a wave field that is not flat, so the sampled peak moves a
// little with where she stands; it must not move with *how far out* she stands,
// which is what this bounds. `groundWaves`'s own amplitude over one hop's
// lateral travel is the honest size of the residual.
const APEX_TOLERANCE = 0.06;
// She must land on the column she took off from.
const DRIFT_TOLERANCE = 0.05;
/**
 * How close the sideways excursion must come to `apex · sin θ` — the travel a
 * hop along the local up makes across the ground. Fractional, because the
 * quantity itself grows from nothing at the origin to 0.87 m at the rim.
 */
const LATERAL_TOLERANCE = 0.05;

let worstApex = 0;
let worstDrift = 0;
let worstLateral = 0;
let measured = 0;

for (const d of RADII) {
  for (const bearing of BEARINGS) {
    if (d === 0 && bearing !== 0) continue;
    const x = Math.cos(bearing) * d;
    const z = Math.sin(bearing) * d;
    const lean = (Math.asin(Math.min(1, d / 220)) * 180) / Math.PI;
    const hop = hopAt(x, z);
    measured += 1;

    const apexError = Math.abs(hop.apex - control.apex);
    // The sideways travel a hop along the local up must make: `sin θ` is
    // `d / GROUND_SPHERE_RADIUS` on the cap, by construction.
    const expectedLateral = (hop.apex * d) / 220;
    const lateralError = Math.abs(hop.lateral - expectedLateral);
    worstApex = Math.max(worstApex, apexError);
    worstDrift = Math.max(worstDrift, hop.drift);
    worstLateral = Math.max(worstLateral, lateralError);

    const bad =
      apexError > APEX_TOLERANCE ||
      hop.drift > DRIFT_TOLERANCE ||
      lateralError > LATERAL_TOLERANCE;
    if (bad) failed = true;
    if (bad || bearing === 0) {
      note(
        `  d=${d.toString().padStart(3)} m (lean ${lean.toFixed(1).padStart(4)} deg) ` +
          `bearing ${((bearing * 180) / Math.PI).toFixed(0).padStart(3)}: ` +
          `apex ${hop.apex.toFixed(4)} m (${(hop.apex - control.apex).toFixed(4)} vs origin), ` +
          `across ${hop.lateral.toFixed(4)} m (wanted ${expectedLateral.toFixed(4)}), ` +
          `drift ${hop.drift.toFixed(4)} m` +
          (bad ? '   <-- FAILED' : ''),
      );
    }
  }
}

note('');
note(
  `Measured ${measured} hops across ${RADII.length} radii and ${BEARINGS.length} bearings. ` +
    `Worst apex error ${worstApex.toFixed(4)} m (tolerance ${APEX_TOLERANCE}); ` +
    `worst landing drift ${worstDrift.toFixed(4)} m (tolerance ${DRIFT_TOLERANCE}); ` +
    `worst sideways-travel error ${worstLateral.toFixed(4)} m (tolerance ${LATERAL_TOLERANCE}).`,
);
note(
  'What this check does NOT cover: a hop from a bridge deck, a castle floor or ' +
    'any surface that is not the terrain — `SimPlayer` is given `terrainHeight` ' +
    'as its sampler here, so every hop above is off the grass. A deck hop goes ' +
    'through the same code path and the same `liftAlongUp`, but it is not ' +
    'measured by this file and nothing here would notice if it broke.',
);

if (failed) {
  note('');
  note('check:radial-hop FAILED');
}
process.exit(failed ? 1 : 0);
