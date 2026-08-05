/**
 * The logical action vocabulary of the game.
 *
 * Gameplay code NEVER looks at `KeyboardEvent.code` or a gamepad button index.
 * It asks the InputSystem about one of these actions. Adding a new control means
 * adding a name here plus a binding below — nothing else in the codebase changes.
 */
export type GameAction =
  | 'interact' // talk to things, ride rides, toss a coin in the fountain
  // Hop on a tap. With a jet pack worn and room to fly, held past a beat it
  // becomes the jet pack too — hold to climb, let go for gravity to take
  // over. One button, so there is nothing extra to learn: see `Player.ts`'s
  // "THE JET PACK" comment for the whole scheme.
  | 'jump'
  | 'cancel' // back out of a menu
  | 'menu' // open the pause / park menu
  | 'inventory' // open the backpack drawer
  | 'photo' // photo mode shutter
  | 'sprint' // run faster
  | 'zoomIn'
  | 'zoomOut'
  | 'debug' // toggle the developer overlay
  // The Rail Race's own two controls, added for the tap-rate rework (2 August
  // 2026). `duck` is a HELD control — hold Down to drop under a bar — and is
  // safe to bind into the general vocabulary because ArrowDown already means
  // "move backward" and movement has no effect while riding. `boost` has
  // deliberately no keyboard binding below: Space already produces `jump`,
  // and the ride reads `jump` directly for its keyboard/gamepad mash, so a
  // second action bound to the same key would just be a second name for the
  // same edge. `boost` exists purely so a left mouse click can drive the ride
  // without also making Space (bound to `jump`) fire everywhere a mouse is
  // clicked in the rest of the park — see `InputSystem`'s mouse handling.
  | 'duck'
  | 'boost';

/**
 * Every action *except* `interact` — the type `InputSystem.justPressed` takes.
 *
 * `interact` is bound, read and delivered exactly like the others; what is
 * different is that it is the only one whose meaning depends on **where the
 * player is standing**. `jump` hops wherever you are. `interact` means "use the
 * thing the chip is showing me", and only `world/Selection.ts` knows what that
 * is, so only `world/InteractRouter.ts` may read it
 * ({@link InputSystem.takeInteractPress}).
 *
 * Subtracting it here is what turns GitHub issue #122's rule — *"E must act on
 * exactly the item the chip shows"* — from a convention into a compile error.
 * Before this, twelve systems each read the interact edge and each decided from
 * its own proximity radius whether the press was theirs; a flower 1.2 m away
 * stole the press from the station chip a child was actually looking at.
 */
export type InteractFreeAction = Exclude<GameAction, 'interact'>;

export const GAME_ACTIONS: readonly GameAction[] = [
  'interact',
  'jump',
  'cancel',
  'menu',
  'inventory',
  'photo',
  'sprint',
  'zoomIn',
  'zoomOut',
  'debug',
  'duck',
  'boost',
];

/**
 * Keyboard bindings, keyed by `KeyboardEvent.code` (layout independent, so WASD
 * still sits under the same fingers on AZERTY).
 */
export const KEYBOARD_ACTION_BINDINGS: Readonly<Record<string, GameAction>> = {
  // Also the jet pack: hold it past a beat, with a pack worn and room to fly,
  // and it climbs instead of hopping. See `Player.ts`'s "THE JET PACK" comment
  // — one button now covers both, so the dedicated G/R (up) and H/T (down)
  // keys this used to need are retired along with it.
  Space: 'jump',
  Enter: 'interact',
  KeyE: 'interact',
  KeyF: 'interact',
  Escape: 'menu',
  Backspace: 'cancel',
  KeyI: 'inventory',
  KeyP: 'photo',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Equal: 'zoomIn',
  NumpadAdd: 'zoomIn',
  Minus: 'zoomOut',
  NumpadSubtract: 'zoomOut',
  F3: 'debug',
  ArrowDown: 'duck',
};

/**
 * Mouse buttons, keyed by `MouseEvent.button` (0 = left, 2 = right — 1, the
 * middle button, is left alone).
 *
 * Only the Rail Race reads either of these actions, so a stray click landing
 * on a DOM button elsewhere in the park (a paused menu, a shop panel) firing
 * `boost` or `duck` for a frame has no effect anywhere else — unlike `jump`,
 * which genuinely does something the moment she's on foot, this pair is safe
 * to wire globally exactly because nothing outside the ride is listening.
 */
export const MOUSE_ACTION_BINDINGS: Readonly<Record<number, GameAction>> = {
  0: 'boost',
  2: 'duck',
};

/** Keyboard codes that push the movement stick. */
export const KEYBOARD_MOVE_BINDINGS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * Gamepad button indices from the W3C "standard" mapping.
 * 0 A / 1 B / 2 X / 3 Y / 4 LB / 5 RB / 6 LT / 7 RT / 8 Back / 9 Start
 * 10 L3 / 11 R3 / 12 D-up / 13 D-down / 14 D-left / 15 D-right
 *
 * A (0) is `jump` — the jet pack too, held past a beat with a pack worn and
 * room to fly. LB/RB used to be a dedicated up/down pair for it; retired
 * along with the keyboard's G/R/H/T once the pack moved onto the same button
 * as the hop, so 4 and 5 are free again.
 *
 * `duck` (13, D-pad down) fixes a real bug a review caught on the Rail
 * Race's tap-rate rework (2 August 2026): every other device got an explicit
 * duck control, but a gamepad player was left with nothing bound to it at
 * all, which on Level 3 meant a guaranteed bonk on every single bar — before
 * that rework, ducking was simply "not holding A", so a gamepad control had
 * never needed its own binding. `boost` needs no entry here for the same
 * reason it needs none on keyboard: button 0 already produces `jump`, and
 * the ride reads `jump` directly as its mash signal (see `RailRace.ts`'s
 * `driveRiders`), so a second action on the same button would just be a
 * second name for the same edge. `13` is chosen to echo the keyboard exactly
 * — `ArrowDown` is already double-bound to both the movement stick and
 * `duck` (see `KEYBOARD_ACTION_BINDINGS`/`KEYBOARD_MOVE_BINDINGS`), and
 * `GAMEPAD_DPAD_BINDINGS` below already claims 13 for the movement stick
 * too; both tables are read independently in `InputSystem.update()`, so one
 * physical button can carry both meanings exactly the way one physical key
 * already does.
 */
export const GAMEPAD_ACTION_BINDINGS: Readonly<Record<number, GameAction>> = {
  0: 'jump',
  2: 'interact',
  1: 'cancel',
  3: 'photo',
  6: 'zoomOut',
  7: 'zoomIn',
  8: 'inventory',
  9: 'menu',
  10: 'sprint',
  13: 'duck',
};

/** D-pad buttons also drive the movement stick. */
export const GAMEPAD_DPAD_BINDINGS: Readonly<Record<number, readonly [number, number]>> = {
  12: [0, 1],
  13: [0, -1],
  14: [-1, 0],
  15: [1, 0],
};
