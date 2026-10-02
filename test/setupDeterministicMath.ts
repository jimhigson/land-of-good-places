// The vitest end of `src/core/deterministicMath.ts`. A setup file runs before
// the test file's own imports, so every park the suite builds uses the same
// `Math` as the park built on the CI runner and the browser.
import '../src/core/installDeterministicMath';
