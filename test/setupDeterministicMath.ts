// The vitest end of `src/core/deterministicMath.ts`. A setup file runs before
// the test file's own imports, so every park the suite builds uses the same
// `Math` as the park built on the CI runner and the browser.
import '../src/core/installDeterministicMath';

// And the accepted restart, as `scripts/ts-extension-resolver-register.mjs`
// gives every Node script (src/world/parkRestart.ts). Imported through a
// variable so the test project's typecheck does not follow it into Node-only
// code (`test/node-env.d.ts`).
const ACCEPTED_PARK_MODULE = '../scripts/lib/acceptedPark.mts';
const { acceptedRestartSync } = (await import(/* @vite-ignore */ ACCEPTED_PARK_MODULE)) as {
  acceptedRestartSync(seed: number): number;
};
(globalThis as { __LGP_RESOLVE_RESTART__?: unknown }).__LGP_RESOLVE_RESTART__ = acceptedRestartSync;
