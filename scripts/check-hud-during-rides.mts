/**
 * **Is the menu button — and the map pill behind it — actually off the screen
 * while an attraction has her?** (issue #404)
 *
 * Jim, 30 August 2026: *"There are times when the menu button is not
 * appropriate, nor the map. The menu button should only show during normal
 * gameplay. It should hide during attractions."*
 *
 * ## What this measures, and what it deliberately does not
 *
 * It builds the **real `ui/Hud.ts`** — not a copy of its rules, not a re-stated
 * assertion about what it ought to do — under a small DOM of this file's own,
 * then asks the one question a player asks: *walking up the tree from the menu
 * button, is anything hiding it?* The answer is computed by walking the actual
 * parent chain the `Hud` built with `append`, so an implementation that hides
 * the wrong element, or hides the button but leaves the drawer's pills
 * showing, fails here — the assertion is about **where the button ended up**,
 * not about which setter was called.
 *
 * The map pill is the same question one level out. `ui/ParkMap.ts` does not
 * own a pill in the HUD's markup; it *finds* the drawer by name at boot —
 * `container.querySelector('.hud-menu-items').append(this.button)` — and so do
 * `CuteODex` and anything added there later. This check mounts a stand-in pill
 * by that exact query and asserts it is hidden too, which is the property that
 * makes a *future* pill covered without its author knowing this rule exists.
 * If somebody renames the drawer, or hides `.pill--menu` alone instead of its
 * parent, that stand-in stays visible and this goes red.
 *
 * **It does not prove `Game` calls the setter.** That wiring is one line in
 * `Game.tick`, and proving it needs a real browser with a real park in it,
 * which the `build` chain has no server to talk to. It is proved instead by
 * the recorded browser run on the PR (giant slide, helter-skelter and the
 * glass lift, boarded, at phone and desktop widths). That gap is printed on
 * every run below rather than left for somebody to discover, because a green
 * line implying cover it does not give is how the next agent inherits a false
 * belief.
 *
 * **Nor does it prove CSS.** It cannot: there is no layout engine here. That
 * is survivable only because the mechanism chosen is `style.display`, set
 * straight onto the element by `Hud` itself, exactly as the money pill and the
 * "Look" pill already hide — no stylesheet participates, so there is no rule a
 * later edit could out-specify. If the hide ever moves into a class, this
 * check stops being able to see it and must be replaced by a browser one.
 *
 * ## Proved red
 *
 * `Hud.setMenuAvailable`'s body replaced with `return;` (the shape of "a ride
 * forgot to hide it"): 3 of 6 assertions fail, naming the menu button, the
 * drawer and the stand-in map pill as visible mid-ride. Transcript on the PR
 * for #404.
 */
import { attractionOwnsTheScreen } from '../src/core/attraction.ts';

// ------------------------------------------------------------------ the DOM

/**
 * The smallest document `ui/Hud.ts` can be built against.
 *
 * Deliberately dumb: it records structure (`append` builds a real parent
 * chain) and the two things the hide actually uses (`style.display`, and the
 * `dataset` the open/closed drawer is written to). Everything else — layout,
 * cascade, events — is a no-op, and the doc comment above says so out loud.
 */
class FakeElement {
  tagName: string;
  className = '';
  id = '';
  innerHTML = '';
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  readonly classes = new Set<string>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get classList() {
    return {
      add: (name: string) => void this.classes.add(name),
      remove: (name: string) => void this.classes.delete(name),
      contains: (name: string) => this.classes.has(name),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type);
    if (existing) existing.push(handler);
    else this.listeners.set(type, [handler]);
  }

  removeEventListener(): void {}

  /**
   * A real press, through the real handler the `Hud` registered — not a poke at
   * its private state. This is what makes "a menu that was open" in the test
   * below the same menu a child would have opened.
   */
  click(): void {
    for (const handler of this.listeners.get('click') ?? []) {
      handler({ stopPropagation: () => {}, target: this });
    }
  }

  blur(): void {}

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  contains(node: FakeElement): boolean {
    for (let at: FakeElement | null = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }

  /** Only the one form `ParkMap`/`CuteODex` actually use: a single class. */
  querySelector(selector: string): FakeElement | null {
    const wanted = selector.replace(/^\./, '');
    for (const child of this.children) {
      if (child.className.split(/\s+/).includes(wanted)) return child;
      const deeper = child.querySelector(selector);
      if (deeper) return deeper;
    }
    return null;
  }
}

/**
 * The player's question, answered off the tree the `Hud` actually built: from
 * this element up to the root, is anything set to `display: none`?
 */
function hiddenByAnAncestor(element: FakeElement): boolean {
  for (let at: FakeElement | null = element; at; at = at.parentNode) {
    if (at.style['display'] === 'none') return true;
  }
  return false;
}

const documentShim = {
  createElement: (tag: string) => new FakeElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as unknown as { document: unknown }).document = documentShim;

// The `Hud` import must come *after* the shim is installed: it touches
// `document` inside its constructor, not at module scope, but a future edit
// that adds a module-scope `document.createElement` would otherwise fail
// confusingly rather than being caught here.
const { Hud } = await import('../src/ui/Hud.ts');

// ------------------------------------------------------------- the assertions

let failures = 0;
function assert(ok: boolean, what: string, detail: string): void {
  if (ok) {
    console.log(`  ok   ${what} — ${detail}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${what} — ${detail}`);
}

console.log('check:hud-during-rides — the menu button and map during attractions (#404)');

// 1. The predicate everything hangs off, both terms and both directions.
console.log('\nthe one owner (core/attraction.ts):');
for (const [riding, miniGameFrozen, expected] of [
  [false, false, false],
  [true, false, true],
  [false, true, true],
  [true, true, true],
] as const) {
  const got = attractionOwnsTheScreen({ riding, miniGameFrozen });
  assert(
    got === expected,
    `riding=${riding} miniGameFrozen=${miniGameFrozen}`,
    `attractionOwnsTheScreen → ${got}, wanted ${expected}`,
  );
}

// 2. The real HUD, with a pill mounted the way `ParkMap` mounts its own.
const root = new FakeElement('div');
const hud = new Hud(root as unknown as HTMLElement);

const drawer = root.querySelector('.hud-menu-items');
if (!drawer) {
  console.error(
    'check:hud-during-rides: no `.hud-menu-items` in the HUD — `ParkMap` and `CuteODex` find\n' +
      'their pills a home by that exact class name, so this check cannot stand in for them.',
  );
  process.exit(1);
}
const mapPill = new FakeElement('button');
mapPill.className = 'pill pill--map';
drawer.append(mapPill);

const menuButton = root.querySelector('.pill--menu');
if (!menuButton) {
  console.error('check:hud-during-rides: no `.pill--menu` in the HUD — nothing to measure.');
  process.exit(1);
}

console.log('\nwalking about the park (nothing has her):');
assert(!hiddenByAnAncestor(menuButton), 'menu button', 'visible, as it always was');
assert(!hiddenByAnAncestor(mapPill), 'map pill', 'visible in the drawer');

// 3. On a ride. This is the assertion the issue asks for.
hud.setMenuAvailable(false);
console.log('\non a ride (an attraction has her):');
assert(
  hiddenByAnAncestor(menuButton),
  'menu button',
  hiddenByAnAncestor(menuButton)
    ? 'hidden by an ancestor, walking the real parent chain'
    : 'STILL VISIBLE mid-ride — nothing between it and the root is display:none',
);
assert(
  hiddenByAnAncestor(mapPill),
  'map pill',
  hiddenByAnAncestor(mapPill)
    ? 'hidden with the drawer it was mounted into'
    : 'STILL VISIBLE mid-ride — hiding the button alone left the drawer up',
);

// 4. A menu that was open when the ride started is put away, not merely
//    covered — or the drawer is sitting open on the frame the ride ends.
hud.setMenuAvailable(true);
const menu = root.querySelector('.hud-menu');
if (!menu) {
  console.error('check:hud-during-rides: no `.hud-menu` wrapper — the drawer has been restructured.');
  process.exit(1);
}
menuButton.click(); // the real handler, the real toggle — a child opening the menu
console.log('\na menu left open when the ride started:');
assert(
  menu.dataset['open'] === 'true',
  'drawer opens at all',
  `data-open is "${menu.dataset['open']}" after a press, wanted "true" — otherwise the case below is vacuous`,
);
hud.setMenuAvailable(false);
assert(
  menu.dataset['open'] === 'false',
  'drawer',
  `data-open is "${menu.dataset['open']}", wanted "false" so it is not waiting open when she gets off`,
);

// 5. …and it all comes back. A HUD that hides and never returns is worse than
//    the bug it was fixing.
hud.setMenuAvailable(true);
console.log('\nback on her own two feet:');
assert(!hiddenByAnAncestor(menuButton), 'menu button', 'visible again');
assert(!hiddenByAnAncestor(mapPill), 'map pill', 'visible again');

// What this run did not look at — printed every time, pass or fail, and to
// stderr so it is not swallowed by a reporter that only shows failures.
process.stderr.write(
  'check:hud-during-rides coverage note: this drives `ui/Hud.ts` directly. It does NOT prove\n' +
    "that `Game.tick` calls `setMenuAvailable`, and it does NOT prove any CSS — there is no\n" +
    'layout engine here. Those are covered by the browser run recorded on the PR for #404.\n',
);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} assertion(s)`}`);
process.exit(failures === 0 ? 0 : 1);
