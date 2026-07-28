import type { HighlightTarget } from './highlight';

/**
 * The tap-target registry, and the SELECTION RULE's vocabulary.
 *
 * Interaction in this game used to be proximity-based: you walked up to the lift
 * and it came, you stood on the slide pad and you were off, you pressed E next
 * to the grown-up and they came down with you. That is a lovely model for a
 * keyboard and a hopeless one for a finger, which points at a *thing* rather
 * than at a place — and, the family found, it is also how a six-year-old ends up
 * on a train she did not mean to board.
 *
 * So GAME_DESIGN.md's **SELECTION RULE** (28 July 2026) puts one step in front of
 * every action. Each interactive thing declares a zone here: where it is (so a
 * tap can land on it), where a child should stand (so a walk has somewhere to
 * go), and **what you can do to it right now** ({@link InteractZone.actions}).
 * `world/Selection.ts` picks exactly one of these as *selected* — by proximity,
 * by hover or by tap — the rainbow outline draws around it, and `ui/ActionChips`
 * floats its actions over the item itself. Nothing happens until one of those
 * chips (or the key it names) is pressed.
 *
 * Zones are rebuilt on demand rather than cached, because several of them move
 * (the lift doors follow the car, the bubble is wherever the bubble is) and
 * because `actions` is evaluated live: "Get on" and "Get off" are the same
 * train, one second apart.
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
   * What a child can do to this thing **right now** — one chip each, over the
   * item itself.
   *
   * A function, and called every frame, because the interesting answers are
   * stateful: the train offers "Get on" while it is standing at your platform
   * and "Get off" while you are on it, and nothing at all while it is rolling.
   * Returning an empty list is how a zone says "not now", and a zone with no
   * actions is never selected — which is what makes the rainbow outline mean
   * exactly one thing (see `world/Selection.ts`).
   *
   * Omitted entirely by the things you use by *arriving* rather than by
   * pressing: the trampoline, the bubble, the slides, the front door. They have
   * never had a prompt and this does not give them one.
   */
  readonly actions?: () => readonly ZoneAction[];

  /**
   * How close (in XZ metres, from `standX/standZ`) counts as "standing at it",
   * for proximity selection. Defaults to {@link DEFAULT_STAND_RADIUS}.
   *
   * Set it when the system that owns the zone gates its own E key *tighter*
   * than that — the flowers pick within 1.3 m — so that a chip saying "Pick"
   * can never be showing somewhere the press would be ignored.
   */
  readonly standRadius?: number;

  /**
   * Ranking when two zones both hold the player. Higher wins outright; equal
   * ranks are settled by distance. Defaults to 0.
   *
   * This is the old "an interactable you can act on beats a sign you can read"
   * precedence, promoted out of `Game`'s wiring: signs sit at -1, everything
   * else at 0.
   */
  readonly selectRank?: number;

  /**
   * Selectable while a ride owns the character. Defaults to false.
   *
   * True for exactly one thing today — the train's own stations, so that a child
   * sitting in a carriage at a platform is offered "Get off". Everything else in
   * the park is, by definition, out of reach while you are on a ride, and a
   * rainbow flashing past the window as the train rolls by a flowerbed would be
   * noise.
   */
  readonly selectableWhileRiding?: boolean;

  /**
   * The short word the action chip shows when a zone does not spell out its own
   * actions — "Shop", "Ride", "Climb", "Play". Optional and additive, because
   * {@link defaultVerb} derives a sensible one from `id` for every zone that
   * doesn't set it.
   */
  readonly verb?: string;

  /**
   * What to draw the rainbow around, for GAME_DESIGN.md's HIGHLIGHT RULE — the
   * `Object3D` (or the one `InstancedMesh` instance) this zone stands for. See
   * `world/highlight.ts` for the helpers, `world/Highlights.ts` for the system.
   *
   * Optional, and deliberately so: **a zone that omits it is still
   * highlighted**, with a rainbow ring sized from its own `pickRadius`. Naming
   * an object upgrades that ring to an outline of the real silhouette.
   */
  readonly highlight?: HighlightTarget;
}

/**
 * One thing you can do to a selected item: one chip, with one word on it.
 *
 * `label` obeys GAME_DESIGN.md's BREVITY RULE and then some — a chip wants one
 * or two words ("Get on", "Pick", "Shop!"), never a sentence.
 */
export interface ZoneAction {
  readonly id: string;
  readonly label: string;
  /** An emoji for the chip. Optional; a chip without one is just the word. */
  readonly glyph?: string;
  run(): void;
}

/** Standing this close to a zone's stand point selects it. */
export const DEFAULT_STAND_RADIUS = 3;

export function standRadiusOf(zone: InteractZone): number {
  return zone.standRadius ?? DEFAULT_STAND_RADIUS;
}

/**
 * The E key, virtually — the run body of every action whose owner already
 * listens for `interact` with a proximity check of its own.
 *
 * Most of the park works that way: `Shopping`, `TreeClimbing`, `Building`,
 * `MiniGameHost` and `Flowers` each watch the player and each act on their own
 * `justPressed('interact')`, exactly as they did when a keyboard player walked
 * up and pressed the key. A chip that fires a virtual press therefore reaches
 * them through the one path that already existed, and there is still only ever
 * one place that decides what shopping, climbing or riding *does*.
 *
 * The hook is module-level, in the idiom `train/service.ts` already uses for
 * `setTrainService`, because the zone builders that need it — a list of object
 * literals derived from `building/layout.ts`, a flower's instance row — have no
 * `InputSystem` to hand and threading one through all of them to reach a single
 * closure would be five files of plumbing for nothing.
 */
let interactPress: (() => void) | null = null;

/** Wired once, by `Game`. */
export function setInteractPress(press: (() => void) | null): void {
  interactPress = press;
}

/**
 * The one-action list for a zone whose owner already handles the E key: "what
 * pressing E here does", named.
 *
 * `id` is always `primary`, which is also what makes it the action E runs and
 * the one whose key hint the chip shows.
 */
export function pressAction(label: string, glyph?: string): readonly ZoneAction[] {
  return [
    {
      id: PRIMARY_ACTION,
      label,
      ...(glyph === undefined ? {} : { glyph }),
      run: () => interactPress?.(),
    },
  ];
}

/** The action E runs, and the one a chip shows a key hint on. */
export const PRIMARY_ACTION = 'primary';

/**
 * The migration shortcut: a zone with exactly one action, named by {@link
 * zoneVerb}, which is the virtual E press.
 *
 * Every zone the SELECTION RULE inherited was single-purpose — a shop shops, a
 * flower is picked, a tree is climbed — and each one already had a word for
 * itself in {@link DEFAULT_VERBS}. This is that word, with an exclamation mark
 * on it, wrapped as the zone's one chip. Boring on purpose: the interesting
 * zones (the train) spell their actions out by hand.
 */
export function pressZone(
  zone: Omit<InteractZone, 'actions'>,
  glyph?: string,
  label?: string,
): InteractZone {
  const full = zone as InteractZone;
  return { ...full, actions: () => pressAction(label ?? `${zoneVerb(full)}!`, glyph) };
}

/**
 * A sensible default verb for a zone that doesn't set {@link
 * InteractZone.verb} explicitly, keyed off the `id` prefixes every
 * registration site already uses. Order matters — more specific prefixes
 * (individual stalls) are checked before the generic `stall:` fallback.
 */
const DEFAULT_VERBS: readonly (readonly [prefix: string, verb: string])[] = [
  ['shop-', 'Shop'],
  ['stall:dodgems', 'Ride'],
  ['stall:spaceFerrisWheel', 'Ride'],
  // The rail racer grew up into a real coaster you ride in first person
  // (`world/coaster/`), so its chip says so.
  ['stall:railRacer', 'Ride'],
  ['stall:spookyHouse', 'Enter'],
  ['stall:', 'Play'], // waterFight, facePaint and any future stall
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
