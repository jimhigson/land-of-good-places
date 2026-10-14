/**
 * **`check:png-integrity` — every committed PNG is a whole file.**
 *
 * ```
 * pnpm run check:png-integrity
 * ```
 *
 * The Library's first render round was committed with `exterior.png` cut off
 * mid-write — 81 920 bytes, exactly 80 KiB, ending in the middle of an `IDAT`
 * chunk with no `IEND` — because the Blender run writing it was killed and the
 * commit swept up whatever was on disk. Nothing noticed: `file` and `sips` both
 * read the intact header and call it a fine 1200×900 RGB image, and a review
 * picture is not something any other check opens. The one picture of the
 * building in context could not be looked at by the reviewer, QA, or Jim.
 *
 * `library_render.py` now writes every frame through a checked part-file and an
 * atomic rename, but that guard lives inside the process that might die. This
 * is the one that can fire on a corpse already in a commit: it walks **every
 * PNG git tracks** — renders, screenshots, textures, icons — and for each one
 * asserts the signature, an `IHDR` first, every chunk's length inside the file
 * and its CRC correct, and an `IEND` as the last chunk ending exactly at the
 * end of the file. That is the PNG container's own definition of complete; it
 * says nothing about whether the picture is a good one.
 *
 * Run: `pnpm run check:png-integrity`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const REPO = new URL('..', import.meta.url).pathname;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What is wrong with the PNG in `bytes`, or `null` if it is a complete file. */
function problem(bytes: Buffer): string | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) return 'no PNG signature';
  let at = 8;
  let first = true;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) return `${bytes.length - at} stray byte(s) after the last chunk at ${at}`;
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    const end = at + 12 + length;
    if (end > bytes.length) {
      return `truncated: the ${type} chunk at byte ${at} needs ${end} bytes and the file has ${bytes.length}`;
    }
    if (first && type !== 'IHDR') return `the first chunk is ${type}, not IHDR`;
    first = false;
    const stored = bytes.readUInt32BE(at + 8 + length);
    const computed = crc32(bytes.subarray(at + 4, at + 8 + length)) >>> 0;
    if (stored !== computed) return `the ${type} chunk at byte ${at} fails its CRC`;
    if (type === 'IEND') {
      return end === bytes.length ? null : `${bytes.length - end} byte(s) after IEND`;
    }
    at = end;
  }
  return 'no IEND chunk — the file ends without one';
}

const files = execFileSync('git', ['ls-files', '-z', '--', '*.png'], { cwd: REPO, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const failures: string[] = [];
let bytesRead = 0;
for (const file of files) {
  const bytes = readFileSync(join(REPO, file));
  bytesRead += bytes.length;
  const why = problem(bytes);
  if (why) failures.push(`${file} (${bytes.length} bytes): ${why}`);
}

// An empty walk would "pass" by checking nothing — say how much it covered, and
// refuse to call zero files a success.
console.log(
  `\ncheck:png-integrity — ${files.length} committed PNGs, ${(bytesRead / 1024 / 1024).toFixed(1)} MB read`,
);
if (files.length === 0) failures.push('git lists no PNG at all — the walk covered nothing');
if (failures.length) {
  console.error(`\n${failures.length} broken PNG(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('Every one is a complete PNG: signature, IHDR first, every CRC good, IEND at the end.\n');
