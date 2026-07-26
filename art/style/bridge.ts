/**
 * The ONLY file in the art system that reaches into `src/`.
 *
 * Everything else imports from here, so relocating `art/style/` to `src/art/`
 * at integration time is a one-line change: swap `../../src/core/…` for
 * `../core/…` below and nothing else in the art system moves.
 *
 * Nothing is re-implemented here. If the world already has a colour or a
 * texture, the art system uses that exact one — a second definition of "pink
 * stone" is how a park ends up with two slightly different pinks.
 */
export { PALETTE, hexToCss, type PaletteKey } from '../../src/core/palette';
export {
  grassTexture,
  pathTexture,
  pinkStoneTexture,
  woodTexture,
  signTexture,
  nameLabelTexture,
  glowTexture,
} from '../../src/core/textures';
export { Rng, TAU, clamp, clamp01, lerp, smoothstep } from '../../src/core/mathUtils';
