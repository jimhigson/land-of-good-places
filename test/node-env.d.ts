/**
 * The Node surface the test tree actually uses: one global, and one function.
 *
 * `test/procgen/parkFacts.ts` sets `process.env.LGP_SEED` before it dynamically
 * imports the park — that variable is the only channel the seed has into
 * `parkManifest.ts`, which reads it once at module load.
 *
 * ## Why this is hand-declared rather than `@types/node`
 *
 * Pulling in `@types/node` was tried first and **actively breaks correct
 * browser code**, which is worth writing down because the failure is not
 * intuitive.
 *
 * TypeScript's `types` setting is per-*project*, not per-directory, and the
 * test project necessarily pulls in most of `src/` transitively — the tests
 * import the park. So Node's globals do not stay in `test/`; they land on every
 * browser file the tests reach. And Node does not merely *add* globals, it
 * **redeclares DOM ones with different types**. `setTimeout` is the case that
 * bit here:
 *
 * ```
 * src/minigames/spookyHouse/hotspots.ts(65,5):
 *   error TS2322: Type 'number' is not assignable to type 'Timeout'.
 * ```
 *
 * That file is already written the portable way —
 * `ReturnType<typeof window.setTimeout>`. With `@types/node` loaded, the *type*
 * resolves to Node's `Timeout` while the *call* still resolves to the DOM
 * overload returning `number`, so correct code stops compiling. Three files
 * broke this way, none of them wrong: the config was.
 *
 * "Fixing" them would have meant editing working browser code to accommodate
 * types for a runtime it never executes in, and the blast radius is every file
 * under `src/` that the tests transitively reach — today three errors, and
 * every future `setInterval` a fresh mystery in a file whose author does not
 * know this project exists.
 *
 * So: declare the single global that is genuinely used. If the test tree ever
 * needs real Node APIs (`fs`, `path`, `Buffer`), that is the moment to revisit
 * this — and the answer then is probably to stop pulling `src/` into the same
 * project, not to accept the DOM collisions.
 */
declare const process: {
  readonly env: Record<string, string | undefined>;
  /**
   * Just `write`, for an invariant that has to say how much it covered on a
   * run that *passed*. Vitest's default reporter shows `console.log` from
   * failing tests only, so a coverage note written that way is invisible in
   * exactly the case it exists for — see `everyProvenBridgeSiteKeepsItsBridge`
   * and its `[proven-site cover]` line.
   */
  readonly stderr: { write(text: string): void };
};

/**
 * `execFileSync`, for the one test that shells out.
 *
 * `test/procgen/scatterDecoupling.test.ts` runs `scripts/scatter-digest.mts` in
 * a child process, because proving the scatter is *stable* means building the
 * park twice under different inputs and diffing — two module loads of
 * `parkManifest.ts`, which reads its seed once and caches it, so they cannot
 * share a process.
 *
 * Narrow on purpose, matching the paragraph above: `encoding: 'utf8'` is
 * required rather than optional because that is what makes the return `string`
 * rather than a `Buffer`, and the sole call site passes it. A second caller
 * wanting different options gets a compile error, which is the right prompt to
 * come back and read this.
 *
 * **This is the "revisit it" case the paragraph above predicted** — a real Node
 * API rather than a global. It is hand-declared anyway because it arrived as an
 * outage: #217 added the `typecheck:test` gate and #222 added this import, each
 * green alone and red together, and the production deploy was down. The
 * question of whether `test/` should stop pulling `src/` into the same project
 * and simply load `@types/node` is filed as **#237**, to be decided deliberately
 * rather than under time pressure.
 */
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: {
      readonly encoding: 'utf8';
      readonly cwd?: string;
      readonly env?: Record<string, string | undefined>;
      readonly maxBuffer?: number;
    },
  ): string;
}

/**
 * The one bundle-time constant the tests reach transitively:
 * `core/solveCache.ts` keys its localStorage cache on the game version
 * (vite.config.ts's define). Node never has the define, so the cache module
 * guards its read and falls back — this declaration only teaches the test
 * project the name exists.
 */
declare const __APP_VERSION__: string;
