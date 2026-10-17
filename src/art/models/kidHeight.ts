/**
 * Total height in metres, measured to the top of the hair.
 *
 * The **default** style's height. Since hair styles landed, a kid's real height
 * varies with what she is wearing — spikes reach a good 0.2 m higher than a bob
 * — so every handle carries its own measured `height` and that is what a name
 * label must use. This constant survives for callers that only need a rough
 * idea of how big a child is — and for the one that needs her **body**: the
 * collision engine's mover is a cylinder this tall (`Player`, the crowd), which
 * is what makes a canopy her head bumps under a ceiling rather than a slab her
 * head passes through.
 *
 * A leaf of its own, so the engine can ask without loading the whole kid model:
 * `kid.ts` re-exports it, and every caller that learned it there still finds it.
 */
export const KID_HEIGHT = 2.12;
