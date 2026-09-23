# Engineering brief — totality, first rung: a stranded point of interest redraws its own placement

**Status: READY — dispatch now.** Fable engineer, per Jim's ruling for the
procgen rework. You are already reading the design doc's "Totality, ruled
and mechanised (Jim, 6 Sep)"; this brief does not restate it. Branch from
**`design/round-robin-generation`** (it carries #522's registry and is
merged with `main`; `main` itself does *not* have #522 — check
`src/world/entrance/roadCorridor.ts` exists where you branch). One
engineer, one worktree, normal CLAUDE.md discipline.

**First customers**: seeds 1, 4, 5, 6, 13, 15 (`poi.stranded` 12 / 63 /
10 / 3 / 83 / 13; `poi.nospot: 2` on seed 6), plus `anchor.reach:waterFight`
on 6 and 12 — measured by #584 on `main`'s own generator. Measure against
them from the first hour.

## RULED 6 Sep (second ruling — the first, "PoiGraph edges follow the drawn route", is withdrawn: nobody walks those edges)

- **`PoiGraph.reachable := NavGrid can route here from the entrance`**,
  per space, with the same NavGrid the `JourneyPlanner` builds — the
  instrument `check:park`'s `route.unreachable` already uses. Edges are at
  most a prefilter; never the verdict. One instrument; NPC-reach ⊇
  player-reach by construction.
- **`poi.stranded` stays hard**: "the children's own planner cannot reach
  this waypoint". 0 on seeds 0–15 under this definition; prove the old
  count red on the base branch first, then this definition green with
  **zero placements moved** (digest byte-identical for every plot).
  Seed 6's `nospot` discharges the same way.
- **The caveat decides the PR**: measure whether NavGrid over-approximates
  at the transverse deck/ramp crossings (a ~1.9 m step onto a ramp top).
  If it does, that is a **NavGrid bug** — fix NavGrid in the same PR,
  named, never accept it as reachability, never widen anything. Paste the
  measurement either way.
- **Rung 1 (layout redraw) stays exactly as specified below**, armed for
  genuine unreachability (NavGrid fails), printing "0 genuinely stranded;
  rung never fired" every run; proved red by walling a doormat in, in a
  scratch run.
- Seed 5's warp `layout: { waterFight: 1 }` deleted iff seed 5 builds
  without it. Seed 12 is a declared-vs-built water-fight bug — not yours;
  file it and leave it red, named.

## False refusals (6 Sep) — binding

Seed 1 refused the castle's doormat inside the ball pit's *walkable*
footprint and redrew the castle. Rule: **a layout-time probe may refuse
only what is certainly bad on the layout-time world's own terms; that
world cannot express "walkable", so a footprint overlap is never certainly
bad.** Concretely: the probe's obstacle set is the router's own (one
owner — `streetPlots` or its sibling); if nothing owns it, the probe
refuses nothing and the built-park NavGrid verdict alone arms the rung.
**No manifest flag.** The durable fix is the plots' claim kinds
(design doc, "Where the distinction lives"), a separate brief. Keep the
`layout.falseRefusal` guard on every run.

## The prohibition, first

**No warp field, no vetting step, no seed retirement, no widened band may
ever be the answer to a seed that does not build.** On a branch where a
red run's cheapest exit is to retire the seed, that exit is closed. Jim:
*"fix it properly."* A seed that still strands after your rungs is a
*named refusal* in the trace and a red line in the check — that is the
honest result, and it is the input to the next rung, not a thing to hide.

## Where the mechanism already lives — do not build a second one

`src/world/parkLayout.ts` **is** the decision-zero loop: `solve()` runs
`buildOnce(restart)` for `restart` in `[base, base + PARK_RESTARTS)`, and
each entry draws from its own stream
`candidateRng(hashString(entry.id) ^ PARK_SEED, restart + layoutStreamBump(entry.id))`.
`parkWarp.ts`'s `layout[id]` bump is *this rung done by hand, offline, per
seed*; `layoutRestart` is *decision zero done by hand*. Your job is to make
the trigger automatic, not to add a loop beside this one. Three things it
lacks:

1. **A trigger from a stranded POI.** Today the loop restarts only on the
   layout's own failure to place (`MAX_TRIES` exhausted). A POI whose
   doormat cannot reach the network is discovered later, by the paths,
   and never fed back.
2. **A per-entry attempt**, not only a whole-park restart: the
   `layoutStreamBump(id)` slot, but as a runtime input
   (`attempts: ReadonlyMap<id, number>`) rather than a baked table.
3. **A refusal that names things** — see below.

## The rung sequence for this class, and what each is derived from

1. **The stranded POI's own entry redraws** (`attempts[id] += 1`, its own
   stream; everything else keeps its draw). Which entry: the manifest id
   the stranded node belongs to — `graph.nodes[i]` is a doormat/waypoint
   of an entry; the mapping already exists for `check:park`'s
   `poi.stranded` line and is the one owner. `poi.nospot` (no doormat
   spot at all) is the same rung: the entry that has no spot redraws.
2. **The entries it collided with redraw**, most recently placed first.
   **Derived, never listed**: the probe from the POI's doormat toward the
   network is refused by `clearOfFootprints(x, z, margin)` — which today
   returns a bare boolean over the plot table. Add the naming form beside
   it, `footprintsBlocking(x, z, margin): readonly string[]`, reading the
   **same** table (`plots()`) — one owner — and have the probe collect the
   ids it hit. A hand-picked list of "the things a POI tends to collide
   with" is the failure mode CLAUDE.md names and is a rejection on sight.
   Non-plot blockers (the railway, the boundary) are named as such in the
   refusal and are **not** this rung's to move — they fall through to
   rung 3, and the trace says so.
3. **Decision zero**: `restart += 1` — the loop that exists. Counted.

## What a refusal carries — one shape, no inventing a second

```ts
interface LayoutRefusal {
  readonly kind: 'poi.stranded' | 'poi.nospot' | 'anchor.reach';
  readonly entry: string;                       // the manifest id that failed
  readonly blockers: readonly string[];         // manifest ids, from footprintsBlocking — may be empty
  readonly nonPlotBlockers: readonly ('railway' | 'boundary' | 'water' | string)[];
  readonly at: { readonly x: number; readonly z: number }; // where the probe was refused
}
```

The paths' verdict produces it (the same code that produces
`check:park`'s `poi.stranded` line — refactor that code to *return* the
refusal and have the check print it; do not write the verdict twice).
The layout consumes it. A throw for a stranded POI anywhere in the chain
is a bug after this PR.

## Where the loop runs, honestly

The paths solve is a module constant (`PATH_GRAPH`), downstream of
`PARK_LAYOUT`, the rail, the train, the sites. **Rung 1 can run inside the
layout's own `buildOnce` today**: after all entries are placed, ask the
router's *own* reachability function (the one `check:park` uses —
`streetRoute` / the lattice search, not a cheaper look-alike) from each
POI's doormat to the ring, with the obstacles that exist at that moment
(plots, boundary). A refusal there redraws the entry inside the loop. That
is exploration with the commit's own function on a partial world — the
design's allowed shape; the paths' later commit is the check.

**Rungs 2–3 triggered by the paths' commit** (a stranding the layout-time
probe could not see: the railway) need the solves downstream of the layout
to be re-runnable in one process, which is stage-3 step 3's ladder work
generalised. **Do not smuggle that in.** Your PR does rung 1 fully, plus
the refusal shape and the trace; it states per seed which strandings were
plot-caused (fixed here) and which were railway/boundary-caused (named,
still red, owed to the next rung). If all six seeds turn out plot-caused,
say so with the trace, not with a sentence.

## Budgets — derived, never typed

- Per-entry attempts: bounded by the entry's own candidate supply —
  `SPREAD_CHOICES` valid candidates out of `MAX_TRIES` draws is the
  existing loop's budget; **reuse it, do not add a number**. `MAX_TRIES =
  3000` is an existing typed constant; note it in the PR as one to derive
  later (from the band's area over the candidate spacing), do not add a
  sibling to it.
- Decision zero: `PARK_RESTARTS`, existing.
- Exhausting both is the one legal throw, and it carries the whole
  refusal chain.

## The unwind trace, and hashing it

- Every refusal and every redraw appends one line to a per-build trace:
  `seed, rung, entry, attempt, blockers, at`. Printed to **stderr** on
  every build (vitest hides stdout on passing runs).
- **Folded into the park digest**: `scripts/park-digest.mts` gains a
  `trace` line whose sha256 covers the trace text, so a seed that starts
  needing a redraw it did not need before changes its digest *by name*.
  Determinism proof: two builds per seed in separate processes, identical
  digests **including** the trace hash.
- The attempt map is a function of the refusal sequence, which is a
  function of the seed and the fixed candidate order. **No global
  counters, no `Map` iteration order, no `Date`.** If you find the
  refusal order depending on anything but the seed, that is a bug to fix
  before the rung, not after.

## Acceptance — measured, two lines never merged

`scripts/check-every-seed-builds.mts` (new; in the `check` chain — verify
by parsing `scripts` and comparing step *sets* with the base branch):

- **built** — per seed 0–15, in a separate process each: no throw; zero
  `poi.stranded`, zero `poi.nospot`, zero unserved `anchor.reach`. Any red
  seed fails the check and prints its refusal chain. **Proved red first,
  for real**: run it on the base branch before your rung — seeds 1, 4, 5,
  6, 13, 15 must be red with the numbers above — and paste that run with
  its geometry (entry ids, coordinates) in the PR. Then, with the rung in,
  disable it behind a scratch flag and watch the same seeds go red again.
- **built well** — per seed: entries redrawn, attempts consumed, decision
  zero reached (count), printed as measurements and ratcheted against a
  committed baseline (a seed that needed more unwinding than before fails
  the ratchet; fewer is reported, not celebrated).
- `pnpm run check`, `pnpm run test:procgen`, `pnpm run check:coplanar` —
  exit codes captured directly.
- Byte-identity on seeds that needed **no** redraw (the digest instrument,
  before/after): a rung that never fired must change nothing.

## Traps

- The layout's plot table is memoised (`plots()`); a redraw invalidates it
  — make that impossible to get wrong by rebuilding it inside `buildOnce`,
  not by a reset call someone can forget.
- `test/procgen` static imports pin every seed to the canonical park;
  read facts from `ParkFacts`.
- Never build the park twice in one process.
- `rerere` is on: rebuild any `check`-chain resolution from the base
  branch's parsed step list.
