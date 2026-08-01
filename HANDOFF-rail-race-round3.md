# HANDOFF — Rail Race round-3 playtest feedback

Branch `feat/rail-race-round3`, worktree `.claude/worktrees/rail-race-round3`.
Two independent items. **Item 2 did not land and should not be retried as
specified** — read its finding below before spending anything on it.

`src/world/railRace/cart.ts` is off limits (mid-reconciliation between #156/#157).
Nothing here touches it.

---

## Item 1 — rivals appear at the exit after a race

Status: **in progress** (see the commits after `d2f44d6`).

### What is actually there today

- The three rivals (Pip / Nell / Otto) are **permanent** objects. `RailRace`'s
  `buildCarts()` runs once in the constructor and never again; each rival is a
  `createKid()` handle parented to its cart `Group`, which lives under
  `RailRace.group` for the lifetime of the park.
- `arrive()` (RailRace.ts, end of a race) does exactly two things to them:
  `Object.assign(cart.rider, createRider(cart.rider.lane))` and `placeCarts()`
  — a hard teleport back to the start line so the ring looks ready for the next
  visitor. They are never anywhere near the exit.
- `driveIdleRivals()` then laps them round the ring forever while `phase` is
  `'waiting'`.

So the racing rivals **cannot** be reused for the exit moment without emptying
the ring, which is the thing that makes the ride look alive between visitors.

### The pattern to follow

`src/world/entrance/disembarkingKids.ts` is the established lightweight
walk-on-character pattern, and its header is close to a spec for this job
("these two exist for one short scene: hop down, take a step or two into the
park, then fade into the ordinary background. A direct `createKid()` … is all
that scene needs"). It is currently **dead code** — no callers anywhere.

Do **not** use `entities/npc/` — `KidCrowd` is a fixed-size instanced crowd
built once at park construction with no `despawn`; it cannot make a transient
character.

`createKid()` has no `dispose()`; `root.removeFromParent()` is the whole
cleanup, as `disembarkingKids.ts` documents.

### Spacing at the exit

`resolveDismount(collision, x, z, radius)` (`world/dismount.ts`) is
**single-point and stateless** — calling it three times with the same input
returns the same point three times. Nothing in the park spaces multiple bodies;
the only prior art is `Parade.ts`'s queue-along-a-trail and `NpcSystem`'s
±0.8 m spawn jitter with no clearance re-check. So this needs either a small
multi-body extension of `resolveDismount` or a fan of offsets around the exit,
each fed through the existing single-point resolver.

---

## Item 2 — "stall must always sit at the park edge, near the actual rails"

Status: **NOT SHIPPED. Reverted deliberately.** One genuine sub-fix was kept
and is committed as `d2f44d6`.

### The brief's assumed root cause is wrong in an important way

The brief said: copy `ferrisKiosk()` in `minigames/stallPlacement.ts`, which
derives its placement from the ride's own anchor instead of the generic
`placedStall()` free-spot solver.

`ferrisKiosk()` can do that **only because the ferris kiosk has no manifest
entry at all** — the layout solver does not know it exists.

`stall.railRacer` *does* have a manifest entry, and **five** separate systems
read `placedEntry('stall.railRacer')` off the solved layout, independently of
`STALL_PLACEMENTS`:

1. the visible booth (`stallPlacement.ts`)
2. the start/finish arch's bearing (`railRace/route.ts` — `startDistance`)
3. the ride's exit patch (`railRace/plan.ts`)
4. the path spur (`paths.ts`)
5. the scenery blocker (`Scenery.ts`)

A `railRacerKiosk()` that overrides only the placement would move the visible
booth away from its own arch, its own exit, its own doormat and its own
blocker. **The relation has to go in `parkManifest.ts`, the one place all five
agree on** — not in `stallPlacement.ts`.

(The "bearing of the booth" intent the brief asked about lives in
`railRace/route.ts` lines ~225–233, not in a script. `check-rail-race.mts:704`
only *prints* it. It is already honoured: move the manifest entry and the arch
follows.)

### Why the move itself did not land

The park's rim is already fully spoken for, and the rail race ring does not
own it — **the train does**.

- The ring's ground shadow is 49.6–57.4 m out, but the ring **flies at 9.5 m**;
  `route.ts`'s own header says it flies precisely *because* "the ground at this
  radius is already spoken for … the train owns the 48–58 m band".
- The train loop is *relaxed*, resting at 56.2 m and diving to 38 m through
  whatever gaps the plots leave it. A booth placed at the rim plugs one of
  those gaps; the loop, unable to dive there, is pressed out against the
  boundary wall where it cannot be flanked by invisible walls on both sides.

Measured, with the real `check:park`, rewriting only this one pin
(every other plot stays byte-identical — a pin costs the solver no rng draws):

| bearing / radius | outcome |
|---|---|
| 19.5° / 28.53 m (today) | **OK** — 15/15, 72/72, 5 recorded deviations |
| 19.5° / 30 m | `poi.stranded` 1, `rail.exclusion` 20 → 22 |
| 10° / 43.3 m | `poi.stranded` 2 (no rail damage — the best result found) |
| 14° / 39–45 m | `poi.stranded` 1, `rail.exclusion` 22 |
| 26° / 48 m | `poi.stranded` 2, `rail.exclusion` 31 |
| 171–175° / 43–46 m | `poi.stranded` 2, `rail.exclusion` 30–37 |
| 190° / 39–42 m | **layout unsolvable** — this is `stall.skyCruiser`'s only pocket |
| 271–304° / 44–47 m | `poi.stranded` 1–3, `rail.exclusion` 36 |

**Every position at r ≥ 30 m trips `check:park`.** Moving the booth just 1.5 m
further out than it stands today already strands a waypoint. CLAUDE.md and
`check:park` both say plainly: do not silence this with RATCHET.

Two other things worth knowing if this is picked up again:

- **The doormat decides which bearings are even possible.** A counter always
  faces roughly +Z (the one angle the fixed isometric camera can read), so a
  booth's stand point is always ~3 m to its +Z side. On the *north* rim that
  points further out, dropping the doormat beyond the railway. Only the
  southern and western arcs put the doormat back inside the loop.
- The two stranded waypoints at the best candidate (10° / 43.3 m) were
  (42.9, 7.2) — an "interesting" POI that ends up inside the relocated booth —
  and (20.9, 20.2), which loses its connectivity when the old booth's path spur
  goes away. Both are `poiGraph.ts` / `paths.ts` problems, not manifest ones.

### What was kept

`d2f44d6` — `planExit()` now also requires the railway's own
`RAIL_CORRIDOR_CLEARANCE`. Its search runs *outward from the park centre*, and
`clearOfPlots` cannot see the train corridor, so a rim booth would put the ride
exit on the tracks. With the booth where it stands today the exit is unchanged
to the metre (31.61, 11.17) and `check:park` is unchanged, so this is pure
hardening of a latent hole.

### Recommendation

This is not a stall-placement task. It is a "the park rim is full" task. Either:

- **accept a smaller win** — the booth cannot go past ~30 m without park work,
  so there is no cheap version of Jim's ask; or
- **do the real work** — teach `poiGraph.ts` to drop POIs that land inside a
  plot, give `paths.ts` the connectivity the old spur was providing, and then
  re-run the sweep above; 10° / 43.3 m is the position to aim at, since it
  costs the railway nothing.

Ask Jim which. It is a design call about how much of the park to disturb, not
something to guess at.

### Reproducing the sweep

Scratch scripts (not in the repo) lived in this session's scratchpad:
`setpin.cjs` (rewrites only the `stall.railRacer` pin), `sweep2.sh` (runs the
real `check:park` per candidate and distinguishes THROW / REGRESSION / OK), and
`probe-full.mts` (analytic filter for solver-legal, doormat-inside-the-loop
candidates). Note the analytic probe is only a filter — it uses the *baseline*
train route and cannot predict how the loop re-solves once a plot moves. Only
`check:park` is authoritative, and any sweep script **must** distinguish a
solver throw from a clean pass; an early version of mine treated crashes as
"CLEAN" and sent me down a blind alley for several rounds.
