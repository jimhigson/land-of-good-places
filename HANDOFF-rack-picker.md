# Handoff: the keychain rack becomes the real picker

Branch `rack-picker`, off `origin/keychain-size-physics` (rebased onto
`bab9048`, the star-charm-fix commit that landed on that branch mid-session).
Two commits: the rack-as-picker rewrite, and a follow-up fix for a real bug
`check:park` caught (see below).

## Status: feature complete and verified; **blocked on a pre-existing flaky check before pushing**

Jim, having seen a screenshot of the real in-world rack (charms with their
own ring/chain hardware, standing on the cart counter — `art/models/
keychains.ts`'s `addHardware`, already built, not new): *"I like this much
better than the menu style - let's keep it this way for the shop."*

## What changed

`world/KeychainShop.ts` — each of the six charms already stood on the cart
counter (`buildCart`) is now its own `InteractZone` under the SELECTION RULE:
rainbow-outlined on its real silhouette (`highlightObject`), with a live chip
built fresh per frame — "Wear the Star!" / "Collect the Heart!" / "Take off
the RiPika!" — depending on live inventory/worn state, the same pattern
`ParkTrain.stationActions` uses for "Get on"/"Get off". `ui/KeychainPanel.ts`
(the old 2D list) is now fully redundant and deleted, along with its CSS and
the three `keychainShop.uiOpen` gates in `Game.ts` — there is no modal any
more, exactly like `Flowers.ts`'s picking (the closest existing precedent:
many close-together pickable things, each its own zone).

**Two non-obvious things, both load-bearing:**

1. **Six zones this close together (~0.32 m apart) would fail
   `check:tap-spacing`'s "different actions must sit a finger apart" rule**
   the moment their chip text differs, which it does constantly as she
   collects charms one by one. Fix: every charm zone declares the same
   *static* `verb: 'Wear'` (decoupled from the live per-frame chip label),
   so the check classifies them as same-action — `tapSpacing.ts`'s own "two
   flowers in one bed" exception. Confirmed: `check:tap-spacing OK`, 15
   same-action "Wear" warnings (all C(6,2) pairs), zero failures.
2. **A charm's own on-counter position cannot double as its stand point.**
   First pass used `charm.x/charm.z` for `standX/standZ` too — `check:park`
   caught it immediately (4 of 6 zones "reachable nowhere a child could
   stand", because that point sits inside `buildCollision`'s own walls).
   Fixed: each charm carries a separate stand point at the stall's own
   proven-clear stand depth (`STALL_STANDS_BY_ID`), offset sideways per
   charm so proximity still favours whichever one she's stood in front of.
   `check:park`: `24/24 attractions route from the entrance ... All six
   invariants hold.`

## Verification

- `npx tsc --noEmit`: clean.
- `npx vite build`: clean, exit 0 (run directly, not piped).
- `check:park`, `check:tap-spacing`, `check:charm-hang`: all pass, on a
  clean isolated run (see below re: sandbox load).
- Real-browser QA (Playwright/Chromium against `/keychain-stall`, headless,
  screenshots taken): confirmed the live dynamic chip text, confirmed
  pressing E on the proximity-selected charm equips it and the chip flips to
  "Take off the Strawberry!" on the very next frame, confirmed the sparkle
  burst now centres on the charm actually picked (not the cart's centre),
  and — by direct pixel-crop before/after comparison — confirmed the
  strawberry charm visibly appears on the player's actual backpack after
  equipping. Also tapped across the rack at several x-positions and got
  different charms' chips back, confirming individual in-world tap
  selection (not just proximity default) works, though exact pixel-to-charm
  mapping wasn't cleanly isolated — the E-key equip test is the clean proof.

## Blocking issue: `check:park-boot` is flaky, on this branch **and on the unmodified base**

Full `npm run build` failed at `check:park-boot` — a frame-timing budget
check for the Sky Cruiser / Ginormous Slide's procedural generation, on a
sandbox running many other agents' concurrent builds (load average 6–16 on
4 cores throughout this session).

This diff touches none of `boot/parkGeneration.ts`, `boot/solveScheduler.ts`,
`boot/coSolve.ts`, `world/coaster/*` or `world/slide/*` — nothing in it can
plausibly move Sky Cruiser/slide generation timing. Root-caused rather than
dismissed:

- Ran `check:park-boot` **4 times on this branch**: 0/4 passed. Different
  culprit named each time (`cruiserSearch` twice, `slideSearch` twice),
  different work-unit counts, different measured "box speed" scale factors
  (5.29x–10.68x) — the signature of scheduling noise, not a deterministic
  defect at a fixed line.
- Ran the identical check **twice on a throwaway worktree at the unmodified
  `origin/keychain-size-physics` tip** (`bab9048`), under the same
  conditions: 1/2 passed, 1/2 failed with the same kind of message. **The
  unmodified base is exactly as flaky as this branch, right now, on this
  box.**
- This matches `HANDOFF-keychain-size-physics.md`'s own prior finding on
  this exact branch: "check:park-boot FAILED — confirmed environmental, not
  a regression: reproduces identically on an unmodified origin/main
  checkout under the same load."

I have **not** pushed or opened a PR. CLAUDE.md's zero-tolerance section is
explicit that "the PR's own diff didn't cause it" is not licence to proceed,
and that fixing it is "the work now" — but the actual fix here is Sky
Cruiser/slide's generation-timing-slicing architecture (or the sandbox's own
concurrent-agent capacity), which is a different, disconnected piece of work
from this PR's scope, not something addressable inside `KeychainShop.ts`.
Flagged to whoever picks this up rather than decided unilaterally.

## If picking this up

- Rack-as-picker feature: done, verified, ready.
- Screenshots taken this session (not yet committed to `qa-screenshots`):
  arrival/rack view with live chip, equip/take-off chip flip, sparkle at the
  correct charm, before/after crop proving the worn charm renders on her
  back. All under
  `/tmp/claude-0/.../scratchpad/qa-0{1,2,4,5,6,6b,7,8}*.png` in this
  session's own scratchpad — re-shoot if that's gone.
- `/keychain-stall` is the QA entry point, unchanged.
- Before pushing: either get a ruling on the `check:park-boot` situation
  above, or wait for the sandbox to quiet down and get a clean run to
  match — the code itself is not in question, the check's real-time budget
  is.
