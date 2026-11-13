/**
 * **`check:boot-chunk` — the park starts on what the park needs, and nothing
 * else.**
 *
 * On 12 Nov 2026 main went red: #739 (the den, the dragon, the cat) and #745
 * (super-speed) landed together and the one `Game` chunk, which carried every
 * interior and every mini-game, grew to 4.2 MB — past the service worker's
 * precache limit, so workbox refused the build and the deploy with it. Jim's
 * ruling: *"all interiors should be loaded on-demand on entering that room,
 * same for all sub-games etc such as the space ferris wheel"* — and **not** a
 * bigger limit (`src/boot/precacheLimit.ts`).
 *
 * This builds the real bundle (the project's own `vite.config.ts`, every
 * plugin, into a temporary directory) and asserts, on what was emitted:
 *
 * 1. **No listed lazy module is in the boot set** ({@link LAZY_MODULES}). The
 *    boot set is every chunk the page loads before the park is playable: the
 *    HTML entry, the chunks it imports statically, and the chunks of the
 *    dynamic imports the boot always makes ({@link BOOT_DYNAMIC}), closed over
 *    their static imports. A static import added anywhere on that path that
 *    reaches an interior pulls it back in, and this names the module.
 * 2. **The boot set is within budget** — every boot chunk under
 *    {@link BOOT_CHUNK_BUDGET} and the whole set under {@link BOOT_SET_BUDGET},
 *    both comfortably below the precache limit, so growth is caught as a red
 *    check on the PR that causes it rather than as a refused deploy later.
 * 3. **Every emitted chunk is precached** — under the limit and named in the
 *    generated `sw.js` — so a room loaded on demand still opens offline after
 *    the first visit, and no lazy chunk can 404 after an update (the old
 *    worker keeps serving its own precache until `UpdateGate` swaps it).
 *
 * **Controls, every run:** every {@link BOOT_DYNAMIC} facade must be found
 * (else the boot set is being measured from the wrong place), and every
 * {@link LAZY_MODULES} entry must be found in *some* emitted chunk (else the
 * list names a file that moved, and its clause asserts nothing — that is
 * printed, and fails).
 *
 * `--report` prints the twenty-five biggest modules in the boot set, which is
 * where to look next when the budget bites.
 */
import { globSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { PRECACHE_FILE_LIMIT_BYTES } from '../src/boot/precacheLimit.ts';

const root = process.cwd();

/**
 * The dynamic imports the boot always makes before she can play: the game
 * itself (`bootstrap.ts` → `main.ts` → `Game.ts`) and the park's plan and path
 * graph (`boot/parkGeneration.ts`). Everything else behind an `import()` is
 * loaded on demand, and is what the budget below is protecting.
 */
const BOOT_DYNAMIC = ['src/main.ts', 'src/Game.ts', 'src/world/parkPlan.ts', 'src/world/pathGraph.ts'];

/**
 * Modules that belong to an interior, a reader or a mini-game, and must load
 * only when she goes in. Each one is the root of something entered: the place
 * its dynamic `import()` points, or the heavy kit behind it.
 */
const LAZY_MODULES = [
  // The book reader and its pictures — on opening a book (`LazyBookReader`).
  'src/world/library/reader/BookReader.ts',
  'src/world/library/reader/pagePictures.ts',
  'src/world/library/reader/storyProps.ts',
  'src/art/assets/storyPropsGlb.ts',
  // The Reptile House's hall floor and the kits it alone is drawn from (`world/interiors.ts`).
  'src/world/reptileHouse/hall.ts',
  'src/world/reptileHouse/exhibits.ts',
  'src/world/reptileHouse/planting.ts',
  'src/world/reptileHouse/stall.ts',
  'src/world/reptileHouse/tortoiseRide.ts',
  'src/art/assets/reptileCasesGlb.ts',
  'src/art/assets/reptilePlantsGlb.ts',
  'src/art/assets/reptileNoodleGlb.ts',
  'src/art/assets/reptileStallGlb.ts',
  // The Library's reading room and secret den — the room's piece of the Library
  // kit, the den's kit, the furniture, the owl, the dragon and the cat
  // (`world/interiors.ts`'s `LIBRARY_ROOM`). The building stays in the boot.
  'src/world/library/room.ts',
  'src/world/library/roomShell.ts',
  'src/world/library/furnish.ts',
  'src/world/library/LibraryOwl.ts',
  'src/world/library/LibraryDen.ts',
  'src/world/library/LibraryCat.ts',
  'src/world/library/secretShelf.ts',
  'src/art/models/libraryRoomAssets.ts',
  'src/art/models/libraryRoomKit.ts',
  'src/art/models/libraryCreatures.ts',
  'src/art/models/libraryFaces.ts',
  'src/art/models/libraryDenAssets.ts',
  'src/art/models/libraryDenKit.ts',
  'src/art/assets/libraryRoomGlb.ts',
  'src/art/assets/libraryDenGlb.ts',
  // The Space Ferris Wheel's sky show, built on boarding (`world/ferrisWheel/show.ts`).
  'src/world/ferrisWheel/show.ts',
  'src/minigames/ferrisWheel/space.ts',
  'src/minigames/ferrisWheel/sparks.ts',
  'src/world/ferrisWheel/clouds.ts',
  // The Land Hotel's inside, and the inside half of its kit (`world/interiors.ts`).
  'src/world/hotel/interior.ts',
  'src/world/hotel/dressing.ts',
  'src/world/hotel/cinematic.ts',
  'src/art/models/hotelInsideKit.ts',
  'src/art/assets/hotelInsideGlb.ts',
  // Mini-games behind a stall's curtain (`MiniGameHost`).
  'src/minigames/dodgems/Dodgems.ts',
  'src/minigames/waterFight/WaterFight.ts',
  'src/minigames/spookyHouse/SpookyHouse.ts',
];

const MiB = 1024 * 1024;
/** No single boot chunk above this: three-fifths of the precache limit. */
const BOOT_CHUNK_BUDGET = Math.round(PRECACHE_FILE_LIMIT_BYTES * 0.6);
/** The whole boot set, every chunk together. */
const BOOT_SET_BUDGET = Math.round(5 * MiB);

interface ChunkFacts {
  readonly fileName: string;
  readonly bytes: number;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
  readonly modules: ReadonlyMap<string, number>;
}

function capture(into: Map<string, ChunkFacts>): Plugin {
  return {
    name: 'check-boot-chunk-capture',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        into.set(fileName, {
          fileName,
          bytes: Buffer.byteLength(output.code),
          imports: output.imports,
          dynamicImports: output.dynamicImports,
          isEntry: output.isEntry,
          isDynamicEntry: output.isDynamicEntry,
          modules: new Map(
            Object.entries(output.modules).map(([id, info]) => [relative(root, id), info.renderedLength]),
          ),
        });
      }
    },
  };
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;

const outDir = mkdtempSync(join(tmpdir(), 'check-boot-chunk-'));
const chunks = new Map<string, ChunkFacts>();
const failures: string[] = [];
try {
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
    plugins: [capture(chunks)],
  });

  // ---------------------------------------------------------- the boot set
  // By the chunk that *holds* the module, not the chunk it is the facade of:
  // the bundler merges a dynamic entry into a shared chunk freely, and a chunk
  // that holds one has no facade.
  const byModule = new Map<string, ChunkFacts>();
  for (const chunk of chunks.values()) for (const id of chunk.modules.keys()) byModule.set(id, chunk);
  const boot = new Set<string>();
  const queue: string[] = [];
  for (const chunk of chunks.values()) if (chunk.isEntry) queue.push(chunk.fileName);
  for (const facade of BOOT_DYNAMIC) {
    const chunk = byModule.get(facade);
    if (!chunk) failures.push(`control: no chunk holds ${facade} — the boot set is measured from the wrong place`);
    else queue.push(chunk.fileName);
  }
  if (queue.length === 0) failures.push('control: no entry chunk at all');
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (boot.has(name)) continue;
    boot.add(name);
    for (const next of chunks.get(name)?.imports ?? []) queue.push(next);
  }

  const bootModules = new Map<string, { bytes: number; chunk: string }>();
  let bootBytes = 0;
  for (const name of boot) {
    const chunk = chunks.get(name) as ChunkFacts;
    bootBytes += chunk.bytes;
    for (const [id, bytes] of chunk.modules) bootModules.set(id, { bytes, chunk: name });
  }

  // ------------------------------------------------- 1. nothing lazy at boot
  const everyModule = new Set<string>();
  for (const chunk of chunks.values()) for (const id of chunk.modules.keys()) everyModule.add(id);
  for (const lazy of LAZY_MODULES) {
    if (!everyModule.has(lazy)) {
      failures.push(`control: ${lazy} is in no chunk at all — the list names a file that moved, and this clause asserts nothing for it`);
      continue;
    }
    const where = bootModules.get(lazy);
    if (where) {
      failures.push(
        `${lazy} is in the boot set (chunk ${where.chunk}) — something on the boot path imports it statically; ` +
          'it must load only on entry, through its dynamic import()',
      );
    }
  }

  // ------------------------------------------------------------ 2. budgets
  const bootList = [...boot].map((name) => chunks.get(name) as ChunkFacts).sort((a, b) => b.bytes - a.bytes);
  for (const chunk of bootList) {
    if (chunk.bytes > BOOT_CHUNK_BUDGET) {
      failures.push(`boot chunk ${chunk.fileName} is ${kb(chunk.bytes)}, over the ${kb(BOOT_CHUNK_BUDGET)} budget`);
    }
  }
  if (bootBytes > BOOT_SET_BUDGET) {
    failures.push(`the boot set is ${kb(bootBytes)}, over the ${kb(BOOT_SET_BUDGET)} budget`);
  }

  // --------------------------- 4. every lazy chunk can be fetched again
  // A lazy chunk is retried under a fresh URL after a failed fetch
  // (`src/world/lazyChunks.ts`), which only recovers it if nothing it imports
  // can have failed too: so it may import only boot chunks, which are loaded
  // before anything is entered. A chunk shared by two lazy ones breaks that.
  for (const chunk of chunks.values()) {
    if (boot.has(chunk.fileName) || !chunk.isDynamicEntry) continue;
    for (const dep of chunk.imports) {
      if (!boot.has(dep)) {
        failures.push(
          `lazy chunk ${chunk.fileName} imports ${dep}, which is not in the boot — if ${dep} ever fails to fetch, ` +
            `${chunk.fileName} can never be loaded again that session (put what ${dep} holds in the boot)`,
        );
      }
    }
  }
  // Every `chunkPart(name, source, () => import(spec))` names, as `source`, the
  // module it imports, and the build wrote a chunk for it into the map a retry
  // reads (`lazy-chunks-<version>.json`).
  const mapFile = readdirSync(outDir).find((name) => /^lazy-chunks-.*\.json$/.test(name));
  const lazyMap: Record<string, string> = mapFile ? JSON.parse(readFileSync(join(outDir, mapFile), 'utf8')) : {};
  if (!mapFile) failures.push('control: the build wrote no lazy-chunks-<version>.json — a retry would find no chunk');
  const CALL = /chunkPart<[^>]*>\(\s*'[^']*',\s*'([^']+)',\s*\(\)\s*=>\s*import\('([^']+)'\)/g;
  let calls = 0;
  for (const file of globSync('src/**/*.ts', { cwd: root })) {
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(CALL)) {
      calls += 1;
      const [, source, spec] = match as unknown as [string, string, string];
      const imported = relative(root, resolve(dirname(join(root, file)), spec)) + '.ts';
      if (imported !== source) failures.push(`${file}: chunkPart names ${source} but imports ${imported}`);
      if (!lazyMap[source]) failures.push(`${file}: chunkPart ${source} has no chunk in the build's lazy chunk map`);
    }
  }
  if (calls === 0) failures.push('control: found no chunkPart call in src/ — the clause above asserts nothing');

  // ---------------------------------------------------- 3. all precached
  const sw = readFileSync(join(outDir, 'sw.js'), 'utf8');
  let lazyBytes = 0;
  for (const chunk of chunks.values()) {
    if (!boot.has(chunk.fileName)) lazyBytes += chunk.bytes;
    if (chunk.bytes > PRECACHE_FILE_LIMIT_BYTES) {
      failures.push(`${chunk.fileName} is ${kb(chunk.bytes)}, over the precache limit — it would not work offline`);
    }
    if (!sw.includes(`"${chunk.fileName}"`)) {
      failures.push(`${chunk.fileName} is not in sw.js's precache manifest — loaded on demand, it would 404 offline`);
    }
  }

  process.stderr.write(
    `check:boot-chunk: boot set ${boot.size} chunks, ${kb(bootBytes)} (budget ${kb(BOOT_SET_BUDGET)}); ` +
      `largest ${bootList[0]?.fileName} ${kb(bootList[0]?.bytes ?? 0)} (budget ${kb(BOOT_CHUNK_BUDGET)}); ` +
      `${chunks.size - boot.size} lazy chunks, ${kb(lazyBytes)}; ${LAZY_MODULES.length} lazy modules asserted; ` +
      `${calls} chunkPart sources matched to the build's map\n`,
  );
  for (const chunk of bootList) process.stderr.write(`  boot  ${kb(chunk.bytes).padStart(8)}  ${chunk.fileName}\n`);
  if (process.argv.includes('--report')) {
    const lazyList = [...chunks.values()].filter((c) => !boot.has(c.fileName)).sort((a, b) => b.bytes - a.bytes);
    for (const chunk of lazyList) process.stderr.write(`  lazy  ${kb(chunk.bytes).padStart(8)}  ${chunk.fileName}\n`);
    process.stderr.write('biggest modules in the boot set (rendered, before minification):\n');
    for (const [id, { bytes }] of [...bootModules].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 40)) {
      process.stderr.write(`  ${kb(bytes).padStart(8)}  ${id}\n`);
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log('check:boot-chunk: ok');
