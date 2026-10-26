import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { IsoCamera } from '../../core/IsoCamera';
import type { CollisionWorld } from '../Collision';
import { ExhibitCamera, asWhole, type ExhibitShot, type ShotInput, type ShotRoom, type ShotRules, type SolveReport } from '../reptileHouse/exhibitCamera';
import type { CharacterModel } from '../../entities/CharacterModel';
import { applyListeningPose } from '../../entities/ridePose';
import { KID_HEIGHT } from '../../art/models/kidHeight';
import { LIBRARY_FLOOR_Y, LIBRARY_FURNITURE, LIBRARY_INNER_X, LIBRARY_INNER_Z, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z, LIBRARY_STORY_CHAIR, LIBRARY_STORY_RUG, LIBRARY_WALL_HEIGHT } from './layout';
import { OWL_BUBBLE_OVER_HEAD, owlPerch, type LibraryOwl } from './LibraryOwl';
import type { StoryPhase } from './storyTime';

/**
 * **Story time, seen from her cushion** — Jim, 24 October 2026: *"during story
 * time, I'd like the camera to enter a sequence where it comes down to
 * player-level and goes to over the shoulder camera, with the other children
 * listening and the reader visible."* And on the first preview, 26 October:
 * *"the camera needs to transition as soon as you sit."*
 *
 * **The moment she sits on one of her two story cushions**, the camera comes
 * down from the park's high rig to a shot just behind her and over her
 * shoulder, framing the story's stage: the big chair, the rug and the
 * children's cushions. It holds through the owl's flight to the chair, the
 * children walking in and sitting down, and the whole reading — her page in
 * her bubble over her — and goes home when the story she sat through ends,
 * or at once when she gets up (the "Get up" chip, a jump, a tap anywhere) or
 * leaves the room. Sitting with no story running brings it down all the same,
 * on the same stage, and it holds until she gets up; a story that begins
 * while she sits finds it already there. A story beginning while she still
 * sits after the last one's shot went home brings it down again.
 *
 * It also answers the cushion-1 view (`HANDOFF-library-v2.md`): from the rig,
 * the child on cushion 4 sits square between cushion 1 and the chair, and a
 * laptop saw the owl's glasses over her head and little else.
 *
 * ## The stage as it will be
 *
 * When she sits, nobody is in place yet: the owl is at her desk, the children
 * are in the aisles. The shot is solved for the reading all the same — against
 * **stand-ins** ({@link storyStage}): each child's own model and the owl's,
 * copied as they are and set down where story time puts them (a child on her
 * cushion, facing the chair, as `NpcCharacter.beginSeated` sits her — her
 * soles on the floor and her head where it is standing, the listening pose
 * hangs her legs from the cushion; the owl on her perch, as she lands). The
 * stand-ins are never drawn; the solve reads them once and lets them go. So
 * the eye and the framing are the reading's, from the first frame of the sit.
 *
 * ## No new camera
 *
 * The shot is the Reptile House's exhibit camera (`reptileHouse/exhibitCamera.ts`,
 * #711) — the one over-the-shoulder shot in the game, director and solver both:
 * a fan of candidate eyes behind her, each raycast against everything drawn in
 * the room and her own body; the move a smooth curve down over the room's open
 * top, and home the same way; `ExhibitCamera.apply` the single place it writes
 * the camera. This file decides only *when*, *of what*, and where the aim goes:
 * the room ({@link LIBRARY_SHOT_ROOM}), the subjects (the owl and her head; each
 * child and her head), and what story time asks of the solver beyond an exhibit
 * (`ShotRules`): **the subjects hide one another** — a child's head between the
 * eye and the owl is what this shot is solved to see past; **each is seen as a
 * whole**, through a spread of its own drawn points, not only its middle (see
 * {@link STORY_OWL_SEEN} for how much of each); **the frame holds them all**,
 * and the owl's bubble's anchor (a bubble is drawn only while its anchor is in
 * shot, #415), on whatever screen is there; the fan of eyes stands **round her,
 * from her back** — she faces the storyteller's chair, and the audience's
 * middle is off to one side of it; and **the aim** ({@link STORY_AIM_FOLLOW_HALF_LIFE}).
 *
 * ## It never takes the controls
 *
 * Seated, the stick does not move her, so it does not take the camera back
 * either ({@link SEATED}): she gets up by the chip, a jump or a tap, exactly as
 * before, and getting up is what hands the camera back — on the exhibit
 * camera's cancel ease, the short one, because a child who has stood up is
 * about to walk, and "up the stick" is the rig's up-screen, not this shot's.
 * The shot never selects or blocks anything: the "Get up" chip is chosen by
 * where she is, not where the camera is, and while she sits it is laid out at
 * the bottom middle of the screen (`ActionChips.place`, riding), so it is in
 * shot from any camera.
 *
 * ## Wiring
 *
 * Like `bookGlance.ts`: `Game.tick` calls {@link apply} in its camera block,
 * after the player and before the camera, and folds the claim into its one
 * `focusClaim`; `check:library` and `check:labels` copy those lines (`Game`
 * cannot be built in Node), so taking it out of `Game` alone would not turn
 * them red — the served look in a real browser is what sees `Game`'s own copy.
 * Kept outside the park closure (`scripts/lib/park-source-hash.mjs`): only
 * `Game` and the checks import it, so a camera move cannot change a park.
 */

/** The reading room, as the exhibit camera's solver takes a room: its walls, its floor, its open top. */
export const LIBRARY_SHOT_ROOM: ShotRoom = {
  originX: LIBRARY_ORIGIN_X,
  originZ: LIBRARY_ORIGIN_Z,
  innerX: LIBRARY_INNER_X,
  innerZ: LIBRARY_INNER_Z,
  floorY: LIBRARY_FLOOR_Y,
  wallHeight: LIBRARY_WALL_HEIGHT,
};

/**
 * How far in from the screen's edges the whole audience and the owl's bubble's
 * anchor are held — a share of the half-frame: room round them for the bubble
 * itself, which is laid out over its anchor (two lines of the TEXT RULE's
 * size are about a sixth of a half-frame on a phone held upright or a
 * laptop), and for the HUD in the corners. The shot is framed exactly that
 * tight (`ShotRules.contain`).
 */
export const STORY_FRAME_MARGIN = 0.2;

/** The director's name for the shot — what its memory of a good eye is filed under. */
export const STORY_SHOT_ID = 'story-time';

/**
 * How many of the owl's, her head's and each listener's head's own drawn
 * points, spread over them, the shot is solved to see as well as their middles
 * (`ShotRules.spread`): enough that a head half a child's height cannot hide a
 * part of anyone between two of them.
 */
export const STORY_SPREAD = 16;

/**
 * **What the shot must see, and how much of it** — the reader and her
 * listeners, from a cushion in the audience. Measured on the built room
 * (24 Oct 2026): the children's heads are half their height and a metre and a
 * half across with their hair, and cushions 4 and 5 sit square in front of the
 * storyteller's chair, so from behind the audience at a child's height some of
 * the owl is always behind a listener's head — from cushion 1, the best eye
 * over her shoulder sees 57% of the owl at 3 m up, 77% at 3.5 m, 88% at 4 m and
 * 92% at 4.5 m; seeing all of everyone takes an eye 6 m up, looking down on
 * the rug. So the shot holds what makes it story time:
 *
 * - **the owl's head — her face, her glasses — all of it** (`asWhole`, share 1);
 * - **most of the owl**: {@link STORY_OWL_SEEN} of her;
 * - **most of every listener's head**: {@link STORY_HEAD_SEEN} of each, and
 *   {@link STORY_LISTENER_SEEN} of every listener;
 *
 * and nothing but a listener can cover any of them — no bookcase, no lamp,
 * never her own head (the solver's sightlines run against everything drawn in
 * the room and her body; `check:library`'s STORY CAMERA measures the real eye
 * on every drawn point).
 */
export const STORY_OWL_SEEN = 0.75;
export const STORY_HEAD_SEEN = 0.85;
/** And of every listener as a whole, at least this share — the rest behind another listener, and only another listener. */
export const STORY_LISTENER_SEEN = 0.5;

/**
 * **The story shot we would draw by hand** — what the exhibit camera's fan is
 * tried from first (`ShotRules.ideal`; it decides nothing about what the shot
 * must see): an eye a little over the listeners' heads (twice a child's
 * height), close behind her and well off her shoulder, where her own head is
 * beside the audience in the picture rather than in front of it. The lowest
 * eye that passes everything is a step above it: measured from both cushions
 * on both screens (25 Oct 2026), 5.3 m up, 1.6 m behind her — anything lower
 * and her own shoulder brushes the outline of a listener as he sways (the
 * hand's-breadth edge, `ShotRules.spread`), or the owl drops below three
 * quarters seen.
 */
export const STORY_IDEAL = { height: 2 * KID_HEIGHT, back: 1.6, swing: 50 } as const;

/**
 * **The camera breathes with the group** — a deliberate effect, Jim's on 26
 * October 2026: *"I like this effect … I would like this added
 * intentionally."* Once the owl reads and every child is sitting, the eye
 * stays exactly where it was proven clear and the aim eases after the middle
 * of the owl and the three listeners, by half every this many seconds — so as
 * they sway (a listener's head and hands on 4.8 s and 5.7 s cycles, each child
 * on her own phase, `ridePose.ts`'s listening pose; the owl's breath on 3.7 s,
 * `LibraryOwl`), the picture drifts gently with them, a slow sway of about
 * 4–5 s, a fraction of a degree, and the lens breathes with the eye-to-aim
 * distance (`IsoCamera`'s lens follows it). Measured on the first preview,
 * before it was named (26 Oct): ±0.11–0.17° of aim, fixed scenery 0.7–2.8 px
 * from its middle, never more than 0.4 px a frame. Until the reading (the owl
 * on the wing, the children walking in), the aim holds still: following
 * them then would pan across the room. `check:library`'s STORY CAMERA holds
 * the sway between a floor and a ceiling, measured on the screen.
 */
export const STORY_AIM_FOLLOW_HALF_LIFE = 0.35;

/**
 * **What the audience sits on, which hides nobody**: the owl's story chair,
 * the rug, and the children's cushions — each holds the one sitting there (the
 * owl sits back in her chair, a child's soles are on the rug), so none of
 * them counts as in the way of anyone (`ExhibitCamera.start`'s `cast`).
 * Her own cushion is not one of them.
 */
export function storySeats(library: Pick<StoryCameraLibrary, 'furniture' | 'children'>): Object3D[] {
  const rug = LIBRARY_FURNITURE.find((piece) => piece.kind === 'rug' && piece.at === LIBRARY_STORY_RUG);
  const ids = [LIBRARY_STORY_CHAIR.id, ...(rug ? [rug.id] : []), ...library.children.map((child) => child.plan.seat)];
  return ids.flatMap((id) => {
    const piece = library.furniture(id);
    return piece ? [piece] : [];
  });
}

/** The reading's stage, stood in for: the owl on her perch and each child on her cushion, never drawn ({@link storyStage}). */
export interface StoryStage {
  readonly owl: Object3D;
  readonly owlHead: Object3D;
  readonly children: readonly { readonly root: Object3D; readonly head: Object3D }[];
  /** Where the owl's bubble will hang over her, on her perch. */
  readonly bubble: Vector3;
}

const UP = new Vector3(0, 1, 0); // flat-ok: the reading room is its own flat space at (-600, -600), off the sphere

/**
 * `live`, copied as it is this frame (sharing its geometry and materials, never
 * added to the scene) and set down at `at` in its parent's frame, turned to
 * `yaw` about the room's up — the way `NpcCharacter` and `LibraryOwl` place
 * the real one there.
 */
function standIn(live: Object3D, at: Vector3, yaw: number): Object3D {
  live.updateWorldMatrix(true, true);
  const stand = live.clone(true);
  const local = new Matrix4().compose(at, new Quaternion().setFromAxisAngle(UP, yaw), live.scale);
  const world = live.parent ? new Matrix4().multiplyMatrices(live.parent.matrixWorld, local) : local;
  world.decompose(stand.position, stand.quaternion, stand.scale);
  stand.updateMatrixWorld(true);
  return stand;
}

/** The copy in `stand` of `node` in `live` — the same place in a tree `clone` built. */
function twin(live: Object3D, stand: Object3D, node: Object3D): Object3D {
  const from: Object3D[] = [];
  live.traverse((object) => from.push(object));
  const to: Object3D[] = [];
  stand.traverse((object) => to.push(object));
  return to[from.indexOf(node)] ?? stand;
}

/**
 * **The stage as it will be when the owl reads** — built the moment she sits,
 * when nobody is there yet: each body her own model, copied as it is this
 * frame and then posed as she will be, so the stage is the same whatever
 * anyone happened to be doing when she sat.
 *
 * - The owl as `LibraryOwl` lands her on the story chair (`owlPerch`, in the
 *   room's frame) and as she reads there: her head straight ahead, her wings
 *   down, at the middle of a breath — her own neutral pose; her bubble's
 *   anchor over her head there, as `LibraryOwl` hangs it wherever she is.
 * - Each child as story time seats her (`NpcCharacter.beginSeated`: her
 *   cushion's middle in world metres, her soles on the floor, facing the
 *   chair) in the listening pose (`applyListeningPose`, at the middle of its
 *   sway; her root left as placed, never righted through an Euler — the
 *   reason `NpcCharacter` writes a sitter's facing again after her pose).
 */
export function storyStage(library: Pick<StoryCameraLibrary, 'owl' | 'children'>): StoryStage {
  const handle = library.owl.handle;
  const owlLive = handle.root;
  const perch = owlPerch();
  const owl = standIn(owlLive, new Vector3(perch.x, perch.y, perch.z), (perch.facing * Math.PI) / 180);
  const inOwl = (node: Object3D): Object3D => twin(owlLive, owl, node);
  inOwl(handle.head).rotation.y = 0;
  inOwl(handle.wingL).rotation.set(0, 0, 0);
  inOwl(handle.wingR).rotation.set(0, 0, 0);
  inOwl(handle.body).scale.set(1, 1, 1);
  owl.updateMatrixWorld(true);
  // Her bubble's tail over the top of her head, wherever she is (`LibraryOwl.anchorBubble`): over the perch.
  const bubble = new Vector3(perch.x, perch.y + handle.height + OWL_BUBBLE_OVER_HEAD, perch.z);
  if (owlLive.parent) bubble.applyMatrix4(owlLive.parent.matrixWorld);
  const children = library.children.map((child) => {
    const model = child.model;
    const live = model.root;
    const root = standIn(live, new Vector3(child.driver.seat.x, LIBRARY_FLOOR_Y, child.driver.seat.z), child.driver.seatFacing);
    const inChild = (node: Object3D): Object3D => twin(live, root, node);
    applyListeningPose(
      {
        root: { rotation: { x: 0 } },
        body: inChild(model.body),
        head: inChild(model.head),
        leftArm: inChild(model.leftArm),
        rightArm: inChild(model.rightArm),
        leftLeg: inChild(model.leftLeg),
        rightLeg: inChild(model.rightLeg),
      },
      0,
    );
    root.updateMatrixWorld(true);
    return { root, head: inChild(model.head) };
  });
  return { owl, owlHead: inOwl(handle.head), children, bubble };
}

/**
 * **What the seated child does to the camera: nothing.** The exhibit camera
 * goes home when she pushes the stick or jumps; sitting, the stick does not
 * move her, and a jump is read by the Library and stands her up — which is
 * what ends this shot (see the module doc).
 */
const SEATED: ShotInput = { manualMoveActive: false, justPressed: () => false };

/** What story time's camera reads of the Library — `Library` is this shape. */
export interface StoryCameraLibrary {
  readonly roomRoot: Object3D;
  readonly playerIsInside: boolean;
  readonly playerIsSeated: boolean;
  readonly storyPhase: StoryPhase;
  readonly owl: Pick<LibraryOwl, 'perched' | 'handle' | 'bubble'>;
  readonly children: readonly {
    readonly model: CharacterModel;
    readonly plan: { readonly seat: string };
    readonly body: { readonly seated: boolean; readonly hopping: boolean };
    readonly driver: { readonly seat: { readonly x: number; readonly z: number }; readonly seatFacing: number };
  }[];
  furniture(id: string): Object3D | undefined;
}

/** What it reads of her — `Player` is this shape. */
export interface StoryCameraPlayer {
  readonly position: Vector3;
  readonly facing: number;
  readonly group: Object3D;
  /** Her height, hat and all (`Player.topHeight`). */
  readonly topHeight: number;
}

export class StoryCamera {
  private readonly library: StoryCameraLibrary;
  /** The director: the exhibit camera's, in the reading room. */
  private readonly director: ExhibitCamera;
  /** She was on her cushion last frame. */
  private seated = false;
  /** A story was under way last frame (the call, the gathering or the reading). */
  private story = false;
  /** The story she sat through has ended since the shot began: it goes home, she still sitting. */
  private storyEnded = false;
  /** The live owl and children, whose middle the aim follows once the owl reads ({@link STORY_AIM_FOLLOW_HALF_LIFE}). */
  private live: Object3D[] = [];
  /** The stage the shot was last solved against — for the checks. */
  private lastStage: StoryStage | null = null;
  /**
   * Her, as the director asks for her. **`riding: false`** while she sits: a
   * story cushion is a seat, not a ride (`Library`'s cushion holder: `'not a
   * ride'`) — nothing else owns the camera while she listens. The director's
   * `riding` is a ride that does (the tortoise).
   */
  private readonly her: { position: Vector3; facing: number; riding: boolean; group: Object3D; topHeight: number };

  constructor(library: StoryCameraLibrary, collision: CollisionWorld, camera: IsoCamera, player: StoryCameraPlayer) {
    this.library = library;
    this.director = new ExhibitCamera({ hall: library.roomRoot, collision, camera, seeThrough: [], room: LIBRARY_SHOT_ROOM });
    this.her = { position: player.position, facing: player.facing, riding: false, group: player.group, topHeight: player.topHeight };
  }

  /** The camera is the shot's this frame, from the moment it is wanted until it is home. */
  get active(): boolean {
    return this.director.active;
  }

  /** Where the shot is in its life: `'idle'`, `'in'`, `'hold'` or `'out'` — for the checks. */
  get state(): ExhibitCamera['state'] {
    return this.director.state;
  }

  /** The shot as solved, the last time one was — for the checks. */
  get shot(): ExhibitShot | null {
    return this.director.shot;
  }

  /** Why the last solve turned its candidate eyes down — for the checks. */
  get report(): SolveReport | null {
    return this.director.report;
  }

  /** How many times no clear shot could be found — for the checks (the camera then stays where it is). */
  get unsolved(): number {
    return this.director.unsolved.length;
  }

  /** The stand-ins the shot was last solved against ({@link storyStage}) — for the checks. */
  get stage(): StoryStage | null {
    return this.lastStage;
  }

  /** The aim is following the group this frame (the breathing, {@link STORY_AIM_FOLLOW_HALF_LIFE}) — for the checks. */
  get breathing(): boolean {
    return this.director.active && this.followed() !== null;
  }

  /**
   * **One frame**: decides whether the shot is wanted, steps the director by
   * `dt`, and writes this frame's camera through it — returning the focus it
   * claims, or `null`. `Game.tick` folds the claim into its one `focusClaim`
   * (a check sets or clears the camera's focus override with it, as `Game`
   * does); on the frame the shot is home, the director gives the zoom back and
   * lets go of the pose, exactly once.
   */
  apply(camera: IsoCamera, player: StoryCameraPlayer, dt: number): Readonly<Vector3> | null {
    const library = this.library;
    const inside = library.playerIsInside;
    const seated = inside && library.playerIsSeated;
    const story = library.storyPhase === 'gathering' || library.storyPhase === 'reading';
    const her = this.her;
    her.position = player.position;
    her.facing = player.facing;
    her.group = player.group;
    her.topHeight = player.topHeight;
    // Down the moment she sits — and again when a story begins while she still sits after the last one's shot went home.
    if (seated && (!this.seated || (story && !this.story && !this.director.active && !this.director.solving))) this.start();
    // Up off her cushion — the chip, a jump, a tap — or out of the room: home at once.
    if (this.seated && !seated) this.director.cancel();
    // The story she sat through is over: the director eases home on its own, she still sitting.
    if (this.story && !story) this.storyEnded = true;
    this.seated = seated;
    this.story = story;
    this.director.update(dt, SEATED, her, inside, seated && !this.storyEnded ? Infinity : 0);
    return this.director.apply(camera);
  }

  /**
   * The bodies the aim follows this frame ({@link STORY_AIM_FOLLOW_HALF_LIFE}):
   * the owl and the three children once she reads from her perch and every
   * child is on her cushion; until then, nobody — the aim holds still.
   */
  private followed(): readonly Object3D[] | null {
    const library = this.library;
    if (library.storyPhase !== 'reading' || !library.owl.perched) return null;
    if (!library.children.every((child) => child.body.seated && !child.body.hopping)) return null;
    return this.live;
  }

  /** The shot of the stage from where she sits — solved over the next few frames against its stand-ins. */
  private start(): void {
    const { owl, children } = this.library;
    this.storyEnded = false;
    const stage = storyStage(this.library);
    this.lastStage = stage;
    const subjects: Object3D[] = [...asWhole([stage.owl], STORY_OWL_SEEN), ...asWhole([stage.owlHead], 1)];
    for (const child of stage.children) subjects.push(...asWhole([child.root], STORY_LISTENER_SEEN), ...asWhole([child.head], STORY_HEAD_SEEN));
    this.live = [owl.handle.root, owl.handle.head, ...children.flatMap((child) => [child.model.root, child.model.head])];
    const rules: ShotRules = {
      mutual: true,
      spread: STORY_SPREAD,
      contain: { points: [stage.bubble], margin: STORY_FRAME_MARGIN },
      overHerShoulder: true,
      ideal: STORY_IDEAL,
      aim: { halfLife: STORY_AIM_FOLLOW_HALF_LIFE, subjects: () => this.followed() },
    };
    // The real owl and children, wherever they are this frame, hide nothing: the stage is solved for where they will be.
    const cast = [...storySeats(this.library), owl.handle.root, ...children.map((child) => child.model.root)];
    this.director.start(STORY_SHOT_ID, subjects, cast, this.her, rules);
  }
}
