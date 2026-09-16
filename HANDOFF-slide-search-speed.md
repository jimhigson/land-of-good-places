# HANDOFF — slide search speed (#650 seed-11 timeout)

Branch `fix/slide-search-speed`, rebased onto `eng/sphere-six-reds` @ c0913c8d (includes #659, #660). PR #663.

Root cause: 98.5% of search steps were in states already past the 75 m cap. After the rebase (#659 radius profile), seed 11 base = 453 s over 25 attempts, because the cruiser prefilter guessed the height at `desiredLength` and routes that finished then fouled the cruiser.

Commits: closer chord prune (same draws); validate reach prune; ground clause + invariant; park-boot floor derived; interval cruiser prefilter (heights over every finishable length); legs vs the drawn (leaned) car.

Rebased numbers: every seed solves on its first attempt; seed 11 0.6 s. test:procgen 51 failures vs CI 35112992659's 44. The 10 extra are seed 11's tests that CI never ran because of its timeout, and all fail on base seeds. 3 fixed.

Open findings: (a) the chute has no collider. 8–14 m of every seed's run-out (base and branch) has its underside below TALLEST_CHILD_HEIGHT 2.97 m, so a child walks through it. Needs a collider rather than a height clause. (b) The slide's cruiser clearance still compares world chute points with the flat cruiser line, not the drawn one.
