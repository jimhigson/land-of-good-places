import {
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { clamp01, Rng, TAU } from '../core/mathUtils';
import { placeOnSphere, terrainHeight, tiltToSphere, upAt } from './terrain';
import { PLAZA, plazaVerge } from './paths';
import { PLAYER_RADIUS } from '../core/constants';
import { isOnPath, pathCentreline } from './pathGraph';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';
import type { Claim, GroundClaims } from '../boot/groundClaims';
import { refusal, type FeatureBuilder, type Increment, type Refusal } from '../boot/featureBuilder';

/** One pole slot: where it stands, or `null` where it was left out. */
export type FairyPole = { readonly x: number; readonly z: number } | null;

/**
 * **A run of poles carrying one continuous set of strings.**
 *
 * `closed` is the plaza ring, whose last pole is strung back to its first; an
 * open chain is a path run, strung only between neighbours. Slots are kept
 * **sparse** — `null` where a pole was left out — rather than compacted, so a
 * skip leaves a *gap* in the chain and no cable ever spans one. (Compacting
 * was the latent bug seed 18 exposed when a path moved onto a ring pole.)
 */
export interface FairyChain {
  readonly closed: boolean;
  readonly slots: readonly FairyPole[];
}

/** Poles round the fountain plaza. */
export const FAIRY_POLE_COUNT = 10;

/**
 * **How much of the park's drawn path network carries fairy lights.**
 *
 * Jim, 18 Sep 2026, on seeing the plaza ring: *"the fairy lights look good but
 * they should be all over the park as well, not just in around the centre —
 * put them around a large proportion of the paths too."*
 *
 * "A large proportion" is a judgement, so it is made a measured one: the drawn
 * runs are taken **longest first** until this fraction of the network's total
 * length is covered. Longest-first rather than at random because lights read
 * as *avenues* — a continuous run a child can walk down — and scattering the
 * same pole budget over many short stubs would give the same count with none
 * of the effect.
 *
 * Two thirds, and not more, because poles are **not free**: they claim ground
 * earlier in the world phase than lamp posts and walls, so every pole is a
 * lamp slot that may no longer fit (measured: the plaza ring alone costs one
 * lamp on the canonical seed and three on seed 8). Dense enough to read as
 * "all over the park", sparse enough to leave the park its lamps.
 */
const LIT_PATH_FRACTION = 2 / 3;

/**
 * Metres between poles along a path run.
 *
 * Matched to the plaza ring, which the family has already approved the look
 * of: ten poles on a circle of radius 11.25 is a span of about 7.1 m, and the
 * cable's sag is tuned to that. A longer span would hang the same sag over
 * more distance and read slack; a shorter one would crowd the path with posts.
 */
const PATH_POLE_SPACING = 7.1;

/**
 * A run shorter than this carries no lights at all.
 *
 * **Because a lone pole draws nothing.** A cable needs two *adjacent* poles,
 * so a run with room for only one is a post with no lights on it — exactly the
 * "healthy pole count, no actual lights" failure this file's own invariant
 * exists to catch. Two spans' worth is the shortest run that can look like
 * anything.
 */
const MIN_LIT_RUN_LENGTH = PATH_POLE_SPACING * 2;

/** The collider a pole registers, and so the ground it claims. */
const POLE_RADIUS = 0.28;

/**
 * **Where the ring of poles stands — asked for, never written down.**
 *
 * This was `FAIRY_RING_RADIUS = 13.5`, a literal picked once to sit between
 * the plaza and the promenade. The promenade moved (it is `RING_RADIUS`, the
 * fountain's own radius + 5.5) and the literal did not, so the whole ring
 * ended up 0.36–0.41 m *inside* the main loop's paving: every pole tested as
 * standing on a path, every pole was skipped, and the park had no fairy
 * lights at all. Nobody saw it, because nothing asserted that any were
 * placed.
 *
 * {@link plazaVerge} is the one owner of "the lawn between the plaza and the
 * loop" and this is its middle — the furthest a ring can be from both kinds
 * of paving at once. If either the plaza or the loop moves, the ring follows.
 */
function fairyRingRadius(): number {
  return plazaVerge().middle;
}

/**
 * How much clear ground a pole wants between itself and the nearest paving.
 *
 * **Taken from the game, not from the ring's own geometry**: the pole's own
 * collider plus the width a child genuinely needs to walk past it, which is
 * `PLAYER_RADIUS * 2` — the same `WALKABLE_GAP` `test/procgen/invariants.ts`
 * uses, and the width `NavGrid` fattens every collider by before it will call
 * a cell walkable. A pole closer to the kerb than this is a pole pinching the
 * promenade, whatever the drawing looks like.
 *
 * It replaces a bare `1.2` that was neither of those things. It is *stricter*
 * than the number it replaces (1.52 m against 1.20 m), so no pole that used to
 * be refused is now allowed through.
 */
const POLE_PAVING_CLEARANCE = POLE_RADIUS + PLAYER_RADIUS * 2;

/**
 * One planned slot before the registry has been asked about it: where the pole
 * would like to stand, and — for a path pole — enough about its run to let
 * {@link fairyPoleBuilder} slide it along when something needs the space.
 */
interface PoleSlot {
  readonly chain: number;
  /** Candidate positions in preference order: the wanted spot, then slides along the run, then the other side. */
  readonly candidates: readonly (readonly [number, number])[];
  readonly label: string;
}

/**
 * **Where every pole would like to stand**, ring and paths together.
 *
 * Read off the **drawn** centreline (`pathCentreline`), which is the paving
 * the child actually walks, rather than off the route definitions that
 * generated it — the same reason every invariant in this repo measures the
 * built park. Each sample carries its own `halfWidth`, so a pole is offset
 * from the centre line by that plus its clearance and lands beside the paving
 * whatever width that particular run was drawn at. Nothing here restates a
 * path width.
 */
function planPoleSlots(): { chains: { closed: boolean; count: number }[]; slots: PoleSlot[] } {
  const chains: { closed: boolean; count: number }[] = [];
  const slots: PoleSlot[] = [];

  // --- the plaza ring, chain 0 -------------------------------------------
  const radius = fairyRingRadius();
  chains.push({ closed: true, count: FAIRY_POLE_COUNT });
  for (let i = 0; i < FAIRY_POLE_COUNT; i += 1) {
    const angle = (i / FAIRY_POLE_COUNT) * TAU;
    const x = PLAZA.x + Math.cos(angle) * radius;
    const z = PLAZA.z + Math.sin(angle) * radius;
    // A ring pole has nowhere to slide to: moving it along the ring would
    // collide with its neighbour and moving it off changes the circle. Its one
    // candidate is its bearing, and it is left out if that is refused — which
    // is what makes the gap read as a gateway.
    slots.push({ chain: 0, candidates: [[x, z]], label: `ring pole ${i}` });
  }

  // --- the path runs ------------------------------------------------------
  const samples = pathCentreline();
  const runs = new Map<number, { x: number; z: number; halfWidth: number }[]>();
  for (const sample of samples) {
    let run = runs.get(sample.run);
    if (!run) runs.set(sample.run, (run = []));
    run.push({ x: sample.x, z: sample.z, halfWidth: sample.halfWidth });
  }

  const measured = [...runs.entries()]
    .map(([id, points]) => {
      let length = 0;
      for (let i = 1; i < points.length; i += 1) {
        length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
      }
      return { id, points, length };
    })
    .filter((run) => run.length >= MIN_LIT_RUN_LENGTH)
    // Longest first, then by id so the order cannot depend on Map iteration
    // order for two runs of identical length.
    .sort((a, b) => b.length - a.length || a.id - b.id);

  const totalLength = measured.reduce((sum, run) => sum + run.length, 0);
  let covered = 0;

  for (const run of measured) {
    if (covered > totalLength * LIT_PATH_FRACTION) break;
    covered += run.length;
    const chain = chains.length;
    let count = 0;
    let since = PATH_POLE_SPACING; // a pole at the very start of the run
    for (let i = 1; i < run.points.length; i += 1) {
      const a = run.points[i - 1]!;
      const b = run.points[i]!;
      const step = Math.hypot(b.x - a.x, b.z - a.z);
      if (step < 1e-6) continue;
      since += step;
      if (since < PATH_POLE_SPACING) continue;
      since = 0;
      // The run's own perpendicular here, and its own drawn half-width.
      const nx = -(b.z - a.z) / step;
      const nz = (b.x - a.x) / step;
      const offset = b.halfWidth + POLE_PAVING_CLEARANCE;
      const candidates: (readonly [number, number])[] = [];
      // Preference: the near side, then slid along the run either way, then
      // the far side and the same slides. Sliding along a run is what lets a
      // path pole `accommodate` instead of simply being forgone.
      for (const side of [1, -1]) {
        for (const slide of [0, 1, -1, 2, -2]) {
          const px = b.x + nx * offset * side + ((b.x - a.x) / step) * slide * (PATH_POLE_SPACING / 3);
          const pz = b.z + nz * offset * side + ((b.z - a.z) / step) * slide * (PATH_POLE_SPACING / 3);
          candidates.push([px, pz]);
        }
      }
      slots.push({ chain, candidates, label: `path run ${run.id} pole ${count}` });
      count += 1;
    }
    chains.push({ closed: false, count });
  }

  return { chains, slots };
}

/**
 * **Fairy-light poles, as a feature builder.** One increment is one pole on
 * the ring round the plaza. A pole on paving is left out at once (as it always
 * was); a pole refused by the registry — a tree trunk, a bush, a wall —
 * returns an **optional** refusal naming the blockers, so the driver first
 * asks them to step aside and only then leaves the pole out.
 */
export function fairyPoleBuilder(claims: GroundClaims, out: FairyChain[]): FeatureBuilder {
  const claimOf = (x: number, z: number): Claim => ({ kind: 'footprint', shape: { shape: 'disc', x, z, radius: POLE_RADIUS } });

  /** The plan, built once per solve and thrown away on `reset`. */
  let plan: ReturnType<typeof planPoleSlots> | null = null;
  /** Placed slots, in order, so `back` is exact. */
  const placed: (readonly [number, number] | null)[] = [];
  /** Which slot each committed section owns, for `accommodate`. */
  const sectionOfSlot: number[] = [];

  const ensurePlan = (): ReturnType<typeof planPoleSlots> => (plan ??= planPoleSlots());

  /** Rebuild `out` (what the drawing reads) from `placed`. */
  const publish = (): void => {
    const { chains, slots } = ensurePlan();
    const built: FairyPole[][] = chains.map((chain) => new Array<FairyPole>(chain.count).fill(null));
    const nextIndex = chains.map(() => 0);
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const at = nextIndex[slot.chain]!;
      nextIndex[slot.chain] = at + 1;
      const spot = placed[i];
      if (i < placed.length && spot) (built[slot.chain] as FairyPole[])[at] = { x: spot[0], z: spot[1] };
    }
    out.length = 0;
    for (let c = 0; c < chains.length; c += 1) {
      out.push({ closed: chains[c]!.closed, slots: built[c]! });
    }
  };

  /** The first candidate of `slot` that is off the paving and unrefused, with who refused the rest. */
  const chooseSpot = (
    slot: PoleSlot,
    from: number,
    keepClearOf: readonly Claim[],
  ): { spot: readonly [number, number]; claim: Claim } | { blockers: string[] } => {
    const blockers = new Set<string>();
    for (let c = from; c < slot.candidates.length; c += 1) {
      const [x, z] = slot.candidates[c]!;
      // Beside the paving, never on it — and never so close that the pole
      // pinches the lane a child walks down.
      if (isOnPath(x, z, POLE_PAVING_CLEARANCE)) continue;
      const claim = claimOf(x, z);
      if (keepClearOf.some((other) => claimsOverlap(claim, other))) continue;
      const refused = claims.blockers('fairyLights', [claim]).map((b) => b.feature);
      if (refused.length === 0) return { spot: [x, z], claim };
      for (const blocker of refused) blockers.add(blocker);
    }
    return { blockers: [...blockers] };
  };

  return {
    name: 'fairyLights',
    deps: ['fountain'],
    // A pole is cheap to move: no dependants, nothing derived from where it
    // stands. The driver may ask it to step aside before anything heavier.
    movable: true,
    *advance() {
      const { slots } = ensurePlan();
      while (placed.length < slots.length) {
        const index = placed.length;
        const slot = slots[index]!;
        const chosen = chooseSpot(slot, 0, []);
        if ('blockers' in chosen) {
          if (chosen.blockers.length === 0) {
            // Nothing refused it; it simply stands on paving everywhere it
            // could go. That is the gateway gap, and it is not a refusal —
            // there is nobody to ask to move.
            placed.push(null);
            publish();
            continue;
          }
          return refusal(`fairyLights: ${slot.label} refused by ${chosen.blockers.join(', ')}`, {
            blockers: chosen.blockers,
            claims: [claimOf(slot.candidates[0]![0], slot.candidates[0]![1])],
            optional: true,
          });
        }
        placed.push(chosen.spot);
        sectionOfSlot.push(index);
        publish();
        return {
          claims: [chosen.claim],
          label: `${slot.label} at (${chosen.spot[0].toFixed(1)}, ${chosen.spot[1].toFixed(1)})`,
        };
      }
      return 'done';
    },
    back() {
      // Trailing skipped slots carry no claim, so they come off with the
      // increment that follows them — the same shape the ring always had.
      while (placed.length > 0 && placed[placed.length - 1] === null) placed.pop();
      placed.pop();
      sectionOfSlot.pop();
      publish();
    },
    /**
     * **Slide the pole along its own run** rather than refusing.
     *
     * This is the standing backtrack rule applied to a decoration: a path pole
     * has somewhere else to go — a few metres up or down its run, or the other
     * side of it — so being asked to move is an ordinary request, not a reason
     * to be left out. A *ring* pole genuinely has nowhere (moving it along the
     * ring hits its neighbour, moving it off stops it being a circle), so it
     * has exactly one candidate and this correctly refuses for it.
     */
    accommodate(claimIndex: number, _attempt: number, keepClearOf: readonly Claim[]): Increment | Refusal {
      const { slots } = ensurePlan();
      const section = claims.sectionOfClaim('fairyLights', claimIndex);
      const index = sectionOfSlot[section];
      if (index === undefined) return refusal(`fairyLights: no pole owns claim ${claimIndex}`);
      const slot = slots[index];
      const current = placed[index];
      if (!slot || !current) return refusal(`fairyLights: no pole owns claim ${claimIndex}`);
      const moved = chooseSpot(slot, 1, keepClearOf);
      if ('blockers' in moved) {
        return refusal(`fairyLights: ${slot.label} has nowhere else on its run to stand`);
      }
      placed[index] = moved.spot;
      publish();
      return {
        claims: [moved.claim],
        label: `${slot.label} moved from (${current[0].toFixed(1)}, ${current[1].toFixed(1)}) to (${moved.spot[0].toFixed(1)}, ${moved.spot[1].toFixed(1)})`,
      };
    },
    forgo() {
      placed.push(null);
      publish();
    },
    supply: () => 1,
    reset() {
      placed.length = 0;
      sectionOfSlot.length = 0;
      plan = null;
      out.length = 0;
    },
  };
}

/** Do two disc footprints overlap? Used against the claims a refused asker could not commit. */
function claimsOverlap(a: Claim, b: Claim): boolean {
  if (a.shape.shape !== 'disc' || b.shape.shape !== 'disc') return false;
  return Math.hypot(a.shape.x - b.shape.x, a.shape.z - b.shape.z) < a.shape.radius + b.shape.radius;
}

/**
 * Strings of fairy lights slung between wooden poles around the plaza.
 *
 * The bulbs are emissive spheres — cheap, and they read beautifully against a
 * dusk sky. Only a handful of real {@link PointLight}s are used (WebGL gets
 * unhappy with dozens), placed at the middle of each string so the ground
 * actually catches a warm pool of light.
 *
 * The whole rig fades in and out with {@link nightFactor}, which the DayNight
 * system sets each frame.
 */

/**
 * The plaza ring's share of "make the lit area three times bigger in radius".
 *
 * Same reasoning as the lamp posts, and the same trap — tripling `distance`
 * alone would have changed nothing visible, because three.js's `1/d^decay`
 * term had already taken the light to nothing well inside the old cut-off.
 * Decay 1.6 → 1.0, intensity solved (11 → 5.69) to hold the brightness
 * directly under a string exactly where it was. Ground pool 13.8 m → 39.8 m,
 * and the ratio holds between 2.9× and 3.0× across every visibility threshold
 * tested.
 */
const LIGHT_INTENSITY = 5.69;
const LIGHT_DECAY = 1.0;
const LIGHT_DISTANCE = 63;

/**
 * How many of the ten strings carry a real light — down from five.
 *
 * This is what pays for `LampPosts` going 3 → 5, so the park's total
 * point-light count does not move. It is the right side of the trade: these
 * five sit on a ring barely a dozen metres across ({@link fairyRingRadius})
 * and each now washes about 40 m, so
 * they were lighting the same plaza five times over, while the lamp posts are
 * strung out along a ring road well over a hundred metres round and genuinely
 * needed the reach.
 */
const REAL_LIGHTS = 3;

/**
 * Radius of the cable, in metres — a cord about 5 cm thick, matching the
 * tree-to-tree garlands exactly (`TreeLights.WIRE_RADIUS`, where the reasoning
 * is written out in full).
 *
 * Short version: these were `Line`s, and the family reported the string
 * between the lights as very faint. WebGL ignores `LineBasicMaterial.linewidth`
 * on essentially every platform, so a line is always one device pixel however
 * it is configured. The only way to give the cable presence is to make it
 * geometry, so it is a tube.
 */
const CABLE_RADIUS = 0.025;

/** Faces around the cable. See `TreeLights.WIRE_SIDES`. */
const CABLE_SIDES = 5;

export class FairyLights implements GameSystem {
  readonly name = 'fairyLights';
  readonly group = new Group();

  /** 0 = off (daytime), 1 = fully lit. Set by World from DayNight. */
  nightFactor = 0;

  private readonly bulbs: InstancedMesh;
  private readonly bulbMaterial: MeshBasicMaterial;
  private readonly bulbColours: Color[] = [];
  private readonly bulbBase: Color[] = [];
  private readonly lights: PointLight[] = [];
  private readonly strings: Mesh[] = [];
  private readonly bulbMatrix = new Matrix4();
  private readonly scratchColour = new Color();
  private readonly litCandidates: { at: Vector3; index: number }[] = [];

  /** Draws the chains the world phase decided ({@link fairyPoleBuilder}). */
  constructor(collision: CollisionWorld, chains: readonly FairyChain[]) {
    this.group.name = 'fairy-lights';
    const rng = new Rng(0x11a17);

    const poleHeight = 4.4;
    const flat = new Vector3();
    const scratchLean = new Quaternion();
    const up = new Vector3();

    const poleMaterial = new MeshStandardMaterial({
      color: PALETTE.woodDark,
      roughness: 0.9,
      metalness: 0,
    });
    const poleGeometry = new CylinderGeometry(0.11, 0.17, poleHeight, 8);
    const knobGeometry = new SphereGeometry(0.22, 10, 8);
    const knobMaterial = new MeshStandardMaterial({
      color: PALETTE.stonePink,
      roughness: 0.6,
      metalness: 0,
    });

    const bulbColours = [
      PALETTE.fairyWarm,
      PALETTE.fairyPink,
      PALETTE.fairyMint,
      PALETTE.fairyBlue,
    ];
    const cableMaterial = new MeshBasicMaterial({
      color: 0x6b5a4a,
      transparent: true,
      opacity: 0.75,
      fog: true,
    });

    const bulbsPerString = 9;
    const bulbPositions: Vector3[] = [];
    let poleNumber = 0;
    let stringNumber = 0;

    for (const chain of chains) {
      // The anchors this chain's cables hang from — sparse, `null` where a pole
      // was left out, so no cable ever spans a gap.
      const anchors: (Vector3 | null)[] = new Array<Vector3 | null>(chain.slots.length).fill(null);

      for (let i = 0; i < chain.slots.length; i += 1) {
        const slot = chain.slots[i];
        if (!slot) continue;
        const { x, z } = slot;
        const ground = terrainHeight(x, z);

        // Pole, knob and the string's anchor are three parts of one post, so all
        // three take their height from the ground under the *same* (x, z). That
        // is what keeps the post rigid as it leans away from the park's centre —
        // a knob that stayed at its old world height would hang off the side of a
        // pole that had tipped out from under it.
        const pole = new Mesh(poleGeometry, poleMaterial);
        pole.name = `fairy-pole-${poleNumber}`;
        flat.set(x, ground + poleHeight / 2, z);
        placeOnSphere(flat, 0, pole.position, pole.quaternion);
        pole.castShadow = true;
        pole.receiveShadow = true;
        this.group.add(pole);

        const knob = new Mesh(knobGeometry, knobMaterial);
        flat.set(x, ground + poleHeight + 0.12, z);
        placeOnSphere(flat, 0, knob.position, knob.quaternion);
        knob.castShadow = true;
        this.group.add(knob);

        const anchor = new Vector3();
        flat.set(x, ground + poleHeight - 0.25, z);
        placeOnSphere(flat, 0, anchor, scratchLean);
        anchors[i] = anchor;
        // **A pole is solid, in the same place it is drawn.** Nothing derives a
        // collider from a mesh here, so the two are only ever together on purpose.
        collision.addCircle(x, z, POLE_RADIUS);
        poleNumber += 1;
      }

      // --- the strings themselves ------------------------------------------
      // An open chain (a path run) strings neighbour to neighbour; the plaza
      // ring also closes from its last pole back to its first.
      const spans = chain.closed ? anchors.length : anchors.length - 1;
      for (let i = 0; i < spans; i += 1) {
        const from = anchors[i];
        const to = anchors[(i + 1) % anchors.length];
        // Either end missing means a skipped pole — the gateway gap. No string
        // spans it, on either side, so the opening stays open.
        if (!from || !to) continue;
        const points: Vector3[] = [];

        for (let sp = 0; sp <= bulbsPerString + 1; sp += 1) {
          const t = sp / (bulbsPerString + 1);
          // Catenary-ish sag: a parabola is close enough and much cheaper.
          const sag = Math.sin(t * Math.PI) * 1.15;
          const point = new Vector3().lerpVectors(from, to, t);
          // The cable hangs along the **local** down, and so does the bulb under
          // it. Sagging along world -Y instead would be right at the plaza's
          // middle and progressively wrong out from it: the poles lean, so a
          // string dropped straight down would swing away from the knobs it is
          // supposedly tied to.
          upAt(point.x, point.y, point.z, up);
          point.addScaledVector(up, -sag);
          points.push(point);
          if (sp > 0 && sp <= bulbsPerString) {
            bulbPositions.push(point.clone().addScaledVector(up, -0.18));
          }
        }

        const geometry = new TubeGeometry(
          new CatmullRomCurve3(points),
          points.length,
          CABLE_RADIUS,
          CABLE_SIDES,
          false,
        );
        const cable = new Mesh(geometry, cableMaterial);
        cable.name = `fairy-string-${stringNumber}`;
        cable.castShadow = false;
        cable.receiveShadow = false;
        this.group.add(cable);
        this.strings.push(cable);

        // **Real lights are rationed, and now shared across the whole park.**
        // Each costs every lit fragment in the scene, so `REAL_LIGHTS` of them
        // are spread evenly over however many strings the park ended up with
        // rather than `REAL_LIGHTS` per chain — otherwise lighting the paths
        // would multiply the park's point-light count by the number of runs.
        this.litCandidates.push({ at: points[Math.floor(points.length / 2)] as Vector3, index: stringNumber });
        stringNumber += 1;
      }
    }

    for (let k = 0; k < Math.min(REAL_LIGHTS, this.litCandidates.length); k += 1) {
      const pick = this.litCandidates[
        Math.floor((k * this.litCandidates.length) / Math.max(1, Math.min(REAL_LIGHTS, this.litCandidates.length)))
      ];
      if (!pick) continue;
      const light = new PointLight(rng.pick(bulbColours), 0, LIGHT_DISTANCE, LIGHT_DECAY);
      light.position.copy(pick.at);
      this.group.add(light);
      this.lights.push(light);
    }

    // --- bulbs as one instanced mesh ---------------------------------------
    // Unlit and opaque. Transparent bulbs turned into ghostly grey discs in
    // daylight; solid beads that simply brighten after dark read far better,
    // and per-instance colour does all the work.
    this.bulbMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      fog: true,
    });
    const bulbGeometry = new SphereGeometry(0.145, 8, 6);
    this.bulbs = new InstancedMesh(bulbGeometry, this.bulbMaterial, bulbPositions.length);
    this.bulbs.name = 'fairy-bulbs';

    const quaternion = new Quaternion();
    // A bulb is a sphere stretched 1.25 along its own long axis, so that axis
    // has to be the local up — stretched along world Y it would read as
    // leaning the opposite way to the string it hangs from. The positions are
    // already the leaned ones, so the tilt is read straight off each of them
    // rather than re-derived from a flat height.
    const scale = new Vector3(1, 1.25, 1);
    bulbPositions.forEach((position, index) => {
      tiltToSphere(position.x, position.y, position.z, quaternion);
      this.bulbMatrix.compose(position, quaternion, scale);
      this.bulbs.setMatrixAt(index, this.bulbMatrix);
      const base = new Color(bulbColours[index % bulbColours.length] as number);
      this.bulbBase.push(base);
      const current = base.clone();
      this.bulbColours.push(current);
      this.bulbs.setColorAt(index, current);
    });
    this.bulbs.instanceMatrix.needsUpdate = true;
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    this.group.add(this.bulbs);
  }

  update({ elapsed }: FrameContext): void {
    const lit = clamp01(this.nightFactor);

    if (this.bulbs.instanceColor) {
      // Each bulb breathes on its own phase so the strings shimmer gently
      // instead of pulsing in unison.
      for (let i = 0; i < this.bulbColours.length; i += 1) {
        const base = this.bulbBase[i];
        const target = this.bulbColours[i];
        if (!base || !target) continue;
        // Dull beads by day, bright and twinkling once the sun goes down.
        const flicker = 0.78 + 0.22 * Math.sin(elapsed * 2.1 + i * 0.9);
        this.scratchColour.copy(base).multiplyScalar(flicker * (0.42 + lit * 0.58));
        target.copy(this.scratchColour);
        this.bulbs.setColorAt(i, target);
      }
      this.bulbs.instanceColor.needsUpdate = true;
    }

    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i];
      if (!light) continue;
      const flicker = 0.85 + 0.15 * Math.sin(elapsed * 1.7 + i * 2.3);
      light.intensity = lit * LIGHT_INTENSITY * flicker;
      light.visible = lit > 0.02;
    }

    const cableOpacity = 0.35 + lit * 0.4;
    for (const cable of this.strings) {
      (cable.material as MeshBasicMaterial).opacity = cableOpacity;
    }
  }

  dispose(): void {
    this.bulbMaterial.dispose();
    this.bulbs.geometry.dispose();
    for (const line of this.strings) line.geometry.dispose();
  }
}
