import { PALETTE } from '../core/palette';

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
   * These all sit near +45°, which is where the default isometric camera looks
   * from — a sign a child cannot read without rotating the view is no use.
   * Small per-anchor variation stops them looking like a row of billboards.
   */
  readonly signYaw: number;
  readonly signTitle: string;
  readonly signSubtitle: string;
  readonly glyph: string;
  readonly accent: number;
  /** A note to whoever builds this — read it before you start. */
  readonly notes: string;
}

export const ANCHORS: readonly AnchorDefinition[] = [
  {
    id: 'building',
    position: [-31, -33],
    footprint: { kind: 'rect', halfX: 15, halfZ: 11 },
    boundingRadius: 19,
    entrance: [-27, -20],
    signYaw: Math.PI * 0.29,
    signTitle: 'The Big Building',
    signSubtitle: 'lots of floors coming soon!',
    glyph: '🏬',
    accent: PALETTE.markerSky,
    notes:
      'Multi-floor building: glass lift, escalators, stairs, trampoline, bubble ' +
      'and the top of the ginormous slide. The slide should exit towards the ' +
      'ballPit anchor to the north-east. Ground level here is roughly y=0; call ' +
      'terrainHeight() for the exact value under each footing.',
  },
  {
    id: 'ballPit',
    position: [-9, -15],
    footprint: { kind: 'circle', radius: 7.5 },
    boundingRadius: 9,
    entrance: [-6, -8],
    signYaw: Math.PI * 0.21,
    signTitle: 'Ball Pit',
    signSubtitle: 'the ginormous slide lands here!',
    glyph: '🎉',
    accent: PALETTE.markerLemon,
    notes:
      'Landing pit of squishy balls at the bottom of the ginormous slide. The ' +
      'slide arrives from the building anchor to the south-west, so keep the ' +
      'north-east lip open. A grown-up can ride down with the player.',
  },
  {
    id: 'ferrisWheel',
    position: [31, -27],
    footprint: { kind: 'circle', radius: 11 },
    boundingRadius: 13,
    entrance: [26, -17],
    signYaw: Math.PI * 0.3,
    signTitle: 'Space Ferris Wheel',
    signSubtitle: 'all the way up to space!',
    glyph: '🎡',
    accent: PALETTE.markerLilac,
    notes:
      'The wheel climbs into space: park shrinks, Earth appears, stars, moon, ' +
      'planets, a waving alien and Space RiPika. It lights up at night — ' +
      'subscribe to the DayNight system for `lightsOn`.',
  },
  {
    id: 'dodgems',
    position: [33, 21],
    footprint: { kind: 'rect', halfX: 12, halfZ: 10 },
    boundingRadius: 15,
    entrance: [23, 15],
    signYaw: Math.PI * 0.2,
    signTitle: 'Dodgems',
    signSubtitle: 'bonk the wobbly tree!',
    glyph: '🚗',
    accent: PALETTE.markerPink,
    notes:
      'Arena floor plus the fake wooden tree in the middle. Bonking the tree ' +
      'wobbles it, drops apples, rains leaves and pops a surprised bird out of ' +
      'the top going "TWEET!?".',
  },
  {
    id: 'waterFight',
    position: [-31, 25],
    footprint: { kind: 'rect', halfX: 12, halfZ: 11 },
    boundingRadius: 15,
    entrance: [-22, 18],
    signYaw: Math.PI * 0.27,
    signTitle: 'Water Fight',
    signSubtitle: 'very big water guns!',
    glyph: '💦',
    accent: PALETTE.markerMint,
    notes:
      'Splash points, giggling kids who splash back, drippy soaked hair and a ' +
      'little rainbow when lots of water is in the air. Score lives in ' +
      'gameStore (splashPoints / bestSplashPoints).',
  },
];

export const ANCHORS_BY_ID: Readonly<Record<AnchorId, AnchorDefinition>> = Object.fromEntries(
  ANCHORS.map((anchor) => [anchor.id, anchor]),
) as Record<AnchorId, AnchorDefinition>;

/** Scene-graph name given to each anchor's group. */
export function anchorGroupName(id: AnchorId): string {
  return `anchor:${id}`;
}
