# Handoff — portrait HUDs (branch `feat/portrait-huds`)

## State: done, PR raised. Nothing in flight.

Two family notes, one shared component:

- water fight: *"the heads and names on the water fight icons need to be
  bigger, put the icons down the left and right sides too (half on each side)
  when in landscape and top/bottom when in portrait"*
- dodgems: *"same fix as water fights — labels in the middle cover up too
  much; use portraits"*, *"no need to annotate apple bonks"*

## What is on the branch

1. `src/minigames/portraitStrip.ts` — the already-shared component, now:
   two banks with the list split down the middle; `pop()` moved in from the
   water fight so both games trigger the bounce the same way; and the canvas
   count cut from **sixty to five** (see below).
2. `src/style.css`, `.mg-portrait-*` — bigger heads and names, and the
   landscape/portrait placement. **The orientation swap is pure CSS**, one
   `@media (orientation: portrait)` block, which is what makes it live.
3. `src/minigames/dodgems/*` — portraits in, `shout()` out.
4. `src/minigames/waterFight/portraits.ts` — uses `strip.pop()`.

## The finding worth keeping: the texture budget

The strip used to call `paintExpressions` **per character** (5 canvases) and
then composite 5 more per character to lay each expression over a skin disc
and hair fringe. Six fighters = **60 canvases**, against ART_DIRECTION's
game-wide guideline of about 40 — and the dodgems were about to ask for a set
of their own.

Now: the five expressions are painted once, cached by iris colour, kept as
data URLs, and shared by every portrait in every mini-game; skin and hair are
a CSS gradient, which is all they ever were (two flat colours clipped to a
circle — that is a gradient stop). **Five canvases total**, which is what
paid for the heads getting bigger.

## Decisions a replacement might otherwise re-litigate

- **Two banks, split statically.** "Half on each side" and "top/bottom" are
  the same split; only the placement differs. So the DOM split never changes
  and CSS does the rest — no resize handler, nothing to leak, nothing to
  forget to re-run.
- **Names beside the head in landscape.** Three portraits at 4.25rem with the
  name *underneath* do not fit down the side of a landscape phone (390 CSS px
  tall ≈ 19.5rem). Beside, they do, comfortably.
- **The old `style.css` comment argued for a single row along the top** and
  against a side column. The family has now asked for the sides specifically.
  Comment updated rather than left to contradict the code.
- **RiPika's portrait** is his own yellow with a cocoa band, not a painted
  mouse — a bespoke face would cost exactly the canvases the rewrite saved.

## HIGHLIGHT rule: checked, nothing to report

Nothing in this PR is interactive — portraits are `pointer-events: none`
decoration. The shared system is intact and genuinely global: the rainbow ring
is one rule over `:is(button, summary, a[href], [role='button'])` in
`style.css`, and the tap flash is a single delegated `click` listener in
`ui/TapBurst.ts` over the same selector. The framework's own `.mg-quit` is a
plain `<button>` and is covered without opting in.

## Needs visual QA (I did not have the browser)

- **Turn the phone mid-game**, both stalls. The banks should move from the
  sides to top/bottom without a reload.
- Landscape phone, six characters: three portraits down each side, names
  inboard, nothing running off the top or bottom.
- Portrait phone: the top bank must clear the score/counter pills (5.75rem of
  clearance) and the bottom bank must clear the hold pad and hint (5rem).
  These are the two numbers most likely to want a nudge.
- **Water fight, landscape:** the side banks now sit over the garden's left
  and right margins, where children walk close to the fence. That was the
  stated reason the original chose the top edge; the family overrode it, but
  it is worth a look at whether a child ever hides behind a portrait.
- Dodgems: bonk the tree and check the bonker's portrait jumps; get apple-
  bonked and check **nothing** is announced; drive into someone and check both
  portraits react; wait 2.5s without moving and check the how-to-drive hint
  appears under the counters and clears itself.
- The faces are now 192px shared images scaled to 4.25rem — check they are
  crisp on a big monitor.
