/**
 * TEMP diagnostic: does `joinStrandedBridgeWalks`'s joining branch ever fire?
 *
 * Captures `console.warn` for the whole process — the park is built more than
 * once, and `park-harness`'s own collector only wraps one of those builds, so a
 * probe reading `park.said` sees nothing at all (measured: the control below
 * failed exactly that way first).
 *
 * The CONTROL is the `NO-ANNOUNCEMENT` row: with the announcement made
 * unconditional, every seed must produce one, so a seed that produces none
 * means the instrument, not the park, is at fault.
 */
const said: string[] = [];
const realWarn = console.warn.bind(console);
console.warn = (...parts: unknown[]): void => {
  said.push(parts.map((p) => String(p)).join(' '));
};

const { buildHeadlessPark } = await import('./park-harness.mts');

const seed = process.env.LGP_SEED ?? 'canonical';
buildHeadlessPark();
console.warn = realWarn;

const lines = said.filter((s) => s.includes('bridge walks ending on a bare foot'));
if (lines.length === 0) {
  console.log(`${seed} NO-ANNOUNCEMENT (instrument saw nothing — control fails on this row)`);
} else {
  // The park is built more than once per process; every build must agree.
  const parsed = lines.map((line) => {
    const m = /: (\d+) — (\d+) joined.*?, (\d+) with no paving.*?, (\d+) refused/.exec(line);
    return m ? `stranded=${m[1]} joined=${m[2]} noPaving=${m[3]} refusedByTrim=${m[4]}` : `UNPARSED ${line}`;
  });
  const distinct = [...new Set(parsed)];
  console.log(`${seed} ${distinct.join(' | ')} (${lines.length} builds)`);
}
