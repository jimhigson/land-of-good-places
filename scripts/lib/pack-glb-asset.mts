/**
 * Shared body of `pack:<asset>`: turns a `.glb` into the base64 module the
 * game imports.
 *
 * Extracted out of `pack-kid-asset.mts` when the Rail Race cart became the
 * **second** asset through this pipeline (`ART-AGENT-NOTES.md` §6a lists hair,
 * hoods, hats, shoes and backpacks as candidates for a *third* onwards) —
 * two callers with the exact same file-writing and budget-check logic is
 * exactly the kind of copy this project's own field notes warn against
 * (§2: "never copy a number from another model file. Import it."). Each
 * asset's own script (`pack-kid-asset.mts`, `pack-cart-asset.mts`) stays
 * responsible for its own paths, constant name and doc-comment text — the
 * things that are genuinely per-asset — and calls this for the rest.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

export interface PackGlbAssetConfig {
  /** Absolute path to the source `.glb`. */
  readonly glbPath: string;
  /** Absolute path to the `.ts` module to write. */
  readonly modulePath: string;
  /** The exported constant's name, e.g. `'KID_GLB_BASE64'`. */
  readonly constantName: string;
  /**
   * The doc comment's body, one array entry per line, **without** the
   * leading ` * ` (added here) and without the trailing byte-count line
   * (also added here, since it depends on the file just read).
   */
  readonly docLines: readonly string[];
  /** Jim's ruling, 31 July 2026: ~150 KB per character for the exported asset. */
  readonly budgetBytes: number;
  /** The npm script name, for the console banner — e.g. `'pack:kid'`. */
  readonly label: string;
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

/** Reads `config.glbPath`, writes `config.modulePath`, and enforces the budget. */
export function packGlbAsset(config: PackGlbAssetConfig): void {
  const bytes = readFileSync(config.glbPath);
  const base64 = bytes.toString('base64');

  const doc = [
    '/**',
    ...config.docLines.map((line) => (line === '' ? ' *' : ` * ${line}`)),
    ' *',
    ` * ${bytes.length} bytes.`,
    ' */',
  ].join('\n');

  writeFileSync(
    config.modulePath,
    `${doc}\nexport const ${config.constantName} =\n  '${base64}';\n`,
  );

  console.log(`\n${config.label}`);
  console.log(`  ${config.glbPath}`);
  console.log(`  ${kb(bytes.length)} on disk, ${kb(gzipSync(bytes).length)} gzipped`);
  console.log(
    `  ${kb(base64.length)} as a module, ${kb(gzipSync(Buffer.from(base64)).length)} gzipped`,
  );

  if (bytes.length > config.budgetBytes) {
    console.error(
      `\n✗ ${kb(bytes.length)} is over the ${kb(config.budgetBytes)} per-asset budget.\n`,
    );
    process.exit(1);
  }
  console.log(`  within the ${kb(config.budgetBytes)} budget\n`);
}
