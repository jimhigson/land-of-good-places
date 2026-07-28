# Order of work

Written 27 July 2026 during the daily pause, ahead of the 19:00 resume.

The backlog is roughly forty items, and several of them **invalidate each
other** if taken in the wrong order — a good half of the queued work would
otherwise be done twice. This file exists so that does not happen.

Read top to bottom. Within a wave, items are parallel-safe unless stated.
Do not start a wave until the one above it has landed.

---

## Wave 0 — before anything else

**0.0 FIX THE FACE-PAINT CRASH (P0, live).** Using the face painting stall
freezes the game completely. It is merged and live now. Fix before anything
else — a crash a child can hit outranks every other item in this document.

**0.1 QA sweep of the unverified merges.** The last seven PRs are
**build-verified only** — the shared browser profile was locked all session,
so the castle exterior, indoor lighting, shaft guards, shop re-spacing, NPC
chat, water-fight portraits, balloons and skin tone have **never been seen
running**. A Claude Code restart clears the browser (the `--isolated` config
is waiting on it). Sweep against QA-PLAYBOOK.md first.
*Rationale: everything below builds on this ground. If the shop re-spacing
is wrong, every later placement decision inherits the error.*

**0.2 Start the two architect decisions** (Wave 2) at the same time. They
are thinking, not building, and they gate a third of the backlog — so they
run in the background from minute one and cost nothing.

---

## Wave 1 — global mechanisms, and fixes that depend on nothing

- **1.0b HOPPABILITY GAP (live on main, found 27 July 22:45).**
  `autoHopClears` calls anything up to **1.43 m** hoppable, but the jump only
  actually carries the player across walls up to **~1.33 m** — above that the
  apex window is too brief to cross the footprint. The park has a **1.4 m wall
  at `[3,19]→[-4,20]`** sitting in that gap. Since route finding now
  deliberately plans *over* hoppable walls, a route can be planned across a
  wall she cannot actually cross — she would walk up to it and stop, which is
  exactly the "stuck on scenery" complaint route finding was built to end.
  Pre-existing, but route finding makes it reachable. Fix by narrowing the
  predicate to what the flight really clears, and add a boot assert that no
  wall sits in the gap.
- **1.0 ROUTE FINDING (high priority, family-reported).** Tap-to-move gets
  stuck on scenery; the player must route *around* obstacles. Core feel, not
  polish — it is how a six-year-old plays. The NPC `poiGraph` already solves
  this for NPCs; make the player a consumer of real pathfinding. Must respect
  auto-jump over small walls, survive Decisions 3 and 4, and degrade
  gracefully when no route exists.

These touch many files but depend on nothing. **Do them early precisely
because they are global**: everything built afterwards inherits them free;
everything built before needs revisiting.

- **1.1 Minimum font size AND whole-UI scaling** everywhere, including
  canvas-painted sign text. Define once (CSS custom property + matching
  canvas constant). The minimum is only the floor: derive **one root scale
  from the viewport** and express every UI size as a multiple of it, clamped
  at both ends, so a big monitor scales everything up and a phone stays
  usable. Dialogs being small boxes on a large screen is the bug being
  fixed. **Do 1.8 as part of this** — same root cause.
- **1.2 Rainbow interaction outline** — hover for mouse, E-primed for
  keyboard. Build once as a shared system every interactable registers with.
  *Same reasoning as 1.1: build the mechanism before there are more things
  to retrofit it onto.*
- **1.3 No tank controls** — press a direction, go that way; rotation only
  in first person. This **deletes** the dodgems' inverted-steering and
  angle-clamp bugs by construction. **Do not fix dodgems steering first —
  that work would be thrown away.**
- **1.4 Jump-over-wall fling** — the airborne clearance path almost
  certainly bypasses the escorting guard that fixed the fountain fling.
- **1.5 Character-creation texture leak (P0)** — `disposeTree` never
  disposes `material.map`; a real phone out-of-memory risk.
- **1.6 Backpack wearing** — you cannot wear anything you own. The wearing
  systems exist; only the UI route is missing.
- **1.7 Character-creation preview framing** — the hat is cropped out
  entirely; the camera should follow whatever changed last.
- **1.8 Character-creation scrolls needlessly** — the card is capped at
  760x680 and scrolls instead of using a large window. Let it fill the
  space available; scroll only when it genuinely cannot fit.

*1.5 and 1.7 are character creation — give them to one agent. 1.8 belongs to
whoever does 1.1, since it is the same root-scale fix, so those two agents
must agree who owns `style.css` first. 1.1 and 1.2 both touch every UI
surface — sequence them, do not parallelise.*

**Wave 1b — GC investigation.** Fable profiles, cheap agents fix. Needs the
browser, so it starts after 0.1 and runs long. Known suspects are already
listed in ARCHITECTURE-REVIEW.md; each fix is an independent small PR.

---

## Wave 2 — the two architect decisions (started in Wave 0)

Neither may be implemented until ruled on.

**2.1 The park replan** — a winding, tunnelled railway; both rail systems
planned together; the map redrawn and attractions re-placed. **Supersedes
the premise of Decision 1** (train and coaster in separate concentric
bands). The visibility objection is already answered: first-person train,
and bridges carrying paths over the track.

**2.2 Castle floors as separate spaces** — changes what `WalkSurfaces`, the
floor fader and every traversal device fundamentally *are*.

---

## Wave 3 — the `Activity` refactor (serial; one owner; nothing else in that file)

Extract the four hand-bolted NPC behaviour blocks (train trips, tree
climbing, face paint, chat) into a proper abstraction.

**Why now:** ride queues need a *fifth* behaviour. Three of the four have
already diverged, and one **caused a bug** by dropping safety rails during
copy-adaptation. Hand-adding a fifth and then refactoring five is strictly
worse than refactoring four.

**Why alone:** ~500 lines move. Any parallel edit to `wanderDriver.ts`
conflicts badly.

---

## Wave 4 — implement the park replan

All of this is **thrown away** if done before 2.1.

- 4.1 New layout; attractions re-placed
- 4.2 Both rail routes laid together
- 4.3 Tunnels; bridges carrying paths over the track
- 4.4 Barriers keeping the player off the track (visible + invisible)
- 4.5 **Paths to both stations** — also lets the NPC waypoint graph reach
  the platforms, retiring the improvised off-graph steering
- 4.6 **Spooky house** → giant ghost head with a spider, at its new edge spot
- 4.7 **Trackside statues and characters**, dancing and posing
- 4.8 **First-person train ride** with look-around. **Build the shared
  `RideCamera` here, once** — the ferris wheel, the train and the coaster
  all want it.
- 4.9 **Two-track rollercoaster**, first person, on the real rails

## Wave 5 — implement the castle floor split

All of this is **thrown away** if done before 2.2.

- 5.0 **Before S1: settle the `spaces.ts` name collision** (Review 5/F4).
  `src/world/spaces.ts` (save-facing place names) already exists; Decision 3
  specifies `src/world/building/spaces.ts` (`SpaceManager`, runtime authority).
  Rename one, and have the save table derive its origins from `SpaceManager`
  rather than keeping a second copy of the coordinates.
- 5.1 Floors as separate spaces; traversal devices re-conceived.
  **Cache the nav lattice per space while doing this** (ARCHITECTURE-REVIEW
  Review 3/F3): `NavGrid` keeps exactly one lattice, so every floor
  transition would otherwise re-pay a 6.8–10.1 ms rebuild, both ways, plus
  ~1.3 MB of typed-array churn when floor sizes differ.
- 5.2 **Straight stairs only**; walk onto them on keyboard, tap on touch
- 5.3 **One connection per floor pair**, scattered to reward exploring
- 5.4 **Tap-and-go trampolines**
- 5.5 **Interior perimeter wall** in castle style, sliced to the current
  floor and below
- 5.6 **Interior re-theme** — stone, vaults, arches, chandeliers, banners
- 5.7 **Snake room** — needs a floor to live in
- 5.8 **Novelty shopfronts** — giant ice cream, giant balloon, attendant
  openings. Gated here because a tall shopfront needs more ceiling height
  than the decks currently have.

*5.5, 5.6 and 5.8 are the same building files — one agent, sequentially.*

## Wave 6 — ride queues

After Wave 3 (needs `Activity`) **and** Wave 4 (queues sit at rides; if
rides move, queues move). Six chunks already specified in
ARCHITECTURE-DECISIONS.md Decision 2.

---

## Anytime — genuinely independent

- **Wire up the four orphaned check scripts** (Review 7/F7).
  `checkShopSpacing`, `checkGondolaSightline`, `measure-hop-clearance` and
  `measure-wall-tunnelling` are referenced from nothing in `package.json`, so
  nothing re-runs them. The hop ceiling (1.0 m) and the sub-step cap are both
  *justified by* those measurements and both depend on values that change —
  jump apex, sprint speed, collider thickness, `MAX_FRAME_DELTA`. The boot
  asserts guard the invariants but nothing re-derives the numbers behind them.
  Give each a `check:` entry and split fast/deterministic ones into `build`
  from slow sweeps into a `check:all`.

- **The pets are still not 1.46 m** (found by the asset-contract check, which
  was written to validate the fix that missed this). `sizeToStandard` now
  closes over a `Box3`, which **over-measures** — a Box3 is the axis-aligned
  box of already axis-aligned boxes, so every rotation inflates it. The pets
  are therefore scaled slightly too far *down*: kitten -34 mm, mouse -55 mm,
  puff -68 mm, and the puff sinks 28 mm through the floor. Only the bunny is
  inside tolerance. Fix: close it over the new `visibleBounds` vertex walk
  (`src/art/style/measure.ts`) instead of a Box3, and tighten the ratchet
  entries afterwards.

- **Three assets declare a height that does not describe them** — reported by
  the contract check, deliberately not fixed, because moving art is a
  level-design decision: `spaceTurtle` +42% (the sprout on its shell is
  excluded from the sum, exactly like the bunny's ears), `prop.tree.tall.*`
  -14% (`tallness` multiplies the whole declared height but only the trunk and
  the canopy pivot are scaled), `hat.puff` +37% and hovering 30 mm above the
  crown. Plus origins off the floor: `keeper` +99 mm, `candy.spookyHouse`
  +77 mm.

- **Assert that every asset's declared height matches its measured bounds**
  (Review 6/F5). `sizeToStandard` scaled pets from a hand-written `0.52` that
  was the top of the skull, not the creature — so the bunny rendered at 2.12 m
  against a 1.46 m target, for weeks, while a function named "size to
  standard" reported success. The asset contract says 1 unit = 1 m with the
  origin at the feet, and **nothing checks it**. Close it from a `Box3` at
  boot or in a test. Third instance tonight of the same class: a number an
  author writes down is a claim; a number derived from the built object is a
  fact.

- **P1 — she can walk through any wall when the frame stutters.** At
  `MAX_FRAME_DELTA` while sprinting, one integration step is **0.93 m**, which
  is wider than a wall's footprint — so she tunnels straight through, at any
  height (a 2 m wall was cleared in simulation). Pre-existing, found while
  measuring hop clearance. Reachable in ordinary play on any phone that
  stutters, and exactly the sort of thing a six-year-old finds by accident and
  cannot explain. Needs swept/substepped collision for the movement step, not
  a smaller `MAX_FRAME_DELTA` (which would just make the game lurch instead).

- **Four walls sit above the true hop ceiling — a level-design call.** The
  measured clearance is 1.045 m for 0.34 m stone and 1.100 m for 0.22 m wood.
  These "worked" before only via an ejection glitch and are now correctly
  solid, so routes go around them: wooden `[3,19]->[-4,20]` 1.40 m, wooden
  `[-16,9]->[-8,10]` 1.25 m, wooden `[-21,-8]->[-15,-9]` 1.15 m, stone
  `[22,-6]->[22,4]` 1.20 m, stone `[-24,4]->[-24,12]` 1.20 m. Lower them if
  they were meant to be hoppable; leave them if they are meant to be barriers.

- **Indoor navigation does not exist.** The waypoint graph has three "indoors"
  nodes and the castle architect found they are **dead nodes sitting inside
  the garden facade** — so NPCs cannot reach the interior at all, and
  tap-to-walk inside the castle has almost nothing to route on. Surfaced again
  by the toilet work ("tapping the toilets from across the deck"). Needs
  proper indoor coverage; note `NavGrid` builds its lattice from the current
  play bounds, so the interior may mostly want the lattice rather than the
  graph. Sequence against Decision 3 (S2 was already told to clean up the
  three dead seeds).

- **If night should be darker, start here.** The park has **14** point lights,
  not the 9 previously recorded: `prop.ferrisWheel` is a `PointLight` at
  intensity **12** — the brightest in the park — plus the locomotive headlight.
  Neither was touched by the lighting work, and the ferris wheel is the most
  plausible single contributor to "midnight looks like daylight". Look at it
  before touching `MOON_INTENSITY` or re-scaling the lamp pools.

Slot in whenever an agent is free; none of these block anything.

- Cute-o-dex widening: rides **and deeds** ("climb a tree", jump in the
  fountain, get face painted…). Wants sections, not a flat list; the
  completion prize must count all categories.
- **Food is eaten, not carried** — ice cream, candy floss, candy
- **Flower picking animation** — bend, pick, smell
- **Show the Swishy Pony in the character creator.** The floor-length physics
  ponytail hangs directly behind the character, occluded by her own body and
  the pet, and the preview turntable's +-31 degrees cannot swing it into view.
  It is the best style in the set and the one a child cannot see before
  choosing it. Re-tune `VIEW_DIRECTION` or the turntable range for that style
  (deliberately — the preview framing was tuned by item 1.7/1.8).
- **Balloon strings allocate every frame** (found by the hair agent, belongs on
  the GC suspect list): `BalloonString.rebuildGeometry` allocates a fresh
  `CatmullRomCurve3` and `TubeGeometry` per balloon per frame. The fix is the
  trick the hair ponytail uses — write transforms onto pre-built meshes.
- **Collapse the top bar behind one menu button**, and **remove the clock
  entirely**. Family-reported; the pills eat too much screen.
- **Lift call panel** — call button near the lift styled as an elevator
  panel, lift comes fast, auto-board, panel lists floors, go straight there.
  Keep decoupled from lift internals pending the castle floor-split ruling.
- **One-click buying** — item + description + Buy button, no select step.
- **Ferris wheel pet chair** — pet sits lower than the player so it does not
  block the view; restructure the car to fit. Do NOT disturb the ferris
  look-around directions, which are confirmed correct.
- **Night lighting** — more light after dark; **procedurally generated**
  light strings between trees (must survive the park replan moving them);
  fireflies at night. Pool and instance them.
- **Toilet privacy roof** — walk in, roof covers the room, flush, roof
  lifts, wash hands. Uses the existing `TOILET_ROOM` region and the existing
  flush/tap sounds. Must never trap the player under the lid.
- **More hair styles** — physics ponytail (springy chain, like the balloon
  strings), long hanging hair, ponytail, bowl cut, spiky, messy. Applies to
  NPCs too. *Graphic-design agent for the modelling.*
- **Save / continue** — autosave every 5s and on unload; on return, offer
  continue or start again. Versioned format from day one.
- **Camera-constant duplication (Review 3, F1/F2)** — `WaterFight` hard-codes
  `38 * DEG` with a comment claiming it matches the park's
  `CAMERA_PITCH_DEGREES` while importing nothing; and the eye-offset formula
  is copied between `IsoCamera` and `WaterFight`. Import the constant, and
  export the offset formula as one function taking a yaw. Small, and it stops
  a silent divergence the next time the camera is tuned.
- **Dust cloud behind the player when running** — pooled particles, no
  per-puff allocation (see Wave 1b)
- Water-fight portraits: bigger heads/names, split left+right in landscape,
  top+bottom in portrait
- **Dodgems portrait HUD** — reuse the water-fight portrait strip
- Pet mood screen + **stroking**
- Analogue clock that speaks the time
- Ferris **off-screen arrows** + **riding companion**
- Wishing-fountain coins · roaming wild RiPika · floaty corgi balloon ·
  photo mode
- Review 1 P1/P2 hygiene: shadow-casters, dead exports, triplicated
  helpers, class boundaries
- **Architecture Review 3** — start with the never-audited files:
  `minigames/`, `ui/`, `style.css`, `parade/`, non-building world

## Last

**Sound and music pass**, then **Mayhem mode**. Both large, both touch
everything, both far cheaper once the park and castle have stopped moving.

---

## The six traps this ordering avoids

1. Fixing dodgems steering before the control rework — deleted work.
2. Building UI before the font minimum and the outline system — every
   panel and every interactable revisited.
3. Placing anything (station paths, spooky house, statues, queues) before
   the park replan — all of it moves.
4. Theming or re-walling the castle interior before the floor split — the
   rooms change shape underneath it.
5. Adding a fifth NPC behaviour block before the `Activity` extraction.
6. Building three first-person cameras instead of one shared `RideCamera`.
