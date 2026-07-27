#!/usr/bin/env node
/**
 * Guards GAME_DESIGN.md's TEXT RULE: "set a minimum font size and apply it
 * throughout the whole game, with no exceptions".
 *
 * A rule that lives only in a stylesheet is a rule that comes back next month
 * as `font-size: 12px` in a new panel nobody reviewed closely. So it is
 * checked, and the check runs as the first step of `npm run build`.
 *
 * What is banned, in `src/**` (both `.css` and the CSS-in-TS blocks the
 * mini-game HUDs use):
 *
 *   1. any `font-size` in `px` — the whole UI is sized in `rem`, which is the
 *      root scale (see the header of `src/style.css`);
 *   2. any `font-size` below `1rem` — `1rem` *is* the minimum;
 *   3. any `element.style.fontSize = '…px'` in TypeScript.
 *
 * The one allowed `px` font size in the codebase is the definition itself —
 * `html { font-size: clamp(...) }` — which is recognised by the marker
 * comment below rather than by being special-cased on a line number.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** The single line that is allowed to state a font size in px. */
const DEFINITION = /^\s*font-size:\s*clamp\(/;

const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (/\.(css|ts)$/.test(full)) {
      check(full);
    }
  }
}

function check(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const where = relative(ROOT, file);
  let inComment = false;

  lines.forEach((line, index) => {
    // Cheap block-comment tracking: enough for these files, and it keeps the
    // rule's own prose ("was 34px") from failing the build that enforces it.
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes('*/')) inComment = false;
      return;
    }
    if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
      inComment = true;
      return;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;

    const at = `${where}:${index + 1}`;

    if (DEFINITION.test(line)) return;

    const px = line.match(/font-size:\s*(-?[\d.]+)px/);
    if (px) {
      failures.push(`${at}  font-size in px (${px[1]}px) — use rem, the root scale.\n    ${trimmed}`);
    }

    const rem = line.match(/font-size:\s*(-?[\d.]+)rem/);
    if (rem && Number(rem[1]) < 1) {
      failures.push(
        `${at}  font-size ${rem[1]}rem is below the minimum — use var(--lgp-text-min).\n    ${trimmed}`,
      );
    }

    const inline = line.match(/fontSize\s*=\s*['"`]([^'"`]*\d)px/);
    if (inline) {
      failures.push(`${at}  inline fontSize in px — use rem.\n    ${trimmed}`);
    }
  });
}

walk(SRC);

if (failures.length > 0) {
  console.error(
    `\nTEXT RULE (GAME_DESIGN.md): ${failures.length} problem${failures.length === 1 ? '' : 's'}.\n`,
  );
  for (const failure of failures) console.error(`  ${failure}\n`);
  console.error(
    'Every size in the UI is a multiple of the root scale — see the header of\n' +
      'src/style.css. The minimum text size is var(--lgp-text-min), which is 1rem.\n',
  );
  process.exit(1);
}

console.log('TEXT RULE: no text below the minimum size. ✓');
