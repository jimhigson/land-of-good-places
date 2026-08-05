import { Box3, Raycaster, Sphere, Vector2, Vector3, type Ray } from 'three';
import type { FrameContext, GameSystem } from '../core/types';
import type { IsoCamera } from '../core/IsoCamera';
import type { Player } from '../entities/Player';
import { highlightKey, type HighlightTarget } from './highlight';
import {
  PRIMARY_ACTION,
  standRadiusOf,
  ZONE_HEIGHT_TOLERANCE,
  type InteractZone,
  type ZoneAction,
} from './interact';

/**
 * The SELECTION RULE, as one system (GAME_DESIGN.md, 28 July 2026).
 *
 * *"Tapping or standing close to a world item selects it, showing the outline.
 * Once selected, the possible actions show over the item itself. Press a key or
 * tap the action to do it. So, actions need two taps if distant or one if
 * already close. Otherwise it is too easy to do things by mistake."*
 *
 * Exactly one thing in the park is selected at a time, and this decides which.
 * Everything downstream reads it and nothing re-derives it: `world/Highlights.ts`
 * draws the rainbow outline around it, `ui/ActionChips.ts` floats its actions
 * over it. One pick, one meaning — **outlined = selected = actions showing**.
 *
 * ### Three ways in
 *
 * - **Proximity.** The nearest zone whose stand radius holds the player. This is
 *   the old action pill's pick, hysteresis and all, promoted: it is what makes a
 *   thing you are standing at take one tap rather than two.
 * - **Tap.** A tap that lands on a zone selects it *and does not walk* — see
 *   {@link handleTap}. Selection is free; committing is what costs a walk.
 * - **Hover.** A mouse over a zone selects it, which is also what turns the
 *   cursor into a pointer (GAME_DESIGN's HIGHLIGHT RULE asks for both, and doing
 *   it here means one decision with two effects).
 *
 * Tap and hover both set the same *sticky* selection, and that is deliberate:
 * the chips are DOM buttons floating over the canvas, so moving the mouse from
 * the item towards its chip leaves the canvas and drops the hover. If hover
 * alone held the selection, the chips would vanish exactly as you reached for
 * them. Sticky is dropped when a tap misses everything, when the zone stops
 * offering actions, or when you walk up to something else.
 *
 * ### Committing
 *
 * {@link commit} is the whole of "two taps if distant, one if close": if the
 * player is already standing at the thing, the action runs now; otherwise she
 * walks there first (the ordinary routed walk — no second movement path) and it
 * runs on arrival, re-read from the zone's live action list so that a train
 * which has pulled out in the meantime simply does nothing.
 */

/**
 * How much closer a *different* zone must be before it steals the selection —
 * the hysteresis band that stops a child standing between two stalls seeing the
 * chips flicker.
 */
const HYSTERESIS_MARGIN = 0.6;

/** Nothing further than this from the player is worth pointing at. Matches TapNavigator. */
const MAX_PICK_DISTANCE = 90;

/** A walk that has not arrived within this long has plainly gone wrong. */
const COMMIT_TIMEOUT = 12;

export interface SelectionDeps {
  /** Every interactable in the park this frame. */
  zones(): readonly InteractZone[];
  /** True while a panel, the book, the map or a sign owns the screen. Riding is NOT blocked. */
  blocked(): boolean;
  /** Walk there, routed, the way a tap on open ground would. */
  walkTo(x: number, y: number, z: number): void;
  /** True while that walk is still going. */
  walking(): boolean;
  /** "You touched it" — the HIGHLIGHT RULE's activation flash. */
  flash(zone: InteractZone): void;
}

/** A tapped chip whose thing is too far away to use from here: walk, then run. */
interface PendingCommit {
  readonly zoneId: string;
  readonly actionId: string;
  age: number;
}

export class Selection implements GameSystem {
  readonly name = 'selection';

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly scratchSphere = new Sphere();
  private readonly scratchPoint = new Vector3();
  /** World bounds per registered highlight target, for ray picking. Cached; these do not move. */
  private readonly bounds = new Map<string, Box3>();

  private hasCursor = false;
  private sticky: InteractZone | null = null;
  private proximity: InteractZone | null = null;
  private current: InteractZone | null = null;
  private currentActions: readonly ZoneAction[] = [];
  /**
   * What was selected on the last frame the park was being played.
   *
   * The press that uses something is the same press that opens the panel over
   * it, and by the time this runs that frame we are already blocked. Flashing
   * what was selected a moment ago is what lets a shop or a stall confirm the
   * press that started it.
   */
  private lastSelected: InteractZone | null = null;
  private pending: PendingCommit | null = null;

  constructor(
    private readonly player: Player,
    private readonly camera: IsoCamera,
    /**
     * The park canvas, so that pointing at something usable also turns the
     * cursor into a pointer. The rule lives in `style.css`
     * (`#game-canvas[data-hover]`); this only says when.
     */
    private readonly canvas: HTMLCanvasElement,
    private readonly deps: SelectionDeps,
  ) {}

  /** The one selected thing, or null. Read by `Highlights` and `ActionChips`. */
  get selected(): InteractZone | null {
    return this.current;
  }

  /** Its actions this frame, in chip order. Empty whenever nothing is selected. */
  get actions(): readonly ZoneAction[] {
    return this.currentActions;
  }

  /** True while the player is standing close enough to use the selection from here. */
  get inReach(): boolean {
    return this.current !== null && this.withinReach(this.current);
  }

  /**
   * Where the mouse is, in normalised device coordinates, or nothing if it has
   * left the canvas. Touch never calls this: a finger has no hover.
   */
  setCursor(ndcX: number, ndcY: number): void {
    this.ndc.set(ndcX, ndcY);
    this.hasCursor = true;
  }

  clearCursor(): void {
    this.hasCursor = false;
  }

  /**
   * A tap landed on the park. Returns true if it selected something — in which
   * case the caller must **not** walk: selecting is free, and a distant tap that
   * both selected and walked would be the accidental-boarding bug in a new hat.
   */
  handleTap(ndcX: number, ndcY: number): boolean {
    if (this.deps.blocked() || this.player.riding) return false;

    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    const zone = this.pickRay(this.raycaster.ray);

    if (!zone) {
      // A tap on open ground is also "never mind that": it puts the selection
      // away, so the chips do not hang about over something she has walked off.
      this.sticky = null;
      return false;
    }

    this.sticky = zone;
    this.pending = null;
    // On a phone there is no hover at all, so this burst is the only thing that
    // tells a child her tap landed on the thing she aimed at.
    this.deps.flash(zone);
    return true;
  }

  /**
   * Do it: now if she is standing there, after a walk if she is not.
   *
   * The walk is the ordinary routed one — the same `TapNavigator` a tap on open
   * ground uses — so it goes round the scenery and can be taken over at any
   * moment by simply walking, which silently drops the commit.
   */
  commit(action: ZoneAction): void {
    const zone = this.current;
    if (!zone) return;

    if (this.withinReach(zone)) {
      this.pending = null;
      action.run();
      this.deps.flash(zone);
      return;
    }

    this.pending = { zoneId: zone.id, actionId: action.id, age: 0 };
    this.deps.walkTo(zone.standX, zone.y, zone.standZ);
  }

  update(context: FrameContext): void {
    if (this.deps.blocked()) {
      this.pending = null;
      this.clear();
      // `lastSelected` deliberately survives: the press that used the thing is
      // the press that opened the panel over it, and `handleInteractPress` —
      // which runs after this, from `InteractRouter` — is where that press gets
      // its confirmation flash.
      return;
    }

    this.advancePending(context.dt);

    const zones = this.deps.zones();
    const hovered = this.hoverPick(zones);
    this.proximity = this.pickNearby(zones);
    this.refreshSticky(zones, hovered);

    const chosen = this.sticky ?? this.proximity;
    this.current = chosen;
    this.currentActions = chosen ? (chosen.actions?.() ?? []) : [];
    this.lastSelected = chosen;

    this.setPointerCursor(hovered !== null);
  }

  dispose(): void {
    this.setPointerCursor(false);
    this.bounds.clear();
  }

  /**
   * The E key, and the SELECTION RULE's "press the key ... to do it".
   *
   * Called by `world/InteractRouter.ts` and nowhere else, after this frame's
   * {@link update} has settled what is selected — so the action that runs is,
   * by construction, the one whose chip is on screen. That is the whole of
   * GitHub issue #122: *"E must act on exactly the item the chip shows."*
   *
   * {@link commit} does the rest of the rule — standing at it, it runs now;
   * selected from across the park, she walks there and it runs on arrival.
   *
   * ### Why this used to refuse to run an in-reach action
   *
   * It flashed and returned instead, because the system that owned the zone was
   * *also* watching this press with a proximity check of its own and had already
   * acted on it. Running it here as well would have fired twice — and on a tree
   * that meant climbing and instantly un-climbing, the double-fire hazard noted
   * on #103. Those rival readers are gone (`InputSystem.takeInteractPress` is
   * the only reader of the key now), so there is nothing left to double-fire
   * with, and the special case that worked around them goes with them.
   */
  handleInteractPress(): void {
    if (this.deps.blocked()) {
      // A panel is up. The press that opened it was aimed at whatever was
      // selected the moment before, so that is what confirms.
      if (this.lastSelected) this.deps.flash(this.lastSelected);
      this.lastSelected = null;
      return;
    }

    if (!this.current) return;
    const primary =
      this.currentActions.find((action) => action.id === PRIMARY_ACTION) ?? this.currentActions[0];
    if (primary) this.commit(primary);
  }

  // -------------------------------------------------------------- internals

  /** Runs a walked-to action once the walk lands, and gives up when it plainly has not. */
  private advancePending(dt: number): void {
    const pending = this.pending;
    if (!pending) return;

    pending.age += dt;
    if (pending.age > COMMIT_TIMEOUT) {
      this.pending = null;
      return;
    }
    // Still on her way. `walking()` goes false the moment the navigator arrives,
    // gives up, or is taken over by a hand on the controls.
    if (this.deps.walking()) return;
    this.pending = null;

    const zone = this.deps.zones().find((candidate) => candidate.id === pending.zoneId);
    if (!zone || !this.withinReach(zone)) return;

    // Re-read rather than remembered: by the time she gets there the train may
    // have pulled out, and "Get on" is then simply not on offer any more.
    const action = zone.actions?.().find((candidate) => candidate.id === pending.actionId);
    if (!action) return;
    action.run();
    this.deps.flash(zone);
  }

  /** Drops a sticky selection that has gone stale, and keeps the object identity fresh. */
  private refreshSticky(zones: readonly InteractZone[], hovered: InteractZone | null): void {
    if (hovered) this.sticky = hovered;

    const sticky = this.sticky;
    if (!sticky) return;

    // Zones are rebuilt every frame, so hold the id rather than the object.
    const live = zones.find((zone) => zone.id === sticky.id);
    if (!live || !this.selectable(live)) {
      this.sticky = null;
      return;
    }
    // Walking up to something else is a choice, and it wins over whatever was
    // tapped a moment ago.
    if (this.proximity && this.proximity.id !== live.id) {
      this.sticky = null;
      return;
    }
    this.sticky = live;
  }

  private clear(): void {
    this.sticky = null;
    this.proximity = null;
    this.current = null;
    this.currentActions = [];
    this.setPointerCursor(false);
  }

  /** Only ever written on a change: the cursor is a style recalc, every frame is not. */
  private setPointerCursor(on: boolean): void {
    const want = on ? 'true' : 'false';
    if (this.canvas.dataset.hover === want) return;
    this.canvas.dataset.hover = want;
  }

  /** A zone worth selecting: it has something you could do to it right now. */
  private selectable(zone: InteractZone): boolean {
    if (this.player.riding && !zone.selectableWhileRiding) return false;
    const actions = zone.actions?.();
    return actions !== undefined && actions.length > 0;
  }

  private withinReach(zone: InteractZone): boolean {
    const { position } = this.player;
    if (Math.abs(position.y - zone.y) > ZONE_HEIGHT_TOLERANCE) return false;
    return Math.hypot(position.x - zone.standX, position.z - zone.standZ) <= standRadiusOf(zone);
  }

  /**
   * The nearest selectable zone the player is standing at, or null.
   *
   * Higher {@link InteractZone.selectRank} wins outright — the old "an
   * interactable you can act on beats a sign you can read" precedence — and
   * equal ranks are settled by distance, with the current pick kept unless a
   * rival beats it by more than {@link HYSTERESIS_MARGIN}.
   */
  private pickNearby(zones: readonly InteractZone[]): InteractZone | null {
    const { position } = this.player;
    let best: InteractZone | null = null;
    let bestRank = -Infinity;
    let bestDistance = Infinity;
    let currentDistance = Infinity;

    for (const zone of zones) {
      if (!this.selectable(zone)) continue;
      if (Math.abs(position.y - zone.y) > ZONE_HEIGHT_TOLERANCE) continue;
      const distance = Math.hypot(position.x - zone.standX, position.z - zone.standZ);
      if (distance > standRadiusOf(zone)) continue;

      const rank = zone.selectRank ?? 0;
      if (zone.id === this.proximity?.id) currentDistance = distance;
      if (rank > bestRank || (rank === bestRank && distance < bestDistance)) {
        best = zone;
        bestRank = rank;
        bestDistance = distance;
      }
    }

    const held = this.proximity;
    if (held && currentDistance < Infinity && best) {
      const heldRank = held.selectRank ?? 0;
      if (bestRank <= heldRank && bestDistance >= currentDistance - HYSTERESIS_MARGIN) {
        return zones.find((zone) => zone.id === held.id) ?? best;
      }
    }
    return best;
  }

  /** What the mouse is over, or null when there is no mouse or it is over nothing. */
  private hoverPick(zones: readonly InteractZone[]): InteractZone | null {
    if (!this.hasCursor || this.player.riding) return null;
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    return this.pickRay(this.raycaster.ray, zones);
  }

  /**
   * The selectable zone under a ray, or null.
   *
   * Tested against the target's world bounds where one was registered — so a
   * tall shop front can be pointed at anywhere up its awning — and against the
   * zone's own `pickRadius` sphere otherwise. Nearest hit along the ray wins.
   */
  private pickRay(ray: Ray, zoneList?: readonly InteractZone[]): InteractZone | null {
    const zones = zoneList ?? this.deps.zones();
    const { position } = this.player;
    let best: InteractZone | null = null;
    let bestDistance = Infinity;

    for (const zone of zones) {
      if (!this.selectable(zone)) continue;
      const dx = zone.x - position.x;
      const dz = zone.z - position.z;
      // Cheap, and it is also what keeps the building's interior — six hundred
      // metres away in its own space — out of the park's picking.
      if (dx * dx + dz * dz > MAX_PICK_DISTANCE * MAX_PICK_DISTANCE) continue;

      const hit = this.intersect(ray, zone);
      if (hit === null || hit >= bestDistance) continue;
      best = zone;
      bestDistance = hit;
    }
    return best;
  }

  /** Distance along the ray to this zone, or null for a miss. */
  private intersect(ray: Ray, zone: InteractZone): number | null {
    const box = zone.highlight ? this.boundsFor(zone.highlight) : null;
    if (box) {
      const hit = ray.intersectBox(box, this.scratchPoint);
      return hit ? ray.origin.distanceTo(hit) : null;
    }
    this.scratchSphere.center.set(zone.x, zone.y + zone.pickRadius * 0.5, zone.z);
    this.scratchSphere.radius = zone.pickRadius;
    const hit = ray.intersectSphere(this.scratchSphere, this.scratchPoint);
    return hit ? ray.origin.distanceTo(hit) : null;
  }

  /**
   * World bounds of a registered target, cached.
   *
   * Only for targets that stand still — which is every one that names a whole
   * object. An instance moves, grows and is picked (the flowers), so those fall
   * back to their zone's sphere, which is rebuilt from live data every frame.
   */
  private boundsFor(target: HighlightTarget): Box3 | null {
    if (target.instanceId !== undefined) return null;
    const key = highlightKey(target);
    const existing = this.bounds.get(key);
    if (existing) return existing;
    const box = new Box3().setFromObject(target.object);
    if (box.isEmpty()) return null;
    this.bounds.set(key, box);
    return box;
  }
}
