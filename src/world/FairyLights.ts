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
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';

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
 * **What the rig actually draws on a post.** Owned here because the ride
 * guard has to inflate by it, and a literal in the drawing that the guard
 * cannot see is the whole bug this file keeps re-learning.
 */
const POLE_DRAWN_TOP_RADIUS = 0.11;
const POLE_DRAWN_BOTTOM_RADIUS = 0.17;
const KNOB_RADIUS = 0.22;
/** How far the knob's centre sits above the post's top. */
export const KNOB_RISE = 0.12;

/**
 * The widest thing a post puts in the air — **derived, so widening the post
 * widens the guard with it.**
 *
 * The clearance test samples a post's *axis* and inflates by this. Inflating
 * by the collider radius instead would have been a tolerance masquerading as
 * ownership: draw a fatter post and the guard would quietly under-cover it
 * with nothing to say so.
 */
export const WIDEST_DRAWN_RADIUS = Math.max(POLE_DRAWN_BOTTOM_RADIUS, KNOB_RADIUS);

/**
 * The collider a pole registers, and so the ground it claims.
 *
 * Deliberately **not** the same number as {@link WIDEST_DRAWN_RADIUS}: this is
 * how much ground the pole owns, which is a little more than the wood, and it
 * is also what {@link POLE_PAVING_CLEARANCE} is built from. It was doing three
 * unrelated jobs — collider, guard inflation, paving clearance — and the guard
 * has been given its own owner above.
 */
export const POLE_RADIUS = 0.28;

// **A pole must not be drawn wider than the ground it claims.** Anything a
// child can see and lean on has a collider that covers it (CLAUDE.md), and a
// knob fatter than the collider would be a visible thing she could walk
// through the edge of. A constant comparison, so if it ever fires the code is
// wrong before it ever runs.
if (POLE_RADIUS < WIDEST_DRAWN_RADIUS) {
  throw new Error(
    `fairy pole: collider radius ${POLE_RADIUS} is narrower than the widest drawn part ${WIDEST_DRAWN_RADIUS}`,
  );
}

/** How tall a pole stands. The drawing and the overhead test must agree, so both ask here. */
export const POLE_HEIGHT = 4.4;

/** How far below the pole's top the cable is tied on. */
const ANCHOR_DROP = 0.25;
/** How far a cable sags at mid-span. */
const CABLE_SAG = 1.15;
/** How far a bulb hangs under the cable. */
const BULB_DROP = 0.18;
/** Bulbs on one string. */
const BULBS_PER_STRING = 9;

/**
 * How finely the clearance test walks a post's axis — **derived so the guard
 * genuinely contains the drawn cylinder, rather than to within a tolerance.**
 *
 * The test samples the axis and inflates each sample by
 * {@link WIDEST_DRAWN_RADIUS}. A vertex on the cylinder wall exactly midway
 * between two samples is `hypot(step / 2, POLE_DRAWN_BOTTOM_RADIUS)` from the
 * nearest of them, so covering it needs
 *
 *   `hypot(step / 2, bottomRadius) <= widestDrawnRadius`
 *
 * At 0.5 m that is `hypot(0.25, 0.17) = 0.302` against `0.22` — the wall was
 * standing 0.082 m outside its own guard, and the honest form of the promise
 * would have been "covered to within 0.082 m". The step below satisfies the
 * inequality instead, so the promise is simply true and no tolerance has to be
 * quoted or maintained.
 */
export const POST_AXIS_STEP = 0.25;

if (Math.hypot(POST_AXIS_STEP / 2, POLE_DRAWN_BOTTOM_RADIUS) > WIDEST_DRAWN_RADIUS) {
  throw new Error(
    `fairy pole: axis step ${POST_AXIS_STEP} leaves the cylinder wall outside the guard ` +
      `(${Math.hypot(POST_AXIS_STEP / 2, POLE_DRAWN_BOTTOM_RADIUS).toFixed(3)} > ${WIDEST_DRAWN_RADIUS})`,
  );
}

/**
 * **Where a pole's cable is tied**, in drawn world space.
 *
 * The post leans with the park, so its anchor is not `(x, ground + h, z)` —
 * it is that point carried along the local up, exactly as `placeOnSphere`
 * carries the pole itself.
 */
export function fairyAnchorAt(x: number, z: number, into: Vector3): Vector3 {
  const ground = terrainHeight(x, z);
  const up = upAt(x, ground, z, new Vector3());
  const h = POLE_HEIGHT - ANCHOR_DROP;
  return into.set(x + up.x * h, ground + up.y * h, z + up.z * h);
}

/**
 * **The sampled cable slung between two poles, bulbs included — the one owner.**
 *
 * Both the drawing and the ride-clearance test read this. They must, and the
 * reason is a defect this PR shipped and had to fix: the overhead test guarded
 * the 4.4 m *post* and nothing else, so on seed 326 the Sky Cruiser passed
 * clean between two poles, cleared both, and went **through `fairy-bulbs`** —
 * the lights strung between them, which hang in air where there is no pole at
 * all.
 *
 * The sag, the anchor drop and the bulb drop used to be literals inside the
 * constructor. Re-deriving them in the builder would have been the very
 * two-definitions bug this branch exists to kill: the next person to tune the
 * sag would have silently un-guarded the ride, and nothing would have said so.
 *
 * Returns the cable points; `withBulbs` adds the bulb positions hanging under
 * it, which are what the ride actually strikes first.
 */
export function fairySpan(from: Vector3, to: Vector3): { cable: Vector3[]; bulbs: Vector3[] } {
  const cable: Vector3[] = [];
  const bulbs: Vector3[] = [];
  const up = new Vector3();
  for (let s = 0; s <= BULBS_PER_STRING + 1; s += 1) {
    const t = s / (BULBS_PER_STRING + 1);
    const sag = Math.sin(t * Math.PI) * CABLE_SAG;
    const point = new Vector3().lerpVectors(from, to, t);
    upAt(point.x, point.y, point.z, up);
    point.addScaledVector(up, -sag);
    cable.push(point);
    if (s > 0 && s <= BULBS_PER_STRING) bulbs.push(point.clone().addScaledVector(up, -BULB_DROP));
  }
  return { cable, bulbs };
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
 * How many real {@link PointLight}s the **whole park's** fairy lights carry —
 * three, spread across every string there is, not three per run.
 *
 * It was three of the plaza ring's ten, which paid for `LampPosts` going
 * 3 → 5 without moving the park's total light count. Now that the lights
 * follow two thirds of the paths there are ninety-odd strings, and the
 * ration is the same three: a point light costs every lit fragment in the
 * scene, so one per chain would have multiplied the park's light count by
 * the number of runs.
 *
 * What carries the look instead is the bulbs, which are unlit emissive
 * geometry and cost nothing per-fragment — the real lights exist only so the
 * ground catches a warm pool somewhere, and three pools across the park is
 * what the frame budget buys.
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

    const poleHeight = POLE_HEIGHT;
    /**
     * **Each post is turned to its own bearing.**
     *
     * A pole is an eight-sided cylinder and a knob is a sphere, both built from
     * one shared geometry and, until now, all placed at yaw 0 — so every post
     * in the park had its facets pointing the same way. Two posts offset along
     * a direction parallel to one of those facets put that facet in the *same
     * plane*, which is a depth-buffer fight the moment both are on screen.
     *
     * With ten poles in one verge it never came up. With a hundred strung
     * along the paths `check:coplanar` found nine such pairs
     * (`fairy-pole-0`/`fairy-pole-10`, `fairy-pole-20`/`fairy-pole-21`, the
     * knobs against each other, and so on) — all of them new, all of them
     * mine.
     *
     * Turning each post to its own seeded bearing removes the shared plane at
     * its cause. ART_DIRECTION.md §7's rule is to delete the hidden face
     * rather than hold surfaces apart with a stand-off, and this is the same
     * spirit: no stand-off is introduced and no number has to be maintained —
     * the faces simply stop being parallel. A post is a rough wooden thing and
     * reads identically at any bearing, so nothing is lost.
     *
     * Its own `Rng`, not the one below: that one draws the strings' light
     * colours, and consuming it here would silently re-colour them.
     */
    const yawRng = new Rng(0x9a17e);
    const flat = new Vector3();

    const poleMaterial = new MeshStandardMaterial({
      color: PALETTE.woodDark,
      roughness: 0.9,
      metalness: 0,
    });
    // **Open-ended: the caps are hidden faces, so they are deleted rather than
    // nudged.** Turning each post to its own bearing (below) stops their SIDE
    // facets sharing a plane, but a cylinder's end caps are flat discs
    // perpendicular to its axis, and yaw cannot rotate a disc out of its own
    // plane. Two posts on similar ground therefore kept coplanar caps whatever
    // their bearing — which is why the first attempt at this only took
    // `check:coplanar`'s fairy seams from 9 to 6.
    //
    // Neither cap is ever seen: the top is inside the knob sphere that sits on
    // it (knob radius 0.22 against a 0.12 rise), and the bottom is at ground
    // level. ART_DIRECTION.md section 7 says to delete the hidden face rather
    // than hold surfaces apart, and that is exactly what this is.
    const poleGeometry = new CylinderGeometry(POLE_DRAWN_TOP_RADIUS, POLE_DRAWN_BOTTOM_RADIUS, poleHeight, 8, 1, true);
    const knobGeometry = new SphereGeometry(KNOB_RADIUS, 10, 8);
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
        const yaw = yawRng.range(0, TAU);
        const pole = new Mesh(poleGeometry, poleMaterial);
        pole.name = `fairy-pole-${poleNumber}`;
        flat.set(x, ground + poleHeight / 2, z);
        placeOnSphere(flat, yaw, pole.position, pole.quaternion);
        pole.castShadow = true;
        pole.receiveShadow = true;
        this.group.add(pole);

        const knob = new Mesh(knobGeometry, knobMaterial);
        flat.set(x, ground + poleHeight + KNOB_RISE, z);
        placeOnSphere(flat, yaw + 0.7, knob.position, knob.quaternion);
        knob.castShadow = true;
        this.group.add(knob);

        // **Asked for, not re-derived.** `fairyAnchorAt` is the one owner of
        // where a cable is tied, and the ride-clearance test measures against
        // the points it returns — so the drawing must come from the same call
        // or the guard is measuring a cable the park does not hang.
        anchors[i] = fairyAnchorAt(x, z, new Vector3());
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
        // **The drawn cable and bulbs are `fairySpan`'s own output**, the same
        // call the Sky Cruiser clearance test measures against. They were two
        // implementations of one shape until a reviewer mutated `CABLE_SAG` to
        // 3.0 and found the guarded cable moving 1.85 m while the drawn one
        // stayed at a hard-coded 1.15 — agreeing at the committed values only
        // because the numbers had been copied, which is the two-definitions bug
        // this branch exists to kill, in the code written to kill it.
        const span = fairySpan(from, to);
        const points = span.cable;
        bulbPositions.push(...span.bulbs);

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
