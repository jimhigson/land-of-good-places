import { Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import type { IsoCamera } from '../../core/IsoCamera';
import { cameraBreath } from '../../core/cameraBreath';
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
 * hangs her legs from the cushion; the owl on her perch, as she lands) — and
 * her own, as she will sit through it. Each is posed from rest, never as it
 * happened to be (the listeners sway on the clock and nod as they walk), so
 * the stage is the same whenever she sits, and so is the eye: it is a matter
 * of her cushion, her screen and what she wears, never of the moment or of
 * how fast the machine solves it. The stand-ins are never drawn; the solve
 * reads them once and lets them go. So the eye and the framing are the
 * reading's, from the first frame of the sit.
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
 * middle is off to one side of it; and **the camera breathes** (`ShotRules.breath`,
 * `core/cameraBreath.ts`): the eye held where it was proven clear, the aim
 * swaying a fraction of a degree about the stage on a slow, gently irregular
 * rhythm, the whole time the shot is down — Jim, 26 October 2026: *"I like this
 * wobble and would like this small wobble to apply all of the time."* It owes
 * nothing to who is moving: the owl flying over, the children walking in.
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

/**
 * The director's name for the shot, and the start of **what its memory of a
 * good eye is filed under**: with her, as she will sit through it, and her
 * screen's shape ({@link storyShotName}). The director tries the eye it
 * remembers under a name first, and keeps it if it passes everything — so a
 * name holds exactly what decides the eye, and a remembered one is the eye a
 * fresh solve would choose, only found sooner. Under one name for every sit,
 * an eye solved bare-headed would be taken again with a hat on, or on a phone
 * turned the other way, whenever it still passed — another eye than she would
 * have had sitting down fresh.
 */
export const STORY_SHOT_ID = 'story-time';

/**
 * {@link STORY_SHOT_ID}, filed under her stand-in — every part of her where it
 * is and what is drawn there, which is her cushion, her pose and her look —
 * and the screen's shape: two sits share a name only if the solve would see
 * the same thing both times (the rest of the stage is the same at every sit).
 */
export function storyShotName(her: Object3D, aspect: number): string {
  // FNV-1a over her parts' world matrices (to a tenth of a millimetre), what each one draws, and whether it is drawn.
  let hash = 0x811c9dc5;
  const mix = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  her.updateMatrixWorld(true);
  her.traverse((node) => {
    mix(node.matrixWorld.elements.map((e) => (Math.abs(e) < 5e-5 ? 0 : e).toFixed(4)).join(','));
    const geometry = (node as Partial<Mesh>).geometry;
    if (geometry) mix(geometry.uuid);
    mix(node.visible ? '+' : '-');
  });
  return `${STORY_SHOT_ID}@${hash.toString(36)}/${aspect.toFixed(4)}`;
}

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

/** The reading's stage, stood in for: the owl on her perch, each child on her cushion and her on hers, never drawn ({@link storyStage}). */
export interface StoryStage {
  readonly owl: Object3D;
  readonly owlHead: Object3D;
  readonly children: readonly { readonly root: Object3D; readonly head: Object3D }[];
  /** Where the owl's bubble will hang over her, on her perch. */
  readonly bubble: Vector3;
  /** Her, as she will sit through it — what the solve reads her body as ({@link herStandIn}). */
  readonly her: Object3D;
}

/** A child's model as `ridePose.ts` poses her, and her head's own height on her shoulders — `CharacterModel` is this shape. */
export interface StoryListener {
  /** The whole of her drawn body: hat, hair, backpack and all hang from it. */
  readonly root: Object3D;
  readonly body: Object3D;
  readonly head: Object3D;
  readonly leftArm: Object3D;
  readonly rightArm: Object3D;
  readonly leftLeg: Object3D;
  readonly rightLeg: Object3D;
  /** Where her head sits on her shoulders at rest (`CharacterModel.headHeight`): her stride nods it up and down. */
  readonly headHeight: number;
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
 * **A stand-in posed as she will listen, whatever she was doing when she sat**:
 * the stand-in's copy (`inStand`) of each of `model`'s parts, set from rest —
 * her head back at its own height on her shoulders (her stride nods it,
 * `Player.animate` and `NpcCharacter.animate`, and the listening pose leaves it
 * where it was), then the listening pose at the start of its sway
 * (`applyListeningPose` at 0; the real one sways on the game's clock, so a
 * copy of it as it was would be a different copy every time she sat). Her
 * root is left as placed, never righted through an Euler — the reason
 * `NpcCharacter` writes a sitter's facing again after her pose.
 */
function poseListening(model: StoryListener, inStand: (node: Object3D) => Object3D): void {
  inStand(model.head).position.y = model.headHeight;
  applyListeningPose(
    {
      root: { rotation: { x: 0 } },
      body: inStand(model.body),
      head: inStand(model.head),
      leftArm: inStand(model.leftArm),
      rightArm: inStand(model.rightArm),
      leftLeg: inStand(model.leftLeg),
      rightLeg: inStand(model.rightLeg),
    },
    0,
  );
}

/**
 * **Her, as she will sit through it** — her drawn body (`model.root`: her hat,
 * her hair, her backpack, what she looks like), copied as it is this frame,
 * set where she sits, and posed as she listens ({@link poseListening}); not
 * her name over her head, which bobs on the clock and hides nothing. The
 * solve reads her body as something in the way of the eye — never her own
 * head between it and the owl — and her real body sways on the clock, so it
 * reads this copy instead. (26 Oct 2026: from cushion 3 on a phone, the same
 * check once chose an eye a metre higher than it had before — she had sat at
 * another moment of her sway.)
 */
export function herStandIn(player: Pick<StoryCameraPlayer, 'model'>): Object3D {
  const live = player.model.root;
  live.updateWorldMatrix(true, true);
  const stand = live.clone(true);
  live.matrixWorld.decompose(stand.position, stand.quaternion, stand.scale);
  poseListening(player.model, (node) => twin(live, stand, node));
  stand.updateMatrixWorld(true);
  return stand;
}

/**
 * **The stage as it will be when the owl reads** — built the moment she sits,
 * when nobody is there yet: each body her own model, copied as it is this
 * frame and then posed as she will be, from rest, so the stage is the same
 * whatever anyone happened to be doing when she sat, and whenever that was.
 *
 * - The owl as `LibraryOwl` lands her on the story chair (`owlPerch`, in the
 *   room's frame) and as she reads there: her head straight ahead, her wings
 *   down, at the middle of a breath — her own neutral pose; her bubble's
 *   anchor over her head there, as `LibraryOwl` hangs it wherever she is.
 * - Each child as story time seats her (`NpcCharacter.beginSeated`: her
 *   cushion's middle in world metres, her soles on the floor, facing the
 *   chair), listening ({@link poseListening}).
 * - Her, on her own cushion, listening too ({@link herStandIn}).
 */
export function storyStage(library: Pick<StoryCameraLibrary, 'owl' | 'children'>, player: Pick<StoryCameraPlayer, 'model'>): StoryStage {
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
    poseListening(model, inChild);
    root.updateMatrixWorld(true);
    return { root, head: inChild(model.head) };
  });
  return { owl, owlHead: inOwl(handle.head), children, bubble, her: herStandIn(player) };
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
    readonly driver: { readonly seat: { readonly x: number; readonly z: number }; readonly seatFacing: number };
  }[];
  furniture(id: string): Object3D | undefined;
}

/** What it reads of her — `Player` is this shape. */
export interface StoryCameraPlayer {
  readonly position: Vector3;
  readonly facing: number;
  readonly group: Object3D;
  /** Her model's parts, for her stand-in ({@link herStandIn}). */
  readonly model: StoryListener;
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

  /** A shot is being solved this frame — for the checks (the solve begins on the frame she sits). */
  get solving(): boolean {
    return this.director.solving;
  }

  /** How many times no clear shot could be found — for the checks (the camera then stays where it is). */
  get unsolved(): number {
    return this.director.unsolved.length;
  }

  /** The stand-ins the shot was last solved against ({@link storyStage}) — for the checks. */
  get stage(): StoryStage | null {
    return this.lastStage;
  }

  /**
   * The stage a shot is solved against, built the moment she sits
   * ({@link storyStage}). A method, so that `check:library` can hand the solve
   * the stage as it happened to be instead (`story-stage-as-it-was`, the
   * stand-ins before 26 Oct 2026) and watch the clause that holds the stage
   * and the eye the same at every sit go red.
   */
  stageFor(player: StoryCameraPlayer): StoryStage {
    return storyStage(this.library, player);
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
    if (seated && (!this.seated || (story && !this.story && !this.director.active && !this.director.solving))) this.start(camera, player);
    // Up off her cushion — the chip, a jump, a tap — or out of the room: home at once.
    if (this.seated && !seated) this.director.cancel();
    // The story she sat through is over: the director eases home on its own, she still sitting.
    if (this.story && !story) this.storyEnded = true;
    this.seated = seated;
    this.story = story;
    this.director.update(dt, SEATED, her, inside, seated && !this.storyEnded ? Infinity : 0);
    return this.director.apply(camera);
  }

  /** The shot of the stage from where she sits — solved over the next few frames against its stand-ins, her own among them. */
  private start(camera: IsoCamera, player: StoryCameraPlayer): void {
    const { owl, children } = this.library;
    this.storyEnded = false;
    const stage = this.stageFor(player);
    this.lastStage = stage;
    const subjects: Object3D[] = [...asWhole([stage.owl], STORY_OWL_SEEN), ...asWhole([stage.owlHead], 1)];
    for (const child of stage.children) subjects.push(...asWhole([child.root], STORY_LISTENER_SEEN), ...asWhole([child.head], STORY_HEAD_SEEN));
    const rules: ShotRules = {
      mutual: true,
      spread: STORY_SPREAD,
      contain: { points: [stage.bubble], margin: STORY_FRAME_MARGIN },
      overHerShoulder: true,
      ideal: STORY_IDEAL,
      breath: cameraBreath,
    };
    // The real owl and children, wherever they are this frame, hide nothing: the stage is solved for where they will be.
    const cast = [...storySeats(this.library), owl.handle.root, ...children.map((child) => child.model.root)];
    // Her body, to the solve, is her stand-in: the real one sways (`herStandIn`).
    const her = { ...this.her, group: stage.her };
    this.director.start(storyShotName(stage.her, camera.camera.aspect), subjects, cast, her, rules);
  }
}
