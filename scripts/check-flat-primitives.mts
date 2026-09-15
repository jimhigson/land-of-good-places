/**
 * **`check:flat-primitives`** — the flat world cannot be written down again.
 *
 * Jim, 14 September 2026, after a week of these being found one at a time:
 * *"I don't know why I need to keep saying the same thing."*
 *
 * He is right, and the reason is that every one of them is the same two
 * mistakes. `RADIAL-INVENTORY.md` catalogues ~95 open sites across ~70 files,
 * and sorts into exactly:
 *
 * 1. **a `y` difference standing in for a distance** — `a.y - b.y`,
 *    `p.y - terrainHeight(p.x, p.z)`, `position.y < -2`. On this planet the
 *    radial gradient reaches **1.02 m of `y` per metre travelled outward** at
 *    157 m, so a `y` difference taken between two different columns is mostly
 *    planet, and one taken in a single column over-reads the true perpendicular
 *    distance by `1 / cos θ` — **1.43x** at the park's reach.
 * 2. **a world `+Y` axis standing in for a local up** — `new Vector3(0, 1, 0)`,
 *    `up.set(0, 1, 0)`, `rotation.x = -Math.PI / 2` on a mesh nothing leans
 *    downstream. At 157 m that axis is 45.5 degrees from the ground it claims
 *    to be perpendicular to.
 *
 * Everyone else on this rebuild is fixing instances. **This file closes the
 * category**: it fails the build when a *new* one is written, so that the
 * ninety-five already on the list are the last ninety-five anybody has to find
 * by playing the game.
 *
 * ## What it is NOT for, which decides the whole design
 *
 * It is **not** an adjudicator of the existing sites. Deciding whether
 * `check-npc-perch.mts:224` is a true positive took the seeker a day and a
 * measured control, and it is not a judgement a regex — or an AST — can make.
 * So every site that exists today is recorded in
 * `flat-primitives-baseline.mts` and the gate is purely differential:
 *
 * - a finding **not** in the baseline is new work, and goes **red**;
 * - a baseline entry with **fewer** findings than recorded is a site somebody
 *   fixed, and prints **BASELINE LOOSE** — also red, so the line gets deleted
 *   rather than left to rot into cover for a future regression.
 *
 * That is the same two-way ratchet `check:coplanar` uses, and for the same
 * reason: a baseline that only ever grows is a list of excuses.
 *
 * ## Why the AST and not a grep
 *
 * The inventory's own greps returned 92 hits for the flat-disc pattern alone,
 * of which the seeker kept a handful — `LampPosts.ts` does
 * `glowGeometry.rotateX(-Math.PI / 2)` and is **correct**, because `instanceAt`
 * leans every instance. A textual match cannot tell those apart and would drown
 * the signal in ~200 entries nobody reads.
 *
 * The AST cannot fully tell them apart either — that needs to know what happens
 * downstream — but it can do the thing text cannot: **decide that `a.y - b.y`
 * has two different objects on the two sides**, which is the difference between
 * a height difference between two columns (always wrong outdoors) and
 * `p.y - p.y` (nobody writes that). And it never matches inside a string, a
 * comment, or a docblock — this repo's docblocks quote these exact expressions
 * dozens of times to explain why they are wrong, and a grep-based version of
 * this check would have flagged its own explanation.
 *
 * ## The escape hatch, and why it is counted out loud
 *
 * `// flat-ok: <reason>` on the offending line, or the line **immediately**
 * above it, exempts it. One line, not "somewhere above" — a two-line reason
 * puts the marker out of reach and the finding stands; see {@link scan}, which
 * has the worked example. Put long prose above and the marker inline.
 * Legitimate: a minigame with its own flat scene, a chart's own tangent basis,
 * an object-local transform under an `Anchor`. The reason is mandatory and the
 * total is **printed on every run**, so the hatch cannot quietly become the
 * convention — the number going up is visible in the same place the coverage is.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { GARDEN_PLAY_RADIUS, GROUND_SPHERE_RADIUS } from '../src/core/constants.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { FLAT_PRIMITIVE_BASELINE } from './flat-primitives-baseline.mts';

const REPO = new URL('..', import.meta.url).pathname;

/**
 * The corpus. `src/` is the game; `scripts/` and `test/` are the checks, and
 * the inventory's headline is that **nobody had ever swept those** — 193 files,
 * three of which mention a sphere helper, against 129 sites in `src/`. A check
 * asserting against flat geometry is as wrong as the code and worse, because it
 * is green.
 */
const ROOTS = ['src', 'scripts', 'test'];

/**
 * **The owners of the primitives, which must be allowed to write them.**
 *
 * `geo/` *is* the sphere vocabulary: `Geo.up` returns `target.set(0, 1, 0)` at
 * the planet's centre, `Frame` keeps a `LOCAL_UP`, `Chart.basis` builds a
 * tangent basis out of literal axes. `terrain.ts` and `up.ts` are the older
 * owners of the same job. Every one of those is a *definition* of up, not an
 * assumption about it, and a check that cannot tell the difference would force
 * the vocabulary to exempt itself line by line.
 *
 * This is deliberately three paths and not a pattern. It is announced on every
 * run, and it is the first place to look if this check ever seems too quiet.
 */
const OWNERS = [
  join('src', 'world', 'geo'),
  join('src', 'world', 'terrain.ts'),
  join('src', 'world', 'up.ts'),
];

type RuleId =
  | 'HARD_UP'
  | 'Y_DIFFERENCE'
  | 'Y_OVER_GROUND'
  | 'Y_THRESHOLD'
  | 'FLAT_DISC'
  | 'AXIS_ALIGNED_BOX'
  | 'VERTICAL_RAY';

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: RuleId;
  /** The expression itself, normalised, so a key survives the line moving. */
  readonly snippet: string;
  readonly text: string;
}

/**
 * **The park's own numbers, derived — never a figure typed into a string.**
 *
 * Every one of these was originally written out by hand, and every one was
 * attributed to "the park edge" while actually being the value at the furthest
 * *furniture* (157 m), not at the walkable boundary (`GARDEN_PLAY_RADIUS`).
 * Both are real, they differ (38.0 vs 45.5 degrees), and a message that quotes
 * one while naming the other teaches the next reader something false.
 *
 * Worse, they were sized against a park that moves, and it moved: the branch
 * they were written on has `PARK_SURFACE_SCALE = 2.3355` and a 135.5 m walkable
 * boundary, while #620 restores the authored scale of 1 and a **58 m** one —
 * 38.0 degrees of lean against 15.3. A hard-coded figure would have survived
 * that resize looking perfectly plausible, which is this repo's "two
 * definitions kept in step by hand" in its cheapest form, inside the very check
 * meant to delete the category.
 *
 * So they are computed from `GROUND_SPHERE_RADIUS` and `GARDEN_PLAY_RADIUS` at
 * load. Verified across the change: the same message reads 38.0 degrees at
 * 135 m on this branch and 15.3 degrees at 58 m with #620 merged, with nothing
 * edited.
 *
 * **And the furniture reach is deliberately NOT quoted as a number.** The park's
 * furthest furniture is 157 m at scale 2.3355 and 108.6 m at scale 1, and
 * neither is an authored constant — both are *measured off a built park*, which
 * this check never builds: it is a 0.65 s static scan. A number that can only
 * be measured has no business being typed into a static scanner's message, so
 * the messages name the derived boundary and say "and more beyond it" rather
 * than inventing a second radius to go stale.
 */
const leanAt = (metres: number): number => Math.asin(Math.min(1, metres / GROUND_SPHERE_RADIUS));
const WALKABLE_LEAN = leanAt(GARDEN_PLAY_RADIUS);

const deg = (radians: number): string => `${((radians * 180) / Math.PI).toFixed(1)} degrees`;

const RULE_WHY: Record<RuleId, string> = {
  HARD_UP:
    `a world +Y axis standing in for the local up (${deg(WALKABLE_LEAN)} out at the walkable ` +
    `boundary ${GARDEN_PLAY_RADIUS.toFixed(0)} m, and more on the furniture that stands outside it)`,
  Y_DIFFERENCE:
    `a y difference between two columns — mostly planet, not height (radial gradient ` +
    `${Math.tan(WALKABLE_LEAN).toFixed(2)} m/m at the walkable boundary, steeper beyond it)`,
  Y_OVER_GROUND:
    `height as y minus ground — over-reads by 1/cos(lean), ` +
    `${(1 / Math.cos(WALKABLE_LEAN)).toFixed(2)}x at the walkable boundary and more beyond; use altitude()`,
  Y_THRESHOLD:
    `a fixed y threshold — the ground is already at ${terrainHeight(GARDEN_PLAY_RADIUS, 0).toFixed(1)} m ` +
    `at the walkable boundary, so a threshold near zero fires on grass`,
  FLAT_DISC: 'a disc laid in the world XZ plane — correct only if something leans it downstream',
  AXIS_ALIGNED_BOX:
    'the vertical extreme of an AXIS-ALIGNED box round geometry that may be leaning — ' +
    'min.y is the lowest CORNER of a tilted slab, not its soffit; inflated by about ' +
    'halfDiagonal x sin(lean)',
  VERTICAL_RAY:
    'a ray fired along a hard-coded vertical through a world that leans — over a 4 m bore ' +
    'it walks 1-2 m sideways and can miss the thing it was aimed at entirely',
};

// ---------------------------------------------------------------------------
// Walking the corpus
// ---------------------------------------------------------------------------

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|mts)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
    }
  };
  for (const root of ROOTS) walk(join(REPO, root));
  return out.map((f) => relative(REPO, f)).sort();
}

function isOwner(file: string): boolean {
  return OWNERS.some((o) => file === o || file.startsWith(o + sep));
}

// ---------------------------------------------------------------------------
// The five patterns
// ---------------------------------------------------------------------------

/** A numeric literal, with an optional leading minus. `0`, `1`, `-1`. */
function numberOf(node: ts.Node): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = numberOf(node.operand);
    return inner === undefined ? undefined : -inner;
  }
  return undefined;
}

/** `(0, 1, 0)` or `(0, -1, 0)` — the vertical axis, written out by hand. */
function isVerticalTriple(args: readonly ts.Expression[]): boolean {
  if (args.length !== 3) return false;
  const [x, y, z] = args.map(numberOf);
  return x === 0 && z === 0 && (y === 1 || y === -1);
}

/** Strip any leading unary minus. `Math.PI`, `-Math.PI` and `--x` all reduce. */
function withoutSign(node: ts.Node): ts.Node {
  let n = node;
  while (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken) n = n.operand;
  return n;
}

/**
 * `Math.PI / 2` or `-Math.PI / 2`, however spaced or parenthesised.
 *
 * **The minus binds to `Math.PI`, not to the division.** `-Math.PI / 2` parses
 * as `(-Math.PI) / 2` — a division whose *left operand* is the negation — and
 * not as a negation wrapping a division. The first draft of this function
 * stripped the sign at the outer level only, so it matched every `Math.PI / 2`
 * and **no** `-Math.PI / 2`: 57 of 93 real sites, silently, including
 * `tapMarker.ts`, which `RADIAL-INVENTORY.md` ranks as the single worst defect
 * in the game. The check would have passed, and the thing it was written to
 * catch would have walked straight through it.
 *
 * It was caught by counting the same corpus with the inventory's own grep and
 * refusing to accept a smaller number without an explanation. That control is
 * {@link textualControl}, which runs on every invocation of this check, and
 * {@link selfTest} fires this exact expression as a fixture — so reintroducing
 * the bug now fails the build rather than going quiet.
 */
function isPiOverTwo(node: ts.Node): boolean {
  const n = withoutSign(node);
  if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.SlashToken) return false;
  const left = withoutSign(n.left);
  return left.getText().replace(/\s/g, '') === 'Math.PI' && numberOf(n.right) === 2;
}

/** Does this expression end in `.y`? */
function isYAccess(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) && node.name.text === 'y';
}

/** Anything that names the ground: the right-hand side of the commonest repair. */
const GROUND = /\b(terrainHeight|groundY|groundRadius|surfaceY|capHeight|\w*[Gg]round)\b/;

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * **Names that are holding a `y`, so that laundering one through a variable
 * does not hide it.**
 *
 * This was a real hole, found by this check failing to catch a bug its author
 * had just fixed by hand. `scripts/check-npc-perch.mts` contained:
 *
 * ```ts
 * const headY = rig.head.getWorldPosition(new Vector3()).y;
 * …
 * return headY - lowest;   // a floating-head test, wrong by 1/cos(lean)
 * ```
 *
 * `headY - lowest` is two plain identifiers, so the `.y` on both sides that
 * `Y_DIFFERENCE` looks for is not there — and the check sailed past the exact
 * defect it exists to find, one that was failing the whole chain at the time.
 *
 * So a single-file pass first records every `const x = <expr>.y`, and those
 * names then count as a `y` for the difference rule. Local and syntactic: it
 * does not follow a value across a function boundary, so a `y` passed as a
 * parameter is still invisible. That residue is announced on every run rather
 * than left for somebody to discover the way this one was.
 */
function namesHoldingY(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  /** Does this expression carry a `y` — directly, or through a name, or through Math.min/max? */
  const carriesY = (n: ts.Node): boolean => {
    if (isYAccess(n)) return true;
    if (ts.isIdentifier(n)) return names.has(n.text);
    // `Math.min(lowest, part.getWorldPosition(v).y)` — the real shape of the
    // running minimum that hid the bug this pass exists to catch.
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === 'min' || n.expression.name.text === 'max')
    ) {
      return n.arguments.some(carriesY);
    }
    if (ts.isParenthesizedExpression(n)) return carriesY(n.expression);
    return false;
  };

  // A fixed point, because y-ness propagates along a chain of assignments and
  // the declarations are not necessarily in dependency order.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = names.size;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (carriesY(node.initializer)) names.add(node.name.text);
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        carriesY(node.right)
      ) {
        names.add(node.left.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (names.size === before) break;
  }
  return names;
}

/**
 * Names holding a hard-coded vertical axis, so that laundering one through a
 * variable does not hide a ray fired along it.
 *
 * The same lesson as {@link namesHoldingY}, applied before it could cost
 * anything: `test/procgen/invariants.ts` does `const up = new Vector3(0, 1, 0)`
 * and then fires `raycaster.set(origin, up)` — the literal is caught by
 * `HARD_UP`, but the *ray* is the thing that decides whether the train drives
 * through its own bridge, and it deserves to be named as such.
 */
function namesHoldingVertical(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isNewExpression(init) && /Vector3$/.test(init.expression.getText(sf))) {
        if (isVerticalTriple(init.arguments ?? [])) names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function scan(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
  const lines = source.split('\n');
  const found: Finding[] = [];
  const yNames = namesHoldingY(sf);
    /** Names this file assigned a hard-coded vertical axis to. */
  const verticalNames = namesHoldingVertical(sf);
  /** A `.y` access, or a name this file assigned one to. */
  const holdsY = (n: ts.Node): boolean =>
    isYAccess(n) || (ts.isIdentifier(n) && yNames.has(n.text));
  const subjectOf = (n: ts.Node): string =>
    isYAccess(n) ? normalise(n.expression.getText(sf)) : normalise(n.getText(sf));

  const add = (node: ts.Node, rule: RuleId): void => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    // `// flat-ok:` on this line or the one **immediately** above. A reason is
    // mandatory — a bare `flat-ok` does not match, so the hatch cannot be used
    // wordlessly.
    //
    // **The footgun, which everyone who uses this hits once.** "The line above"
    // means exactly one line, so a marker separated from its code by anything —
    // most easily by writing the reason as two comment lines — is not an
    // exemption, and the finding stands with no hint as to why:
    //
    //     // flat-ok: local +Y rotated by the object's own quaternion,      <- ignored
    //     // which derives the local up rather than assuming it             <- this is "above"
    //     const up = new Vector3(0, 1, 0).applyQuaternion(q);               <- still flagged
    //
    // This is the same shape as `@ts-expect-error`, and for the same reason:
    // a directive that scanned upwards past intervening lines would silently
    // exempt code nobody meant to exempt. So put a long reason *above* as
    // ordinary prose and the marker **inline** on the code line itself, which
    // is what `parkFacts.ts`'s `heightAlongOwnUp` does.
    const here = lines[line] ?? '';
    const above = lines[line - 1] ?? '';
    if (/\/\/\s*flat-ok:\s*\S/.test(here) || /^\s*\/\/\s*flat-ok:\s*\S/.test(above)) {
      exemptions.push({ file, line: line + 1, rule });
      return;
    }
    const text = normalise(node.getText(sf));
    found.push({ file, line: line + 1, rule, snippet: text.slice(0, 90), text });
  };

  const visit = (node: ts.Node): void => {
    // 1. HARD_UP — `new Vector3(0, 1, 0)`, `up.set(0, 1, 0)`, `.setFromAxisAngle`
    if (ts.isNewExpression(node) && /Vector3$/.test(node.expression.getText(sf))) {
      if (isVerticalTriple(node.arguments ?? [])) add(node, 'HARD_UP');
    }
    // 7. VERTICAL_RAY — `new Raycaster(origin, up)`.
    if (ts.isNewExpression(node) && /Raycaster$/.test(node.expression.getText(sf))) {
      const dir = node.arguments?.[1];
      if (dir && ts.isIdentifier(dir) && verticalNames.has(dir.text)) add(node, 'VERTICAL_RAY');
    }
    // 6. AXIS_ALIGNED_BOX — `box.min.y` / `box.max.y`, the vertical extreme of
    //    an axis-aligned box round geometry that may be leaning.
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'y' &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'min' || node.expression.name.text === 'max')
    ) {
      add(node, 'AXIS_ALIGNED_BOX');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if ((method === 'set' || method === 'setFromAxisAngle') && isVerticalTriple(node.arguments.slice(0, 3))) {
        add(node, 'HARD_UP');
      }
      // 5. FLAT_DISC — `mesh.rotateX(-Math.PI / 2)`
      if (method === 'rotateX' && node.arguments.length === 1 && isPiOverTwo(node.arguments[0]!)) {
        add(node, 'FLAT_DISC');
      }
      // 7. VERTICAL_RAY — `raycaster.set(origin, up)` with a vertical direction.
      if (method === 'set' && node.arguments.length === 2) {
        const target = normalise(node.expression.expression.getText(sf));
        const dir = node.arguments[1]!;
        if (
          /ray|caster/i.test(target) &&
          ts.isIdentifier(dir) &&
          verticalNames.has(dir.text)
        ) {
          add(node, 'VERTICAL_RAY');
        }
      }
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;

      // 5. FLAT_DISC — `mesh.rotation.x = -Math.PI / 2`
      if (op === ts.SyntaxKind.EqualsToken && isPiOverTwo(node.right)) {
        const lhs = normalise(node.left.getText(sf));
        if (/\.rotation\.x$/.test(lhs)) add(node, 'FLAT_DISC');
      }

      if (op === ts.SyntaxKind.MinusToken && holdsY(node.left)) {
        const rightText = normalise(node.right.getText(sf));
        // 3. Y_OVER_GROUND — the single commonest repair in the inventory.
        if (GROUND.test(rightText)) add(node, 'Y_OVER_GROUND');
        // 2. Y_DIFFERENCE — two different columns differenced along +Y.
        else if (holdsY(node.right)) {
          if (subjectOf(node.left) !== subjectOf(node.right)) add(node, 'Y_DIFFERENCE');
        }
      }

      // 4. Y_THRESHOLD — `character.position.y < -2`, and its mirror.
      const COMPARISON = [
        ts.SyntaxKind.LessThanToken,
        ts.SyntaxKind.LessThanEqualsToken,
        ts.SyntaxKind.GreaterThanToken,
        ts.SyntaxKind.GreaterThanEqualsToken,
      ];
      if (COMPARISON.includes(op)) {
        const leftNum = numberOf(node.left);
        const rightNum = numberOf(node.right);
        // A literal on exactly one side, a `.y` on the other. `0` is exempt:
        // `if (face.y < 0)` is a facing test, and the inventory files those
        // separately as a direction question rather than an altitude one.
        if (isYAccess(node.left) && rightNum !== undefined && rightNum !== 0) add(node, 'Y_THRESHOLD');
        else if (isYAccess(node.right) && leftNum !== undefined && leftNum !== 0) add(node, 'Y_THRESHOLD');
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

// ---------------------------------------------------------------------------
// The ratchet
// ---------------------------------------------------------------------------

const exemptions: { file: string; line: number; rule: RuleId }[] = [];

function keyOf(f: Finding): string {
  return `${f.file}::${f.rule}::${f.snippet}`;
}

/**
 * **Every rule, fired deliberately, on every single run.**
 *
 * CLAUDE.md: *break every check deliberately and watch it go red before you
 * trust it green*. This is that, wired in permanently rather than performed
 * once by an agent who then left. A rule that stops matching — a renamed
 * helper, a changed AST shape, a typo — makes this fail loudly instead of
 * making the scan quietly return less.
 *
 * It costs about a millisecond and it is the difference between this file being
 * a check and being a decoration.
 */
const ARMING: readonly { rule: RuleId; source: string }[] = [
  { rule: 'HARD_UP', source: 'const up = new Vector3(0, 1, 0);' },
  { rule: 'HARD_UP', source: 'up.set(0, -1, 0);' },
  { rule: 'Y_DIFFERENCE', source: 'const h = rail.y - under.y;' },
  // The laundered form, which slipped past the first version of this rule and
  // let a real chain-failing bug through. See `namesHoldingY`.
  {
    rule: 'Y_DIFFERENCE',
    source:
      'const headY = rig.head.getWorldPosition(v).y;\n' +
      'let lowest = headY;\n' +
      'lowest = Math.min(lowest, proxy.getWorldPosition(s).y);\n' +
      'const d = headY - lowest;',
  },
  { rule: 'Y_OVER_GROUND', source: 'const h = p.y - terrainHeight(p.x, p.z);' },
  { rule: 'Y_THRESHOLD', source: 'if (character.position.y < -2) fall();' },
  { rule: 'FLAT_DISC', source: 'disc.rotation.x = -Math.PI / 2;' },
  { rule: 'FLAT_DISC', source: 'geometry.rotateX(Math.PI / 2);' },
  { rule: 'AXIS_ALIGNED_BOX', source: 'const soffit = new Box3().setFromObject(deck).min.y;' },
  {
    rule: 'VERTICAL_RAY',
    source: 'const up = new Vector3(0, 1, 0);\nraycaster.set(origin, up);',
  },
  { rule: 'VERTICAL_RAY', source: 'const up = new Vector3(0, 1, 0);\nconst r = new Raycaster(origin, up);' },
  // The hatch's own footgun, armed: a reason split over two comment lines puts
  // the marker off the line immediately above, so this is NOT exempt and the
  // rule must still fire. If this fixture ever stops firing, the hatch has
  // started reaching further up the file than anyone documented and is quietly
  // exempting code nobody marked.
  {
    rule: 'HARD_UP',
    source:
      '// flat-ok: a reason that runs on\n' +
      '// to a second comment line\n' +
      'const up = new Vector3(0, 1, 0);',
  },
];

/** Things that must NOT fire — the false positives a grep cannot dodge. */
const MUST_NOT_FIRE: readonly string[] = [
  'const z = p.y - p.y;', //                 the same column differenced with itself
  'paw.rotation.x = Math.PI / 2 - ARC;', //  a deliberately tilted part, not a flat disc
  '/** foo.rotation.x = -Math.PI / 2 */', // a docblock explaining the bug
  'if (face.y < 0) down += 1;', //           a facing test, not an altitude
  'raycaster.set(origin, tangent);', //      a ray along something derived, not a world axis
  'const lowest = box.min.x;', //            a horizontal extreme is orientation-free here
  // Both spellings that DO exempt, so the hatch cannot silently stop working —
  // a check whose escape hatch has failed shut is as broken as one that cannot
  // fail, and it fails in the direction everybody argues with.
  'const up = new Vector3(0, 1, 0); // flat-ok: inline, on the code line itself',
  '// flat-ok: one line, immediately above\nconst up = new Vector3(0, 1, 0);',
];

function selfTest(): string[] {
  const failures: string[] = [];
  for (const { rule, source } of ARMING) {
    const hit = scan('arming.ts', source).some((f) => f.rule === rule);
    if (!hit) failures.push(`rule ${rule} did not fire on its own fixture: ${source}`);
  }
  for (const source of MUST_NOT_FIRE) {
    const found = scan('arming.ts', source);
    if (found.length > 0) failures.push(`false positive on: ${source} -> ${found[0]!.rule}`);
  }
  return failures;
}

/**
 * **The control that caught the bug this check shipped with.**
 *
 * Count the flat-disc sites a second, independent way — the inventory's own
 * grep, on the same corpus — and account for every difference. The first draft
 * matched 57 of 93 because `-Math.PI / 2` parses as `(-Math.PI) / 2`, and
 * nothing else would have noticed: the scan simply returned less.
 *
 * The relationship asserted is structural rather than a remembered number, so
 * it survives people actually fixing sites: **every textual hit is either an
 * AST finding, or one of the two things text cannot judge** — a hit inside a
 * comment, or a `Math.PI / 2 - <angle>`, which is a deliberately tilted part
 * and not a flat disc at all.
 */
function textualControl(files: readonly string[]): { text: number; ast: number; excused: number } {
  const DISC = /rotation\.x = -?Math\.PI ?\/ ?2|rotateX\(-?Math\.PI ?\/ ?2\)/g;
  let text = 0;
  let ast = 0;
  let excused = 0;
  for (const file of files) {
    if (!file.startsWith('src' + sep)) continue;
    const source = readFileSync(join(REPO, file), 'utf8');
    for (const line of source.split('\n')) {
      const hits = line.match(DISC);
      if (!hits) continue;
      text += hits.length;
      // A comment line, or `Math.PI / 2 - something`: the two cases a textual
      // match gets wrong and an AST gets right.
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) excused += hits.length;
      else if (/Math\.PI ?\/ ?2 ?-/.test(line)) excused += hits.length;
    }
    ast += scan(file, source).filter((f) => f.rule === 'FLAT_DISC').length;
  }
  return { text, ast, excused };
}

function main(): number {
  const files = sourceFiles();
  const scanned = files.filter((f) => !isOwner(f));
  const findings: Finding[] = [];
  for (const file of scanned) {
    findings.push(...scan(file, readFileSync(join(REPO, file), 'utf8')));
  }

  const counts = new Map<string, number>();
  for (const f of findings) counts.set(keyOf(f), (counts.get(keyOf(f)) ?? 0) + 1);

  if (process.argv.includes('--print-baseline')) {
    printBaseline(findings, counts);
    return 0;
  }

  announce(files, scanned, findings);

  // Before believing a single finding, prove the instrument works. CLAUDE.md:
  // "run a control on the instrument first" — two agents got clean, decisive,
  // entirely wrong answers from flood fills measuring the wrong thing.
  const arming = selfTest();
  if (arming.length > 0) {
    for (const f of arming) console.error(`ARMING FAILURE  ${f}`);
    console.error(
      `\n${arming.length} rule(s) are disarmed. Every finding below — and every green run of this\n` +
        `check since the rule broke — is worthless. Fix the rule before reading the scan.`,
    );
    return 1;
  }

  const control = textualControl(scanned);
  process.stderr.write(
    `[flat-primitives] control: over src/, a textual sweep finds ${control.text} flat discs, ` +
      `${control.excused} of them in a comment or a \`Math.PI / 2 - angle\` tilt; ` +
      `the AST finds ${control.ast}.\n`,
  );
  if (control.ast !== control.text - control.excused) {
    console.error(
      `\nCONTROL FAILED  the AST and a plain text sweep disagree about src/.\n` +
        `  text ${control.text} - excused ${control.excused} = ${control.text - control.excused}, but the AST found ${control.ast}.\n` +
        `  The two counted the same files, so one of them is broken. This is exactly how this\n` +
        `  check shipped its first bug: \`-Math.PI / 2\` parses as \`(-Math.PI) / 2\`, so stripping\n` +
        `  the sign at the outer level matched 57 of 93 sites and said nothing about the rest.`,
    );
    return 1;
  }

  const novel: Finding[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const key = keyOf(f);
    const allowed = FLAT_PRIMITIVE_BASELINE[key]?.count ?? 0;
    if ((counts.get(key) ?? 0) > allowed && !seen.has(key)) {
      seen.add(key);
      novel.push(f);
    }
  }

  const loose: string[] = [];
  for (const [key, entry] of Object.entries(FLAT_PRIMITIVE_BASELINE)) {
    const now = counts.get(key) ?? 0;
    if (now < entry.count) loose.push(`${key}  (baseline ${entry.count}, now ${now})`);
  }

  if (novel.length === 0 && loose.length === 0) {
    process.stderr.write('[flat-primitives] no new flat primitives, and no stale baseline entries.\n');
    return 0;
  }

  for (const f of novel) {
    const allowed = FLAT_PRIMITIVE_BASELINE[keyOf(f)]?.count ?? 0;
    console.error(
      `\nNEW FLAT PRIMITIVE  ${f.file}:${f.line}  [${f.rule}]\n` +
        `  ${f.text}\n` +
        `  why this is wrong: ${RULE_WHY[f.rule]}\n` +
        `  baseline allows ${allowed} of this expression in this file; found ${counts.get(keyOf(f))}.`,
    );
  }
  if (novel.length > 0) {
    console.error(
      `\n${novel.length} new flat primitive(s). The park is a sphere of radius ${GROUND_SPHERE_RADIUS} m; the\n` +
        `ground leans ${deg(WALKABLE_LEAN)} at the walkable boundary (${GARDEN_PLAY_RADIUS.toFixed(0)} m),\n` +
        `and further still on the furniture outside it. Use the vocabulary in src/world/geo:\n` +
        `  a height           -> altitude(geo)           (never a.y - b.y)\n` +
        `  a distance         -> geo.chordTo / arcTo     (never a y difference)\n` +
        `  an up              -> geo.up(target)          (never new Vector3(0, 1, 0))\n` +
        `  a placement        -> hang it off an Anchor   (never a computed world position)\n` +
        `If this one is genuinely flat — a minigame's own scene, an object-local transform\n` +
        `under an Anchor — mark it \`// flat-ok: <reason>\`; the total is printed every run.`,
    );
  }
  for (const key of loose) {
    console.error(`\nBASELINE LOOSE  ${key}\n  Fixed — delete this line from scripts/flat-primitives-baseline.mts.`);
  }
  return 1;
}

/**
 * **Say what is and is not covered, on every run, to stderr.**
 *
 * CLAUDE.md: a check that stops covering something must say so on every run,
 * and Vitest's default reporter shows `console.log` from *failing* tests only —
 * so a coverage note written the obvious way is invisible in exactly the case
 * it exists for. This one is a plain script rather than a test, but the note is
 * for the same reader and goes to the same place.
 *
 * The line that matters most is the last: if the corpus ever empties — a moved
 * directory, a renamed root, a glob that stops matching — this says ASSERTS
 * NOTHING instead of passing quietly, which is the failure mode that let a
 * suite drop 137 tests with nothing red to show for it.
 */
function announce(files: string[], scanned: string[], findings: Finding[]): void {
  const perRule = new Map<RuleId, number>();
  for (const f of findings) perRule.set(f.rule, (perRule.get(f.rule) ?? 0) + 1);
  const rules = (Object.keys(RULE_WHY) as RuleId[])
    .map((r) => `${r} ${perRule.get(r) ?? 0}`)
    .join(', ');
  process.stderr.write(
    `[flat-primitives] ${scanned.length} files scanned of ${files.length} under ${ROOTS.join('/')}; ` +
      `${files.length - scanned.length} are the vocabulary's own owners (${OWNERS.join(', ')}) and are exempt by design.\n` +
      `[flat-primitives] findings by rule: ${rules}.\n` +
      `[flat-primitives] ${exemptions.length} site(s) carry an explicit // flat-ok: reason.\n` +
      `[flat-primitives] baseline records ${Object.keys(FLAT_PRIMITIVE_BASELINE).length} known expression(s).\n`,
  );
  if (scanned.length === 0 || findings.length + exemptions.length === 0) {
    process.stderr.write(
      '[flat-primitives] ASSERTS NOTHING — the corpus is empty or no pattern matched anywhere. ' +
        'That is a broken check, not a clean repo: the baseline was built from ~200 real findings.\n',
    );
  }
}

function printBaseline(findings: Finding[], counts: Map<string, number>): void {
  const keys = [...counts.keys()].sort();
  const byKey = new Map(findings.map((f) => [keyOf(f), f]));
  const body = keys
    .map((k) => {
      const f = byKey.get(k)!;
      return `  ${JSON.stringify(k)}: { count: ${counts.get(k)}, rule: '${f.rule}' },`;
    })
    .join('\n');
  const file = `/**
 * **Every flat primitive that already existed when this gate was written.**
 *
 * Generated — \`pnpm run check:flat-primitives -- --print-baseline\`. Do not
 * hand-edit to make a check pass: an entry here means "this was already flat",
 * and a finding that is not here means somebody has just written a new one.
 *
 * The key is \`file::RULE::expression\`, not a line number, so an entry survives
 * the code above it moving and dies only when the expression itself goes.
 *
 * **These are not adjudicated.** \`RADIAL-INVENTORY.md\` sorts ~95 of them into
 * true positives and ~40 into checked-and-correct, and that took a day and a
 * measured control per case. This table makes no such claim: it records what
 * was there, so that what comes next has to be better. The way an entry leaves
 * is by being fixed, at which point the check prints BASELINE LOOSE and asks
 * for the line to be deleted.
 */

export interface BaselineEntry {
  /** How many of this expression were in this file when the gate was written. */
  readonly count: number;
  /** Which of the two mistakes it is an instance of. */
  readonly rule: string;
}

export const FLAT_PRIMITIVE_BASELINE: Readonly<Record<string, BaselineEntry>> = {
${body}
};
`;
  writeFileSync(join(REPO, 'scripts', 'flat-primitives-baseline.mts'), file);
  process.stderr.write(`[flat-primitives] wrote ${keys.length} baseline entries.\n`);
}

export { scan, sourceFiles, isOwner, RULE_WHY, type Finding, type RuleId };

// Exported so the rules are importable, and guarded so the scan only runs when
// this file is the process entry point. `scripts/` is deliberately outside
// `tsconfig.test.json` (see `test/node-env.d.ts`, and #237), so the control that
// caught the sign bug lives in `selfTest`/`textualControl` above and runs on
// every invocation of the check itself — which is better than a vitest test:
// it runs in the `check` chain on every CI run, not only under `test:procgen`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
