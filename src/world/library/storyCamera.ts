import type { Object3D, Vector3 } from 'three';
import type { IsoCamera } from '../../core/IsoCamera';
import type { CollisionWorld } from '../Collision';
import { ExhibitCamera, asWhole, type ExhibitShot, type ShotInput, type ShotRoom, type ShotRules, type SolveReport } from '../reptileHouse/exhibitCamera';
import type { CharacterModel } from '../../entities/CharacterModel';
import { KID_HEIGHT } from '../../art/models/kidHeight';
import { LIBRARY_FLOOR_Y, LIBRARY_FURNITURE, LIBRARY_INNER_X, LIBRARY_INNER_Z, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z, LIBRARY_STORY_CHAIR, LIBRARY_STORY_RUG, LIBRARY_WALL_HEIGHT } from './layout';
import type { LibraryOwl } from './LibraryOwl';
import type { StoryPhase } from './storyTime';

/**
 * **Story time, seen from her cushion** — Jim, 24 October 2026: *"during story
 * time, I'd like the camera to enter a sequence where it comes down to
 * player-level and goes to over the shoulder camera, with the other children
 * listening and the reader visible."*
 *
 * While the owl reads (story time's `'reading'`, `storyTime.ts`) and the child
 * sits on one of her two story cushions, the camera comes down from the park's
 * high rig to a shot just behind her and over her shoulder: the owl in the big
 * chair with her page in her bubble over her, and the library's three children
 * on their cushions, listening. It holds for as long as the owl reads, and goes
 * home when the story ends — or at once when she gets up (the "Get up" chip, a
 * jump, a tap anywhere) or leaves the room. Sitting down once the reading has
 * begun brings it down from that moment.
 *
 * It also answers the cushion-1 view (`HANDOFF-library-v2.md`): from the rig,
 * the child on cushion 4 sits square between cushion 1 and the chair, and a
 * laptop saw the owl's glasses over her head and little else.
 *
 * ## No new camera
 *
 * The shot is the Reptile House's exhibit camera (`reptileHouse/exhibitCamera.ts`,
 * #711) — the one over-the-shoulder shot in the game, director and solver both:
 * a fan of candidate eyes behind her, each raycast against everything drawn in
 * the room and her own body; the move a smooth curve down over the room's open
 * top, and home the same way; `ExhibitCamera.apply` the single place it writes
 * the camera. This file decides only *when*, and *of what*: the room
 * ({@link LIBRARY_SHOT_ROOM}), the subjects (the owl and her head; each child
 * and her head), and what story time asks of the solver beyond an exhibit
 * (`ShotRules`): **the subjects hide one another** — a child's head between
 * the eye and the owl is what this shot is solved to see past; **each is seen
 * as a whole**, through a spread of its own drawn points, not only its middle
 * (see {@link STORY_OWL_SEEN} for how much of each); **the frame holds them
 * all**, and the owl's bubble's anchor (a bubble is drawn only while its anchor
 * is in shot, #415), on whatever screen is there; and the fan of eyes stands
 * **round her, from her back** — she faces the storyteller's chair, and the
 * audience's middle is off to one side of it.
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
  readonly children: readonly { readonly model: CharacterModel; readonly plan: { readonly seat: string } }[];
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
  /** The shot was wanted last frame — it starts on the frame it becomes wanted, and only then. */
  private wanted = false;
  /** She was on her cushion last frame. */
  private seated = false;
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
    const wanted = seated && library.storyPhase === 'reading' && library.owl.perched;
    const her = this.her;
    her.position = player.position;
    her.facing = player.facing;
    her.group = player.group;
    her.topHeight = player.topHeight;
    if (wanted && !this.wanted) this.start();
    // Up off her cushion — the chip, a jump, a tap — or out of the room: home at once.
    if (this.seated && !seated) this.director.cancel();
    // The story over before its shot was even solved: no shot.
    else if (!wanted && this.director.solving) this.director.cancel();
    this.wanted = wanted;
    this.seated = seated;
    // The hold lasts while the owl reads; when she has finished, the director eases home on its own.
    this.director.update(dt, SEATED, her, inside, wanted ? Infinity : 0);
    return this.director.apply(camera);
  }

  /** The shot of the owl and the three children, from where she sits — solved over the next few frames. */
  private start(): void {
    const { owl, children } = this.library;
    const subjects: Object3D[] = [...asWhole([owl.handle.root], STORY_OWL_SEEN), ...asWhole([owl.handle.head], 1)];
    for (const child of children) subjects.push(...asWhole([child.model.root], STORY_LISTENER_SEEN), ...asWhole([child.model.head], STORY_HEAD_SEEN));
    const rules: ShotRules = {
      mutual: true,
      spread: STORY_SPREAD,
      contain: { points: [owl.bubble.worldAnchor()], margin: STORY_FRAME_MARGIN },
      overHerShoulder: true,
      ideal: STORY_IDEAL,
    };
    this.director.start(STORY_SHOT_ID, subjects, storySeats(this.library), this.her, rules);
  }
}
