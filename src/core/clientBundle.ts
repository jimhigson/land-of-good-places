/**
 * **Is this code running as the game a child plays — the Vite bundle — rather
 * than in Node (a check, a test, `build:parks`)?**
 *
 * Jim, 24 September 2026: *"there should be no ability to build built into the
 * game as delivered — seeds not downloadable is an error."* The park's
 * searches and its backtracking driver exist only in build tooling; the
 * client reads a park's decisions from its prebuilt file
 * (`docs/design/PREBUILT-PARKS.md`).
 *
 * `vite.config.ts` defines `__LGP_CLIENT__` as `true` for every client build
 * and for the dev server, so this folds to the literal `true` and every
 * `if (!CLIENT_BUNDLE)` branch — with every search only it reaches — is
 * removed from the bundle. In Node the identifier is undeclared, so the
 * `typeof` answers `'undefined'` and this is `false`. `check:client-no-solver`
 * greps the built bundle to prove the removal actually happened.
 */
declare const __LGP_CLIENT__: boolean | undefined;

export const CLIENT_BUNDLE: boolean = typeof __LGP_CLIENT__ !== 'undefined' && __LGP_CLIENT__ === true;
