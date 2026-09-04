/**
 * **Do the pets actually come down the slide behind her?** (issue #468)
 *
 * ```
 * pnpm run check:pet-slide
 * ```
 *
 * Jim: *"When going down the slide, the pet should slide down behind the
 * player."*
 *
 * ### Why a script, and why it drives every frame
 *
 * Every failure mode of this feature is **mid-ride**, and mid-ride is the one
 * place screenshots cannot reach: the QA browser renders this park at 0.2–0.5
 * fps on swiftshader and a backgrounded tab throttles `requestAnimationFrame`,
 * so a sequence of frames costs minutes and arrives stale. A pet that is fine
 * at the lip and fine in the ball pit and gone for the two seconds in between
 * would pass a pair of stills and fail a six-year-old, who watches for it the
 * whole way down.
 *
 * So this rides the real `Building.update` loop with a real `Player` and a real
 * `Parade` — the same harness `check:slide-rider` uses, and for the same
 * reason: the defect class here is per-frame, not geometric. It **observes**
 * the bodies the game would draw. Nothing below recomputes where a pet ought to
 * be from the chute and compares that with itself; every number is read off a
 * `root.position` after the frame that moved it.
 *
 * ### What it asserts, every frame of a real descent
 *
 * 1. **Every companion is drawn** — `root.visible`, and every ancestor up to
 *    the scene. "Vanishes at the lip and reappears at the bottom is worse than
 *    one that never left" is Jim's own bar, so absence is a failure and not
 *    merely a gap.
 * 2. **Every companion is on the chute**, within the built trough
 *    (`CHUTE_ENVELOPE`), from shortly after boarding to the mouth. The grace at
 *    the start is not slack: the line runs on backwards behind the lip so that
 *    eight animals do not stand inside one another for the first second and a
 *    half (see `slide/petRiders.ts`), and this asserts that each one is aboard
 *    within {@link BOARD_SECONDS} and never off it afterwards.
 * 3. **Behind her, and in order.** Each companion's nearest point on the chute
 *    is further **up** the slide than the child's, and each next one is further
 *    up still — so "behind her" and "no two on the same spot" are both measured
 *    on the built curve rather than trusted to the spacing constants.
 * 3a. **And not inside her.** No companion's drawn geometry may touch the
 *    child's drawn geometry, mesh against mesh, on any ridden frame. Jim, 1
 *    September 2026: *"Pet on the slide shouldn't mean they clip inside the
 *    player's head."* This is the clause that would have caught that, and the
 *    reason none of the ones above did is worth reading: they are all about
 *    *distance along the chute* and about the *camera*, and a pet 1.5 m behind
 *    her on the curve is 0.78 m inside a child whose arms reach 2.28 m back.
 *    Ordering is not clearance and framing is not clearance. See
 *    {@link touching}.
 * 3b. **Lying down, as she is.** Every companion's own up axis is tipped at
 *    least {@link LYING_DOWN_DOT} back against the chute's tangent, which is a
 *    body on its back with its feet down the slide and not a body standing on a
 *    falling floor. Asked of the world quaternion the renderer would use, so it
 *    covers the pose *and* the frame it is composed in — the first attempt at
 *    this feature turned a pet in `XYZ`, where a recline and a yaw compose the
 *    other way round and a pet on a bend corkscrews out of the trough.
 * 4. **In the shot.** The first companion is inside the live ride camera's
 *    frustum on essentially every chase frame. This is the clause that answers
 *    "behind her *and clearly so*" — judged off what is framed, not off a gap
 *    in metres, because an agent this week rendered 116 clouds of which zero
 *    were on screen by reasoning about extents instead of looking.
 * 5. **No jump, ever.** No companion moves more than {@link MAX_STEP} in one
 *    frame after the boarding teleport — which covers the two hand-offs a child
 *    would see as a stutter: onto the chute and off it.
 * 6. **Back to her at the bottom.** Some frames after the ride ends every
 *    companion is off the slide and back within following distance of her.
 *
 * ### The control, and why it is in the file
 *
 * A green instrument proves nothing until it has been shown to go red. Several
 * checks in this repo have been clean, decisive and measuring the wrong thing —
 * `WildPets` compared a world position against floor-local coordinates and
 * every distance in the file was 1341.6 m while nothing was red.
 *
 * So this runs the descent **twice**. The second time the ride is not told
 * about the parade at all (`building.petParade = null`), which is exactly the
 * game as it stood before #468: the pets keep following the trail on the
 * ground. That run **must fail** the same clauses, and the check fails if it
 * passes — a control that cannot go red is not a control. It is asserted
 * positively, printed, and it is the reason to believe the green run.
 */

import './headless-dom.mjs';
import { Box3, Object3D, Quaternion, Vector3 } from 'three';

await import('./headless-canvas.mjs');
const { Scene } = await import('three');
const { World } = await import('../src/world/World.ts');
const { Sky } = await import('../src/world/Sky.ts');
const { Player } = await import('../src/entities/Player.ts');
const { Parade } = await import('../src/entities/parade/Parade.ts');
const { CHUTE_ENVELOPE } = await import('../src/world/building/SlideRide.ts');
const { Raycaster } = await import('three');
const { PARADE_MEMBER_RADIUS } = await import('../src/core/constants.ts');
const { IsoCamera } = await import('../src/core/IsoCamera.ts');
const { gameStore } = await import('../src/state/index.ts');
const { shopItem } = await import('../src/world/building/shops/catalogue.ts');
type InteriorControls = import('../src/world/building/Building.ts').InteriorControls;

// Live controls, as `check:slide-rider` uses: boarding the slide is a change of
// space, and the ride does not start until the iris midpoint fires.
const liveControls: InteriorControls = {
  cancelWalk: () => {},
  iris: (midpoint) => midpoint(),
  flash: () => {},
  snapCamera: () => {},
};

/**
 * The companions she takes down with her.
 *
 * Three, and three different species: one would not prove they do not pile up,
 * and two of a kind would not prove the spacing works for models of different
 * heights. Granted the way the park grants them — `catchWildPet`, the roof
 * garden's own route into the parade — rather than by building `ParadeMember`s
 * here, so what rides the slide is what a child who caught three animals has.
 */
const PET_IDS = ['pet.kitten', 'pet.bunny', 'pet.mouse'] as const;

/** How long after boarding every companion must be on the chute, in seconds. */
const BOARD_SECONDS = 2;

/**
 * The furthest a companion may move in one frame, in metres, after the boarding
 * teleport.
 *
 * The chute is travelled at `GIANT_SLIDE_SPEED` (6.5 m/s), so a frame at 60 fps
 * covers 0.108 m and nothing on this ride has any business going faster. 0.35 m
 * is three times that: comfortably clear of the honest motion, and two orders
 * of magnitude under the sort of hand-off failure it is here to catch — a pet
 * left at the top and snapped down, or dropped to the ground under the chute.
 */
const MAX_STEP = 0.35;

/** How close a companion must be to her a moment after the ride, in metres. */
const REGROUP_RADIUS = 14;
/** How long it is given to get there. */
const REGROUP_SECONDS = 3;

/**
 * The least of the chase frame the nearest companion may fill and still count
 * as being in the shot.
 *
 * **Pixels, not a point.** The clause here before this one projected the
 * companion's centre and asked whether that point was inside the picture, and
 * it was the second instrument in this file to be undone by the difference
 * between *in frustum* and *in shot* — the first asked the frustum question and
 * scored 100% on a bunny that filled the lens. This one failed the other way
 * round: with the pets lying down, the nearest one sits low in the frame with
 * its middle a degree or so under the bottom edge, so the probe scored **3%**
 * on a shot the raster measures a whole animal in, at 8% of the frame. A point
 * is not an animal. Both mistakes have the same cure, which is to count what
 * the camera actually lands on.
 *
 * 1% of a 120 × 68 raster is 82 px — about a third the area a pet at the
 * back of the line makes, and far more than the handful of pixels an ear
 * clipping the border would. It is a floor on "is it in the picture at all",
 * and {@link PET_FRAME_CEILING} is the ceiling on the same measurement.
 */
const PET_FRAME_FLOOR = 0.01;

/** The fraction of chase rasters the nearest companion must be in the shot on. */
const IN_SHOT_FLOOR = 0.95;

/**
 * How often the chase shot is rastered, in chase frames.
 *
 * Every 25th rather than every 45th, since the raster is the *only* instrument
 * left on the framing question and eight samples across a whole descent is a
 * thin basis for a percentage. It is the expensive line in this file — 8160
 * rays through four object trees — so it is sampled rather than run every
 * frame, but the sampling has to be dense enough that a beat which loses the
 * pet for a second cannot fall between two of them.
 */
const RASTER_EVERY = 25;

/**
 * The raster the chase shot is measured on. Landscape, and the same shape
 * `check:slide-rider` measures the same camera with, so the two files' pixel
 * numbers are comparable.
 */
const RASTER_W = 120;
const RASTER_H = 68;

/**
 * The most of the chase frame any one companion may fill.
 *
 * **Read off the failure, not chosen in the abstract.** With the seats laid out
 * plainly the third companion rode 0.45 m in front of the lens and filled
 * essentially the whole frame with the child nowhere in it — seen on a paused
 * mid-descent screenshot, then measured here. A pet that is genuinely following
 * her, at 1.5–2.7 m, comes out at a few percent. 25% sits far above the honest
 * case and far below the wall-of-fur one, so it cannot be satisfied by
 * accident and cannot fail correct behaviour.
 */
const PET_FRAME_CEILING = 0.25;

/**
 * How far back a companion has to be lying for this to call it lying down,
 * expressed as the dot product of its own **up** axis with the chute's tangent.
 *
 * Zero is a body standing on the chute — its up axis square to the direction of
 * travel — which is what shipped, and which Jim saw as a pet inside her head.
 * Lying back on its shoulders at `RIDE_RECLINE` (−1.35 rad, 77°) puts its up
 * axis 0.976 *against* the tangent: head up-slope, feet first, exactly as she
 * goes down.
 *
 * −0.707 is a quarter turn — 45° back — which no upright pet can reach by
 * accident on any pitch of chute (the pitch turns the body *and* the tangent
 * together, so it cancels out of this product entirely), and which the honest
 * pose clears by a wide margin. It is a floor on "is it lying down at all",
 * deliberately not a re-statement of `RIDE_RECLINE`: a check that asserted the
 * exact angle would be a second copy of the pose rather than a question about
 * it, and would have to be edited every time the pose was tuned.
 */
const LYING_DOWN_DOT = -0.707;

/**
 * One drawn part, as the **oriented** box it really is: a centre, three axes
 * and three half-extents, all in world metres.
 *
 * Why oriented, and not the world-axis-aligned box `Box3.setFromObject` hands
 * out: everything on this ride is turned. A child on her back at −1.35 rad on a
 * chute pitched 30° down and yawed off the compass has no part of her square to
 * the world, and the axis-aligned box round her hair is very much bigger than
 * her hair. Measured that way she reached **3.05 m** up-slope of her own feet
 * against the 2.28 m the built model actually spans — three quarters of a metre
 * of nothing, which the spacing would then have had to be padded to clear.
 * Padding a real gap to satisfy a loose instrument is how a check ends up
 * driving the game rather than describing it.
 *
 * The kid is fourteen flat rigid parts and a pet is a dozen more — there is no
 * skinning anywhere in this pipeline, and `export_skins=False` on all three
 * Blender exporters — so every one of them really is a box, and an oriented box
 * round it is not an approximation of the silhouette. It is the silhouette.
 */
interface OrientedBox {
  readonly name: string;
  readonly centre: Vector3;
  readonly axes: readonly [Vector3, Vector3, Vector3];
  readonly half: readonly [number, number, number];
}

/** Every drawn mesh under `root`, found once. */
function drawnParts(root: Object3D): Object3D[] {
  const parts: Object3D[] = [];
  root.traverse((node: Object3D) => {
    if ((node as { isMesh?: boolean }).isMesh) parts.push(node);
  });
  return parts;
}

const SCRATCH_CENTRE = new Vector3();
const SCRATCH_SIZE = new Vector3();

/**
 * The oriented world box of one part this frame.
 *
 * `updateWorldMatrix` first, and not because it is tidy: the check drives the
 * game loop by hand and nothing renders, so nothing else in the process ever
 * flushes a world matrix. Reading one without this measures where the part was
 * last frame — 0.11 m at `GIANT_SLIDE_SPEED`, which is a quarter of the
 * clearance being asserted.
 */
function orientedBoxOf(part: Object3D): OrientedBox | null {
  const geometry = (part as { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } })
    .geometry;
  if (!geometry) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const local = geometry.boundingBox;
  if (!local || local.isEmpty()) return null;
  part.updateWorldMatrix(true, false);
  const m = part.matrixWorld.elements;
  local.getCenter(SCRATCH_CENTRE);
  local.getSize(SCRATCH_SIZE);
  const centre = SCRATCH_CENTRE.clone().applyMatrix4(part.matrixWorld);
  const x = new Vector3(m[0]!, m[1]!, m[2]!);
  const y = new Vector3(m[4]!, m[5]!, m[6]!);
  const z = new Vector3(m[8]!, m[9]!, m[10]!);
  const sx = x.length();
  const sy = y.length();
  const sz = z.length();
  if (sx < 1e-9 || sy < 1e-9 || sz < 1e-9) return null;
  return {
    name: part.name || part.type,
    centre,
    axes: [x.divideScalar(sx), y.divideScalar(sy), z.divideScalar(sz)],
    half: [(SCRATCH_SIZE.x * sx) / 2, (SCRATCH_SIZE.y * sy) / 2, (SCRATCH_SIZE.z * sz) / 2],
  };
}

/**
 * How far two oriented boxes are into each other, in metres — negative when
 * they are apart, and then it is how far apart along their worst separating
 * axis, which is a lower bound on the distance between them.
 *
 * The standard fifteen-axis separating-axis test: three faces each, and the
 * nine cross products that catch an edge-on-edge touch two boxes can make
 * without either one's face seeing it. Returning the depth rather than a
 * boolean is what lets a failure say *how far* a pet is inside her — "0.31 m
 * into her head" is a number somebody can act on, and `true` is not.
 */
function penetration(a: OrientedBox, b: OrientedBox): number {
  const between = b.centre.clone().sub(a.centre);
  let worst = Infinity;
  const test = (axis: Vector3): void => {
    const length = axis.length();
    // A degenerate cross product means those two edges are parallel, and the
    // face axes already cover that case. Skipping it is correct, not a gap.
    if (length < 1e-6) return;
    axis.divideScalar(length);
    let reach = 0;
    for (let i = 0; i < 3; i += 1) reach += a.half[i]! * Math.abs(a.axes[i]!.dot(axis));
    for (let i = 0; i < 3; i += 1) reach += b.half[i]! * Math.abs(b.axes[i]!.dot(axis));
    const overlap = reach - Math.abs(between.dot(axis));
    if (overlap < worst) worst = overlap;
  };
  // **All fifteen, every time, and not stopping at the first axis that
  // separates them.** Stopping there answers the question this file asserts —
  // are they touching — and gets the question it *reports* wrong: it hands back
  // whichever separation it happened to find first, which for two bodies half a
  // metre apart was routinely a millimetre. The check then printed "closest to
  // her 0.00 m" on a run where nothing came near her, which is a number that
  // teaches the next reader something false about a green build.
  for (let i = 0; i < 3; i += 1) test(a.axes[i]!.clone());
  for (let i = 0; i < 3; i += 1) test(b.axes[i]!.clone());
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) test(a.axes[i]!.clone().cross(b.axes[j]!));
  }
  return worst;
}

/**
 * The worst thing that happens between two bodies this frame: how deep inside
 * each other they are, and — when they are not — how close they came.
 *
 * One pass rather than two, because both answers fall out of the same fifteen
 * axes and walking a hundred and fifty part pairs twice for 675 frames is the
 * difference between a check that runs in a minute and one nobody waits for.
 */
function closest(
  a: readonly OrientedBox[],
  b: readonly OrientedBox[],
): { overlap: number; clearance: number; pair: string } {
  let overlap = 0;
  let clearance = Infinity;
  let pair = '';
  for (const boxA of a) {
    for (const boxB of b) {
      const depth = penetration(boxA, boxB);
      if (depth > 0) {
        if (depth > overlap) {
          overlap = depth;
          pair = `${boxA.name} and ${boxB.name}`;
        }
      } else if (-depth < clearance) {
        clearance = -depth;
        if (overlap === 0) pair = `${boxA.name} and ${boxB.name}`;
      }
    }
  }
  return { overlap, clearance: overlap > 0 ? 0 : clearance, pair };
}

interface Complaint {
  readonly clause: string;
  readonly detail: string;
}

interface RunResult {
  readonly ridingFrames: number;
  readonly complaints: readonly Complaint[];
  readonly framedFraction: number;
  readonly worstOffChute: number;
  readonly worstStep: number;
  readonly closestPair: number;
  /** The closest any companion's drawn geometry came to hers, in metres. */
  readonly worstClearance: number;
  /** How far inside her the worst one got — 0 on a run where nobody clipped. */
  readonly deepestOverlap: number;
  /** The closest any companion came to the body in front of it, in metres. */
  readonly worstNeighbour: number;
  /** The most upright any companion rode. See {@link LYING_DOWN_DOT}. */
  readonly worstLie: number;
  readonly worstRegroup: number;
}

/**
 * One whole descent, measured.
 *
 * `wired` is the control switch: with it false the ride is never introduced to
 * the parade, which is the game exactly as it was before #468.
 */
async function ride(wired: boolean): Promise<RunResult> {
  const scene = new Scene();
  const world = new World(scene, new Sky(), liveControls, new IsoCamera());
  const building = world.building;
  const slide = building.ginormousSlide;
  slide.group.updateMatrixWorld(true);

  const camera = new IsoCamera();
  const player = new Player(world.collision, camera, new Vector3(0, 0, 0));
  scene.add(player.group);
  building.attachPlayer(player);

  const parade = new Parade(player, world.collision, camera);
  scene.add(parade.group);
  if (wired) building.petParade = parade;

  let ridingNow = false;
  building.onRideChange = (riding) => {
    ridingNow = riding;
    player.group.visible = !riding || building.playerStaysVisible;
  };

  // The chute as **drawn**, sampled once, so "where is this on the slide" is a
  // question about the built curve rather than about the plan it came from.
  const chute: Vector3[] = [];
  {
    const probe = new Vector3();
    const steps = Math.max(400, Math.round(slide.length / 0.2));
    for (let i = 0; i <= steps; i += 1) {
      slide.pointAt(i / steps, probe);
      chute.push(slide.group.localToWorld(probe.clone()));
    }
  }
  /** Nearest chute sample to a world point: how far off, and how far along. */
  function onChute(point: Vector3): { off: number; along: number } {
    let off = Infinity;
    let along = 0;
    for (let i = 0; i < chute.length; i += 1) {
      const d = point.distanceTo(chute[i]!);
      if (d < off) {
        off = d;
        along = i / (chute.length - 1);
      }
    }
    return { off, along };
  }

  /** Is `node` `part`, or somewhere underneath it? */
  function isDescendantOf(node: unknown, part: unknown): boolean {
    let walk = node as { parent: unknown } | null;
    while (walk) {
      if (walk === part) return true;
      walk = walk.parent as typeof walk;
    }
    return false;
  }

  function drawn(object: { visible: boolean; parent: unknown } | null): boolean {
    let node = object;
    while (node) {
      if (!node.visible) return false;
      node = node.parent as typeof node;
    }
    return true;
  }

  const SHOT_W = 240;
  const SHOT_H = 135;
  building.resizeRideCameras(SHOT_W, SHOT_H);

  if (!building.requestBoardSlide(false)) {
    throw new Error('check:pet-slide — could not board the ginormous slide at all');
  }

  // **The lens is not written down anywhere any more, so there is nothing here
  // to compare it against.** There used to be: the seats were laid out around a
  // copy of `Building.ts`'s `CHASE_EYE.z`, kept honest by reading the live
  // mounted camera's offset back and failing if the two had drifted. The copy
  // went when the pets lay down and the blind band that needed it was deleted,
  // and the assertion went with it — an assertion whose subject no longer
  // exists is the "check that cannot fail" this repo keeps meeting, dressed as
  // diligence. What guards the framing now is downstream and empirical: the
  // rasters below shoot the live camera and complain about what the shot
  // actually contains, so moving the lens is answered by the picture.

  const dt = 1 / 60;
  let elapsed = 0;
  let frames = 0;
  let ridingFrames = 0;
  let afterFrames = 0;
  let rideEnded = false;

  const complaints: Complaint[] = [];
  const say = (clause: string, detail: string): void => {
    if (complaints.some((c) => c.clause === clause)) return;
    complaints.push({ clause, detail });
  };

  /**
   * **What the chase camera actually shows**, by shooting a grid of rays
   * through the live camera and counting what each one lands on — the same
   * instrument `check:slide-rider` and `check:climb-wave` measure legibility
   * with, and for the same reason: *in frustum* and *in shot* are different
   * questions, and only an area measurement can tell them apart.
   */
  function raster(
    camera: unknown,
    childRoot: unknown,
    pets: readonly { readonly displayName: string; readonly root: unknown }[],
  ): { child: number; pets: [string, number][]; total: number } {
    const caster = new Raycaster();
    const targets = [slide.group, building.gardenRoot, childRoot, parade.group];
    let child = 0;
    const counts = pets.map((pet): [string, number] => [pet.displayName, 0]);
    for (let iy = 0; iy < RASTER_H; iy += 1) {
      const ndcY = 1 - (2 * (iy + 0.5)) / RASTER_H;
      for (let ix = 0; ix < RASTER_W; ix += 1) {
        const ndcX = (2 * (ix + 0.5)) / RASTER_W - 1;
        caster.setFromCamera({ x: ndcX, y: ndcY } as never, camera as never);
        const hit = caster.intersectObjects(targets as never[], true)[0];
        if (!hit) continue;
        if (isDescendantOf(hit.object, childRoot)) {
          child += 1;
          continue;
        }
        for (let i = 0; i < pets.length; i += 1) {
          if (isDescendantOf(hit.object, pets[i]!.root)) {
            counts[i]![1] += 1;
            break;
          }
        }
      }
    }
    return { child, pets: counts, total: RASTER_W * RASTER_H };
  }

  /**
   * **Why a companion is not in the shot** — diagnosis only, never an
   * assertion, and printed only under `LGP_SHOT_DEBUG=1`.
   *
   * {@link raster} counts rays that *land on* a pet. A pet hidden behind the
   * trough wall and a pet outside the frustum both land zero, so `in shot`
   * reports the same 0% for two unrelated faults: a framing bug, which is about
   * where the lens points, and an occlusion bug, which is about the chute being
   * between the child and her own pet. Telling them apart needs a second
   * question — where is it, and what does the camera meet on the way — which is
   * what this asks.
   */
  function shotDiagnosis(
    camera: unknown,
    pet: { readonly displayName: string; readonly root: unknown },
    childRoot: unknown,
  ): string {
    const centre = new Vector3();
    new Box3().setFromObject(pet.root as never).getCenter(centre);
    const ndc = centre.clone().project(camera as never);
    const across = Math.abs(ndc.x) <= 1;
    const down = Math.abs(ndc.y) <= 1;
    const infront = ndc.z >= -1 && ndc.z <= 1;

    // **Only ask what the camera meets if the camera can see there at all.**
    // `setFromCamera` happily builds a ray for |ndc| > 1 by extrapolating past
    // the frustum, and that ray hits the pet perfectly well — so an unguarded
    // version of this prints "camera meets the pet itself" about a pet that is
    // nowhere in the picture. That is the same fault this helper exists to
    // expose, committed by the helper: one string for two different worlds.
    let meets = 'n/a — outside the frustum, so there is no ray to follow';
    if (across && down && infront) {
      const caster = new Raycaster();
      caster.setFromCamera({ x: ndc.x, y: ndc.y } as never, camera as never);
      const hit = caster.intersectObjects(
        [slide.group, building.gardenRoot, childRoot, parade.group] as never[],
        true,
      )[0];
      meets = 'nothing';
      if (hit) {
        if (isDescendantOf(hit.object, pet.root)) meets = 'the pet itself';
        else if (isDescendantOf(hit.object, childRoot)) meets = 'the child';
        else if (isDescendantOf(hit.object, slide.group)) meets = 'the SLIDE — OCCLUDED';
        else if (isDescendantOf(hit.object, building.gardenRoot)) meets = 'the garden — OCCLUDED';
        else meets = 'another companion';
      }
    }
    return (
      `${pet.displayName} ndc(${ndc.x.toFixed(2)},${ndc.y.toFixed(2)},${ndc.z.toFixed(2)}) ` +
      `${across ? '' : 'OFF-SIDE '}${down ? '' : 'OFF-TOP/BOTTOM '}${infront ? '' : 'BEHIND-LENS '}` +
      `→ camera meets ${meets}`
    );
  }

  const previous = new Map<string, Vector3>();
  let rasters = 0;
  let childHiddenSamples = 0;
  let worstChild = Infinity;
  let biggestPet = 0;
  let biggestPetName = '—';
  let worstOffChute = 0;
  let worstStep = 0;
  let closestPair = Infinity;
  let worstRegroup = 0;
  let chaseFrames = 0;
  let framedFrames = 0;
  let missingFrames = 0;
  let offChuteFrames = 0;
  let aheadFrames = 0;
  let deepestOverlap = 0;
  let worstClearance = Infinity;
  let deepestNeighbour = 0;
  let worstNeighbour = Infinity;
  let smallestNearest = Infinity;
  let touchingFrames = 0;
  let uprightFrames = 0;
  /** The most upright any companion was seen, as {@link LYING_DOWN_DOT}'s dot. */
  let worstLie = -1;

  /**
   * The chute's direction of travel at a position along it, in world metres —
   * read off the sampled curve, so the tangent a pose is judged against is the
   * one the chute was actually built with.
   */
  function chuteTangent(along: number, out: Vector3): void {
    const last = chute.length - 2;
    const i = Math.min(last, Math.max(0, Math.round(along * last)));
    out.copy(chute[i + 1]!).sub(chute[i]!).normalize();
  }

  /**
   * The parts of each body, found once. A model's *parts* do not change during
   * a descent — only where they are — and re-walking four models every frame
   * for 675 frames is the difference between a check that runs in seconds and
   * one nobody waits for.
   */
  const petParts = new Map<string, Object3D[]>();
  let childParts: Object3D[] = [];
  const up = new Vector3();
  const forward = new Vector3();
  const spin = new Quaternion();

  const MAX_FRAMES = 25 * 60;
  // Her own width is what can stick out of the trough sideways; a companion's
  // is `PARADE_MEMBER_RADIUS`. From the game, never from the generator's own
  // wider `CORRIDOR_RADIUS` — see `check:slide-rider`.
  const ON_CHUTE =
    Math.hypot(CHUTE_ENVELOPE.halfWidth, CHUTE_ENVELOPE.above) + PARADE_MEMBER_RADIUS;
  const at = new Vector3();

  while (frames < MAX_FRAMES) {
    const context = {
      dt,
      elapsed,
      input: { justPressed: () => false, isDown: () => false } as never,
      playerPosition: player.position,
      cameraForward: new Vector3(0, 0, 1),
      frame: frames,
    } as never;
    building.update(context);
    player.update(context);
    parade.update(context);
    elapsed += dt;
    frames += 1;

    if (!ridingNow) {
      if (ridingFrames === 0) continue;
      rideEnded = true;
      afterFrames += 1;
      if (afterFrames < REGROUP_SECONDS * 60) continue;
      break;
    }
    ridingFrames += 1;
    // Her own drawn parts, found on the first ridden frame — her model is built
    // by then and does not change shape for the rest of the descent.
    if (childParts.length === 0) childParts = drawnParts(player.model.root as never);

    // The bodies the game would draw, in line order, asked of the system that
    // owns them.
    const bodies = PET_IDS.map((_, slot) => parade.companionAt(slot)).filter(
      (member): member is NonNullable<typeof member> => member !== null,
    );
    if (bodies.length !== PET_IDS.length) {
      say(
        'line',
        `only ${bodies.length} of ${PET_IDS.length} companions were in the line on ridden ` +
          `frame ${ridingFrames} — one of them left it during the descent`,
      );
    }

    const rider = onChute(player.position);
    let lastAlong = rider.along;
    /** Past the boarding stretch — see {@link BOARD_SECONDS}. */
    const settledRide = ridingFrames > BOARD_SECONDS * 60;

    // Every body's real shape this frame, taken once. Hers first, then the line
    // in order, so the clauses below can ask about any pair of them without
    // re-deriving a hundred and fifty boxes per question.
    const herBoxes = childParts
      .map(orientedBoxOf)
      .filter((box): box is OrientedBox => box !== null);
    let boxesInFront = herBoxes;
    let nameInFront = 'the child';

    for (let slot = 0; slot < bodies.length; slot += 1) {
      const member = bodies[slot]!;
      member.root.getWorldPosition(at);

      if (!drawn(member.root as never)) {
        missingFrames += 1;
        say(
          'drawn',
          `${member.displayName} was not drawn on ridden frame ${ridingFrames} of the ` +
            'descent — a pet that vanishes mid-ride is worse than one that never left',
        );
      }

      const where = onChute(at);
      // Behind the lip for the first stride or two — deliberately, so eight
      // animals do not stand in one another at the entry. After that it must be
      // in the trough and stay there.
      if (settledRide) {
        if (where.off > worstOffChute) worstOffChute = where.off;
        if (where.off > ON_CHUTE) {
          offChuteFrames += 1;
          say(
            'on the chute',
            `${member.displayName} was ${where.off.toFixed(2)} m off the chute on ridden frame ` +
              `${ridingFrames} (trough allows ${ON_CHUTE.toFixed(2)} m) — it is beside the ` +
              'slide, or on the ground under it, not on it',
          );
        }
      }

      // **Behind her, and behind the one in front.** Measured as a position on
      // the built curve, so it holds through every bend rather than only where
      // the chute happens to run straight.
      if (where.along > lastAlong + 1e-6) {
        aheadFrames += 1;
        say(
          'behind her',
          `${member.displayName} was ${(where.along * slide.length).toFixed(1)} m down the ` +
            `chute against ${(lastAlong * slide.length).toFixed(1)} m for the one in front of ` +
            `it, on ridden frame ${ridingFrames} — it has overtaken`,
        );
      }
      lastAlong = where.along;

      // **No two on the same spot.**
      if (slot > 0) {
        const ahead = bodies[slot - 1]!.root.getWorldPosition(new Vector3());
        const gap = ahead.distanceTo(at);
        if (gap < closestPair) closestPair = gap;
      }

      // **Not inside her.** The whole of Jim's complaint, measured on the drawn
      // meshes of the real child against the drawn meshes of the real pet — not
      // on the gap between two points on a curve, which is what every clause
      // above measures and which is exactly why none of them saw it.
      let mine = petParts.get(member.uid);
      if (!mine) {
        mine = drawnParts(member.root as never);
        petParts.set(member.uid, mine);
      }
      const its = mine.map(orientedBoxOf).filter((box): box is OrientedBox => box !== null);
      const hers = closest(herBoxes, its);
      if (hers.overlap > deepestOverlap) deepestOverlap = hers.overlap;
      if (hers.clearance < worstClearance) worstClearance = hers.clearance;
      if (hers.overlap > 0) {
        touchingFrames += 1;
        say(
          'not inside her',
          `${member.displayName} was ${(hers.overlap * 100).toFixed(0)} cm inside the child on ` +
            `ridden frame ${ridingFrames} — ${hers.pair} occupy the same space, which is a pet ` +
            'clipping through her, not a pet following her down the slide',
        );
      }

      // **And not inside the one in front of it**, which is the same question
      // one place further down the line and the reason Jim asked for *several*
      // pets rather than one: whatever keeps a companion out of her has to keep
      // it out of its neighbour too, or three of them fixes one clip and
      // introduces two. Measured against the body actually in front — hers for
      // the first, the previous animal for the rest — rather than against a
      // rule about spacing.
      if (slot > 0) {
        const neighbour = closest(boxesInFront, its);
        if (neighbour.overlap > deepestNeighbour) deepestNeighbour = neighbour.overlap;
        if (neighbour.clearance < worstNeighbour) worstNeighbour = neighbour.clearance;
        if (neighbour.overlap > 0) {
          say(
            'not inside each other',
            `${member.displayName} was ${(neighbour.overlap * 100).toFixed(0)} cm inside ` +
              `${nameInFront} on ridden frame ${ridingFrames} — ${neighbour.pair} occupy the ` +
              'same space, so the line has piled up on itself',
          );
        }
      }
      boxesInFront = its;
      nameInFront = member.displayName;

      // **Lying down, as she is.** Asked of the world quaternion the renderer
      // would use, so it covers the composition order as well as the angle.
      member.root.getWorldQuaternion(spin as never);
      up.set(0, 1, 0).applyQuaternion(spin as never);
      chuteTangent(where.along, forward);
      const lie = up.dot(forward);
      if (lie > worstLie) worstLie = lie;
      if (lie > LYING_DOWN_DOT) {
        uprightFrames += 1;
        say(
          'lying down',
          `${member.displayName} rode ridden frame ${ridingFrames} with its up axis at ` +
            `${lie.toFixed(3)} against the chute's own direction, where lying back on its ` +
            `shoulders is ${LYING_DOWN_DOT} or less (and the child's own recline is −0.976) — ` +
            'it is standing on the chute, not lying on it',
        );
      }

      const was = previous.get(member.uid);
      // The first ridden frame is the boarding teleport — the whole park
      // changes space behind a closed iris there, exactly as it does for the
      // child, so a step is expected and is not a stutter anybody sees.
      if (was && ridingFrames > 1) {
        const step = was.distanceTo(at);
        if (step > worstStep) worstStep = step;
        if (step > MAX_STEP) {
          say(
            'no jump',
            `${member.displayName} moved ${step.toFixed(2)} m in one frame on ridden frame ` +
              `${ridingFrames}, against ${MAX_STEP} m allowed — that is a jump, not a slide`,
          );
        }
      }
      previous.set(member.uid, at.clone());
    }

    // **Is the nearest companion actually in the picture?** Through the live
    // ride camera — the real object the game renders with, from
    // `Building.rideCameraNow` — not a reconstruction of it.
    const liveShot = building.slideShots.liveShot;
    const liveCamera = building.rideCameraNow;
    const first = bodies[0];
    if (liveShot?.kind === 'chase' && liveCamera && first) {
      chaseFrames += 1;

      // **What does the shot actually contain?** Rays through the live camera,
      // counting what each one lands on — the only honest form of this
      // question, and this file has now got it wrong in both directions with
      // cheaper ones. See {@link PET_FRAME_FLOOR}.
      // Not while they are still boarding. The line runs on backwards behind
      // the lip so eight animals do not stand inside one another at the entry
      // (see `slide/petRiders.ts`), which means for the first stride or two the
      // nearest one is genuinely still up inside the castle and genuinely not
      // in the shot. That is the same grace the on-chute clause takes, taken
      // for the same reason — and taking it here is what lets the floor below
      // be 95% of what is left rather than a number chosen to accommodate the
      // one raster that could never have passed.
      if (settledRide && chaseFrames % RASTER_EVERY === 1) {
        scene.updateMatrixWorld(true);
        (liveCamera as { updateMatrixWorld(force: boolean): void }).updateMatrixWorld(true);
        const shot = raster(liveCamera, player.model.root, bodies);
        rasters += 1;
        const nearestShare = (shot.pets[0]?.[1] ?? 0) / shot.total;
        // **Why is it not in the shot?** `LGP_SHOT_DEBUG=1` only. The raster
        // counts a pet hidden behind the trough wall and a pet outside the
        // frustum identically, at 0 px, and those are different bugs with
        // different fixes — see `shotDiagnosis`.
        if (process.env['LGP_SHOT_DEBUG'] === '1') {
          const nearest = bodies[0];
          process.stderr.write(
            `    raster ${rasters} ridden frame ${ridingFrames}: nearest ` +
              `${(nearestShare * 100).toFixed(1)}% — ` +
              (nearest ? shotDiagnosis(liveCamera, nearest, player.model.root) : 'no companion') +
              '\n',
          );
        }
        if (nearestShare >= PET_FRAME_FLOOR) framedFrames += 1;
        if (nearestShare < smallestNearest) smallestNearest = nearestShare;
        if (shot.child === 0) {
          childHiddenSamples += 1;
          say(
            'the child is in her own shot',
            `on ridden frame ${ridingFrames} the chase camera shows 0 px of the child — her ` +
              'companions are between her and the lens and have covered her up entirely',
          );
        }
        if (shot.child < worstChild) worstChild = shot.child;
        for (const [name, pixels] of shot.pets) {
          const share = pixels / shot.total;
          if (share > biggestPet) {
            biggestPet = share;
            biggestPetName = name;
          }
          if (share > PET_FRAME_CEILING) {
            say(
              'nothing in the lens',
              `${name} fills ${(share * 100).toFixed(0)}% of the chase frame on ridden frame ` +
                `${ridingFrames}, against ${(PET_FRAME_CEILING * 100).toFixed(0)}% allowed — it ` +
                'is not following her down the slide, it is pressed against the camera',
            );
          }
        }
      }
    }
  }

  // **And back to her at the bottom**, with nobody still riding.
  const settled = PET_IDS.map((_, slot) => parade.companionAt(slot)).filter(
    (member): member is NonNullable<typeof member> => member !== null,
  );
  for (const member of settled) {
    if (member.onSlide) {
      say('off at the bottom', `${member.displayName} was still on the chute after the ride`);
    }
    member.root.getWorldPosition(at);
    const gap = at.distanceTo(player.position);
    if (gap > worstRegroup) worstRegroup = gap;
    if (gap > REGROUP_RADIUS) {
      say(
        'regroup',
        `${member.displayName} was ${gap.toFixed(1)} m from her ${REGROUP_SECONDS} s after the ` +
          `ride, against ${REGROUP_RADIUS} m — it did not come back to her`,
      );
    }
  }

  if (!rideEnded) say('coverage', 'the ride never finished, so nothing after it was measured');
  if (ridingFrames < 60) {
    say('coverage', `the ride only ran for ${ridingFrames} frames — nothing was exercised`);
  }
  const framedFraction = rasters > 0 ? framedFrames / rasters : 0;
  if (rasters === 0) {
    say('in shot', 'the chase camera was never rastered, so framing was never tested');
  } else if (framedFraction < IN_SHOT_FLOOR) {
    say(
      'in shot',
      `the nearest companion filled at least ${(PET_FRAME_FLOOR * 100).toFixed(0)}% of the chase ` +
        `frame on only ${(framedFraction * 100).toFixed(0)}% of ${rasters} rasters, against ` +
        `${(IN_SHOT_FLOOR * 100).toFixed(0)}% required (its smallest was ` +
        `${(smallestNearest * 100).toFixed(1)}%) — it is behind her, but not in the shot`,
    );
  }

  parade.dispose();

  console.log(
    `  ${wired ? 'wired  ' : 'control'}: ${ridingFrames} ridden frames, ` +
      `worst ${worstOffChute.toFixed(2)} m off the chute, ` +
      `closest pair ${closestPair === Infinity ? 'n/a' : `${closestPair.toFixed(2)} m`}, ` +
      `closest to her ${worstClearance === Infinity ? 'n/a' : `${worstClearance.toFixed(2)} m`} ` +
      `(deepest inside her ${deepestOverlap.toFixed(2)} m), ` +
      `closest to its neighbour ` +
      `${worstNeighbour === Infinity ? 'n/a' : `${worstNeighbour.toFixed(2)} m`} ` +
      `(deepest inside it ${deepestNeighbour.toFixed(2)} m), ` +
      `most upright lie ${worstLie.toFixed(3)} against ${LYING_DOWN_DOT}, ` +
      `biggest single-frame step ${worstStep.toFixed(3)} m, ` +
      `nearest pet in shot on ${(framedFraction * 100).toFixed(0)}% of rasters ` +
      `(smallest ${smallestNearest === Infinity ? 'n/a' : `${(smallestNearest * 100).toFixed(1)}%`}), ` +
      `${chaseFrames} chase frames, ` +
      `${rasters} chase rasters (child at worst ${worstChild === Infinity ? 'n/a' : `${worstChild} px`}, ` +
      `biggest pet ${(biggestPet * 100).toFixed(0)}% of frame — ${biggestPetName}), ` +
      `furthest from her afterwards ${worstRegroup.toFixed(1)} m ` +
      `(${missingFrames} undrawn, ${offChuteFrames} off-chute, ${aheadFrames} overtaking, ` +
      `${touchingFrames} clipping, ${uprightFrames} upright pet-frames)`,
  );

  return {
    ridingFrames,
    complaints,
    framedFraction,
    worstOffChute,
    worstStep,
    closestPair,
    worstClearance,
    deepestOverlap,
    worstNeighbour,
    worstLie,
    worstRegroup,
  };
}

// Granted once, before either run: the store is the game's, there is one of it,
// and both descents must be taken by the same three animals or the control is
// not a control.
for (const id of PET_IDS) {
  const spec = shopItem(id);
  if (!spec) throw new Error(`check:pet-slide — no catalogue entry for ${id}`);
  gameStore.catchWildPet(spec);
}

console.log('  riding the ginormous slide with three companions:');
const wired = await ride(true);
console.log('  and again with the ride never told about the parade — the control:');
const control = await ride(false);

const failures: string[] = [];
for (const complaint of wired.complaints) failures.push(`${complaint.clause}: ${complaint.detail}`);

// **The control must fail.** If riding with the parade unwired passes every
// clause above, then every clause above is satisfied by a pet standing in the
// long grass and this file proves nothing. Which clauses go red is not pinned —
// that would be a second description of the old behaviour — only that some do.
if (control.complaints.length === 0) {
  failures.push(
    'the control passed: a descent where the ride was never told about the parade at all ' +
      'satisfied every clause above, so the clauses are not measuring whether the pets ride ' +
      'the slide. Nothing green in this file can be believed until this goes red again',
  );
}

if (failures.length > 0) {
  console.error('check:pet-slide FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `check:pet-slide ok — three companions rode all ${wired.ridingFrames} frames of the descent ` +
    `behind her and in order, never more than ${wired.worstOffChute.toFixed(2)} m off the chute, ` +
    `lying down throughout (most upright ${wired.worstLie.toFixed(3)}, against ` +
    `${LYING_DOWN_DOT} required), never closer to her own body than ` +
    `${wired.worstClearance.toFixed(2)} m, ` +
    `never closer to the one in front of it than ${wired.worstNeighbour.toFixed(2)} m, never ` +
    `moving more than ` +
    `${wired.worstStep.toFixed(3)} m in a frame, in the chase camera's shot on ` +
    `${(wired.framedFraction * 100).toFixed(0)}% of its rasters, and back within ` +
    `${wired.worstRegroup.toFixed(1)} m of her ${REGROUP_SECONDS} s later.\n` +
    `  The control (ride not wired to the parade) failed ` +
    `${control.complaints.length} of the same clauses — ` +
    `${control.complaints.map((c) => c.clause).join(', ')} — so they measure the ride and not ` +
    'the park.',
);
