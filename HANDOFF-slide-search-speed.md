# HANDOFF — slide search speed (#650 seed-11 timeout)

Branch `fix/slide-search-speed` off `origin/eng/sphere-six-reds`; PR against it.

Root cause (measured, seed 11): 98.5% of the rail search's joint steps (3.45M of 3.50M) were in states where accumulated + straight-line distance to the finish already exceeded maxLength (75 m) — subtrees that can never finish. 2904 of ~3060 attempts ran out their 1200-step limit there. Which pose pairing first succeeds was luck: 1165/1620 before d2741d5d, none on rung 1 after (so rung 2 too).

Commits:
1. closer skips chains whose chord bound > maxLength — identical draws (candidates/backtracks identical), 25 s -> 12 s.
2. validate rejects a piece whose end leaves the finish out of reach — changes routes, seed 11 slide search 25 s -> ~2 s, canonical 6 s -> 50 ms.
3. slide satisfies: chute underside above ground (base seed 326 was 0.54 m under; new routes on 11/24 were under).
4. invariant for (3), proved red on base seed 326.
5. check:park-boot frame floor derived from measured work (was a 100 constant from a 3.46 s search); proved red with a lump mutation.
