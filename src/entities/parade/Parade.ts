import { Group, Object3D, Raycaster, Vector2 } from 'three';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import type { TapPoint } from '../../core/input/PointerControls';
import type { CollisionWorld } from '../../world/Collision';
import { terrainHeight } from '../../world/terrain';
import { shopItem } from '../../world/building/shops/catalogue';
import { gameStore, type GameState, type InventoryItem } from '../../state';
import type { Player } from '../Player';
import { PlayerTrail } from './trail';
import { ParadeMember } from './ParadeMember';
import { BackpackPeek } from './BackpackPeek';

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
 * **Who is in it.** Toys and pets — see `PARADE_KINDS` in the store, which
 * also lists `'balloon'` (for the Cute-o-dex's "can this come out?" question)
 * but is overridden here, since a balloon never walks. Candy floss, ice
 * cream, hats, stickers and eggs cannot walk either, so they stay in the bag
 * where {@link BackpackPeek} gives them something to do. The thing in the
 * player's hands is never also in the parade.
 */

/** How many walk behind you at once. More than this and the park disappears. */
const MAX_VISIBLE = 8;

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

/** Collision radius for a follower. Small — they are toys. */
const MEMBER_RADIUS = 0.22;

/** Seconds of stagger per place in the line when the hop ripples down it. */
const HOP_RIPPLE = 0.075;

export class Parade implements GameSystem {
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

  /** True while every pet in the line is off screen — see {@link setPetsHidden}. */
  private petsHidden = false;
  private wasAirborne = false;
  private rotateTimer = 0;
  private rotation = 0;
  private overflow = 0;
  /** Signature of the last sync, so a store notification is usually free. */
  private signature = '';

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
   * Take the **pets** out of the line for a moment — they are asleep in bed.
   *
   * The hotel suite's nap is the one caller (`Game.tick`, off
   * `Hotel.isNapping`). Every pet the player owns has its own bed in that
   * room and trots into it when she goes to sleep, so without this her bunny
   * is asleep in a pet bed *and* still standing behind her at the bedside —
   * two of the same animal on screen at once, which is half of what Jim
   * reported on 21 Aug 2026.
   *
   * **Pets only, not the whole line**, because it is only pets that the
   * bedroom has beds for. A teddy has nowhere to have gone, so a teddy that
   * blinked out of existence for the length of a nap would be a second bug
   * rather than the fix for the first one; it simply stands there while
   * everybody sleeps, which is what a toy does. `ParadeMember.kind` is the
   * catalogue's own category, so this asks the same question `store.ts` and
   * `Hotel.ownedPetKinds` ask, rather than matching on an id prefix.
   *
   * Deliberately a flag on the member rather than a teardown: {@link update}
   * keeps running, the pets keep following the trail, and coming back is one
   * flag rather than a rebuild that could put a pet somewhere it never
   * walked. Re-asserted every frame by the caller, which is the same shape as
   * `Hud.setLookAvailable` next door to it.
   */
  setPetsHidden(hidden: boolean): void {
    if (this.petsHidden === hidden) return;
    this.petsHidden = hidden;
    for (const member of [...this.members, ...this.leaving]) {
      if (member.kind === 'pet') member.hidden = hidden;
    }
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

    this.trail.push(player.position.x, player.position.y, player.position.z);

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
      this.aimAt(member);
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
   */
  private aimAt(member: ParadeMember): void {
    const point = member.target;
    if (!this.trail.sample(member.offset, point)) {
      point.copy(this.player.position);
      return;
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
      return;
    }

    this.collision.resolve(point, MEMBER_RADIUS);
    point.y = this.groundAt(point.x, point.z, point.y);
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
      // A pet bought (or brought back out) mid-nap joins already hidden, like
      // the rest of its kind — see `setPetsHidden`.
      if (member.kind === 'pet') member.hidden = this.petsHidden;
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
      this.aimAt(member);
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
 * Balloons are excluded outright, regardless of `carriedUid`: a balloon is
 * held above the player on a string (`entities/HeldBalloon.ts`), never walked
 * behind them like a toy or a pet, however many the player owns and however
 * long ago each one stopped being the thing literally in their hands. They
 * are still marked `paradeable` in the store (`PARADE_KINDS` includes
 * `'balloon'`, for the Cute-o-dex's "can this come out with you?" question),
 * so the exclusion belongs here rather than upstream.
 */
function isOut(item: InventoryItem, carriedUid: string | null): boolean {
  return item.paradeable && item.kind !== 'balloon' && !item.stowed && item.uid !== carriedUid;
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
    // the bag itself: the charm and its own copy climbing out of the mouth
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
