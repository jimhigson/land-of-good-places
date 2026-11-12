/**
 * **The Space Ferris Wheel's sky show** — the clouds she climbs through, space
 * itself, the four friends who come to wave and the sparks a wave earns —
 * fetched the first time she boards, not at boot (`world/interiors.ts`'s
 * `FERRIS_SHOW`). The wheel in the park, its kiosk and the gondola stay in the
 * boot: they are what the park shows from outside.
 *
 * `FerrisWheelRide.build` already made all of this fresh on every boarding and
 * threw it away on leaving; this only moves *where its code lives*, so the
 * first boarding fetches it and every later one finds it here.
 */
export { createCloudBand } from './clouds';
export {
  createAlienSaucer,
  createSpaceRipika,
  createSweetieNebula,
  createSpaceTurtles,
} from '../../minigames/ferrisWheel/friends';
export { createSpaceShow, fromAngle } from '../../minigames/ferrisWheel/space';
export { createSparks } from '../../minigames/ferrisWheel/sparks';
