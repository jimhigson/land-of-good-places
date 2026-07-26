/**
 * Fairground stalls and the mini-games behind them.
 *
 * The park side of this module is two objects:
 *
 * - {@link MiniGameStalls} — the booths in the garden. `World` builds one of
 *   these, adds its group to the scene and folds its `interactZones()` in with
 *   everything else a finger can point at.
 * - {@link MiniGameHost} — the runtime. `Game` builds one, updates it with the
 *   loop's real delta, lets it freeze the park while it is busy and gives it the
 *   last word on the frame.
 *
 * See ARCHITECTURE.md, "Appendix: adding a mini-game", for the whole recipe.
 */
export { MiniGameHost, type MiniGameHostOptions } from './MiniGameHost';
export { MiniGameStalls, STALLS, type StallInstance } from './stalls';
export { createStallProp, type StallProp } from './stallProp';
export type {
  MiniGame,
  MiniGameContext,
  MiniGameFactory,
  MiniGameFrame,
  MiniGameInput,
  MiniGameResult,
  StallDefinition,
} from './types';
