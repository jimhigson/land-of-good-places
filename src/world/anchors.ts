import { PALETTE } from '../core/palette';
import { placedEntry } from './parkLayout';

/**
 * Reserved plots for the features that arrive in later build steps.
 *
 * Each entry becomes an empty `Group` in the scene named `anchor:<id>`, with a
 * marked-out ground plot and a temporary "coming soon" sign. When you build the
 * real thing, add your content to that group and set `showPlaceholder` to false
 * for the anchor (see `AnchorPlots.setPlaceholderVisible`).
 *
 * The numbers here are the single source of truth for where things go: the path
 * network routes spurs to `entrance`, and scenery scattering avoids
 * `boundingRadius` so nobody plants a tree inside the ferris wheel.
 */
export type AnchorId = 'building' | 'ballPit' | 'ferrisWheel' | 'dodgems' | 'waterFight';

export type AnchorFootprint =
  | { readonly kind: 'circle'; readonly radius: number }
  | { readonly kind: 'rect'; readonly halfX: number; readonly halfZ: number };

export interface AnchorDefinition {
  readonly id: AnchorId;
  /** Centre of the plot on the ground plane, [x, z]. */
  readonly position: readonly [number, number];
  readonly footprint: AnchorFootprint;
  /** Radius used for path routing and scenery exclusion. */
  readonly boundingRadius: number;
  /** Where the path spur arrives, [x, z]. The sign stands here. */
  readonly entrance: readonly [number, number];
  /**
   * Yaw in radians the sign faces. 0 looks down +Z.
   *
   * These all sit near +45°, which is the one fixed angle the camera ever
   * looks from (ARCHITECTURE.md, "One camera angle, forever") — a sign facing
   * any other way is one a child simply cannot read. Small per-anchor
   * variation stops them looking like a row of billboards.
   */
  readonly signYaw: number;
  readonly signTitle: string;
  readonly signSubtitle: string;
  readonly glyph: string;
  readonly accent: number;
  /** A note to whoever builds this — read it before you start. */
  readonly notes: string;
}

/**
 * Sign copy and styling per anchor — the *words* stay authored here; the
 * *positions* come from the layout solver (Decision 5: the park is generated,
 * not authored). `placed()` joins the two.
 */
interface AnchorCopy {
  readonly signYawNudge?: number;
  readonly signTitle: string;
  readonly signSubtitle: string;
  readonly glyph: string;
  readonly accent: number;
  readonly notes: string;
}

function placed(id: AnchorId, copy: AnchorCopy): AnchorDefinition {
  const p = placedEntry(id);
  return {
    id,
    position: [p.x, p.z],
    footprint: p.footprint,
    boundingRadius: p.boundingRadius,
    entrance: [p.entranceX, p.entranceZ],
    signYaw: p.signYaw + (copy.signYawNudge ?? 0),
    signTitle: copy.signTitle,
    signSubtitle: copy.signSubtitle,
    glyph: copy.glyph,
    accent: copy.accent,
    notes: copy.notes,
  };
}

export const ANCHORS: readonly AnchorDefinition[] = [
  placed('building', {
    signTitle: 'The Castle',
    signSubtitle: 'come in and look around!',
    glyph: '\u{1F3F0}',
    accent: PALETTE.markerSky,
    notes:
      'Multi-floor castle: glass lift, escalators, stairs, trampoline, bubble ' +
      'and the top of the ginormous slide. The slide exits towards the ballPit ' +
      'anchor, which the layout solver keeps within reach (see parkManifest).',
  }),
  placed('ballPit', {
    signTitle: 'Ball Pit',
    signSubtitle: 'the ginormous slide lands here!',
    glyph: '\u{1F389}',
    accent: PALETTE.markerLemon,
    notes:
      'Landing pit of squishy balls at the bottom of the ginormous slide. The ' +
      'manifest holds it within slide reach of the building whatever the seed.',
  }),
  placed('ferrisWheel', {
    signTitle: 'Space Ferris Wheel',
    signSubtitle: 'all the way up to space!',
    glyph: '\u{1F3A1}',
    accent: PALETTE.markerLilac,
    notes:
      'The wheel climbs into space: park shrinks, Earth appears, stars, moon, ' +
      'planets, a waving alien and Space RiPika. It lights up at night.',
  }),
  placed('dodgems', {
    signTitle: 'Dodgems',
    signSubtitle: 'bonk the wobbly tree!',
    glyph: '\u{1F697}',
    accent: PALETTE.markerPink,
    notes:
      'Arena floor plus the fake wooden tree in the middle. Bonking the tree ' +
      'wobbles it, drops apples, rains leaves and pops a surprised bird out.',
  }),
  placed('waterFight', {
    signTitle: 'Water Fight',
    signSubtitle: 'very big water guns!',
    glyph: '\u{1F4A6}',
    accent: PALETTE.markerMint,
    notes:
      'Splash points, giggling kids who splash back, drippy soaked hair and a ' +
      'little rainbow when lots of water is in the air.',
  }),
];

export const ANCHORS_BY_ID: Readonly<Record<AnchorId, AnchorDefinition>> = Object.fromEntries(
  ANCHORS.map((anchor) => [anchor.id, anchor]),
) as Record<AnchorId, AnchorDefinition>;

/** Scene-graph name given to each anchor's group. */
export function anchorGroupName(id: AnchorId): string {
  return `anchor:${id}`;
}
