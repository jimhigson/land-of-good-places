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
 * assertion about what it ought to do — under `scripts/headless-dom.mjs`, the
 * same stub `check:slide-rider`, `check:bus-journey` and `check:ride-camera`
 * already run their own UI against, then asks the one question a player asks: *walking up the tree from the menu
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
import { installHeadlessDom, overlayElement } from './headless-dom.mjs';
import { attractionOwnsTheScreen } from '../src/core/attraction.ts';

installHeadlessDom();

// After the DOM, always: `ui/Hud.ts` builds elements in its constructor, and
// `scripts/headless-dom.mjs` is what there is to build them out of. It is the
// same stub `check:slide-rider`, `check:bus-journey` and `check:ride-camera`
// already run their UI against — one owner, extended (element listeners, a
// one-class `querySelector`, `contains`) rather than a second document of this
// file's own, which is exactly the two-definitions trap this repo keeps paying
// for.
const { Hud } = await import('../src/ui/Hud.ts');

/**
 * The player's question, answered off the tree the `Hud` actually built: from
 * this element up to the root, is anything set to `display: none`?
 *
 * Deliberately **not** "did `setMenuAvailable` set a flag". An implementation
 * that hides the wrong element, or hides the button and leaves the drawer's
 * pills up, fails here.
 */
function hiddenByAnAncestor(element: any): boolean {
  for (let at = element; at; at = at.parent) {
    if (at.style?.display === 'none') return true;
  }
  return false;
}

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
const root = overlayElement();
const hud = new Hud(root as unknown as HTMLElement);

const drawer = root.querySelector('.hud-menu-items');
if (!drawer) {
  console.error(
    'check:hud-during-rides: no `.hud-menu-items` in the HUD — `ParkMap` and `CuteODex` find\n' +
      'their pills a home by that exact class name, so this check cannot stand in for them.',
  );
  process.exit(1);
}
const mapPill = document.createElement('button') as any;
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
