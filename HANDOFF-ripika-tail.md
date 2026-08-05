# HANDOFF — ripika-tail (E5-statue)

Branch `fix/ripika-tail-cant`, worktree `.claude/worktrees/ripika-tail`,
dev server port **5318** (npx wrapper PID 17316, listening node PID 17340).
Issue **#191** / board task #16. Browser NOT owned — build-verified only.

**Status: build green (exit 0), procgen 85/85. No PR raised.**

Small, self-contained change. Two commits.

---

## The bug

`ripika.ts`'s `setWalkPhase` ended with

```ts
tail.rotation.z = Math.sin(phase * Math.PI * 4) * 0.18 * speed;
```

which is **0 whenever `speed` is 0**. That did not return the tail to its rest
pose — it *assigned the rest pose away*. Every RiPika in the park stood with a
limp, straight-down tail the instant she stopped walking, which is exactly when
a child is most likely to be standing still looking at her.

The cant is documented where it is built as the reason she is not "just a yellow
mouse": mounted on the hip and rolled over so the zig-zag flash fans across the
screen, because a tail tucked behind the body is invisible at every camera angle
this game uses.

## The fix

Add the swing to the rest pose rather than multiplying over it, and name the
constant — 1.05 was a literal in two places that had to agree and silently
did not:

```ts
const TAIL_CANT = 1.05;
tail.rotation.z = TAIL_CANT + Math.sin(phase * Math.PI * 4) * 0.18 * speed;
```

## The general shape, which matters more than the tail

**A per-frame `x = f(speed)` that multiplies the *whole* expression by an
amplitude destroys any non-zero authored value of `x` when that amplitude
reaches zero.** An animation offset has to be *added* to the rest pose
(`REST + swing`), or the rest pose has to be zero.

`applyWalk` — shared by every creature — gets away with the multiply-only form
purely because **every limb it drives is authored at rotation zero**. That is a
coincidence, not a property, and it is one authored non-zero pose away from
happening again.

## So the second commit enforces it

`check:assets` now asserts, for every creature it already enumerates:

> **at zero speed, a walk cycle must not move anything, whatever the phase.**

Snapshots every node's local transform, calls `setWalkPhase(phase, 0)` across
six phases, requires the tree back bit-identical. Reuses `collect()`, so it
covers all **35 creatures** and picks up anything added later for free.

**Verified to bite before being trusted.** Reintroducing the old line fails on
all four RiPika subjects (`ripika`, `ripika.space`, `toy.ripika`,
`egg.prize.ripika`) and names the offending node and channel. A check nobody
has watched fail is not a check — and this one would otherwise have passed
vacuously for the same reason the bug survived.

Two details worth keeping if you touch it:

- **Phase is swept, not pinned at 0.** The tail bug fails at every phase (its
  amplitude is `speed`, so the expression is zero regardless), but a sibling
  whose amplitude is driven by *phase* would sail through a phase-0-only test.
- **It runs after `check()`, never before.** A creature that fails leaves its
  model in a mutated pose, which would contaminate the height/origin
  measurements the rest of the script takes.

## Sibling sweep: none found

All 35 creatures pass. That is a real result, not absence of evidence:
`applyWalk` drives every other limb in the game and every one is authored at
rotation zero. The check is what turns that coincidence into something enforced.

## Relationship to the statue (#121)

Independent. The statue never calls `setWalkPhase` (it deliberately uses the
freshly-built neutral pose precisely *because* of this bug), so it is unaffected
either way.

**Both branches touch `src/art/models/ripika.ts`.** `feat/ripika-fountain-statue`
changes the materials/face block and the handle's `setExpression`; this branch
adds `TAIL_CANT` near the top and changes the `setWalkPhase` body. Whichever
merges second will likely need a small manual conflict resolution in the handle
literal — trivial, but worth knowing rather than discovering.

## QA (port 5318, private window)

1. Find RiPika in the park. **Stand still and watch her.** The tail should stay
   rolled over, fanning its yellow-to-amber zig-zag across the screen — not hang
   limp and straight down.
2. Walk her about (or watch her walk): the tail should still swing, around that
   canted rest position rather than around straight-down.
3. Nothing else about her should have changed.

## State

- [x] tail cant fixed, constant named
- [x] `check:assets` rest-pose guard, verified to fail on the reintroduced bug
- [x] sibling sweep — none
- [x] `npm run build` exit 0, `test:procgen` 85/85
- [ ] visual QA
- [ ] PR (not raised — Overseer's call)

---

# UPDATE — 5 Aug, after Jim's review

**Jim saw the fix on 5318: "tail should extend behind, not to the side —
rotate it 90º and relocate to match, and is good."** The zero-speed fix itself
was accepted; what he rejected was the *authored direction* of the rest pose.

## What changed (same branch, one more commit)

- **Relocated as well as rotated**, because rotating alone cannot work. The tail
  hung off her left hip at x −0.25 *precisely because* it fanned sideways from
  there; swinging it 90° about that pivot drives it through the torso. Mount
  moved to the centre line at the back: **z −0.20**, just inside the torso skin
  at −0.230 (radius 0.245 squashed to 0.94 in z).
- Cant moved from a **roll** (`rotation.z`) to a **backward pitch**
  (`rotation.x = -TAIL_CANT`); negative because +Z is forward.
- Wag moved **z → y** with it. That follows from the pose, not taste: a rear
  tail swinging in the vertical plane bobs like a lever; about Y it sweeps side
  to side. Euler order is XYZ (`Rx·Ry·Rz`) so the yaw applies *before* the
  pitch — the other order would cone it.
- `TAIL_YAW = 0.12` is the new rest value the wag is added to. Non-zero on
  purpose: a zero rest pose would make the multiply-only bug undetectable here
  again.

## The old comment was wrong, and worth knowing why

This file defended the sideways cant as stopping the tail "hiding behind the
body at every camera angle the game ever uses". The camera looks **down** at
38°, so a tail trailing back and up projects **up the screen**. Fanning it
sideways was solving a problem an isometric camera does not have — presumably
why it looked wrong to the person who actually plays the game.

## Invariant re-proved, not assumed

Green across all 35 creatures with the new rest pose; reintroducing the
multiply-only form still fails 4 subjects.

**Process note:** the first time I ran that red-test I reverted it with
`git checkout src/art/models/ripika.ts` and lost my uncommitted edits with it.
Commit before running a destructive test, or revert with a targeted `sed`.

## Consequence for the statue branch

`feat/ripika-fountain-statue` is **rebased onto this branch**, because the
statue shows the authored rest pose and this changes its silhouette.
**This branch merges first.** See HANDOFF-ripika-statue.md for the silhouette
measurement and the `TAIL_YAW` knob if Jim wants some of the read back.
