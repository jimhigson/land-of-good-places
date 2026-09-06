# HANDOFF — bedroom click-to-move does nothing (#583)

**Branch** `fix/bedroom-click-583`, worktree `.claude/worktrees/bedroom-click-583`,
based on `d7da0408`.

## The ask
Jim, 6 Sep 2026: *"some of the bedroom isn't reachable by clicking on the floor — the
near sub-room fails. The player simply does nothing in response to the click."*

Done = the click works there, **and** a click that genuinely cannot be honoured is
visible to a six-year-old rather than silent. Snapping her to the nearest reachable
point without saying so is explicitly **not acceptable** (ticket).

## Status
- [x] Worktree + `pnpm install --frozen-lockfile` (pnpm 12.1.0 confirmed running)
- [x] Read #583, CLAUDE.md, GAME_DESIGN.md CONTROL/HIGHLIGHT, HANDOFF-pet-beds-582
- [ ] Map the click pipeline (subagent running)
- [ ] Instrument the click + **control run first** on a click that works
- [ ] Identify which of the three causes it is
- [ ] Fix + a check that goes red without it (proved red, geometry pasted)
- [ ] Gates: `check`, `test:procgen`, `build`, `check:coplanar`, `check:swept-bus`,
      `check:park-pool`
- [ ] Browser slot (must ask the Overseer — I do not own it)
- [ ] PR + `/hotel…` deep link and one sentence for Jim

## The three candidate causes (from the ticket — they look identical from outside)
1. **No pick target** — raycast hits nothing, no destination produced.
2. **Destination produced but rejected** — play bounds, `keepOutsFor`, or inside a
   collider.
3. **Destination accepted but no path** — walk graph has no route; move computed then
   abandoned. If so this is an instance of **#577** (nothing guarantees spatially-near
   destinations are near on the path network), not a one-off.

## Geometry inherited from #582 (measured by that engineer, not typed by me)
- Bedroom is **three sub-rooms**, clear floor: **0 (west) 6.35 × 5.85 m**,
  **1 (middle) 14.80 × 5.85 m**, **2 (east) 7.15 × 5.85 m**.
- **`Hotel.enterSuite` drops her at local (−13.2, 0)**; the first bedroom door she
  reaches is **x = −10.4 → bedroom 0, the west/side one**.
- So **"the near sub-room" is almost certainly bedroom 0 (west)** — the small one she
  walks into first. Confirm before believing it.

## Design rules that bind this fix
- **CONTROL (absolute)**: press a direction = go that way. Tap-to-move is a listed
  control (GAME_DESIGN.md:232-235), incl. double-tap to run.
- **HIGHLIGHT (absolute)**, GAME_DESIGN.md:49-56: *"When something is actually used —
  tapped, clicked or activated — it flashes the same outline for about half a second…
  On a phone there is no hover at all, so this is what tells a child her tap
  registered."* **The "does nothing" half of this bug is already a rule violation**,
  independent of whichever of the three causes is at fault. A refused click must be
  distinguishable from a missed one.

## Coordination
- **#582 (`feat/pet-beds-582`) is live in this same room.** Coordinate through the
  Overseer, never directly. Do not edit files that branch is editing —
  it is in `src/world/hotel/Hotel.ts` (`dressPetBeds`, ~4982) and
  `src/world/hotel/layout.ts` (`petBedSlots`, ~1834). Avoid both if at all possible.

## Traps that apply (CLAUDE.md)
- **Run a control on the instrument first.** Two agents last night got clean, decisive,
  entirely wrong answers from uncontrolled probes. A silent instrument and a silent
  click look identical.
- `check` + `test:procgen` can both be green while a pool park is broken (**#579**) —
  run the three standalone checks too.
- Read exit codes **unpiped**; never `| tail`.
- Three-dot diff (`origin/main...HEAD`) before every push.
- Never `git stash`; commit and push after every meaningful edit.

## Log
- Worktree created off `d7da0408`, deps installed, context read. Pipeline survey
  dispatched to a subagent.
