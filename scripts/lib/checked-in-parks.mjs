// @ts-check
/**
 * **The checked-in parks, read and written** — `parks/<seed>.json` and
 * `parks/manifest.json` (`docs/design/PREBUILT-PARKS.md`, "Checked in"). One
 * owner for everything that touches those files' bytes: `vite build` and the
 * dev server (which serve them), Node tooling (which hydrates from them),
 * `validate:parks` and `build:parks` (which check and write them).
 *
 * Plain JavaScript, Node builtins and the format's leaf constants only, so
 * `vite.config.ts`, the `--import` hook and every script can import the one
 * definition.
 *
 * **Nothing here solves a park, and nothing here asks whether the source
 * changed.** A checked-in park is used as it is. Whether the current source
 * still accepts it is `validate:parks`' question (`scripts/lib/parkFiles.mts`).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PARK_FILE_FORMAT, PREBUILT_PARKS_MANIFEST, PREBUILT_PARKS_OUT } from '../../src/world/prebuilt/parkFileName.ts';
import { parkSourceHash } from './park-source-hash.mjs';

/**
 * What to do about a park that is missing, unreadable, or out of step with the
 * manifest — the one sentence every such error ends with.
 * @param {number | string} seed
 */
export function restoreInstruction(seed) {
  return (
    `Restore it from git (\`git checkout origin/main -- ${PREBUILT_PARKS_OUT}/\`), or — only if you really are changing ` +
    `park geometry — solve it again with \`LGP_SEEDS=${seed} pnpm run build:parks\` and commit the result.`
  );
}

/** @param {string} root */
export function parksDir(root) {
  return join(root, PREBUILT_PARKS_OUT);
}

/**
 * @param {string} root
 * @param {number} seed
 */
export function parkFilePath(root, seed) {
  return join(root, PREBUILT_PARKS_OUT, `${seed}.json`);
}

/**
 * sha256 of a park file's bytes, hex.
 * @param {string | Uint8Array} bytes
 */
export function parkFileSha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * **The manifest, or null when there is none.** A manifest that is there but
 * cannot be read — merge markers, half a file — **throws**: silently treating
 * it as "no parks" is how sixteen solves used to start on their own.
 * @param {string} root
 * @returns {import('../../src/world/prebuilt/parkFileName.ts').PrebuiltParksManifest | null}
 */
export function readParksManifest(root) {
  const path = join(root, PREBUILT_PARKS_OUT, PREBUILT_PARKS_MANIFEST);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST} cannot be read (${String(error).slice(0, 120)})` +
        `${/^(<<<<<<<|=======|>>>>>>>)/m.test(text) ? ' — it has merge markers in it' : ''}. ` +
        `Take main's parks (\`git checkout origin/main -- ${PREBUILT_PARKS_OUT}/\`), then run \`pnpm run build:parks\`, ` +
        'which keeps every park this source still accepts and re-solves only the ones it rejects.',
    );
  }
  if (typeof manifest !== 'object' || manifest === null || typeof manifest.seeds !== 'object' || manifest.seeds === null || Array.isArray(manifest.seeds)) {
    throw new Error(
      `${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST} is not a checked-in parks manifest ({ format, seeds: { "<seed>": … } }). ` +
        `Take main's parks (\`git checkout origin/main -- ${PREBUILT_PARKS_OUT}/\`).`,
    );
  }
  return manifest;
}

/**
 * Write the manifest: one seed per line, in seed order, so a re-solved or
 * re-stamped seed is a one-line diff and two branches touching different seeds
 * merge cleanly. Written whole and renamed into place.
 * @param {string} root
 * @param {import('../../src/world/prebuilt/parkFileName.ts').PrebuiltParksManifest} manifest
 */
export function writeParksManifest(root, manifest) {
  const seeds = Object.keys(manifest.seeds).sort((a, b) => Number(a) - Number(b));
  const lines = seeds.map((seed) => {
    const park = /** @type {import('../../src/world/prebuilt/parkFileName.ts').CheckedInPark} */ (manifest.seeds[seed]);
    return `    ${JSON.stringify(seed)}: ${JSON.stringify({ restart: park.restart, file: park.file, layout: park.layout, solvedUnder: park.solvedUnder })}`;
  });
  const text = `{\n  "format": ${manifest.format},\n  "seeds": {\n${lines.join(',\n')}\n  }\n}\n`;
  writeWhole(join(root, PREBUILT_PARKS_OUT, PREBUILT_PARKS_MANIFEST), text);
}

/**
 * Write a file whole and rename it into place, so nothing ever reads half of it.
 * @param {string} path
 * @param {string} text
 */
export function writeWhole(path, text) {
  mkdirSync(join(path, '..'), { recursive: true });
  const partial = `${path}.${process.pid}.partial`;
  writeFileSync(partial, text);
  renameSync(partial, path);
}

/**
 * **The bytes a park is checked in as** — content-deterministic, so solving
 * the same park again writes the same file: no build stamp, no render digest
 * (it changes on every art edit), and nothing in `acceptance` about when or
 * under what source it was solved (`solvedUnder` in the manifest is the note
 * of that). One trailing newline.
 * @param {Record<string, unknown>} park a parsed park file
 * @returns {string}
 */
export function checkedInParkText(park) {
  const { digest: _digest, ...rest } = park;
  const acceptance = /** @type {{ sourceHash?: unknown, log?: unknown } | null | undefined} */ (rest['acceptance']);
  /** @type {unknown} */
  let plain = acceptance ?? null;
  if (acceptance && typeof acceptance === 'object') {
    const { sourceHash: _sourceHash, ...kept } = acceptance;
    plain = {
      ...kept,
      ...(Array.isArray(acceptance.log)
        ? {
            log: acceptance.log.map((/** @type {Record<string, unknown>} */ entry) => {
              const { wallMs: _wallMs, ...attempt } = entry;
              return attempt;
            }),
          }
        : {}),
    };
  }
  return `${JSON.stringify({ ...rest, build: 'unstamped', acceptance: plain })}\n`;
}

/**
 * **Which park a served file is, for a saved position** (`parkStamp`,
 * `src/world/prebuilt/parkFileStore.ts`): the placement digest together with
 * the park source hash. A saved spot is only restored into the same stamp, so
 * it is never restored into a park whose code changed since — a collider can
 * move without the placement digest moving.
 * @param {string} layout
 * @param {string} sourceHash
 */
export function parkStampOf(layout, sourceHash) {
  return createHash('sha256').update(`${layout}\0${sourceHash}`).digest('hex').slice(0, 16);
}

/**
 * **The park file a client is given for `seed`**, as text: the checked-in
 * file, stamped with the bundle's `version` (the boot refuses any other) and
 * with its `digest` ({@link parkStampOf}). Throws, with what to do, when the
 * park is missing or is not the file the manifest records — a served park is
 * never a guess, and nothing is ever solved to fill the gap.
 * @param {string} root
 * @param {number} seed
 * @param {string} version
 * @param {string} [sourceHash] this tree's `parkSourceHash`, when the caller already has it
 * @returns {string}
 */
export function servedParkText(root, seed, version, sourceHash) {
  const manifest = readParksManifest(root);
  if (!manifest) {
    throw new Error(`no ${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST}: the solved parks are checked in, and this tree has none. ${restoreInstruction(seed)}`);
  }
  if (manifest.format !== PARK_FILE_FORMAT) {
    throw new Error(
      `${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST} is format ${manifest.format}, this source reads ${PARK_FILE_FORMAT}: the park file's shape ` +
        'changed, so every park must be solved again — `LGP_SOLVE_ALL=1 pnpm run build:parks -- --force`, and commit the result.',
    );
  }
  const entry = manifest.seeds[String(seed)];
  const path = parkFilePath(root, seed);
  if (!entry || !existsSync(path)) {
    throw new Error(`park ${seed} is not checked in (${!entry ? 'no manifest line' : `no ${PREBUILT_PARKS_OUT}/${seed}.json`}). ${restoreInstruction(seed)}`);
  }
  const bytes = readFileSync(path);
  const sha = parkFileSha(bytes);
  if (sha !== entry.file) {
    throw new Error(
      `${PREBUILT_PARKS_OUT}/${seed}.json is not the file ${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST} records ` +
        `(sha256 ${sha.slice(0, 12)}, manifest says ${String(entry.file).slice(0, 12)}): the two are out of step. ${restoreInstruction(seed)}`,
    );
  }
  const park = JSON.parse(bytes.toString('utf8'));
  if (park.seed !== seed || park.format !== PARK_FILE_FORMAT || park.restart !== entry.restart) {
    throw new Error(
      `${PREBUILT_PARKS_OUT}/${seed}.json says seed ${park.seed}, format ${park.format}, restart ${park.restart}; ` +
        `expected seed ${seed}, format ${PARK_FILE_FORMAT}, restart ${entry.restart}. ${restoreInstruction(seed)}`,
    );
  }
  return JSON.stringify({ ...park, build: version, digest: parkStampOf(entry.layout, sourceHash ?? parkSourceHash(root)) });
}
