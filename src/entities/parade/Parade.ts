import { Box3, Group, Object3D, Raycaster, Vector2, Vector3 } from 'three';
import { PARADE_MEMBER_RADIUS } from '../../core/constants';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import type { TapPoint } from '../../core/input/PointerControls';
import type { CollisionWorld } from '../../world/Collision';
import type { PetBedSpot, PetParadeLink } from '../../world/hotel/Hotel';
import type { PetSlideLink, SlideSeat, SlideSeatFor } from '../../world/slide/petRiders';

/** Scratch for {@link Parade.nearestRiderBodyCentre}, so a per-frame call allocates nothing. */
const SLIDE_BODY_BOX = new Box3();
import { terrainHeight } from '../../world/terrain';
import { shopItem } from '../../world/building/shops/catalogue';
import { gameStore, walksInParade, type GameState, type InventoryItem } from '../../state';
import type { Player } from '../Player';
import { PlayerTrail } from './trail';
import { ParadeMember, type BedPhase, type PetTablePlace } from './ParadeMember';
import { BackpackPeek } from './BackpackPeek';
import { MAX_PARADE_VISIBLE } from './paradeCap';
import { PetRoute } from './petRoute';
import type { NavGrid } from '../../world/NavGrid';

/**
 * The parade of cute things.
 *
 * The family's favourite feature, and the point of the whole shopping trip:
 * everything you own that can walk falls in behind you in a single file line,
 * and everything else waits in the backpack and pops its head out now and
 * then. Balloons are the one exception: they are *held*, on a bending string
 * above the player, not walked — see `entities/HeldBalloon.ts` and this
 * file's own `isOut`, which excludes them outright.
 *
 * **How the line works.** The player leaves a breadcrumb trail (`trail.ts`) and
 * each member follows a point a fixed number of metres *back along that trail*,
 * not a point behind the player. That one decision buys almost everything:
 *
 * - the line goes round corners instead of cutting them, so it cannot clip
 *   through a wall or wade through the fountain;
 * - it goes up the stairs and the escalator, because the trail records the
 *   height the player's feet were at and `WalkSurfaces` snaps the follower to the
 *   same deck rather than to the grass twelve metres below;
 * - it forms up naturally from a standstill, because there is no trail to follow
 *   until the player walks.
 *
 * A spring settles each member onto its point, so the line has a lazy, springy
 * lag rather than moving like a train on rails.
 *
 * **Who is in it.** Toys and pets alike — `state/store.ts`'s
 * {@link walksInParade}, which is the *one* answer to "is this a companion?"
 * in the whole game: this file's own `isOut` asks it, and so does the hotel,
 * when it works out which of the things she owns gets a bed. (It is narrower
 * than `PARADE_KINDS`, which also lists `'balloon'` for the Cute-o-dex's "can
 * this come out?" question; a balloon is held on a string, never walked.)
 * Candy floss, ice cream, hats, stickers and eggs cannot walk either, so they
 * stay in the bag where {@link BackpackPeek} gives them something to do. The
 * thing in the player's hands is never also in the parade.
 */

/**
 * How many walk behind you at once.
 *
 * Read from {@link MAX_PARADE_VISIBLE} rather than written here, because
 * `main.ts`'s `?pets=N` needs the same number to warn that it is about to
 * grant more companions than can walk, and cannot import this file to get it.
 */
const MAX_VISIBLE = MAX_PARADE_VISIBLE;

/**
 * Seconds before the line shuffles, when you own more than fit.
 *
 * Chosen over "newest eight, always" so that a child who owns twenty things sees
 * all twenty over a few minutes of play. The order within the line stays
 * newest-first; it is the window onto that order that rotates, one place at a
 * time, so the change is a single toy swapping out rather than a whole new cast.
 */
const ROTATE_SECONDS = 22;

/** Gap between the player's heels and the first follower, in metres. */
const LEAD_GAP = 1.35;

/** Base gap between one follower and the next; model height is added to it. */
const BASE_GAP = 0.7;

/**
 * Collision radius for a follower. Small — they are toys.
 *
 * Kept in `core/constants.ts` because the hotel's pet-bed spacing has to leave
 * a companion room to walk between two beds, and that has to be *this* number
 * rather than a copy of it.
 */
const MEMBER_RADIUS = PARADE_MEMBER_RADIUS;

/** Seconds of stagger per place in the line when the hop ripples down it. */
const HOP_RIPPLE = 0.075;

/**
 * How far a companion's body may be from the player's own trail and still
 * count as **on the line**, in metres — issue #605.
 *
 * Not a taste number. Measured on the built hotel suite, as the distance from
 * each drawn body to the trail polyline (`PlayerTrail.distanceTo`, whose
 * comment carries the same figures):
 *
 * | | median | p90 | p99 | worst |
 * |---|---|---|---|---|
 * | following her about (8,965 samples) | 0.00 m | 0.045 m | 0.276 m | **0.366 m** |
 * | re-forming after a nap (4,460) | 0.00 m | 0.124 m | **2.441 m** | **5.926 m** |
 *
 * This sits between them with room on both sides: ~1.6x above the worst a
 * follower ever reached, and ~4x below the p99 of a companion that has been
 * put somewhere. It is deliberately **not** compared against the follow lag,
 * which is a different and much bigger number (median 0.87 m, worst 1.41 m) —
 * a follower lags *along* the trail, not away from it, and a threshold on lag
 * would fire on every stride while missing the case this exists for.
 */
const ON_LINE_RADIUS = 0.6;

export class Parade implements GameSystem, PetParadeLink, PetSlideLink {
  readonly name = 'parade';

  /** Add this to the scene once. Members live in world space inside it. */
  readonly group = new Group();

  private readonly player: Player;
  private readonly collision: CollisionWorld;
  private readonly camera: IsoCamera;
  private readonly peek: BackpackPeek;

  private readonly trail = new PlayerTrail();
  private readonly members: ParadeMember[] = [];
  /** Members poofing out of existence. They hold still and shrink. */
  private readonly leaving: ParadeMember[] = [];

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();

  private readonly unsubscribe: () => void;

  /**
   * The map a bedtime walk is routed on — issue #602, and see `bedRoute.ts`.
   *
   * Handed over by `Game` after the collision world is finished, the same way
   * the hotel and the great hall are introduced to this class, because the
   * parade is constructed before there is a lattice to give it. `null` until
   * then, and on any harness that never builds one: a pet with no router walks
   * to its bed exactly as it did before, in a straight line.
   */
  private navGrid: NavGrid | null = null;
  /**
   * One route per companion, by uid — for a walk to a bed, and for the walk
   * back onto the line afterwards. Entries are made the first time a companion
   * needs one and dropped when it leaves the line, so an ordinary walk round
   * the park never plans anything.
   */
  private readonly routes = new Map<string, PetRoute>();
  /**
   * **How often a companion moved without routing** — the count issue #605
   * asks for out loud, because a fallback that fires routinely would hide this
   * bug again exactly as the straight line did.
   *
   * Four counts, and only the last one is a fallback:
   *
   * - **`onLine`** — the body is on the ground the player covered, so the
   *   trail *is* its route. The ordinary case, and not a fallback at all.
   * - **`routed`** — walking a waypoint of a plan of its own.
   * - **`lastLeg`** — a plan ran out of waypoints short of its goal and the
   *   ordinary seek is finishing the job. By design (see `petRoute.ts`): a
   *   lattice is fattened by the walker's width, so a run-up spot wedged
   *   between two pet beds is honestly unstandable to it. It has routed.
   * - **`noRoute`** — off the line, wanted a route, and got nothing: no
   *   router, no ground sampler, or a lattice that does not cover where it
   *   is standing. **This is the one that hides the bug**, and it should be
   *   zero.
   */
  private readonly routing = { onLine: 0, routed: 0, lastLeg: 0, noRoute: 0, worstLastLeg: 0 };

  private wasAirborne = false;
  private rotateTimer = 0;
  private rotation = 0;
  private overflow = 0;
  /** Signature of the last sync, so a store notification is usually free. */
  private signature = '';
  /**
   * Scratch handed to the ride and straight on to one member, so a descent with
   * eight companions in it allocates nothing per frame. Never held by anybody:
   * {@link ParadeMember.rideSlide} copies the numbers out of it.
   */
  private readonly slideSeat: SlideSeat = {
    x: 0,
    y: 0,
    z: 0,
    facing: 0,
    pitch: 0,
    recline: 0,
  };

  constructor(player: Player, collision: CollisionWorld, camera: IsoCamera) {
    this.player = player;
    this.collision = collision;
    this.camera = camera;
    this.group.name = 'parade';

    // The anchor is a closure, not a captured `Group` — see `WornHat.ts`'s
    // doc comment on the same pattern. It reads `player.model.backpackAnchor`
    // fresh every time a peek actually begins, so the HUD's "Look" pill
    // rebuilding `player.model` in place (`rebindPlayerModel`, below) never
    // leaves it reaching into a disposed bag.
    this.peek = new BackpackPeek(() => player.model.backpackAnchor);

    this.trail.reset(player.position.x, player.position.y, player.position.z);
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  /** How many owned things are waiting their turn behind the visible eight. */
  get waitingCount(): number {
    return this.overflow;
  }

  /**
   * **Send one pet to its own bed** — the hotel suite's nap, by way of
   * `Hotel.sendPetsToBed`, is the only caller.
   *
   * The member itself does the rest ({@link ParadeMember.goToBed}): it walks
   * to the bed's run-up spot on the ordinary follow spring — {@link update}
   * points its `target` there instead of at a trail sample, which is the only
   * thing this class changes — and then climbs in and lies down under its own
   * steam.
   *
   * **There is one body.** The pet a child has been watching walk behind her
   * is the pet that walks to the bed, climbs in and sleeps in it; the hotel
   * builds no stand-in, nothing is hidden, nothing is handed over, and no
   * second system has an opinion about where that animal is or whether it is
   * drawn. That is the whole fix for Jim's 23 Aug 2026 report — the pet
   * *"phases in and out of existence on alternating frames, no smooth
   * animation and then morphs into a totally different pet, who then clips out
   * of the bed"*: every one of those is what two bodies for one animal looks
   * like from the sofa.
   *
   * Returns `false`, and starts nothing, when this uid is not a live member of
   * the line right now — stowed, carried in her hands, or a bed built before
   * she owned a matching companion at all. That bed simply stays empty
   * furniture, which is what it already is between naps.
   *
   * **Any member of the line, not only a `kind: 'pet'` one.** Jim, 24 Aug
   * 2026: *"if they follow the character they get a bed."* Membership of this
   * array already *is* that question — nothing reaches it that `isOut` did not
   * pass — so a second `kind === 'pet'` test here could only ever be a
   * narrower, disagreeing copy of it, and was: it silently refused every
   * fresh save's own starter companion, RiPika, who is catalogued `'toy'`.
   */
  sendPetToBed(uid: string, bed: PetBedSpot): boolean {
    const member = this.members.find((candidate) => candidate.uid === uid);
    if (!member) return false;
    member.goToBed(bed);
    return true;
  }

  /**
   * **The map a companion's walk is routed on** — issues #602 and #605. `Game`
   * is the one caller, in the same breath as it introduces this class to the
   * hotel and to the great hall, and for the same reason: the parade is built
   * before there is a lattice to give it.
   *
   * **The player's own grid, the very same instance**, not one of a companion's
   * own. A pet-sized grid was written for #602 and deleted with measurements
   * in `petRoute.ts` — the walker makes no difference to what a lattice costs,
   * and a second one charges the first nap another second of blocked main
   * thread. Sharing it is also the literal reading of "one owner": a companion
   * walks on exactly the map she walks on.
   *
   * Interleaving is safe because it is sequential. `findRoute` leaves
   * `lastRouteReachedGoal` and `lastRouteEndY` behind it, and both readers —
   * `TapNavigator.planRoute` and this class — read them in the statement after
   * their own call, never across somebody else's.
   */
  setNavGrid(navGrid: NavGrid): void {
    this.navGrid = navGrid;
  }

  /**
   * **How the companions have been getting about**, for `check:hotel` to print.
   *
   * Issue #605 asks for the fallback to be counted and said out loud, because
   * a straight line that fires routinely is how this bug hides. `noRoute`
   * being anything but zero means companions are moving with no router behind
   * them somewhere, which is the defect itself; the other three are all
   * routed walks of one kind or another.
   */
  get routingStats(): {
    readonly onLine: number;
    readonly routed: number;
    readonly lastLeg: number;
    readonly noRoute: number;
    readonly worstLastLeg: number;
    readonly plans: number;
  } {
    let plans = 0;
    for (const route of this.routes.values()) plans += route.plans;
    return { ...this.routing, plans };
  }

  /**
   * **Send the companions off to the pets' table** — issue #449, and the great
   * hall's banquet is the one caller.
   *
   * Jim: *"There should also be a small pets table for the pets to eat at, and
   * they go there when the player sits."* She sits down; her cat leaves her
   * side, trots over to a little table of its own and puts its nose in a bowl.
   *
   * **The hall offers places; this hands them out.** It does not ask the hall
   * who her companions are, and the hall does not ask it — the line *is* the
   * answer to "what walks behind her", and it is already here. That is the
   * difference between this and the hotel's breakfast pet, which builds a
   * `createPet` of its own beside her chair: a second body for an animal she
   * already owns, of a species picked separately from the one in the line.
   * Here the pet a child has been watching walk behind her is the pet that
   * walks to the table and eats at it.
   *
   * Places are handed out in line order, nearest her first, and a companion
   * past the last place simply stays in the line — it will be standing beside
   * her at the bench, which is a perfectly good thing for it to be doing and
   * is better than two animals in one chair.
   *
   * Returns how many actually went, which is what a check measures.
   */
  sendPetsToTable(places: readonly PetTablePlace[]): number {
    let sent = 0;
    for (const member of this.members) {
      const place = places[sent];
      if (!place) break;
      member.goToTable(place);
      sent += 1;
    }
    return sent;
  }

  /**
   * She has got up from the table: everybody back into the line, from wherever
   * they had got to. A no-op for a member that never went, so the hall may
   * call it whenever she stands up without tracking who it sent.
   */
  callPetsBackFromTable(): void {
    for (const member of this.members) member.leaveTable();
  }

  /**
   * **Everybody down the slide behind her** — issue #468, and the ginormous
   * slide is the one caller, every frame of the descent.
   *
   * Jim: *"When going down the slide, the pet should slide down behind the
   * player."*
   *
   * The same one-way seam as the banquet's `sendPetsToTable` and, like it,
   * built on the line itself: the order companions walk in *is* the order they
   * come down the chute in, so nothing here decides who goes where, and there
   * is no second list of who her companions are to disagree with the one behind
   * her. The ride answers where each seat is (`slide/petRiders.ts`); this puts
   * the animals in them and never gives the ride a body to hold.
   *
   * Returns how many are aboard, which is what a check measures.
   */
  ridePetsDownSlide(seatFor: SlideSeatFor): number {
    for (let slot = 0; slot < this.members.length; slot += 1) {
      seatFor(slot, this.slideSeat);
      this.members[slot]?.rideSlide(this.slideSeat);
    }
    return this.members.length;
  }

  /**
   * The bottom of the slide: everybody back into the line, from wherever on the
   * chute they had got to. A no-op for a member that never boarded, so the ride
   * may call it whenever a descent ends without tracking who went.
   */
  callPetsOffSlide(): void {
    for (const member of this.members) member.leaveSlide();
  }

  /**
   * How many companions are actually on the chute — the question a check asks,
   * answered by the system that owns those bodies rather than by a second
   * count kept by the ride.
   */
  petsOnSlide(): number {
    return this.members.filter((member) => member.onSlide).length;
  }

  /**
   * **Where the nearest companion's body actually is** — measured off the drawn
   * animal, not derived from the seat it was put in (#518).
   *
   * Same principle as {@link petsOnSlide} and {@link companionAt} directly
   * above: a question about these bodies, answered by the system that owns
   * them, from the scene graph after the frame that moved it. *Observing rather
   * than recomputing* is the distinction those two already draw, and it is the
   * whole of #518 — the camera was recomputing, off a seat, and was most of a
   * metre wrong about where the animal it was filming had got to.
   *
   * `updateWorldMatrix` first, and not for tidiness: the parade is moved this
   * same frame, and `Box3.setFromObject` reads world matrices. Without it this
   * measures where the animal was **last** frame — the identical fault, one
   * frame instead of one metre, and the one that made three of
   * `check:pet-slide`'s own numbers false until it was fixed.
   */
  nearestRiderBodyCentre(out: Vector3): boolean {
    const member = this.members[0];
    if (!member || !member.onSlide) return false;
    member.root.updateWorldMatrix(true, true);
    SLIDE_BODY_BOX.setFromObject(member.root);
    if (SLIDE_BODY_BOX.isEmpty()) return false;
    SLIDE_BODY_BOX.getCenter(out);
    return true;
  }

  /**
   * The `slot`-th companion's own live body, nearest her first — what
   * `check:pet-slide` measures a descent with.
   *
   * By place in the line rather than by uid, unlike {@link petState}, because
   * the question that check asks is about **order**: is each one behind the one
   * in front of it, and is any pair on the same spot. `root` is the real node,
   * so the check takes its own world position off the scene graph after the
   * frame that moved it rather than being told where the pet ought to be — the
   * distinction that separates observing from recomputing, and the reason this
   * returns the body and not a copy of its coordinates.
   */
  companionAt(slot: number): {
    readonly uid: string;
    readonly displayName: string;
    readonly height: number;
    readonly onSlide: boolean;
    readonly root: Object3D;
  } | null {
    const member = this.members[slot];
    if (!member) return null;
    return {
      uid: member.uid,
      displayName: member.displayName,
      height: member.height,
      onSlide: member.onSlide,
      root: member.root,
    };
  }

  /**
   * How many companions are actually standing at the pets' table with their
   * noses in a bowl — the question `check:castle` asks, answered by the one
   * system that owns those bodies rather than by a second clock in the hall.
   */
  petsEatingAtTable(): number {
    return this.members.filter((member) => member.eatingAtTable).length;
  }

  /**
   * The nap is over, or ended early: this pet stands back up wherever its
   * routine had got to and rejoins the line. A no-op for a uid that was never
   * sent to bed, so `Hotel.standPetsDown` can call it for every bed it owns
   * without tracking which ones it actually used.
   */
  wakePetFromBed(uid: string): void {
    for (const member of this.members) {
      if (member.uid === uid) member.getOutOfBed();
    }
    // The route it walked in on goes with the nap: the walk *back* to the line
    // plans afresh from wherever this animal has got to, rather than replaying
    // waypoints laid out for a body that was somewhere else entirely.
    this.routes.get(uid)?.clear();
  }

  /**
   * How far through its bedtime routine this pet is **in `bed`**, or `null`
   * when it is not going to bed at all or is in one of its own other beds —
   * the question `Hotel`'s "Z" glyphs and `check:hotel` both ask, without
   * either of them reaching into a member.
   *
   * Matched on the spot object the hotel handed over, not on coordinates:
   * one pet has a bed in each of the three bedrooms, and only the one it
   * actually walked to may claim it.
   */
  petBedPhase(uid: string, bed: PetBedSpot): BedPhase | null {
    const member = this.members.find((candidate) => candidate.uid === uid);
    return member?.bedSpot === bed ? (member?.bedPhase ?? null) : null;
  }

  /**
   * The HUD's "Look" pill, by way of `Game.applyLiveLook`: `player.model` has
   * just been rebuilt, so whoever `peek` had reached into the old
   * `backpackAnchor` for is gone with it. `peek` already reads the anchor
   * live (see the constructor's own doc comment) and already tolerates a
   * vanished handle (`BackpackPeek.clear`); it just needs telling, since it
   * cannot otherwise know the mesh it was tracking has already been disposed.
   */
  rebindPlayerModel(): void {
    this.peek.rebind();
  }

  update(context: FrameContext): void {
    const { dt, elapsed } = context;
    const player = this.player;

    // The trail is the one owner of "was she moved, or did she walk?" — see
    // `PlayerTrail.push`. When she was moved, her companions were moved with
    // her, and leaving them behind in the space she left is what sent five
    // animals flying across the park and in through the hotel wall on every
    // `/hotel-suite` deep link. See {@link catchUpAfterTeleport}.
    if (this.trail.push(player.position.x, player.position.y, player.position.z)) {
      this.catchUpAfterTeleport();
    }

    // Copy the hop. Reading the player's own airborne edge rather than the jump
    // button means the trampoline and the slide's landing get a hop out of the
    // parade too, for free.
    const airborne = player.isAirborne;
    if (airborne && !this.wasAirborne && player.verticalSpeed > 0) this.rippleHop();
    this.wasAirborne = airborne;

    if (dt > 0 && this.overflow > 0) {
      this.rotateTimer += dt;
      if (this.rotateTimer >= ROTATE_SECONDS) {
        this.rotateTimer = 0;
        this.rotation += 1;
        this.signature = '';
        this.sync(gameStore.get());
      }
    }

    // "When you use it your pet gets one too" — Eleri. Told every frame rather
    // than on the edge, because a toy that joins the line mid-flight has to get
    // one as well, and `setFlying` is a comparison when the answer is the same.
    const flying = player.isFlying;

    for (const member of this.members) {
      member.setFlying(flying);
      // A pet on its way to bed aims at its bed's own run-up spot instead of
      // at a trail sample. That is the *only* difference: the same spring,
      // the same easing, the same turn-to-face and the same walk cycle carry
      // it there, so there is no second way of moving a pet in this game.
      // A pet on its way to bed aims at the next waypoint of a `NavGrid` route
      // to its bed's own run-up spot (#602 — see `bedRoute.ts`; it used to aim
      // straight at the spot and walk through the bedroom wall on the way),
      // and one on its way to the pets' table (#449) at its own place there,
      // instead of at a trail sample. That is the *only* difference in either
      // case: the same spring, the same easing, the same turn-to-face and the
      // same walk cycle carry it there, so there is no second way of moving a
      // pet in this game.
      const bed = member.bedSpot;
      const place = member.tablePlace;
      // **A companion on the ginormous slide (#468) is aimed at nothing at
      // all.** The ride has already written its seat on the chute and the
      // member ignores {@link ParadeMember.target} while it is riding, so
      // aiming would only resolve a trail sample against the collision world
      // for a body that is thirty metres up in the air.
      if (member.onSlide) {
        // nothing to aim
      } else if (bed) this.aimAtBed(member, bed, dt);
      else if (place) member.target.set(place.x, place.y, place.z);
      else this.aimAt(member, dt);
      member.update(dt, elapsed);
    }

    for (let index = this.leaving.length - 1; index >= 0; index -= 1) {
      const member = this.leaving[index]!;
      member.update(dt, elapsed);
      if (!member.gone) continue;
      member.dispose();
      this.leaving.splice(index, 1);
    }

    this.peek.update(dt, elapsed);
  }

  /**
   * A tap landed on the park. If it hit a member of the parade, that one goes
   * back in the backpack — and reports true so the tap does not *also* become a
   * walk order to the same spot.
   */
  handleTap(point: TapPoint): boolean {
    if (this.members.length === 0) return false;

    this.ndc.set(point.ndcX, point.ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    const hits = this.raycaster.intersectObject(this.group, true);
    if (hits.length === 0) return false;

    const member = this.memberOf(hits[0]!.object);
    if (!member) return false;

    gameStore.setStowed(member.uid, true);
    return true;
  }

  dispose(): void {
    this.unsubscribe();
    this.peek.dispose();
    for (const member of this.members) member.dispose();
    for (const member of this.leaving) member.dispose();
    this.members.length = 0;
    this.leaving.length = 0;
  }

  /**
   * Everything `check:hotel` needs to know about one pet's own live body, by
   * uid — where it is, whether it is drawn, **which model it actually is**
   * and how far through its bedtime routine it has got. `null` when no such
   * pet is currently in the line at all.
   *
   * `itemId` is here because "the pet in the bed is the pet she owns" used to
   * be un-askable from outside: the hotel built a second animal of its own
   * and a probe reading that one could not tell a bunny standing in for a
   * kitten from the kitten itself. `root` is the real node, so a probe can
   * take its own `Box3` and ask whether the animal fits in the bed rather
   * than trusting an offset.
   */
  petState(uid: string): {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly visible: boolean;
    readonly itemId: string;
    readonly bedPhase: BedPhase | null;
    readonly root: Object3D;
  } | null {
    const member = this.members.find((candidate) => candidate.uid === uid);
    if (!member) return null;
    const { x, y, z } = member.root.position;
    return {
      x,
      y,
      z,
      visible: member.root.visible,
      itemId: member.itemId,
      bedPhase: member.bedPhase,
      root: member.root,
    };
  }

  // -------------------------------------------------------------- internals

  /**
   * Works out where this member should be standing, and writes it into the
   * member's target.
   *
   * Two corrections are applied to the raw trail point. The walk-surface sampler
   * puts it on whatever the player was standing on there — the deck, the stair
   * tread, the grass — using the recorded height as the hint that tells "deck
   * three" from "the ground under deck three". Then collision nudges it out of
   * anything solid, which only ever matters when the spring has cut a corner
   * slightly on a fast turn.
   *
   * ## And then: is this animal still on the line at all? (#605)
   *
   * Jim: *"the pets should ALWAYS use normal path finding by default to get to
   * where they need to go, including while following the player in a parade
   * formation."* Following already is routed — the trail is the ground the
   * player herself covered, and `trail.ts` exists to say so — and measured on
   * the built suite it holds: **0 partition crossings in 26,180 pet-steps** of
   * walking her back and forth through every doorway. What was not routed was
   * getting **back** to the line: a companion that has just stood up out of a
   * bed in another room is nowhere near the trail, and the spring took it
   * straight at its trail point through the partition. Same for one leaving
   * the pets' table, one coming off the slide, one just popped out of the
   * backpack, and one left behind when a teleport drops the trail.
   *
   * So there is one rule, and it is derived rather than a list of those cases:
   * **a companion follows the trail while it is on the trail, and routes back
   * to it when it is not.** {@link PlayerTrail.distanceTo} is the measurement,
   * and its own comment carries the two populations that place
   * {@link ON_LINE_RADIUS} between them. Nothing has to be flagged when a pet
   * is put somewhere, so nothing can be forgotten when a new way of putting it
   * somewhere is added.
   */
  private aimAt(member: ParadeMember, dt: number): void {
    // Everything up to here is *where the line is*, and it is wanted on its own
    // by `spaceOut` and by `catchUpAfterTeleport` — see {@link aimAtLine}.
    if (!this.aimAtLine(member)) return;

    // A member that has never been placed has no body to route *from* — see
    // `spaceOut`, which places it onto exactly this point.
    if (!member.placed) return;

    // On the line: the trail is this animal's route, and it is already on it.
    if (this.trail.distanceTo(member.root.position.x, member.root.position.z) <= ON_LINE_RADIUS) {
      this.routes.get(member.uid)?.clear();
      this.routing.onLine += 1;
      return;
    }
    // Off it: walk back on, round whatever is in the way.
    this.routeTo(member, member.target, dt);
  }

  /**
   * Writes **where this member's place in the line is** into its target, and
   * returns whether that point is an ordinary walked-to spot on the ground —
   * that is, whether **routing to it means anything**. `false` says the target
   * was written by one of the two shortcuts below (no trail to sample yet, or
   * she is flying and the line is pinned to her altitude); the point is still
   * somewhere to stand, so a caller that only wants to *place* a body there
   * ignores the answer.
   *
   * Split out of {@link aimAt} because two other callers want exactly this and
   * emphatically do not want the routing that follows it: `spaceOut`, placing a
   * brand-new member, and {@link catchUpAfterTeleport}. Both are about to move
   * the body *onto* this point, so asking for a route to it would be planning a
   * walk that is not going to happen — and, before this was split, `spaceOut`
   * relied on `aimAt`'s `!member.placed` guard to stop it doing just that,
   * which is a guard doing duty as control flow.
   */
  private aimAtLine(member: ParadeMember): boolean {
    const point = member.target;
    if (!this.trail.sample(member.offset, point)) {
      point.copy(this.player.position);
      return false;
    }

    // In the air, the line flies at *her* altitude rather than at the height the
    // trail remembers. The trail's arc length is horizontal, so hovering
    // straight up drops no crumbs at all and a follower reading the recorded
    // height would sit on the grass watching her go. Its x and z are still the
    // trail's, so the line still rounds corners and still cannot cut through a
    // wall on the way.
    //
    // Clearance is hers too, so the followers are allowed over the same low
    // walls she is instead of being shoved about by things they are ten metres
    // above. `y` is followed hard (see `ParadeMember.update`), so they rise and
    // settle with her rather than lagging.
    if (this.player.isFlying) {
      this.collision.resolve(point, MEMBER_RADIUS, this.player.heightAboveGround);
      point.y = this.player.position.y;
      return false;
    }

    this.collision.resolve(point, MEMBER_RADIUS);
    point.y = this.groundAt(point.x, point.z, point.y);
    return true;
  }

  /**
   * **The character was moved rather than walked, so her companions were
   * moved too** — put them back in the line where she now is, instead of
   * leaving them standing in the space she left.
   *
   * Measured on `/hotel-suite?pets=5` before this existed: the deep link puts
   * her in the suite at `(-613.2, 1380)` while all five companion bodies are
   * still at the park spawn, `(-1.6, 51.6)`. That is 640 m and a different
   * space, so the suite's own nav lattice — which spans `x -630..-570,
   * z 1350..1410` and nothing else — does not contain the animal at all.
   * `NavGrid.findRoute` correctly answers 0 ("route unknown"), `routeTo`
   * correctly counts `noRoute`, and the follow spring drags five animals in a
   * straight line across the park and in through the hotel wall. **120
   * `noRoute` member-frames, all of them in frames 2–25 and none after**, and
   * ~0.4 s of exactly the wall-walking #602 and #605 exist to delete.
   *
   * Note what this is *not*: no lattice was cold and no ground sampler was
   * missing — both were present and built on every one of those frames, which
   * is what rules out #608 (the first-tap lattice stall) as the cause. The
   * router was asked a question it cannot answer, and the honest answer is the
   * one it gave. The bug is the asking.
   *
   * A member that is **not following** is left exactly where it is: one asleep
   * in a bed or walking to one belongs to that room and not to the line, one
   * at the pets' table has its own place, and one on the slide is being
   * carried by the ride. Those are the same three exclusions `update` makes
   * when it decides what a member is aiming at, read from the same fields, so
   * there is no second opinion about who is in the parade.
   */
  private catchUpAfterTeleport(): void {
    for (const member of this.members) {
      if (member.onSlide || member.bedSpot || member.tablePlace) continue;
      this.routes.get(member.uid)?.clear();
      this.aimAtLine(member);
      member.placeAt(
        member.target.x,
        member.target.y,
        member.target.z,
        this.player.group.rotation.y,
      );
    }
  }

  /**
   * Points `member` at the next waypoint of a route to wherever `goal` already
   * says, or leaves `goal` alone when there is no route to be had — the one
   * place a companion's walk is planned, shared by the walk to a bed and the
   * walk back to the line.
   *
   * The two fall-throughs are counted rather than silent, because #605's whole
   * complaint is a straight line nobody could see:
   *
   * - **No router and no ground sampler** — a harness, or before `Game` has
   *   introduced the two. The old straight line, and honest about it.
   * - **The route is spent**, which is the last leg. A lattice is fattened by
   *   the walker's width, so a route can stop honestly short of a goal wedged
   *   between two pet beds; that stretch is short and inside one room. See
   *   `petRoute.ts`.
   *
   * The body's own drawn position drives the waypoint advance, taken off
   * `ParadeMember.root` — never {@link ParadeMember.target}, which is a
   * waypoint from the frame it is written and would count every leg walked
   * before the animal had moved at all.
   */
  private routeTo(member: ParadeMember, goal: Vector3, dt: number): void {
    const navGrid = this.navGrid;
    const sampler = this.player.groundSampler;
    if (!navGrid || !sampler) {
      this.routing.noRoute += 1;
      return;
    }
    let route = this.routes.get(member.uid);
    if (!route) {
      route = new PetRoute();
      this.routes.set(member.uid, route);
    }
    const body = member.root.position;
    const goalY = goal.y;
    if (
      route.advance(navGrid, sampler, goal.x, goal.z, goalY, body.x, body.z, goalY, dt, goal)
    ) {
      // The waypoints are `x, z` only; the floor under one is the same
      // question the trail sample above asks, with the goal's own level as the
      // hint that tells this room from whatever is under it.
      goal.y = this.groundAt(goal.x, goal.z, goalY);
      this.routing.routed += 1;
      return;
    }
    // Nothing left to say. Which of the two that is decides whether anything
    // is wrong — see {@link PetRoute.hasRoute}.
    if (!route.hasRoute) {
      this.routing.noRoute += 1;
      return;
    }
    this.routing.lastLeg += 1;
    // **How long that last leg actually is.** "The route stopped a little
    // short" and "the route stopped nowhere near" are the same code path and
    // very different facts, and only the first one is safe — a long straight
    // line to a goal is precisely the thing #602 and #605 delete. Recorded so
    // a check can assert on it rather than take the distinction on trust.
    const leg = Math.hypot(goal.x - body.x, goal.z - body.z);
    if (leg > this.routing.worstLastLeg) this.routing.worstLastLeg = leg;
  }

  /**
   * Works out where a pet **on its way to bed** should be walking, and writes
   * it into the member's target — issue #602.
   *
   * The route is planned once, by `bedRoute.ts`, on the same {@link NavGrid}
   * class the player's tap-to-walk and every NPC child plan on. All this does
   * is ask it which waypoint the animal is on and point the ordinary follow
   * spring at it: no avoidance, no second search, and nothing here that knows
   * a wall from a doorway.
   *
   * Two deliberate fall-throughs to the old straight line, and neither is a
   * quiet failure — a pet that walks the shortest way to a bed *in the room it
   * is standing in* is exactly right:
   *
   * - **No router at all** (a harness, or before `Game` has handed one over).
   * - **The route is spent**, which is every leg after the last waypoint. The
   *   lattice is fattened by the walker's own width and the middle bedroom's
   *   ten beds are close-packed, so a route can honestly stop a little short of
   *   the run-up spot; that last stretch is inside one room, and the arrival
   *   check `ParadeMember` makes against `bed.runUpX/Z` still wants the exact
   *   spot rather than a waypoint near it.
   *
   * The body's own drawn position drives the waypoint advance, taken off
   * `ParadeMember.root` — never {@link ParadeMember.target}, which is a
   * waypoint from the frame it is written and would count every leg walked
   * before the animal had moved at all.
   */
  private aimAtBed(member: ParadeMember, bed: PetBedSpot, dt: number): void {
    const point = member.target;
    point.set(bed.runUpX, bed.runUpY, bed.runUpZ);
    this.routeTo(member, point, dt);
  }

  private groundAt(x: number, z: number, y: number): number {
    const sampler = this.player.groundSampler;
    return sampler ? sampler(x, z, y) : terrainHeight(x, z);
  }

  private rippleHop(): void {
    for (const member of this.members) member.hop(member.slot * HOP_RIPPLE);
  }

  private memberOf(object: Object3D): ParadeMember | null {
    for (let node: Object3D | null = object; node; node = node.parent) {
      const found = this.members.find((member) => member.root === node);
      if (found) return found;
    }
    return null;
  }

  /**
   * Brings the parade into line with what the player owns.
   *
   * Runs on every store notification, so it bails out the moment the answer has
   * not changed — buying an ice cream must not rebuild eight models.
   */
  private sync(state: GameState): void {
    const out = state.inventory.filter((item) => isOut(item, state.carriedUid));
    // Newest first: the thing you just bought walks right behind you, which is
    // how a six-year-old finds out that buying it worked.
    out.reverse();

    this.overflow = Math.max(0, out.length - MAX_VISIBLE);
    if (this.overflow === 0) this.rotateTimer = 0;

    const visible = window_(out, this.rotation);
    const signature = visible.map((item) => item.uid).join(',');
    if (signature === this.signature) {
      this.peek.setCandidates(stowedIds(state, visible));
      return;
    }
    this.signature = signature;

    // --- leavers ------------------------------------------------------------
    const keep = new Set(visible.map((item) => item.uid));
    for (let index = this.members.length - 1; index >= 0; index -= 1) {
      const member = this.members[index]!;
      if (keep.has(member.uid)) continue;
      member.beginExit();
      this.leaving.push(member);
      this.members.splice(index, 1);
      // Nothing walks anywhere while it is poofing out of existence, so the
      // route it was walking goes with it rather than waiting in the map for a
      // body that is not coming back.
      this.routes.delete(member.uid);
    }

    // --- joiners ------------------------------------------------------------
    const byUid = new Map(this.members.map((member) => [member.uid, member]));
    const ordered: ParadeMember[] = [];
    for (const item of visible) {
      const existing = byUid.get(item.uid);
      if (existing) {
        ordered.push(existing);
        continue;
      }
      // Somebody who is halfway through poofing out has changed their mind.
      // Reviving them beats building a second copy inside the first — which is
      // exactly what happens when a toy is put away and taken straight back out
      // from the Cute-o-dex, since the book pauses the park and the poof never
      // gets a frame to finish in.
      const returning = this.leaving.findIndex((member) => member.uid === item.uid);
      if (returning >= 0) {
        const member = this.leaving[returning]!;
        this.leaving.splice(returning, 1);
        member.cancelExit();
        ordered.push(member);
        continue;
      }
      const catalogue = shopItem(item.id);
      if (!catalogue) continue;
      const member = new ParadeMember(item.uid, catalogue);
      this.group.add(member.root);
      ordered.push(member);
    }

    this.members.length = 0;
    this.members.push(...ordered);
    this.spaceOut();
    this.peek.setCandidates(stowedIds(state, visible));
  }

  /**
   * Hands out the follow distances.
   *
   * Spacing is per-member rather than fixed, because a teddy the size of a
   * kitchen bin and a mouse the size of a plum cannot share a gap: one leaves a
   * hole in the line and the other gets walked through.
   */
  private spaceOut(): void {
    let offset = LEAD_GAP;
    this.members.forEach((member, index) => {
      member.slot = index;
      member.offset = offset;
      offset += BASE_GAP + member.height * 0.5;
      // A brand new member has never been positioned. Drop it straight onto its
      // spot so it pops into the line rather than flying in from the origin.
      if (member.placed) return;
      // Placing a brand-new member: the trail point itself, never a route.
      // There is no body to route *from* yet — `placeAt` is what first gives
      // it one — and a member dropped onto the line is by construction on it.
      // {@link aimAtLine} rather than `aimAt` says that in the call rather
      // than leaning on `aimAt`'s `!placed` guard to mean it. Its return says
      // whether *routing* would apply, which is no business of placing: the
      // target it writes is somewhere to stand either way.
      this.aimAtLine(member);
      member.placeAt(
        member.target.x,
        member.target.y,
        member.target.z,
        this.player.group.rotation.y,
      );
    });
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Out of the bag, able to walk, and not the thing in the player's hands.
 *
 * "Able to walk" is {@link walksInParade}, in `state/store.ts`, and asking it
 * rather than restating it here is the point: the hotel's pet beds ask the
 * same function which of the things she owns is a companion, so the line
 * behind her and the row of beds waiting for it can no longer disagree about
 * what a companion is. They did — see that function's own doc comment for the
 * bug it cost — and a balloon (`PARADE_KINDS` includes it for the Cute-o-dex,
 * but it is *held* on a string, never walked) is the reason the two questions
 * are not the same question.
 */
function isOut(item: InventoryItem, carriedUid: string | null): boolean {
  return walksInParade(item.kind) && !item.stowed && item.uid !== carriedUid;
}

/**
 * The visible slice of the line.
 *
 * Fewer than the cap and everybody is out. More, and a window of `MAX_VISIBLE`
 * slides one place every {@link ROTATE_SECONDS} so that owning lots of things
 * means seeing lots of things, in turns, rather than seeing the same eight.
 */
function window_(ordered: readonly InventoryItem[], rotation: number): InventoryItem[] {
  if (ordered.length <= MAX_VISIBLE) return [...ordered];
  const start = ((rotation % ordered.length) + ordered.length) % ordered.length;
  const picked: InventoryItem[] = [];
  for (let step = 0; step < MAX_VISIBLE; step += 1) {
    picked.push(ordered[(start + step) % ordered.length]!);
  }
  return picked;
}

/** Catalogue ids of everything that is in the bag rather than out in the park. */
function stowedIds(state: GameState, visible: readonly InventoryItem[]): string[] {
  const outside = new Set(visible.map((item) => item.uid));
  const ids = new Set<string>();
  for (const item of state.inventory) {
    if (outside.has(item.uid)) continue;
    if (item.uid === state.carriedUid) continue;
    // A hat on your head, a flower in your hair and a keychain on your bag are
    // not in the bag. Without this the same thing is drawn twice — once where
    // it is worn, once peeking out of the backpack behind it — which is easy to
    // hit now that the drawer can put any hat on (`ui/InventoryDrawer.ts`).
    //
    // The keychain is the worst of the three to get wrong, because it hangs off
    // the bag itself: the keyring and its own copy climbing out of the mouth
    // above it would be a hand's width apart.
    if (
      item.uid === state.wornHatUid ||
      item.uid === state.wornFlowerUid ||
      item.uid === state.wornKeychainUid
    ) {
      continue;
    }
    ids.add(item.id);
  }
  return [...ids];
}
