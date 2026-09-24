import { shapesOverlap, type Claim } from '../../../src/boot/groundClaims';
import { type CollisionWorld } from '../../../src/world/Collision';
import { distanceToPath } from '../../../src/world/pathGraph';
import { distanceToRailCorridor } from '../../../src/world/train/plan';
import { PARK_LAYOUT } from '../../../src/world/parkLayout';
import { TRESTLE_SPACING } from '../../../src/world/railRace/hazards';
import { POST_FOOT_RADIUS, maxTrunkLean } from '../../../src/world/railRace/trestleGeometry';
import { ROAD_FEATURE } from '../../../src/world/entrance/roadCorridor';
import { cloneTrestleTree, newTrestleTree, trestleClaims, trestleStruts, trestleTreeAt, type TrestleSpot, type TrestleSpotAnswer, type TrestleSpotQuery, type TrestleTree } from '../../../src/world/railRace/track';
/**
 * **The rail race's trestle slot search.** Moved verbatim from
 * `src/world/railRace/track.ts`, which builds a ring on decided trestles.
 * Build-time only (`docs/design/PREBUILT-PARKS.md`).
 */

/**
 * **A duck bar with no support, as a refusal the park's driver can answer.**
 * Carries the features whose claims refused the candidates and those
 * candidates' claims, so a movable blocker (a tree, a bush) can be asked to
 * step aside (`worldPhase.ts`) instead of the build dying here.
 */
export class TrestleRefusal extends Error {
  readonly refusedBy: readonly string[];
  readonly refusedClaims: readonly Claim[];
  constructor(refusedBy: readonly string[], refusedClaims: readonly Claim[], message: string) {
    super(message);
    this.name = 'TrestleRefusal';
    this.refusedBy = refusedBy;
    this.refusedClaims = refusedClaims;
  }
}


/**
 * Does any strut of `tree`, as it would be drawn — trunk and every branch, the
 * whole plan projection, no height clip — share ground with any of `claims`?
 * The road rule's question (see `trestleSpots`): a trestle is the thing that
 * gets drawn, not the disc under it.
 */
function treeStandsOn(tree: TrestleTree, ringSizeVsRace: number, claims: readonly Claim[]): boolean {
  for (const strut of trestleStruts(tree)) {
    const capsule = {
      shape: 'capsule' as const,
      x1: strut.from.x,
      z1: strut.from.z,
      x2: strut.to.x,
      z2: strut.to.z,
      halfWidth: Math.max(strut.radiusFrom, strut.radiusTo) * ringSizeVsRace,
    };
    if (claims.some((claim) => shapesOverlap(capsule, claim.shape))) return true;
  }
  return false;
}


/** A trunk's height and its lean, both in the chart the tree was solved in — see {@link TrestleTree}. */
function trunkRise(tree: TrestleTree): { readonly height: number; readonly lean: number } {
  return {
    // flat-ok: the flat solve's own frame — chart height over chart ground (TrestleTree)
    height: tree.trunkTop.y - tree.ground,
    lean: Math.hypot(tree.trunkTop.x - tree.trunkFoot.x, tree.trunkTop.z - tree.trunkFoot.z),
  };
}


/**
 * **The ground predicates the registry does not own yet.**
 *
 * Trees, walls and plots (`collision`), the walking network
 * (`distanceToPath`), the railway's band (`distanceToRailCorridor`) and the
 * park's entries are not claims — they are the private obstacle lists stage 5
 * of `docs/DESIGN-round-robin-generation.md` migrates ("The migration
 * checklist"). Until they are, a support has to ask them by name, here, behind
 * the one predicate `trestleSpots` uses for both its search and its commit.
 * Each line that leaves this function is a feature that has become a claim.
 *
 * Asked at the foot, as they always were; the road and the other ring — the two
 * things a leaning trunk actually met — are claims now and are asked with the
 * drawn geometry.
 */
/**
 * Which unmigrated predicate refuses `(x, z)`, by its own name — or `null` if
 * none does. Named so a refusal can say *which* one (ruling 4, 6 Sep 2026):
 * stage 5 reads what is left to migrate off the traces, not off this file.
 */
function legacyRefuser(x: number, z: number, collision: CollisionWorld): LegacyPredicate | null {
  if (!collision.isClearCircle(x, z, 1.1)) return 'legacy:collision';
  if (distanceToPath(x, z) < 2.8) return 'legacy:distanceToPath';
  if (distanceToRailCorridor(x, z) < 2.4) return 'legacy:distanceToRailCorridor';
  const pinchesCorridor = [...PARK_LAYOUT.entries.values()].some(
    (entry) => Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + 2.4,
  );
  return pinchesCorridor ? 'legacy:parkLayoutEntries' : null;
}


/** The four predicates the registry does not own yet, as a refusal names them. */
type LegacyPredicate =
  | 'legacy:collision'
  | 'legacy:distanceToPath'
  | 'legacy:distanceToRailCorridor'
  | 'legacy:parkLayoutEntries';


/**
 * Says, once per ring per seed, how much the unmigrated predicates still
 * decide — a coverage line, so the day the registry decides every slot is
 * announced rather than inferred. Node only: a browser has no `process`, and
 * the read is optional-chained, exactly as `parkLayout.ts`'s hooks.
 */
function reportLegacyRefusals(
  feature: string,
  tally: ReadonlyMap<LegacyPredicate, number>,
  road: { readonly overRoad: number; readonly roadRefused: number } | null,
): void {
  try {
    const nodeProcess = (globalThis as { process?: { stderr?: { write: (s: string) => unknown } } }).process;
    if (!nodeProcess?.stderr) return;
    let total = 0;
    const parts: string[] = [];
    for (const [name, count] of tally) {
      total += count;
      parts.push(`${name} ${count}`);
    }
    nodeProcess.stderr.write(
      `  ${feature}: candidates refused by legacy predicates: ` +
        (total === 0 ? '0 — the registry decided every slot' : `${total} (${parts.join(', ')})`) +
        (road
          ? `; slots over the road not built: ${road.overRoad}; candidates refused by the road: ${road.roadRefused}\n`
          : '; the ride ring ignores the road (it exists only mid-race, when the bus is gone)\n'),
    );
  } catch {
    // A runtime with a `process` that is not Node's — say nothing rather than fail a park.
  }
}


/**
 * The resolution of the outward march, in metres of lean and metres of arc.
 * A resolution, not a reach: the march stops where the support's own geometry
 * or the registry says, however many steps that takes. One metre is the
 * spacing the old nudge lists had, kept so a slot nothing refuses stands
 * exactly where it did.
 */
const SEARCH_STEP = 1;


/** `0, -1, 1, -2, 2, …` up to `reach` — nearest first, inward before outward. */
function* nearestFirst(reach: number): Generator<number, void, void> {
  yield 0;
  for (let k = SEARCH_STEP; k <= reach; k += SEARCH_STEP) {
    yield -k;
    yield k;
  }
}


/**
 * **Where the ring can actually be stood up — one outward march per slot,
 * asking the registry.**
 *
 * Every `TRESTLE_SPACING` metres round the loop is a slot. For each, the search
 * tries the ring's own centre line first and then marches the foot away from
 * it — *leaning* the support, because its top stays under the rails — asking
 * two things of every candidate, in this order:
 *
 * 1. **Can the support still be a trunk here?** The foot may stand no further
 *    from the point under its trunk's top than `maxTrunkLean` allows for the
 *    trunk the slot actually gets (`trestleGeometry.ts`: no steeper than its
 *    own branches). This is the bound of the march. It is derived from the
 *    support's geometry and varies round the ring with the lanes' height —
 *    never a typed reach, and never "where the ground ends", which on the
 *    sphere world (#511) it does not.
 * 2. **May it stand here?** The registry is asked with the plan projection of
 *    the tree as it would be drawn, below a walker's height, that anything
 *    claimed needs ({@link trestleClaims}); then the predicates nothing has
 *    migrated yet ({@link legacyRefuser}). The claims that answer the
 *    search are the claims that are committed — one function, one object.
 *
 * Along the ring, a slot may also slide by up to `arcReach` either way. That
 * costs the support nothing (the top follows), and is bounded so two
 * neighbouring slots can never share ground: half the spacing, less a foot.
 * Lean is the outer loop and arc the inner one, as before — arc room is free
 * and lean is not, so the whole arc range is tried at each lean before the
 * lean grows.
 *
 * **What replaced the three-tier ladder.** `RADIAL_NUDGES` ±5, then for a slot
 * with a duck bar `WIDE_ARC_NUDGES` × `MANDATORY_RADIAL_NUDGES` ±4, then
 * `WIDE_RADIAL_NUDGES` ±8 with a warning — three typed reaches deciding where a
 * support may stand, none of them derived from the support. Ruled out in
 * `docs/DESIGN-round-robin-generation.md` ("Ruling on `RADIAL_NUDGES`"): one
 * search, one predicate, one ordering. A bar's slot is no longer searched
 * *harder*; it is searched the same and, if nothing serves, **refused loudly**
 * rather than shrugged off — a duck bar scored at a point with nothing under it
 * is a hazard the rider hits with no support in sight, the bug this whole
 * grid exists to prevent. A slot with nothing scheduled on it may still go
 * missing (over a path, over the railway); `test:procgen`'s widest-run
 * invariant bounds how many.
 *
 * `atArch` is arch-relative — the same convention `hazards.ts`'s `DuckBar.at`
 * uses — and is converted to the raw route coordinate here, the same way the
 * duck-bar loop always has, so a trestle grid index and a hazard-schedule grid
 * index agree on which physical point on the ring they mean.
 */
export function trestleSpots({
  route,
  collision,
  groundClaims,
  feature,
  ringName,
  respectsRoad,
  ringSizeVsRace,
  mandatoryIndices,
}: TrestleSpotQuery): TrestleSpotAnswer {
  const spots: TrestleSpot[] = [];
  const count = Math.floor(route.length / TRESTLE_SPACING);
  const footRadius = POST_FOOT_RADIUS * ringSizeVsRace;
  const arcReach = TRESTLE_SPACING / 2 - footRadius;
  // **Jim's road rule (7 Sep 2026): "just skip all the legs over the road,
  // otherwise keep them."** Stated properly: **nothing of a trestle stands
  // over the road.** A slot whose drawn tree, solved at its nominal place on
  // the ring (`trestleTreeAt` — trunk and every branch, the whole plan
  // projection, unclipped), touches the road's corridor claim — the drawn
  // carriageway, one number, `ROAD_HALF_WIDTH` — is not built: no search, no
  // lean, no shape, on either ring. Every other slot is placed exactly as
  // before, and a march candidate that lands on the road is refused like any
  // other claim. A mandatory slot over the road is not pre-solved: it takes
  // the duck-bar invariant red, which is the alarm.
  //
  // The foot alone was the first cut, and it was a measurement taken on a
  // convenient origin rather than on the thing drawn: on the hill, where the
  // road runs through the ring's band, `check:swept-bus` found a KEPT
  // neighbour's branches (4.1–6.7 m up, a 5.75 m span) over the carriageway
  // and inside the driven bus on 7 of 14 seeds (5: 8 posts, 11: 10, 346: 6,
  // 451: 7, 326: 4, 24: 1, 128: 1). The guard stays armed; the rule now says
  // what he said.
  const road = respectsRoad
    ? groundClaims.claimsOf(ROAD_FEATURE).filter((claim) => claim.kind === 'corridor')
    : [];
  let overRoad = 0;
  /** The slots the road rule did not build, so a bar scheduled on one is accounted for by name. */
  const overRoadSlots = new Set<number>();
  /** March candidates refused for standing over the road, for the coverage line. */
  let roadRefused = 0;
  // The furthest any trunk on this ring could lean — a loop guard, from the
  // same owner as the per-candidate bound below, never the bound itself.
  const leanGuard = maxTrunkLean(route.clearance);
  const tree = newTrestleTree();
  /** Candidates each unmigrated predicate refused on this ring — reported once, below. */
  const legacyTally = new Map<LegacyPredicate, number>();

  for (let i = 0; i < count; i += 1) {
    const atArch0 = (i / count) * route.length;
    {
      const nominalAt = route.wrap(route.startDistance + atArch0);
      const nominal = route.path.sampleAt(nominalAt);
      trestleTreeAt(route, nominalAt, nominal.x, nominal.z, tree);
      if (treeStandsOn(tree, ringSizeVsRace, road)) {
        overRoad += 1;
        overRoadSlots.add(i);
        continue;
      }
    }
    let placed: TrestleSpot | null = null;
    let leanExhausted = false;
    /** The registry's refusers, for the message if nothing serves. */
    const refusedBy = new Set<string>();
    /** The claims of every candidate the registry refused — what a blocker is asked to clear. */
    const refusedClaims: Claim[] = [];

    search: for (const lean of nearestFirst(leanGuard)) {
      let admissible = false;
      for (const along of nearestFirst(arcReach)) {
        const at = route.wrap(route.startDistance + atArch0 + along);
        // Nudged along the centre line's own outward normal, not out from the
        // origin: on a ring that follows the park's edge the two differ.
        const sample = route.path.sampleAt(at);
        const x = sample.x + sample.normalX * lean;
        const z = sample.z + sample.normalZ * lean;
        trestleTreeAt(route, at, x, z, tree);
        // 1. Still a trunk? The lean is the run from foot to top, in the chart
        //    the tree is solved in — see `TrestleTree` for why not world `xz`.
        const rise = trunkRise(tree);
        if (rise.lean > maxTrunkLean(rise.height)) continue;
        admissible = true;
        // 2. Nothing of a trestle stands over the road — asked of every
        //    candidate with the whole drawn tree, unclipped, because a claim
        //    stops at a walker's height and a branch over the carriageway
        //    does not (measured: the guard found kept branches 4–6.7 m up in
        //    the driven bus when only the nominal slot was asked).
        if (treeStandsOn(tree, ringSizeVsRace, road)) {
          refusedBy.add(ROAD_FEATURE);
          roadRefused += 1;
          continue;
        }
        // 3. May it stand? The registry first, with the drawn geometry.
        const claims = trestleClaims(tree, ringSizeVsRace);
        const blockers = groundClaims.blockers(feature, claims);
        if (blockers.length > 0) {
          for (const blocker of blockers) refusedBy.add(blocker.feature);
          if (refusedClaims.length < 64) refusedClaims.push(...claims);
          continue;
        }
        const legacy = legacyRefuser(x, z, collision);
        if (legacy !== null) {
          refusedBy.add(legacy);
          legacyTally.set(legacy, (legacyTally.get(legacy) ?? 0) + 1);
          continue;
        }
        placed = { at, x, z, index: i, tree: cloneTrestleTree(tree), claims };
        break search;
      }
      // No arc offset at this lean can still be a trunk: the march is over.
      if (!admissible && lean !== 0) {
        leanExhausted = true;
        break;
      }
    }

    if (placed) {
      spots.push(placed);
      continue;
    }
    if (mandatoryIndices.has(i)) {
      // The refusal propagates. There is no wider list to reach for: the
      // support's next decision would be a different *shape* (a trunk rising
      // vertically to the headroom before it forks — design ruling point 3),
      // which does not exist yet. Say exactly what refused it.
      throw new TrestleRefusal(
        [...refusedBy].sort(),
        refusedClaims,
        `railRace/track.ts: no support can stand for the duck bar at slot ${i} of ` +
          `${ringName} (arch-relative at=${atArch0.toFixed(1)}): ` +
          (leanExhausted
            ? `the trunk's lean limit was reached (maxTrunkLean, trestleGeometry.ts) `
            : `the ring's whole lean range was tried `) +
          `with arc room ±${arcReach.toFixed(2)} m` +
          (refusedBy.size > 0
            ? `, refused by ${[...refusedBy].sort().join(', ')}`
            : ', refused by nothing named — every candidate failed the lean bound') +
          '. A bar with no support is not built; the placer needs a second support shape or the blocker must move.',
      );
    }
  }
  reportLegacyRefusals(ringName, legacyTally, respectsRoad ? { overRoad, roadRefused } : null);
  return { spots, overRoadSlots };
}
