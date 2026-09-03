/**
 * **Can you see through a bridge's parapet?** — the instrument for issue #489.
 *
 * Jim, 3 September 2026, standing on a bridge: *"bridges have a hole in them
 * and their near side, above the arch where some of the wall is missing"*.
 *
 * This marches a horizontal ray at the parapet from outside the bridge, at a
 * ladder of heights and at stations along the hump, and asks where it stops. A
 * solid parapet stops every ray inside its own `BRIDGE_WALL_THICKNESS`. A ray
 * whose first hit is further in than that has crossed the near wall and is
 * looking at the far one, the roadway, or the sky — which is exactly what a
 * child sees.
 *
 * It measures the **built park**, not the rules that built it: the geometry
 * probed is whatever `scripts/park-harness.mts` produced, so it cannot agree
 * with a generator that is wrong. Reported against the `shell` mesh alone
 * (*is the wall there?*) and separately against every drawn mesh of the bridge
 * (*can it actually be seen through, once the proud arch ring and the modelled
 * coping are in front of it?*) — those are different questions and #489 only
 * shows up cleanly in the first.
 *
 * Run:
 *
 *     LGP_SEED=1 node --no-warnings \
 *       --import ./scripts/ts-extension-resolver-register.mjs \
 *       scripts/measure-bridge-parapet.mts
 *
 * One seed per process — `parkManifest.ts` reads `LGP_SEED` once at load, so a
 * single process can only ever build one park.
 *
 * Exit code is 1 if any bridge has a gap wider than `PLAYER_RADIUS` worth of
 * daylight, so this can be driven from a check.
 */
import { Raycaster, Vector3, type Mesh, type Object3D } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { frameFor } from '../src/world/train/bridgeSpine.ts';
import { BRIDGE_WALL_THICKNESS } from '../src/world/train/bridgeFootprint.ts';

/** How far outside the bridge the rays start. Any distance clear of the
 * masonry does; it is subtracted straight back off every hit. */
const STAND_OFF = 12;

/** How high the downward casts start. Above anything in the park; the hit's
 * own `point.y` is what is read, so the height itself means nothing. */
const DROP_FROM = 200;

/** A hit further in than the near wall is thick has missed the near wall.
 * Doubled to leave room for the coursing's own recess and the ring's proud
 * stones, so this can never report a hole that is only a chamfer. */
const THROUGH = BRIDGE_WALL_THICKNESS * 2;

/**
 * **The pass/fail line is what a child can SEE through, not what the shell
 * happens to draw.** Those are different measurements and confusing them makes
 * this instrument useless in both directions.
 *
 * The swept `shell` legitimately stops short of the parapet top out at the
 * ramp feet, where `parapetHeightFor` has tapered the wall away and the
 * modelled coping run caps what is left — measured 0.16–0.32 m of "missing"
 * shell at along ±9.5–11 m on every seed, with **zero** daylight, because the
 * coping covers it. Failing on that would be a check that is red when the game
 * is right. So the shell figure is printed as a diagnostic (it is what points
 * at the cause) and the *verdict* is taken from the rays cast at everything
 * drawn.
 */
const SEEN = 0.05;

const { scene, world } = buildHeadlessPark();
scene.updateMatrixWorld(true);

const bridgeGroups = new Map<string, Object3D>();
scene.traverse((object: Object3D) => {
  if (/^bridge-\d/.test(object.name)) bridgeGroups.set(object.name, object);
});

interface Finding {
  readonly bridge: string;
  readonly along: number;
  readonly roadY: number;
  readonly parapetTop: number;
  /** Height of the tallest run of missing wall found on this bridge. */
  readonly gap: number;
  readonly from: number;
  readonly to: number;
  /** The same, but against everything drawn — what a child could actually see. */
  readonly visible: number;
  readonly ladder: string;
}

const findings: Finding[] = [];
let measured = 0;

for (const crossing of world.train.crossings) {
  const group = bridgeGroups.get(`bridge-${crossing.railDistance.toFixed(1)}`);
  if (!group) continue;
  const shell = group.getObjectByName('shell') as Mesh | undefined;
  if (!shell) continue;
  measured += 1;

  const drawn: Mesh[] = [];
  group.traverse((object: Object3D) => {
    const mesh = object as Mesh;
    // `deck` is the invisible clearance marker, not something a child sees.
    if (mesh.isMesh && mesh.name !== 'deck') drawn.push(mesh);
  });

  // The bridge's own half-width, off the `deck` clearance marker that
  // `bridges.ts` builds from the same frame the shell is swept along. The
  // downward casts below must not wander past it: on a hump, a cast 5 m out
  // lands on the ramp *behind* this station and reports its coping as this
  // station's parapet top, which invents daylight above a parapet that is
  // in fact complete. That produced a 0.16 m phantom on two seeds.
  const deck = group.getObjectByName('deck') as Mesh | undefined;
  const halfAcross = deck
    ? (deck.geometry as unknown as { parameters?: { width?: number } }).parameters?.width
    : undefined;
  if (halfAcross === undefined) {
    throw new Error(
      `${group.name} has no 'deck' marker with a BoxGeometry width, so this script ` +
        `cannot tell how wide the bridge is and would probe the ground beside it`,
    );
  }
  const outerEdge = halfAcross / 2;

  const frame = frameFor(crossing);
  const caster = new Raycaster();
  // Generous: the downward casts below start well above the park, and a
  // horizontal ray that runs the whole width of the bridge and out the far
  // side is a *result*, not something to clip away. Every hit is compared
  // against `THROUGH` by distance, so a far plane can only ever hide a
  // finding, never create one — which is why it is not tuned tight.
  caster.far = 400;

  let worst: Finding | null = null;

  for (let along = -12; along <= 12; along += 0.5) {
    const centre = frame.pointAt(along);
    const across = new Vector3(centre.acrossX, 0, centre.acrossZ).normalize();
    const mid = new Vector3(centre.x, 0, centre.z);

    // The road surface here, read off the shell's own road quad rather than
    // recomputed from the hump profile — the point is to measure what was
    // built, and a second opinion about where the road is would be one more
    // thing to drift.
    caster.set(new Vector3(mid.x, DROP_FROM, mid.z), new Vector3(0, -1, 0));
    const road = caster.intersectObject(shell, false)[0];
    if (!road) continue;
    const roadY = road.point.y;

    // **How high the parapet is supposed to be here — found by looking down
    // on it, never by asking a ray that has already been fooled.**
    //
    // The obvious way to bound the ladder is "stop counting daylight once a
    // horizontal ray stops hitting anything", and it is wrong in precisely the
    // case this script exists for: where the wall is missing, a horizontal ray
    // hits nothing, so that rule declares the hole to be sky and reports a
    // clean bridge. It did — seed 1's `bridge-72.0`, a bridge already proved
    // holed by hand, came back green. So the top comes from **above**: the
    // coping and the wall-top strip are horizontal surfaces spanning the
    // parapet, and a ray dropped onto them finds the top of the masonry
    // whether or not the wall beneath it was ever drawn.
    let parapetTop = roadY;
    for (let offset = 0.4; offset <= outerEdge; offset += 0.05) {
      for (const side of [1, -1] as const) {
        const at = mid.clone().addScaledVector(across, offset * side);
        caster.set(new Vector3(at.x, DROP_FROM, at.z), new Vector3(0, -1, 0));
        const top = caster.intersectObjects(drawn, false)[0];
        if (top) parapetTop = Math.max(parapetTop, top.point.y);
      }
    }
    const reach = parapetTop - roadY;
    if (reach <= 0.05) continue; // no parapet here — a ramp foot, not a fault

    let shellFrom = Number.NaN;
    let shellTo = Number.NaN;
    let visibleRun = 0;
    let visibleFrom = Number.NaN;
    const marks: string[] = [];

    // Stop a hair under the top: the very top course is the coping's own
    // sloped face, and grazing it proves nothing either way.
    for (let rise = 0.02; rise <= reach - 0.04; rise += 0.02) {
      const y = roadY + rise;
      const origin = mid.clone().addScaledVector(across, STAND_OFF).setY(y);
      const inward = across.clone().negate();

      caster.set(origin, inward);
      const hitShell = caster.intersectObject(shell, false)[0];
      const hitAny = caster.intersectObjects(drawn, false)[0];

      const throughShell = !hitShell || hitShell.distance - STAND_OFF > THROUGH;
      const throughAny = !hitAny || hitAny.distance - STAND_OFF > THROUGH;

      if (throughShell) {
        if (Number.isNaN(shellFrom)) shellFrom = rise;
        shellTo = rise;
      }
      if (throughAny) {
        if (Number.isNaN(visibleFrom)) visibleFrom = rise;
        visibleRun = Math.max(visibleRun, rise - visibleFrom);
      } else {
        visibleFrom = Number.NaN;
      }
      if (rise % 0.1 < 0.021) marks.push(throughShell ? '.' : '#');
    }

    const gap = Number.isNaN(shellFrom) ? 0 : shellTo - shellFrom;
    if (!worst || visibleRun > worst.visible || (visibleRun === worst.visible && gap > worst.gap)) {
      worst = {
        bridge: group.name,
        along,
        roadY,
        parapetTop,
        gap,
        from: Number.isNaN(shellFrom) ? 0 : shellFrom,
        to: Number.isNaN(shellTo) ? 0 : shellTo,
        visible: visibleRun,
        ladder: marks.join(''),
      };
    }
  }

  if (worst && (worst.visible > SEEN || worst.gap > 0.05)) findings.push(worst);
}

if (measured === 0) {
  // CLAUDE.md: a check that has stopped covering anything must say so, on
  // stderr, on every run — including the passing ones.
  process.stderr.write(
    `measure-bridge-parapet: seed ${PARK_SEED} built no bridges at all, so this ` +
      `run asserts NOTHING about parapets. Pick a seed that bridges its railway.\n`,
  );
}

console.log(
  `seed ${PARK_SEED}: ${measured} bridge${measured === 1 ? '' : 's'} probed, ` +
    `${findings.length} with a gap in the swept wall ` +
    `(wall ${BRIDGE_WALL_THICKNESS} m thick; a hit past ${THROUGH.toFixed(2)} m in has ` +
    `missed the near wall)`,
);
for (const finding of findings) {
  console.log(
    `  ${finding.bridge}: ${finding.gap.toFixed(2)} m of wall missing, ` +
      `${finding.from.toFixed(2)}–${finding.to.toFixed(2)} m over a road at ` +
      `y ${finding.roadY.toFixed(2)}, worst at along ${finding.along.toFixed(1)} m; ` +
      `daylight through everything drawn ${finding.visible.toFixed(2)} m`,
  );
  console.log(`      wall present, road upward, 0.1 m a mark: ${finding.ladder}`);
}

const seenThrough = findings.filter((f) => f.visible > SEEN);
console.log(
  seenThrough.length === 0
    ? `  no bridge on this seed can be seen through: every parapet is closed by ` +
        `the shell, the coping or the arch ring.`
    : `  ${seenThrough.length} of those can be SEEN through — issue #489.`,
);
process.exit(seenThrough.length > 0 ? 1 : 0);
