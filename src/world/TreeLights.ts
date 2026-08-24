import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMERA_PITCH_DEGREES } from '../core/constants';
import { PALETTE } from '../core/palette';
import { glowTexture } from '../core/textures';
import { clamp01, lerp, Rng, smoothstep } from '../core/mathUtils';
import { terrainHeight } from './terrain';
import { isOnPath } from './pathGraph';
import { ANCHORS } from './anchors';
import { COASTER_PLANS } from './coaster/plan';
import { CART_ENVELOPE } from './coaster/cart';
import type { FoliageOccluder } from './Scenery';
import type { TrainRoute } from './train';
import type { FrameContext, GameSystem } from '../core/types';

/**
 * Strings of fairy lights slung from tree to tree across the park.
 *
 * The family asked for these and attached the constraint themselves:
 * *"procedurally generate this so it survives if we change tree locations
 * later."* That is not decoration on the request, it is the whole design —
 * ARCHITECTURE-DECISIONS Decision 4 (the park replan) is about to redraw the
 * park around a railway, and any hand-typed list of wire endpoints would be
 * thrown away with the first tree that moves. So nothing here is authored.
 * The only input is {@link Scenery.foliageOccluders} — the trees' real
 * positions, canopy centres and canopy radii, straight out of the seeded
 * scatter that planted them — and a set of rules. Move the trees and the
 * garlands move with them; plant more and more strings appear.
 *
 * ## The spanning rule
 *
 * Every pair of eligible trees is a candidate, sorted **shortest span first**,
 * and taken greedily while all of these hold:
 *
 * 1. **A maximum span** ({@link MAX_SPAN}). This is the rule that stops a wire
 *    being drawn clean across the park because two lonely trees happened to be
 *    each other's nearest neighbour. Shortest-first is what makes the maximum
 *    do its job: the obvious short hops are all taken before any long one is
 *    even considered.
 * 2. **A minimum span** ({@link MIN_SPAN}), because two trees a metre apart
 *    give you a wire you cannot see.
 * 3. **A degree cap** ({@link MAX_STRINGS_PER_TREE}) — at most two wires meet
 *    at any tree. Without it the greedy pass turns the densest corner of the
 *    park into a cobweb. With it the result is what a person would actually
 *    hang: chains and loops of two-ended garlands.
 * 4. **Clear of the paths.** No wire crosses paving a child walks on
 *    ({@link PATH_CLEARANCE}).
 * 5. **Clear of the reserved ride plots** ({@link ANCHORS}), so nothing is
 *    strung through the ferris wheel.
 * 6. **Clear of the railway** by {@link RAIL_CLEARANCE}, asked of the *solved*
 *    {@link TrainRoute} rather than of a radius typed in here. Today that
 *    rejects nothing at all — the loop sits at r ≈ 56 and `Scenery` plants
 *    nothing past 55, so the track is tree-free by construction. It is written
 *    now anyway, because ARCHITECTURE-DECISIONS Decision 4 dives the railway
 *    inward to r ≈ 29 through the gaps between the big plots, straight through
 *    the trees. When that lands, the garlands step out of its way on their own
 *    and nobody has to remember this file existed — which is the same reason
 *    the wire endpoints are not typed in either.
 * 7. **Not threaded through a third tree**, checked against every tree in the
 *    park rather than only the ones being used as posts.
 * 8. **Enough headroom underneath** ({@link HEAD_ROOM}) once the wire is hung.
 *    The sag is reduced to fit the ground below it, and if it has to come down
 *    past {@link MIN_SAG} to fit, the pair is dropped instead — a wire pulled
 *    taut looks like a cable, and the sag is the whole point (see below).
 *
 * ## The sag
 *
 * Each wire hangs as a **catenary** — a hyperbolic cosine, the shape a real
 * chain takes under its own weight — not a straight line and not the parabola
 * the plaza ring uses. A straight wire reads as scaffolding; a sagging one
 * reads as fairy lights instantly, and the eye is good enough at this that the
 * cosh is worth the two extra multiplies at build time. Deeper sag on longer
 * spans, exactly as a real string of lights does.
 *
 * ## Cost
 *
 * **No real lights at all.** The park already carries about eight `PointLight`s
 * between the plaza ring and the lamp posts, and every one of them costs every
 * lit fragment in the scene; the readability at night comes from
 * {@link DayNight.moonLight} instead. These are emissive-looking beads —
 * unlit, opaque, brightness baked into per-instance colour — exactly the trick
 * `FairyLights` and `LampPosts` already use, so the three rigs read as one
 * family after dark.
 *
 * Every wire in the park is **one** merged `Mesh` and every bulb is **one**
 * `InstancedMesh`: two draw calls for the lot. Nothing is allocated after
 * construction — `update` writes floats straight into the instance colour
 * buffer that already exists.
 */

// ------------------------------------------------------------------- tuning

/** Longest wire we will hang, in metres. Rule 1 above — the family's own constraint. */
const MAX_SPAN = 15;
/** Shortest wire worth hanging. */
const MIN_SPAN = 6;
/** At most this many wires meet at one tree. Two gives chains and loops, not cobwebs. */
const MAX_STRINGS_PER_TREE = 2;

/**
 * Only trees with a canopy at least this wide are used as posts. A sapling
 * bends; more to the point, a wire tied to a small blob looks like it is
 * floating next to it rather than tied to anything.
 */
const MIN_POST_RADIUS = 1.7;

/**
 * How far every wire, and every tree holding one up, stays from the railway's
 * centre line. Well past the 1.3 m the track itself claims
 * ({@link TRACK_CLEARANCE}): a garland is not a hazard to a train, but a wire
 * hanging over the rails would be strung across the one part of the park
 * nobody can walk to, and it would foul the tunnel shells and bridge decks
 * Decision 4 builds over the track.
 */
const RAIL_CLEARANCE = 7;

/** How finely the solved railway is sampled for the clearance test, in metres. */
const RAIL_SAMPLE_STEP = 2;

/** Paving clearance for the whole length of a wire. */
const PATH_CLEARANCE = 1.4;
/** On top of a plot's own `boundingRadius`. */
const ANCHOR_MARGIN = 1.0;

/** Nothing hangs lower than this above the ground beneath it. Tall child + hat + arm. */
const HEAD_ROOM = 3.1;

/** Sag at the middle of a wire, as a fraction of its span. */
const SAG_RATIO = 0.14;
/** Below this much sag the wire reads as taut, and we would rather have no wire. */
const MIN_SAG = 0.55;
/** However long the span, the middle never drops further than this. */
const MAX_SAG = 2.1;

/**
 * Shape parameter of the catenary. `sag(t) = S * (cosh(k) - cosh(k(2t-1))) /
 * (cosh(k) - 1)`, which is zero at both ends and exactly `S` in the middle for
 * any `k`. Larger `k` gathers the curvature into the middle and straightens the
 * ends — the look of a wire pulled up tight over its post. 1.9 is about where a
 * real garland sits.
 */
const CATENARY_K = 1.9;

/** Where up the canopy the wire is tied on, as a fraction of the canopy radius. */
const TIE_HEIGHT = 0.62;

/**
 * Radius of the wire itself, in metres — so a cord about 5 cm thick.
 *
 * It used to be a `LineSegments`, and the family's report was that the string
 * between the lights is "very faint". It was: WebGL ignores
 * `LineBasicMaterial.linewidth` on essentially every platform, so a line is
 * always exactly **one device pixel** — which on a retina screen is half a CSS
 * pixel, a grey hair holding up a row of glowing bulbs. There is no thickness
 * setting to turn up; the wire has to become geometry, so it is a tube.
 *
 * 0.025 m of radius comes out at roughly two and a half times that hairline at
 * the default zoom, which is what was asked for, and unlike a line it now
 * thickens when a child zooms in, exactly as the poles and the bulbs do.
 */
const WIRE_RADIUS = 0.025;

/**
 * Faces around the wire. Five, for the same reason the balloon string uses
 * five: at this thickness a pentagon reads as round, and a hexagon would just
 * be more vertices to say the same thing.
 */
const WIRE_SIDES = 5;

/** Roughly one bulb every this many metres. */
const METRES_PER_BULB = 1.15;
/** How far each bulb hangs below the wire. */
const BULB_DROP = 0.17;

const BULB_COLOURS = [
  PALETTE.fairyWarm,
  PALETTE.fairyPink,
  PALETTE.fairyMint,
  PALETTE.fairyBlue,
];

// ------------------------------------------------------------------- the glow

/**
 * Width of a bulb's halo, in metres.
 *
 * Bulbs sit {@link METRES_PER_BULB} apart along the wire, so at this size
 * neighbouring halos overlap slightly and a lit string reads as a soft rope of
 * light rather than a row of separate blobs — while each bulb is still its own
 * point of light rather than the whole wire fogging up.
 */
const HALO_SIZE = 1.05;

/**
 * How far each halo's colour is pulled towards cream, 0 = the bulb's own
 * colour, 1 = flat cream.
 *
 * Not zero, because a halo has to be *lighter than its surroundings* to read
 * as brightness at all — a saturated pink disc at full saturation reads as a
 * pink sticker stuck to the air. Not one either, or the family gets the row of
 * identical white blobs they were promised they would not: at 0.55 the mint
 * bulbs still glow green and the pink ones still glow pink, they are just
 * unmistakably *glowing*.
 */
const HALO_CREAM = 0.4;

/** Cream, not white — ART_DIRECTION §5. Nothing in this park highlights to pure white. */
const HALO_CREAM_COLOUR = PALETTE.signBoard;

/**
 * How much brighter than its bulb the halo is allowed to get at its centre.
 *
 * Above 1 the halo would clip, and the whole point of pigment blending (see
 * the class doc) is that it cannot.
 */
const HALO_STRENGTH = 0.85;

/**
 * How far into the night the halos have faded fully in. Below this they are
 * still coming up; at 1 they are at full strength.
 */
const HALO_FADE_IN = 0.35;

// Scratch for `aimHalos`, allocated once at module load like everything else
// in this file. Never allocate in a park that is watching its GC.
const CAMERA_PITCH = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
const HALO_EULER = new Euler(0, 0, 0, 'YXZ');
const HALO_FACING = new Quaternion();
const HALO_POSITION = new Vector3();
const HALO_MATRIX = new Matrix4();
const HALO_SCALE = new Vector3(1, 1, 1);

// ---------------------------------------------------------------- the system

/** One tree the garlands are allowed to be tied to. */
interface Post {
  readonly x: number;
  readonly z: number;
  /** World Y the wire is tied on at. */
  readonly y: number;
  /** Canopy radius, used to keep other wires from being threaded through it. */
  readonly radius: number;
}

/** A wire that passed every rule, with the sag it is allowed to hang at. */
interface Strung {
  readonly a: number;
  readonly b: number;
  readonly span: number;
  readonly sag: number;
}

export class TreeLights implements GameSystem {
  readonly name = 'treeLights';
  readonly group = new Group();

  /** 0 = off (daytime), 1 = fully lit. Set by World from DayNight, as the other rigs are. */
  nightFactor = 0;

  private readonly bulbs: InstancedMesh;
  private readonly bulbMaterial: MeshBasicMaterial;
  private readonly wires: Mesh;
  private readonly wireMaterial: MeshBasicMaterial;
  /** The soft halo around each bulb. See {@link HALO_SIZE}. */
  private readonly halos: InstancedMesh;
  private readonly haloMaterial: MeshBasicMaterial;
  /** Each halo's colour at full brightness, three floats per bulb. */
  private readonly haloBase: Float32Array;
  /** Bulb positions, kept so the halos can be re-aimed when the camera turns. */
  private readonly haloPosition: Float32Array;
  /**
   * Camera yaw the halo quads are currently aimed at, or NaN before the first
   * aim. The bulbs never move and the camera has exactly one pitch forever, so
   * the only thing that can invalidate 170 billboard matrices is the camera
   * turning — and in the park it almost never does. Checking costs one
   * comparison a frame and saves rewriting the whole instance matrix buffer on
   * every frame of a game that is already watching its GC.
   */
  private aimedYaw = Number.NaN;
  /**
   * Every bulb's unlit colour, three floats per bulb, in the same working
   * colour space `InstancedMesh.setColorAt` writes — so `update` can multiply
   * these straight into the instance colour buffer without going through a
   * `Color` at all.
   */
  private readonly bulbBase: Float32Array;
  /** Per-bulb twinkle phase, so the strings shimmer rather than pulse in unison. */
  private readonly bulbPhase: Float32Array;
  /** How many strings were actually hung. Handy in the debug overlay. */
  readonly stringCount: number;

  constructor(trees: readonly FoliageOccluder[], railway: TrainRoute) {
    this.group.name = 'tree-lights';
    const rng = new Rng(0x6a12d);

    const rails = sampleRailway(railway);
    const posts = eligiblePosts(trees, rails);
    const strings = chooseStrings(posts, rails);
    this.stringCount = strings.length;

    // --- walk every chosen span once, filling both buffers -------------------
    const wireTubes: BufferGeometry[] = [];
    const bulbPoints: number[] = [];

    for (const { a, b, span, sag } of strings) {
      const from = posts[a] as Post;
      const to = posts[b] as Post;
      const segments = Math.max(6, Math.min(22, Math.round(span / METRES_PER_BULB)));

      const path: Vector3[] = [new Vector3(from.x, from.y, from.z)];
      for (let s = 1; s <= segments; s += 1) {
        const t = s / segments;
        const x = lerp(from.x, to.x, t);
        const z = lerp(from.z, to.z, t);
        const y = lerp(from.y, to.y, t) - sag * catenaryShape(t);
        path.push(new Vector3(x, y, z));
        // A bulb hangs off every interior joint. Never off the two ends, where
        // it would sit inside the canopy it is tied to.
        if (s < segments) bulbPoints.push(x, y - BULB_DROP, z);
      }

      // A Catmull-Rom through points that already lie on the catenary stays on
      // it — the curve is only here because that is what `TubeGeometry` takes.
      wireTubes.push(
        new TubeGeometry(new CatmullRomCurve3(path), segments, WIRE_RADIUS, WIRE_SIDES, false),
      );
    }

    // --- the wires: one merged Mesh for the whole park ------------------------
    // Still a single draw call, as the `LineSegments` this replaced was — the
    // per-span tubes are merged rather than added to the group one by one.
    this.wireMaterial = new MeshBasicMaterial({
      color: PALETTE.barkDark,
      transparent: true,
      opacity: 0.7,
      fog: true,
    });
    const merged = wireTubes.length > 0 ? mergeGeometries(wireTubes, false) : null;
    for (const tube of wireTubes) tube.dispose();
    this.wires = new Mesh(merged ?? new BufferGeometry(), this.wireMaterial);
    this.wires.name = 'tree-light-wires';
    // A 5 cm cord's shadow is a smudge, and the park's one shadow map has more
    // useful things to spend itself on.
    this.wires.castShadow = false;
    this.wires.receiveShadow = false;
    this.group.add(this.wires);

    // --- the bulbs: one InstancedMesh for the whole park ---------------------
    const bulbCount = bulbPoints.length / 3;
    this.bulbMaterial = new MeshBasicMaterial({ color: 0xffffff, fog: true });
    this.bulbs = new InstancedMesh(
      new SphereGeometry(0.135, 8, 6),
      this.bulbMaterial,
      Math.max(1, bulbCount),
    );
    this.bulbs.name = 'tree-light-bulbs';
    this.bulbs.count = bulbCount;

    this.bulbBase = new Float32Array(bulbCount * 3);
    this.bulbPhase = new Float32Array(bulbCount);

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    // Bulbs are slightly taller than they are wide, so they read as beads
    // rather than beads' idea of a ball bearing.
    const scale = new Vector3(1, 1.25, 1);
    const colour = new Color();

    for (let i = 0; i < bulbCount; i += 1) {
      position.set(
        bulbPoints[i * 3] as number,
        bulbPoints[i * 3 + 1] as number,
        bulbPoints[i * 3 + 2] as number,
      );
      matrix.compose(position, rotation, scale);
      this.bulbs.setMatrixAt(i, matrix);

      colour.setHex(BULB_COLOURS[i % BULB_COLOURS.length] as number);
      this.bulbBase[i * 3] = colour.r;
      this.bulbBase[i * 3 + 1] = colour.g;
      this.bulbBase[i * 3 + 2] = colour.b;
      this.bulbPhase[i] = rng.range(0, Math.PI * 2);
      // The first `setColorAt` is what creates the instance colour buffer;
      // after this `update` writes into it directly.
      this.bulbs.setColorAt(i, colour);
    }
    this.bulbs.instanceMatrix.needsUpdate = true;
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    this.group.add(this.bulbs);

    // --- the halo around each bulb ------------------------------------------
    // The family: "needs more glow around the strings of lights" — the bulbs
    // read as hard beads next to the lamp posts' proper pools.
    //
    // A camera-facing quad each, sized in metres so it scales with the world
    // rather than staying a fixed number of pixels, carrying the same soft
    // radial blob the lamp posts' ground glow uses. One InstancedMesh, so the
    // whole park's glow is one more draw call, and **no lights**: this is
    // appearance, not illumination.
    //
    // Blending is **normal, not additive**, which is the one place this departs
    // from the brief that came with the request. ART_DIRECTION is explicit —
    // "pigment, not light; normal blending, never additive" — and it is
    // explicit because additive was tried on the rainbow hop ring and blew out
    // to a flat white halo the moment it crossed a pale path. That failure is
    // exactly the risk here: the request also asks that these hold up now the
    // light pools are trebled, and an additive halo's brightness depends
    // entirely on what happens to be behind it, so it would look wrong over
    // lit ground and wrong again if the park is later darkened back down. A
    // painted halo looks the same whatever it is in front of. Both were built
    // and compared on screen before this was settled — see the PR.
    this.haloMaterial = new MeshBasicMaterial({
      map: glowTexture(0xffffff),
      transparent: true,
      depthWrite: false,
      opacity: 0,
      fog: true,
    });
    this.halos = new InstancedMesh(
      new PlaneGeometry(HALO_SIZE, HALO_SIZE),
      this.haloMaterial,
      Math.max(1, bulbCount),
    );
    this.halos.name = 'tree-light-halos';
    this.halos.count = bulbCount;
    this.halos.castShadow = false;
    this.halos.receiveShadow = false;
    this.halos.renderOrder = 2;

    this.haloBase = new Float32Array(bulbCount * 3);
    this.haloPosition = new Float32Array(bulbPoints);

    const cream = new Color(HALO_CREAM_COLOUR);
    for (let i = 0; i < bulbCount; i += 1) {
      colour
        .setRGB(
          this.bulbBase[i * 3] as number,
          this.bulbBase[i * 3 + 1] as number,
          this.bulbBase[i * 3 + 2] as number,
        )
        .lerp(cream, HALO_CREAM)
        .multiplyScalar(HALO_STRENGTH);
      this.haloBase[i * 3] = colour.r;
      this.haloBase[i * 3 + 1] = colour.g;
      this.haloBase[i * 3 + 2] = colour.b;
      this.halos.setColorAt(i, colour);
    }
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
    this.group.add(this.halos);
  }

  /**
   * Points every halo quad at the camera.
   *
   * One quaternion for all of them: the camera looks down at exactly one
   * angle, forever (ARCHITECTURE.md), so turning the ground-plane
   * `cameraForward` into a facing is a single `atan2` — the same trick
   * `Fireflies` uses. Only called when the yaw has actually changed.
   */
  private aimHalos(yaw: number): void {
    this.aimedYaw = yaw;
    HALO_EULER.set(-CAMERA_PITCH, yaw, 0);
    HALO_FACING.setFromEuler(HALO_EULER);
    for (let i = 0; i < this.halos.count; i += 1) {
      HALO_POSITION.set(
        this.haloPosition[i * 3] as number,
        this.haloPosition[i * 3 + 1] as number,
        this.haloPosition[i * 3 + 2] as number,
      );
      HALO_MATRIX.compose(HALO_POSITION, HALO_FACING, HALO_SCALE);
      this.halos.setMatrixAt(i, HALO_MATRIX);
    }
    this.halos.instanceMatrix.needsUpdate = true;
  }

  update({ elapsed, cameraForward }: FrameContext): void {
    const lit = clamp01(this.nightFactor);
    const instanceColor = this.bulbs.instanceColor;
    const haloColor = this.halos.instanceColor;
    const haloArray = haloColor ? (haloColor.array as Float32Array) : null;

    if (instanceColor) {
      const array = instanceColor.array as Float32Array;
      // Dull beads by day, bright and twinkling once the sun goes down — the
      // same curve `FairyLights` and `LampPosts` use, on purpose.
      const level = 0.42 + lit * 0.58;
      for (let i = 0; i < this.bulbPhase.length; i += 1) {
        const flicker = 0.78 + 0.22 * Math.sin(elapsed * 2.1 + (this.bulbPhase[i] as number));
        const multiplier = flicker * level;
        const base = i * 3;
        array[base] = (this.bulbBase[base] as number) * multiplier;
        array[base + 1] = (this.bulbBase[base + 1] as number) * multiplier;
        array[base + 2] = (this.bulbBase[base + 2] as number) * multiplier;
        // The halo breathes on its bulb's own phase, so the glow and the bead
        // it belongs to twinkle as one thing rather than beating against
        // each other.
        if (haloArray) {
          haloArray[base] = (this.haloBase[base] as number) * flicker;
          haloArray[base + 1] = (this.haloBase[base + 1] as number) * flicker;
          haloArray[base + 2] = (this.haloBase[base + 2] as number) * flicker;
        }
      }
      instanceColor.needsUpdate = true;
      if (haloColor) haloColor.needsUpdate = true;
    }

    // Gone completely in daylight — a glow you can see at noon is a smudge.
    // Held back until dusk is properly under way rather than fading in with
    // the bulbs, because a pale disc over a still-bright sky reads as a
    // lens artefact rather than as a light.
    this.haloMaterial.opacity = smoothstep(HALO_FADE_IN, 1, lit);
    this.halos.visible = this.haloMaterial.opacity > 0.004;

    if (this.halos.visible) {
      const yaw = Math.atan2(-cameraForward.x, -cameraForward.z);
      if (!(Math.abs(yaw - this.aimedYaw) < 0.002)) this.aimHalos(yaw);
    }

    this.wireMaterial.opacity = 0.35 + lit * 0.4;
  }

  dispose(): void {
    this.bulbMaterial.dispose();
    this.bulbs.geometry.dispose();
    this.wireMaterial.dispose();
    this.wires.geometry.dispose();
    this.haloMaterial.dispose();
    this.halos.geometry.dispose();
  }
}

// ------------------------------------------------------------------ the rules

/**
 * The trees big enough, and well enough placed, to tie a wire to.
 *
 * `FoliageOccluder` is `Scenery`'s own record of where each tree is and how
 * wide its widest canopy blob is — the same data `FoliageFade` uses to fade a
 * tree out from in front of the player. Reading it means there is exactly one
 * place in the codebase that decides where trees go.
 */
function eligiblePosts(trees: readonly FoliageOccluder[], rails: Float64Array): Post[] {
  const posts: Post[] = [];
  for (const tree of trees) {
    if (tree.radius < MIN_POST_RADIUS) continue;
    if (railwayGap(rails, tree.x, tree.z, tree.x, tree.z) < RAIL_CLEARANCE) continue;
    posts.push({
      x: tree.x,
      z: tree.z,
      y: tree.centreY + tree.radius * TIE_HEIGHT,
      radius: tree.radius,
    });
  }
  return posts;
}

/**
 * The spanning rule itself. Shortest span first, greedy, subject to every
 * check in the class doc comment.
 *
 * `posts.length` is a couple of dozen, so the O(n²) candidate pass and the
 * O(n) obstruction checks inside it cost nothing worth measuring — and this
 * runs exactly once, at construction.
 */
function chooseStrings(posts: readonly Post[], rails: Float64Array): Strung[] {
  const candidates: { a: number; b: number; span: number }[] = [];
  for (let a = 0; a < posts.length; a += 1) {
    for (let b = a + 1; b < posts.length; b += 1) {
      const from = posts[a] as Post;
      const to = posts[b] as Post;
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      if (span < MIN_SPAN || span > MAX_SPAN) continue;
      candidates.push({ a, b, span });
    }
  }
  candidates.sort((left, right) => left.span - right.span);

  const degree = new Uint8Array(posts.length);
  const chosen: Strung[] = [];
  for (const { a, b, span } of candidates) {
    if ((degree[a] as number) >= MAX_STRINGS_PER_TREE) continue;
    if ((degree[b] as number) >= MAX_STRINGS_PER_TREE) continue;
    const from = posts[a] as Post;
    const to = posts[b] as Post;
    if (!spanIsClear(from, to, posts, rails, a, b)) continue;
    // Last, because it is the only test that can fail for a reason the tree
    // positions alone do not explain — and a pair rejected here must not have
    // spent either tree's budget of two wires on the way.
    const sag = fittedSag(from, to, span);
    if (sag === null) continue;

    degree[a] = (degree[a] as number) + 1;
    degree[b] = (degree[b] as number) + 1;
    chosen.push({ a, b, span, sag });
  }
  return chosen;
}

/** Samples along the span checking paving, ride plots and other trees. */
function spanIsClear(
  from: Post,
  to: Post,
  posts: readonly Post[],
  rails: Float64Array,
  skipA: number,
  skipB: number,
): boolean {
  if (railwayGap(rails, from.x, from.z, to.x, to.z) < RAIL_CLEARANCE) return false;

  // Every other tree the wire would otherwise be threaded through. Checked
  // against the posts rather than every tree in the park: a wire is hung well
  // above a bush or a sapling, and it is only the big canopies it could
  // actually disappear into.
  for (let i = 0; i < posts.length; i += 1) {
    if (i === skipA || i === skipB) continue;
    const other = posts[i] as Post;
    if (segmentDistance(from.x, from.z, to.x, to.z, other.x, other.z) < other.radius) {
      return false;
    }
  }

  for (const anchor of ANCHORS) {
    const [ax, az] = anchor.position;
    const distance = segmentDistance(from.x, from.z, to.x, to.z, ax, az);
    if (distance < anchor.boundingRadius + ANCHOR_MARGIN) return false;
  }

  const steps = Math.max(8, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z)));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = lerp(from.x, to.x, t);
    const z = lerp(from.z, to.z, t);
    if (isOnPath(x, z, PATH_CLEARANCE)) return false;
    if (crossesTheCruiser(x, z, lerp(from.y, to.y, t))) return false;
  }

  return true;
}

/**
 * Clearance kept between a wire and the Sky Cruiser's car, in metres.
 *
 * Half a car plus the wire's own tube and a little either side. Small on
 * purpose: this is a "does not touch" rule like the ride's own clearance check,
 * not a generous band. See `coaster/clearance.ts`.
 */
const CRUISER_WIRE_GAP = CART_ENVELOPE.halfWidth + 0.5;

/**
 * Would a wire tied at `tieY` and passing over (x, z) meet the Sky Cruiser?
 *
 * The trees at either end are already kept out of the ride's way
 * (`clearOfCruiser` in `Scenery.ts`, #198) — but **a wire between two trees
 * that are each clear can still span the gap between them**, and on seed 5 one
 * did: `tree-light-wires` struck the car 181 m along the loop, 3 m up, on the
 * station approach where the ride is down at boarding height. Keeping the posts
 * clear was never going to be enough, because the thing in the way is the span,
 * not its ends.
 *
 * Vertically honest rather than a plan-view veto: a wire is only in the way
 * where the car actually passes through its height. Everywhere else the ride is
 * at cruise, several metres over the tallest tree a wire can be tied to, and
 * refusing those pairs would thin the garlands for nothing.
 *
 * The wire hangs *below* its chord, by up to {@link MAX_SAG}, so the band
 * checked runs from the tie down to the deepest it could sag.
 */
function crossesTheCruiser(x: number, z: number, tieY: number): boolean {
  const route = COASTER_PLANS.cruiser.route;
  const near = route.nearestPoint(x, z);
  if (Math.hypot(near.x - x, near.z - z) > CRUISER_WIRE_GAP) return false;
  const carLow = near.y - CART_ENVELOPE.below;
  const carHigh = near.y + CART_ENVELOPE.above;
  return tieY - MAX_SAG <= carHigh && tieY >= carLow;
}

/**
 * How deep this wire is allowed to hang.
 *
 * Starts from {@link SAG_RATIO} of the span and pulls it up wherever the
 * ground below rises into it, so a wire strung across a dip sags into the dip
 * and one strung over a hummock is tighter. Returns `null` if it would have to
 * be pulled tighter than {@link MIN_SAG} to clear the ground, which is the
 * caller's cue to drop the pair — a wire with no sag in it does not read as
 * fairy lights at all, and no wire is better than a wrong one.
 */
function fittedSag(from: Post, to: Post, span: number): number | null {
  let sag = Math.min(MAX_SAG, span * SAG_RATIO);

  const steps = Math.max(6, Math.ceil(span));
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps;
    const shape = catenaryShape(t);
    if (shape <= 1e-4) continue;
    const x = lerp(from.x, to.x, t);
    const z = lerp(from.z, to.z, t);
    const chordY = lerp(from.y, to.y, t);
    const allowedDrop = chordY - (terrainHeight(x, z) + HEAD_ROOM);
    if (allowedDrop <= 0) return null; // the wire itself is already too low here
    sag = Math.min(sag, allowedDrop / shape);
  }

  return sag >= MIN_SAG ? sag : null;
}

/**
 * The catenary, normalised: 0 at both ends, 1 in the middle, hyperbolic cosine
 * in between. Multiply by the sag in metres.
 */
const COSH_K = Math.cosh(CATENARY_K);
function catenaryShape(t: number): number {
  return (COSH_K - Math.cosh(CATENARY_K * (2 * t - 1))) / (COSH_K - 1);
}

/**
 * The solved railway centre line, flattened to `[x, z, x, z, …]` every
 * {@link RAIL_SAMPLE_STEP} metres.
 *
 * A plain list of points rather than anything cleverer because the only
 * question ever asked of it is "how close does this wire come to the track",
 * and at a two-metre sample spacing against a seven-metre clearance the answer
 * from the samples and the answer from the true curve are the same answer.
 */
function sampleRailway(railway: TrainRoute): Float64Array {
  const count = Math.max(2, Math.ceil(railway.length / RAIL_SAMPLE_STEP));
  const rails = new Float64Array(count * 2);
  const point = new Vector3();
  for (let i = 0; i < count; i += 1) {
    railway.pointAt((i / count) * railway.length, point);
    rails[i * 2] = point.x;
    rails[i * 2 + 1] = point.z;
  }
  return rails;
}

/** Closest the given span comes to the railway centre line, in metres. */
function railwayGap(rails: Float64Array, x1: number, z1: number, x2: number, z2: number): number {
  let best = Infinity;
  for (let i = 0; i < rails.length; i += 2) {
    const gap = segmentDistance(x1, z1, x2, z2, rails[i] as number, rails[i + 1] as number);
    if (gap < best) best = gap;
  }
  return best;
}

/** Distance from a point to a line *segment* on the ground plane. */
function segmentDistance(x1: number, z1: number, x2: number, z2: number, px: number, pz: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? clamp01(((px - x1) * dx + (pz - z1) * dz) / lengthSq) : 0;
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}
