/**
 * The ONLY file in the art system that reaches into `src/`.
 *
 * Everything else imports from here, which is why relocating the art system
 * from `art/style/` into `src/art/style/` at integration time cost exactly the
 * three export lines below and nothing else.
 *
 * Nothing is re-implemented here. If the world already has a colour or a
 * texture, the art system uses that exact one — a second definition of "pink
 * stone" is how a park ends up with two slightly different pinks.
 */
export { PALETTE, hexToCss, type PaletteKey } from '../../core/palette';
export {
  grassTexture,
  pathTexture,
  pinkStoneTexture,
  woodTexture,
  signTexture,
  nameLabelTexture,
  glowTexture,
} from '../../core/textures';
export { Rng, TAU, clamp, clamp01, lerp, smoothstep } from '../../core/mathUtils';
