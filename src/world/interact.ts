import type { HighlightTarget } from './highlight';

/**
 * The tap-target registry.
 *
 * Interaction in this game is proximity-based: you walk up to the lift and it
 * comes, you stand on the slide pad and you are off, you press E next to the
 * grown-up and they come down with you. That is a lovely model for a keyboard
 * and a hopeless one for a finger, which points at a *thing* rather than at a
 * place.
 *
 * Rather than rewriting any of it, each interactive thing declares a small zone
 * here: where it is (so a tap can land on it), where a child should stand (so
 * tap-to-move has somewhere to walk), and whether arriving should also fire the
 * interact action. The keyboard path is untouched — a tap just arranges for the
 * same conditions the keyboard player would have created by walking over.
 *
 * Zones are rebuilt on demand rather than cached, because two of them move: the
 * lift doors follow the car, and the bubble is wherever the bubble is.
 */
export interface InteractZone {
  readonly id: string;
  /** For the HUD / debugging. Not shown anywhere yet. */
  readonly label: string;

  /** World position of the thing itself — what the tap has to land near. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How close (in XZ metres) a tapped point must land to count as this thing. */
  readonly pickRadius: number;

  /** Where the character should end up. Often, but not always, the thing itself. */
  readonly standX: number;
  readonly standZ: number;

  /**
   * Fire `interact` on arrival — the E key equivalent. False for anything that
   * triggers simply by being stood on (slides, the trampoline, the bubble).
   */
  readonly pressInteract: boolean;

  /**
   * The short word the action button shows — "Shop", "Ride", "Climb", "Play"
   * — so a child can see what a place does before doing it (see
   * `ui/ActionButton.ts`). Optional and additive: nothing that registers a
   * zone needs to set this, because {@link defaultVerb} derives a sensible
   * one from `id` for every zone that doesn't.
   */
  readonly verb?: string;

  /**
   * What to draw the rainbow around, for GAME_DESIGN.md's HIGHLIGHT RULE — the
   * `Object3D` (or the one `InstancedMesh` instance) this zone stands for. See
   * `world/highlight.ts` for the helpers, `world/Highlights.ts` for the system.
   *
   * Optional, and deliberately so: **a zone that omits it is still
   * highlighted**, with a rainbow ring sized from its own `pickRadius`. Naming
   * an object upgrades that ring to an outline of the real silhouette. So the
   * rule holds for everything registered here whether or not anybody remembered
   * it, which is the point of having built it once.
   */
  readonly highlight?: HighlightTarget;
}

/**
 * A sensible default verb for a zone that doesn't set {@link
 * InteractZone.verb} explicitly, keyed off the `id` prefixes every
 * registration site already uses. Order matters — more specific prefixes
 * (individual stalls) are checked before the generic `stall:` fallback.
 *
 * Kept as a prefix table rather than a `kind` enum on the interface so that
 * adding this stayed additive: every existing `interactZones()` call site
 * above needed zero changes to keep compiling and showing a sensible word.
 */
const DEFAULT_VERBS: readonly (readonly [prefix: string, verb: string])[] = [
  ['shop-', 'Shop'],
  ['stall:dodgems', 'Ride'],
  ['stall:spaceFerrisWheel', 'Ride'],
  ['stall:spookyHouse', 'Enter'],
  ['stall:', 'Play'], // railRacer, waterFight, facePaint and any future stall
  ['frontDoor', 'Enter'],
  ['lift-', 'Ride'],
  ['stairs-', 'Climb'],
  ['tree-', 'Climb'],
  ['flower:', 'Pick'],
  ['grownUp', 'Ask'],
  ['toilets', 'Go'],
  ['train-station-', 'Ride'],
];

export function defaultVerb(zone: InteractZone): string {
  for (const [prefix, verb] of DEFAULT_VERBS) {
    if (zone.id.startsWith(prefix)) return verb;
  }
  return 'Go';
}

/** The verb to show for this zone: its own if set, else {@link defaultVerb}. */
export function zoneVerb(zone: InteractZone): string {
  return zone.verb ?? defaultVerb(zone);
}

/** How far above or below a zone a tapped point may land and still count. */
export const ZONE_HEIGHT_TOLERANCE = 2.2;

/**
 * The zone whose centre is nearest the tapped point, or `null` if the tap landed
 * on plain ground.
 *
 * Nearest-centre rather than first-match: the lift doors and the lift car
 * overlap, and a child aiming at the middle of a thing should get that thing.
 */
export function pickInteractZone(
  zones: readonly InteractZone[],
  x: number,
  y: number,
  z: number,
): InteractZone | null {
  let best: InteractZone | null = null;
  let bestDistance = Infinity;
  for (const zone of zones) {
    if (Math.abs(y - zone.y) > ZONE_HEIGHT_TOLERANCE) continue;
    const dx = x - zone.x;
    const dz = z - zone.z;
    const distance = Math.hypot(dx, dz);
    if (distance > zone.pickRadius || distance >= bestDistance) continue;
    best = zone;
    bestDistance = distance;
  }
  return best;
}
