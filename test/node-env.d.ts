/**
 * The one Node global the test tree actually uses.
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
};
