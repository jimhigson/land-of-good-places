# HANDOFF — e-track-supports

Branch `e/track-supports`, cut from `origin/chore/rail-race-pr-triage` (PR #223,
which already reworked the droppers — do **not** rebase onto `main`).
Worktree `.claude/worktrees/e-track-supports`. Dev port **5477**.

Jim's spec: Rail Race supports become branching trees (2x base post, split at
~30 degrees, split again to carry 4 tracks, one non-clashing colour); Sky
Cruiser gets vertical supports of the same thickness; both rides get sleepers
at ~1 m.

## Measured before touching anything (canonical seed)

| thing | value |
| --- | --- |
| Rail Race lap | 600.2 m, **two** rings (walk-past scale 1, race scale 2.5) |
| trestles | 50 per ring, 12 m spacing (`TRESTLE_SPACING`, hazards.ts:229) |
| leg height | 6.15–7.11 m, mean 6.64; tops all at `beamY` = 6.60 |
| race lane spacing | 2.750 m, half-span 4.125 m (`laneOffsets` +/-4.125, +/-1.375) |
| walk-past lane spacing | 1.100 m, half-span 1.650 m |
| **Sky Cruiser pylons** | **4, on a 217 m route** — this is the real defect |
| whole scene | **2,367,240 triangles** (ARCHITECTURE.md quotes ~400k worst case) |

## The Sky Cruiser's 4 pylons — root cause

`Coaster.ts:398` rejects a candidate within `entry.boundingRadius + 2.4` of any
`PARK_LAYOUT.entries` value. The comment says this exists to stop a post
pinching "the 5 m gap between two plots", but `boundingRadius` is 19 m for the
castle and 15 m for the dodgems, so it bans discs the cruiser **deliberately
overflies**. Measured rejection over 38 candidates: corridor 28, onPath 11,
notClear 9, tooLow 3. Culprits: dodgems 8, building 7, waterFight 6, ballPit 4,
fountain 4.

**The slide already hit this and fixed it** — `slide/supports.ts:42`
`JOINED_PLOTS = new Set(['building','ballPit'])`, with the note "37
otherwise-perfect spots rejected, 0 legs built, a 95 m chute left floating and
nothing said so". Same disease, different organ.

Also noted: `slide/supports.ts:105` `PATH_CLEARANCE = 2.8` is commented "The
coaster's pylon figure" — a hand-copied constant with no owner. Give it one.

## The 30 degree problem — a real geometric finding

A double fork at 30 degrees from vertical needs
`(1.5 * laneSpacing) / tan(30) = 4.125 / 0.5774 = 7.14 m` of fork height to
reach the race ring's four lane centres. Only **6.6 m** exists between ground
and `beamY`, and that is before any trunk. **30 degrees everywhere is
impossible on the race ring.** Minimum achievable (zero trunk) is 32.0 degrees.

Resolution: target 30 degrees, keep a minimum trunk fraction, let the angle open
only as far as the span forces. Walk-past ring gets exactly 30 degrees (its
half-span is 1.65 m); race ring lands wider. Both angles are measured off the
built instance matrices by the invariant, and reported to Jim.

## Colour

`ART_DIRECTION.md` §5 forbids a neutral grey by name ("reads as a hole punched
in the picture"). The sanctioned grey is the rose-leaning
`ART.statueStone*` ladder (`src/art/style/artPalette.ts:96-104`), whose doc
comment is the ruling. `src/world/Fountain.ts` already imports `ART`, so the
import is precedented. Chosen: `ART.statueStone` (0xd3cacb) — clear of all four
`LANE_COLOURS` (markerPink/Sky/Lemon/Mint) and light rather than dark, per that
file's note that the toon ramp's darkest band goes muddy at night.

## Names in the built scene (what invariants read)

- `railRace:trestle-legs` — kept; 4 invariants read it. Now the **base post**.
- `railRace:trestle-branches` — new, 6 per spot (2 lower, 4 upper).
- `railRace:trestle-beams` — **removed**; grep proves nothing read it.
- `railRace:sleepers` — new.
- `skyCruiser:pylons` — the coaster's pylon mesh had **no name** at all.
- `ties` — kept (name is a hard build gate in `scripts/check-tie-frame.mts`).

## Status

- [x] measured baseline, root-caused the 4 pylons
- [ ] piece 1 Rail Race branching trestles
- [ ] piece 2 sleepers both rides
- [ ] piece 3 Sky Cruiser vertical supports
- [ ] invariants + mutation proof
- [ ] screenshots

Scratch measurement scripts `scripts/measure-supports.mts` and
`scripts/measure-pylon-rejects.mts` are **not** for committing to main; they are
diagnostics. Delete or keep out of the PR.
