# Handoff — character creation phone bugs + the BREVITY RULE

Branch `fix/charcreate-layout-and-brevity`, worktree
`.claude/worktrees/charcreate-brevity`. No browser (not mine — build-verify
only, visual QA listed in the PR).

## Jobs

1. Character creation, from a photo of a real iPhone (390x844 CSS px):
   - **A** name shown twice (caption under preview *and* the input) — drop the
     caption, keep the input.
   - **B** scrolling controls pass behind/around the sticky preview.
2. What's-new panel: half the text, no ages in the subtitle, a build check.
3. Same photo: what's-new card text overflowing its rounded boxes, and the
   floating "hop" button sitting on top of "OK, let's go!".

## Root causes found (record these, they are the expensive part)

- **B**: `.charcreate-body` is the scroll container *and* holds the sticky
  preview, so on a phone (`max-width: 700px`, stacked) the controls travel
  through the space the preview occupies. The cream background hides most of
  it, but iOS paints the text-selection handles and caret of the name input
  *above* all page content, so they poke out either side of the preview — which
  is exactly what the photo shows. Fix: on a phone the preview becomes a
  static **band** and `.charcreate-controls` becomes the scroll region, so the
  two never share space. Desktop keeps the sticky side column untouched.
  - Watch out: `.charcreate-controls` is a **multi-column** container
    (`columns: 13rem`). Giving a multicol box a definite height plus
    `overflow-y: auto` makes it spill into *overflow columns sideways*, not
    scroll down. The phone branch therefore sets `columns: auto` (both
    `column-width` and `column-count` auto = not a multicol container at all).
- **Card overflow**: `.whatsnew-list` is a column flex container and
  `.whatsnew-row` had the default `flex-shrink: 1`, so once the list overran
  the rows were squashed to their `min-height: 3.625rem` and their text spilled
  out of the rounded box onto the row above. Fix: `flex: none`. Same latent bug
  on `.shop-row` in `.shop-list` / `.backpack-list`, fixed with it.
- **Hop button**: `Game.updateHud()` only hid the touch controls while riding
  (`setVisible(!this.player.riding)`), so the hop button floated over every
  panel. Now hidden whenever the screen is busy — extracted `screenIsBusy()`,
  which is the exact predicate `Highlights`'s `blocked` closure already used.

## State

See git log on the branch. Build is `npm run build` (check the exit code).
New check: `npm run check:brevity` → `scripts/check-copy-brevity.mts`.
