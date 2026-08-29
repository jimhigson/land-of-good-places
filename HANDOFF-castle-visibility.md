# HANDOFF — castle interior visibility (investigate/castle-interior-visibility)

Branch off `origin/main` @ `254484d2`. Worktree `.claude/worktrees/castle-invisible`.
Dev server: port **5389**, PID 7721 (`npx vite --port 5389 --strictPort`).

## VERDICT: the report is not true. The castle interior renders.

Neither outcome 1 nor outcome 2 — **outcome 3**. The interior is built, visible and
correct on **both** paths. The `?deck=N` route is faithful to the door. What QA
described as "an open pink-diamond terrace" is the great hall, rendering as designed;
the description of the pixels was wrong, not the setup and not the castle.

Screenshots (scratchpad `.../out/`): `A-deck-0/1/2/3.png` (debug route),
`B2-through-the-door.png`, `B2-in-the-great-hall.png` (walked in).
`B2-through-the-door.png` and `A-deck-0.png` are the same frame.

### Claim by claim, against measurement

| QA claim | Measured |
| --- | --- |
| "no flagstones" | **Present.** `deck-0` carries `castleFloorMaterial` → `castleFlagstoneTexture()`. The "pink diamonds" **are** the flagstones: 1.5 m rounded-square flags laid on world X/Z, seen through a 45°-yaw isometric camera, so every square reads as a diamond. |
| "no coursed stone walls" | **Present.** `walls-0` is the big diagonal band across the lower-left of every shot, coursed ashlar with windows. Bounds y 0.73 → 2.88 (2.15 m of stone, then glass to ~3.2 m). |
| "no ceiling" | **The cutaway, working.** `FloorFader.setVisibleUpTo(deck)` fades every storey above you so you can see in — that is the Theme Park look, not a missing slab. The wall-plate `castle-timber-plate-0` (y 3.81–4.03) *is* drawn and is the pale band along the top of the wall. |
| "grass visible off the edge" | **`interior-plaza`**, y −0.47 down to −22.47, which `layout.ts` documents as deliberate: "gives the windows something to look out at… somewhere to land". |
| "every deck rendered the same" | **False.** Deck 0 is pink; decks 1–3 are cream/green with the storeys below stacked visibly beneath them. Compare `A-deck-0.png` with `A-deck-1.png`. |

### The two paths agree, which kills the harness-artefact theory

`enterCastleSpawn` goes **through** `spaces.changeTo(() => enterInterior())` — the door's
own code — so it was never a second implementation. Confirmed live: walked from
`/spawn?pos=50.16,25.47` to the entrance band (47.16, 20.97) in 11 steps, `inside`
flipped true, `interiorRoot.visible` true, deck 0, player at (600, 0.73, 615.5) — the
identical state and the identical frame the debug route produces.

### Scene-graph evidence at `/castle?deck=0`

Rays from the game camera hit, in order: `walls-0`, `glass-0`, `deck-0`,
`interior-plaza`, `interior-porch` — all under
`building-shell-floor-0 < building-shell < the-big-building-inside < Scene`.
Deck 0 has 240 meshes, **236 visible**; floors 1–4 are hidden by the fader, correctly.

## The check is green because there is no bug — but it is blind anyway

`check:castle` does **not** measure the assembled castle. It calls the factory
`buildCeilingBeams(deck)` directly, five times, and measures the returned
`InstancedMesh`. It never asks whether `BuildingShell` added those beams to a floor
group, whether the floor groups are under `interiorRoot`, or whether the floor and
walls got their castle materials. "4 enclosed storeys" in the success line is
`TOP_DECK`, a constant — not a count of anything observed.

**Proved, not asserted.** With two mutations in `Shell.ts` — `void beams;` instead of
`floor.add(beams)`, and `interiorMaterial(...)` instead of
`isCastleFloor ? castleFloorMaterial(colour) : ...` — the game has no ceiling timbers
anywhere and no flagstones at all, and the check still prints:

```
check:castle OK — 416 ceiling-beam segments across 4 enclosed storeys, ... EXIT=0
```

i.e. it would have reported success on exactly the defect the QA report described.
Both mutations were reverted; `git status src/` is clean and `check:castle` exits 0.

**This is a latent gap, not the cause of anything.** I have deliberately not changed
it: my brief was to fix only what I proved broken, and nothing is broken. If the
Overseer wants it closed, the shape is one assertion that builds a
`BuildingShell('interior')` and counts the `castle-timber-plate-*` meshes and the
flagstone-mapped deck materials it actually finds in the tree.

## Worth passing to whoever owns the castle art (not a defect)

QA's misreading is not unreasonable, and that is itself a finding. From the fixed 38°
camera the great hall genuinely *reads* as a walled open terrace: the stone stops at
2.15 m, the storey above is faded away by the cutaway, and you can see the plaza grass
and the porch roof past the wall. Everything is correct and the room still does not say
"indoors" at a glance. That is art feedback for the castle interior work, not a bug.

## Gates

Nothing in `src/` was changed, so no gate was owed. Run anyway: `check:castle` **exit 0**.

## Files

Probe scripts `qa-probe*.local.mjs` are untracked scratch and are not committed.
