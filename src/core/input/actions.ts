/**
 * The logical action vocabulary of the game.
 *
 * Gameplay code NEVER looks at `KeyboardEvent.code` or a gamepad button index.
 * It asks the InputSystem about one of these actions. Adding a new control means
 * adding a name here plus a binding below — nothing else in the codebase changes.
 */
export type GameAction =
  | 'interact' // talk to things, ride rides, toss a coin in the fountain
  | 'jump' // hop (and later: corgi-balloon float)
  | 'fly' // jet pack: tap to take off, hold to climb, let go to come down
  | 'flyDown' // and hold this to come down briskly rather than drifting
  | 'cancel' // back out of a menu
  | 'menu' // open the pause / park menu
  | 'inventory' // open the backpack drawer
  | 'photo' // photo mode shutter
  | 'sprint' // run faster
  | 'zoomIn'
  | 'zoomOut'
  | 'debug'; // toggle the developer overlay

export const GAME_ACTIONS: readonly GameAction[] = [
  'interact',
  'jump',
  'fly',
  'flyDown',
  'cancel',
  'menu',
  'inventory',
  'photo',
  'sprint',
  'zoomIn',
  'zoomOut',
  'debug',
];

/**
 * Keyboard bindings, keyed by `KeyboardEvent.code` (layout independent, so WASD
 * still sits under the same fingers on AZERTY).
 */
export const KEYBOARD_ACTION_BINDINGS: Readonly<Record<string, GameAction>> = {
  Space: 'jump',
  // Two keys for one action, because neither letter is obvious on its own and
  // a child should not have to remember which we picked: **G** for "go up" and
  // **R** for "rocket". Both are clear of the movement keys and of everything
  // already bound.
  KeyG: 'fly',
  KeyR: 'fly',
  // And down is **the key to the right of whichever one you fly with** — H sits
  // beside G, T beside R. No letter spells "descend", but a pair of adjacent
  // keys is something a hand remembers even when a word would not have been.
  KeyH: 'flyDown',
  KeyT: 'flyDown',
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
 * LB/RB (4/5) are the jet pack: **RB up, LB down**. They used to rotate the
 * camera, which no longer exists (GAME_DESIGN.md #16 — see ARCHITECTURE.md,
 * "One camera angle, forever"), and a pair of shoulder buttons is where two
 * hands already rest — holding one to climb wants a finger that is not doing
 * anything else.
 */
export const GAMEPAD_ACTION_BINDINGS: Readonly<Record<number, GameAction>> = {
  0: 'jump',
  4: 'flyDown',
  5: 'fly',
  2: 'interact',
  1: 'cancel',
  3: 'photo',
  6: 'zoomOut',
  7: 'zoomIn',
  8: 'inventory',
  9: 'menu',
  10: 'sprint',
};

/** D-pad buttons also drive the movement stick. */
export const GAMEPAD_DPAD_BINDINGS: Readonly<Record<number, readonly [number, number]>> = {
  12: [0, 1],
  13: [0, -1],
  14: [-1, 0],
  15: [1, 0],
};
