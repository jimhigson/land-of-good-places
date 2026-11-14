/**
 * **Every module-scope constant that is one import edge away from a temporal
 * dead zone.**
 *
 * The bug this exists for: `railRace/hazards.ts` computed `DUCK_CLEARANCE` at
 * module scope from `RIDE_SCALE`, which it imports from `./route`; `route.ts`
 * imports `parkLayout`, which comes back round to `hazards.ts`. Inside an
 * import cycle the evaluation order is whichever module the entry point
 * reaches first, so an imported binding read at module scope may still be in
 * its temporal dead zone — `ReferenceError: Cannot access 'RIDE_SCALE' before
 * initialization`, at import time, before any check can check anything.
 *
 * This is a *static* scan, deliberately: the crash only happens on the one
 * entry order that reaches the cycle from the wrong side, so running a check
 * and seeing it pass proves nothing about the other orders. The scan asks the
 * structural question instead — is this constant initialised, at module scope,
 * from a binding imported out of a module in its own strongly-connected
 * component? Every site it lists can crash under some entry order; the ones it
 * lists are the complete set for the edges that exist today.
 *
 * Reads only the import graph and the syntax tree — it imports nothing from
 * `src/`, so it cannot itself be caught by what it is looking for.
 *
 *     pnpm exec node --no-warnings scripts/scan-cycle-tdz.mts
 *
 * Exits 0 always: it is an instrument, not a gate. `--strict` makes it exit 1
 * when it finds anything, for wiring into a chain later.
 *
 * ## Controlled, because a scan that cannot find anything reads exactly like a
 * clean repo
 *
 * Run against a throwaway copy of `src/` at the commit that added this file,
 * one mutation at a time. The first is the bug this was written for, put back
 * verbatim; the last two are the *same read of the same binding* moved somewhere
 * that does not run at import time, which it must not report.
 *
 * | control | mutation | sites |
 * |---|---|---|
 * | A | none — the copy as committed | **8** |
 * | B | `hazards.ts`: `DUCK_CLEARANCE = … * RIDE_SCALE` restored, imported from `./route` | **9**, naming `hazards.ts:186 DUCK_CLEARANCE <- RIDE_SCALE` |
 * | C | `hazards.ts`: the same expression inside `function duckClearance()` | **8** — not reported |
 * | D | `hazards.ts`: the same expression as an arrow-function initialiser | **8** — not reported |
 * | E1 | `route.ts` gains `import './track'`, pulling `track.ts` into the cycle; `RAIL_GAUGE` imports the leaf (as shipped) | **8** — not reported |
 * | E2 | the same cycle, but `RAIL_GAUGE` reads `RIDE_SCALE` back through `./route` | **9**, naming `track.ts:94 RAIL_GAUGE <- RIDE_SCALE` |
 *
 * B is the point: pointed at the defect that was repaired by hand, it finds it.
 * C and D are the point too — they are what stops B's 9 being a scan that simply
 * matches the identifier wherever it appears. It discriminates on *when the
 * expression is evaluated*, which is the only thing that decides whether a read
 * is in a dead zone.
 *
 * **E is why `track.ts` imports `./dimensions` rather than `./route`.**
 * `RAIL_GAUGE` is computed at module scope but `track.ts` is *not* in the cycle
 * today (measured: `route.ts` cannot reach `track.ts`), so it cannot fail now.
 * E1/E2 add the one import that would change that, and show the leaf version
 * staying quiet while the `./route` version reports. The hardening is therefore
 * load-bearing against a future edge rather than decoration.
 *
 * ## Two blind spots these controls caught, both real
 *
 * Both were found by a control rather than by reading the code, and each was
 * silently shrinking the strongly-connected components — the failure mode where
 * a scan returns *fewer* findings and looks like a clean repo:
 *
 * 1. **`export { X } from './y'` was not an edge.** 84 of them across `src/`.
 *    Adding them took the cycle count 3 → 4 and surfaced
 *    `artPalette.ts ART <- PALETTE`, which had never been listed.
 * 2. **A bare `import './x'` was not an edge.** It binds no names, so the
 *    original code skipped it with the type-only imports — but it still *forces
 *    evaluation*, which is the whole question here. Control E was written
 *    expecting a 9, got an 8, and that gap was this bug rather than the
 *    mutation failing to bite.
 *
 * ## Parsed with oxc
 *
 * The tree comes from `scripts/ts-ast.mts` (oxc through rolldown), since
 * TypeScript 7 has no JavaScript API. The port keeps the TypeScript-API
 * version's answers exactly, including two that follow from the shape of
 * TypeScript's tree rather than from evaluation order: an object literal's
 * `get`/`set` body is walked (TypeScript had no function node under an
 * accessor), and `import {} from './x'` binds nothing and so adds no edge,
 * like an import whose every name is `type`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { bindingText, childrenOf, lineIndex, parseTypeScript, type Node, type Program } from './ts-ast.mts';

const repoRoot = resolve(import.meta.dirname, '..');
const srcRoot = join(repoRoot, 'src');

const allFiles: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) allFiles.push(full);
  }
};
walk(srcRoot);
// The build-time solver (`procgen/`) runs in every Node check and imports the
// game's modules, so a cycle through it can crash a check exactly as one inside
// `src/` crashes the game. Scanned with `src/`.
walk(join(repoRoot, 'procgen'));

/** Resolve a specifier the way this repo writes them: relative, with `.ts`. */
const resolveSpecifier = (from: string, spec: string): string | undefined => {
  if (!spec.startsWith('.')) return undefined;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return undefined;
};

interface Parsed {
  readonly file: string;
  readonly text: string;
  readonly program: Program;
  /** target file -> local names imported from it, value imports only. */
  readonly valueImports: Map<string, Map<string, string>>;
  /** every target file, including type-only (needed for nothing but reporting). */
  readonly edges: Set<string>;
}

const parsed = new Map<string, Parsed>();
for (const file of allFiles) {
  const text = readFileSync(file, 'utf8');
  const program = parseTypeScript(file, text);
  const valueImports = new Map<string, Map<string, string>>();
  const edges = new Set<string>();
  for (const statement of program.body) {
    // `export { X } from './y'` is a value edge exactly as an import is — the
    // re-exporting module still has to be evaluated, and its own imports walked
    // first. Missing these shrank the strongly-connected components and hid
    // `railRace/track.ts`'s `RAIL_GAUGE` (84 such edges across `src/`).
    // (`export const …` is an ExportNamedDeclaration too, with a declaration
    // and no source; it is a module-scope constant, read further down.)
    if (
      statement.type === 'ExportAllDeclaration' ||
      (statement.type === 'ExportNamedDeclaration' && statement.declaration === null)
    ) {
      if (statement.exportKind === 'type') continue;
      const specifier = statement.source;
      if (specifier === null) continue;
      const target = resolveSpecifier(file, specifier.value);
      if (target === undefined) continue;
      edges.add(target);
      // The re-exported names are not read by this module, so they cannot be
      // the *subject* of a dead-zone read here; the edge is what matters.
      if (!valueImports.has(target)) valueImports.set(target, new Map());
      continue;
    }
    if (statement.type !== 'ImportDeclaration') continue;
    const target = resolveSpecifier(file, statement.source.value);
    if (target === undefined) continue;
    edges.add(target);
    // A bare `import './x'` binds no names but still **forces evaluation**, so
    // it is an evaluation-order edge and belongs in the graph. Dropping it hid
    // a cycle; found by a control that pulled `track.ts` into the cycle with
    // exactly such an import and watched the scan stay quiet. (Bare means no
    // `from`: `import {} from './x'` also has no specifiers, and is not bare.)
    if (statement.specifiers.length === 0 && !/\bfrom\s*$/.test(text.slice(statement.start, statement.source.start))) {
      if (!valueImports.has(target)) valueImports.set(target, new Map());
      continue;
    }
    if (statement.importKind === 'type') continue;
    const names = valueImports.get(target) ?? new Map<string, string>();
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier') names.set(specifier.local.name, 'default');
      else if (specifier.type === 'ImportNamespaceSpecifier') names.set(specifier.local.name, '*');
      else if (specifier.importKind !== 'type') {
        const imported = specifier.imported;
        names.set(specifier.local.name, imported.type === 'Identifier' ? imported.name : String(imported.value));
      }
    }
    if (names.size > 0) valueImports.set(target, new Map([...(valueImports.get(target) ?? []), ...names]));
  }
  parsed.set(file, { file, text, program, valueImports, edges });
}

/** Tarjan, over the value-import graph — a type-only edge is erased and cannot cycle. */
const index = new Map<string, number>();
const low = new Map<string, number>();
const onStack = new Set<string>();
const stack: string[] = [];
const components: string[][] = [];
let counter = 0;

const strongConnect = (node: string): void => {
  index.set(node, counter);
  low.set(node, counter);
  counter += 1;
  stack.push(node);
  onStack.add(node);
  for (const next of parsed.get(node)?.valueImports.keys() ?? []) {
    if (!parsed.has(next)) continue;
    if (!index.has(next)) {
      strongConnect(next);
      low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
    } else if (onStack.has(next)) {
      low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
    }
  }
  if (low.get(node) === index.get(node)) {
    const component: string[] = [];
    for (;;) {
      const popped = stack.pop();
      if (popped === undefined) break;
      onStack.delete(popped);
      component.push(popped);
      if (popped === node) break;
    }
    components.push(component);
  }
};

for (const file of parsed.keys()) if (!index.has(file)) strongConnect(file);

const componentOf = new Map<string, number>();
components.forEach((component, i) => {
  for (const file of component) componentOf.set(file, i);
});
const cyclic = new Set<number>();
components.forEach((component, i) => {
  if (component.length > 1) cyclic.add(i);
  else {
    const only = component[0];
    if (only !== undefined && parsed.get(only)?.valueImports.has(only) === true) cyclic.add(i);
  }
});

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly reads: readonly string[];
  readonly from: readonly string[];
}

const findings: Finding[] = [];

for (const { file, text, program, valueImports } of parsed.values()) {
  const component = componentOf.get(file);
  if (component === undefined || !cyclic.has(component)) continue;

  /** local name -> owning module, for modules inside this same component. */
  const risky = new Map<string, string>();
  for (const [target, names] of valueImports) {
    if (componentOf.get(target) !== component) continue;
    for (const local of names.keys()) risky.set(local, target);
  }
  if (risky.size === 0) continue;
  const lineOf = lineIndex(text);

  for (const statement of program.body) {
    // `const X = …` and `export const X = …` alike.
    const declarations =
      statement.type === 'VariableDeclaration'
        ? statement
        : statement.type === 'ExportNamedDeclaration' && statement.declaration?.type === 'VariableDeclaration'
          ? statement.declaration
          : undefined;
    if (declarations === undefined) continue;
    for (const declaration of declarations.declarations) {
      const initializer = declaration.init;
      if (initializer === null) continue;
      // A function or class *body* does not run at module scope; only the
      // expression that produces the value does. So arrow/function/class
      // initialisers are safe however much they mention a cyclic binding.
      if (
        initializer.type === 'ArrowFunctionExpression' ||
        initializer.type === 'FunctionExpression' ||
        initializer.type === 'ClassExpression'
      ) {
        continue;
      }
      const reads = new Set<string>();
      const owners = new Set<string>();
      const visit = (node: Node): void => {
        if (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'ClassExpression' ||
          node.type === 'MethodDefinition' ||
          // An object literal's method, `{ m() {} }`, name and all.
          (node.type === 'Property' && node.method)
        ) {
          return;
        }
        if (node.type === 'Property' && (node.kind === 'get' || node.kind === 'set')) {
          // TypeScript's tree had no function node under an accessor, so the
          // scan this replaced walked accessor bodies. Kept, so that nothing it
          // reported goes quiet.
          visit(node.key);
          for (const child of childrenOf(node.value)) visit(child as Node);
          return;
        }
        if (node.type === 'MemberExpression' && !node.computed) {
          // `a.b` reads `a` only.
          visit(node.object);
          return;
        }
        if (node.type === 'Identifier') {
          const owner = risky.get(node.name);
          if (owner !== undefined) {
            reads.add(node.name);
            owners.add(owner);
          }
          return;
        }
        for (const child of childrenOf(node)) visit(child as Node);
      };
      visit(initializer);
      if (reads.size === 0) continue;
      findings.push({
        file,
        line: lineOf(declaration.start) + 1,
        name: bindingText(text, declaration.id),
        reads: [...reads].sort(),
        from: [...owners].map((o) => relative(repoRoot, o)).sort(),
      });
    }
  }
}

findings.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));

const cycleSizes = [...cyclic].map((i) => components[i]?.length ?? 0).sort((a, b) => b - a);
console.log(
  `${parsed.size} modules, ${cyclic.size} value-import cycle(s) (largest ${cycleSizes[0] ?? 0} modules).`,
);
console.log(
  `${findings.length} module-scope initialiser(s) reading a binding from their own cycle:`,
);
for (const finding of findings) {
  console.log(
    `  ${relative(repoRoot, finding.file)}:${finding.line}  ${finding.name} <- ${finding.reads.join(', ')}  [${finding.from.join(', ')}]`,
  );
}
if (findings.length === 0) console.log('  (none)');

// ---------------------------------------------------------------------------
// `--check`: ratchet against the baseline, for the `check` chain.
//
// Keyed on file and constant **name**, never on line number — a line moves on
// every edit above it, and a baseline that churns is one people regenerate
// wholesale instead of reading.
//
// It ratchets **both** ways on purpose. A new site fails, obviously. A site
// that has gone also fails, demanding its baseline entry be deleted in the same
// commit — which is what makes this number able only to go down. A baseline you
// may leave stale is a baseline that grows.
// ---------------------------------------------------------------------------
if (process.argv.includes('--check')) {
  const { CYCLE_TDZ_BASELINE } = await import('./cycle-tdz-baseline.mts');
  const key = (f: Finding): string => `${relative(repoRoot, f.file)}::${f.name}`;
  const found = new Map(findings.map((f) => [key(f), f]));
  const baseline = new Set(CYCLE_TDZ_BASELINE);

  const added = [...found.keys()].filter((k) => !baseline.has(k));
  const gone = [...baseline].filter((k) => !found.has(k));

  process.stderr.write(
    `\ncheck:cycle-tdz — ${found.size} site(s) against a baseline of ${baseline.size}.\n` +
      'What this does NOT cover: a constant that is safe today only because its module sits\n' +
      'outside every cycle. That is a property of the import graph, not of the constant, and\n' +
      'one new edge changes it silently — this check will report it the day that edge lands,\n' +
      'and says nothing about it before.\n',
  );

  if (added.length === 0 && gone.length === 0) {
    console.log(
      `\ncheck:cycle-tdz ok — the same ${found.size} site(s) as the baseline, none added, none stale.`,
    );
  } else {
    console.error(`\ncheck:cycle-tdz FAILED — ${added.length + gone.length} problem(s):`);
    for (const k of added) {
      const f = found.get(k);
      console.error(
        `  - NEW module-scope read inside an import cycle: ${k} at line ${f?.line} ` +
          `reads ${f?.reads.join(', ')} from ${f?.from.join(', ')}. This is one import edge from ` +
          "`Cannot access 'X' before initialization` at import time. Move the constant to a module " +
          'that imports nothing (railRace/dimensions.ts is the worked example), or move the read ' +
          'inside a function. Do NOT add it to the baseline to make this pass',
      );
    }
    for (const k of gone) {
      console.error(
        `  - STALE baseline entry: ${k} is no longer a module-scope read inside a cycle. ` +
          'Delete it from scripts/cycle-tdz-baseline.mts in the same commit that fixed it — ' +
          'that is what stops this number drifting back up',
      );
    }
    process.exit(1);
  }
}
