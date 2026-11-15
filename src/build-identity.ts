/**
 * **Which build this is, at a glance** — the one owner of how the running
 * bundle names and colours itself, for the `?perf=1` box (`ui/PerfOverlay.ts`)
 * and the report it copies.
 *
 * The version is `__APP_VERSION__`, baked in by `vite.config.ts` from the commit
 * the bundle was built from — the same string `version.txt` carries and
 * `version-check.ts` compares against — and the build time is
 * `__APP_BUILT_AT__`, from the same `define` block. Nothing here restates
 * either; it only shortens and colours them.
 *
 * Why a colour: Jim, testing a freeze on an iPhone, 15 Nov 2026 — *"will I know
 * right away I have the new build? Sometimes it is slow to not use the cached
 * version."* A seven-character sha has to be read and remembered; a colour is
 * seen. So the box's background is a hue hashed from the version, at a fixed
 * saturation and lightness ({@link buildColour}): every deploy looks different
 * from the last, and white text on it is at least 4.5:1 at every hue (the
 * dimmest is yellow, hue 60, at 4.58:1).
 *
 * On a PR preview the commit is GitHub's merge of the branch into `main`
 * (`refs/pull/<n>/merge`, what `actions/checkout` builds on a `pull_request`),
 * not the branch head the preview URL is named after — the box names what was
 * actually built.
 *
 * Read inside functions, behind `typeof`: Node — every check and test that
 * imports `src/` — never has the defines.
 */

/** The running bundle's identity. */
export interface BuildIdentity {
  /** The whole version: the commit sha, or `APP_VERSION`'s override. */
  readonly sha: string;
  /** What the box shows: git's seven-character short sha. */
  readonly id: string;
  /** When the bundle was built, as an ISO string; `null` where it was not baked in. */
  readonly builtAt: string | null;
}

/** HSL saturation and lightness of every build's colour: see {@link buildColour}. */
const SATURATION_PERCENT = 70;
const LIGHTNESS_PERCENT = 28;

export function buildIdentity(): BuildIdentity {
  const sha = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';
  const builtAt = typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : null;
  return { sha, id: shortBuildId(sha), builtAt };
}

/** A full sha shortened as git shortens it; anything else (an override, `unknown-…`) kept readable. */
export function shortBuildId(version: string): string {
  return /^[0-9a-f]{40}$/i.test(version) ? version.slice(0, 7) : version.slice(0, 16);
}

/** 0–359, from FNV-1a over the whole version: neighbouring commits land far apart. */
export function buildHue(version: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < version.length; i++) {
    hash ^= version.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/**
 * The build's colour, as CSS. Saturation and lightness are fixed so only the
 * hue says which build this is, and dark enough that white text reads on
 * every one of the 360.
 */
export function buildColour(version: string): string {
  return `hsl(${buildHue(version)}, ${SATURATION_PERCENT}%, ${LIGHTNESS_PERCENT}%)`;
}
