/**
 * **Do the Sky Cruiser's ties actually bridge both rails?** The regression
 * guard for the tie-roll bug (#112 — "the sleeper bug").
 *
 * ```
 * npm run check:tie-frame
 * ```
 *
 * `Coaster.ts` used to orient each tie with
 * `rotation.setFromUnitVectors(new Vector3(0, 0, 1), forward)` — the
 * *minimal* rotation onto the track's tangent. That pins the tie's
 * along-track axis to `forward` but leaves its long (bridging) axis free to
 * roll about whatever axis the minimal rotation happens to pick, which on
 * any climbing or descending stretch (almost the whole ride) is not
 * horizontal. The rails themselves are offset with a strictly **horizontal**
 * side vector (`world/rail/sweptRail.ts`'s `sideX = along.z, sideZ =
 * -along.x`) — deliberately never rolled, because no track in this park
 * banks — so the old tie code and the rails disagreed about which way was
 * sideways, and the ties drifted off the rails wherever the track had any
 * pitch.
 *
 * The fix makes the tie's rotation come from `railFrameAt`, the same
 * horizontal `side`/`up`/`forward` frame the rails are swept with (see that
 * file's header). This script does not re-derive that claim from the rules —
 * it builds the **real** Sky Cruiser headlessly (`park-harness.mts`, the
 * `check-park.mts` precedent), reads the real `ties` `InstancedMesh` off it,
 * and for every tie computes where its rail-gauge points (`±RAIL_GAUGE/2`
 * out along its own local X) actually land in world space. That is compared
 * against the rail centre line computed independently, straight from
 * `railFrameAt` at the tie's own distance along the route — the same
 * function the rails themselves are offset with, so a passing tie is
 * provably sitting where the rail is, not just close by construction.
 *
 * Comparison is 3-D (not just horizontal): the tie is deliberately dropped
 * 0.12 m below the rail centre line (`Coaster.ts`: `mid.y - 0.12`, so the
 * rail visually rests on top of the sleeper), and the expected point below
 * accounts for exactly that offset, so the epsilon only has to cover real
 * geometric slop, not the ride's own art direction.
 *
 * Mutation-tested 1 August 2026: reverting the fix (going back to
 * `setFromUnitVectors`) fails this check — see HANDOFF-tie-frame-fix.md for
 * the measured before/after.
 */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { RAIL_GAUGE, TIE_STEP } from '../src/world/coaster/Coaster.ts';
import { railFrameAt, type RailFrame } from '../src/world/rail/sweptRail.ts';

// How far a tie's rail-gauge point may sit from the rail centre line it is
// meant to be bolted to. The rails' own sweep is not perfectly on the
// analytic centre line either — a Catmull-Rom fit through samples 0.45 m
// apart, documented in `Coaster.ts` as straying up to ~20 mm — so this
// leaves comfortable headroom above that while remaining far below what the
// roll bug actually produced (tens of centimetres to over a metre on this
// route's steeper climbs; see the mutation-test numbers in the handoff).
const EPSILON_M = 0.05;

const park = buildHeadlessPark();
const coaster = park.world.coaster;

const ties = coaster.group.children.find(
  (child): child is InstancedMesh => child.name === 'ties',
);
if (!ties) {
  console.error('check:tie-frame — no "ties" InstancedMesh found on the Sky Cruiser group.');
  process.exit(1);
}

const halfGauge = RAIL_GAUGE / 2;
const instanceMatrix = new Matrix4();
const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3();
const localPoint = new Vector3();
const actual = new Vector3();

const frame: RailFrame = {
  position: new Vector3(),
  forward: new Vector3(),
  side: new Vector3(),
  up: new Vector3(),
};
const expected = new Vector3();

let worstDeviation = 0;
let worstAt = 0;
let worstSide = 0;
let checked = 0;

for (let i = 0; i < ties.count; i += 1) {
  ties.getMatrixAt(i, instanceMatrix);
  instanceMatrix.decompose(position, quaternion, scale);

  const d = i * TIE_STEP;
  railFrameAt(coaster.route, d, frame);

  for (const side of [1, -1] as const) {
    // Where the tie itself says its rail-gauge point is: its own local X
    // axis (the long, bridging axis), rotated and translated exactly as the
    // real InstancedMesh instance is.
    localPoint.set(side * halfGauge, 0, 0).applyMatrix4(instanceMatrix);
    actual.copy(localPoint);

    // Where the rail centre line actually is at this same distance,
    // computed independently via the same horizontal convention the rails
    // are swept with — not read back off the tie.
    expected.copy(frame.position).addScaledVector(frame.side, side * halfGauge);
    expected.y -= 0.12; // the tie's own deliberate drop below rail height

    const deviation = actual.distanceTo(expected);
    checked += 1;
    if (deviation > worstDeviation) {
      worstDeviation = deviation;
      worstAt = d;
      worstSide = side;
    }
  }
}

console.log(
  `check:tie-frame — ${ties.count} ties, ${checked} rail-gauge points checked, ` +
    `worst deviation ${(worstDeviation * 1000).toFixed(1)} mm ` +
    `(at s=${worstAt.toFixed(1)} m, ${worstSide > 0 ? 'left' : 'right'} rail), ` +
    `epsilon ${(EPSILON_M * 1000).toFixed(0)} mm`,
);

if (worstDeviation > EPSILON_M) {
  console.error(
    `check:tie-frame: FAIL — a tie's rail-gauge point strayed ${(worstDeviation * 1000).toFixed(1)} mm ` +
      `from the rail centre line, past the ${(EPSILON_M * 1000).toFixed(0)} mm epsilon. ` +
      'Ties are rolling off horizontal — see Coaster.ts\'s tie placement and ' +
      'world/rail/sweptRail.ts\'s railFrameAt.',
  );
  process.exit(1);
}

console.log('tie frame: every tie sits on both rails, within epsilon.');
