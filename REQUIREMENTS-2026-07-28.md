# Family requirements — 28 July 2026

Everything Jim asked for in the 28 July session, recorded so no ruling lives
only in a chat log. Shipped items list their PR; open items are the evening
backlog, **in priority order**. When one of these is built, its section gets
the PR number rather than being deleted — this file is a record, not a queue
(the queue is the session task list; ORDER-OF-WORK.md stays the long-term
order).

## Shipped today

| Requirement | PR |
| --- | --- |
| Selection rule: tap/near selects, actions as chips over the item, two taps if distant; train boards/alights only by chip; "?" under Menu | #100 |
| Two coasters (family ruling): Sky Cruiser passive first-person; Rail Race third-person chase, hold to accelerate, release to duck | #101 |
| Park layout pinned: the family-approved park never reshuffles when the manifest grows | #101 |
| Railway solved as a pure pre-scene plan; stations plannable; trees give way to the track | #101 |
| Walk network as a neutral graph (PATH_GRAPH), train stations as nodes | #101 |
| Rail fence never bars the track: caps keep the collision seal, visible rail is flanking stubs | #101 |
| Ferris car: glass floor and ceiling; look-up/down range widened to −80°/+70° | #102 |
| Phone-orientation (gyro) look-around on all first-person rides, iOS permission from the boarding gesture | #102 |
| Coaster first-person faced backwards — fixed (eyeMount; dot(camera, travel) −1 → +1) | #101 |
| Coaster rails swept curves, not straight segments; track and supports cast shadows | #101 |
| Signs out of the 3D world; sign becomes a 2D card above the chips when the item is selected | #103 |
| Face painting uses the character-creation preview component, zoomed on the face (PREVIEW rule) | #104 |
| Hats sized to the head (were ⅔ fit after the head grew); RiPika head derived from the real RiPika; long hair one connected piece, not "sideburns on a mullet" | #105 |
| Flowers 90/10 small/large, only large pickable, so "Pick!" is rare | #106 |
| Stars move with the camera (authored parallax — ortho cameras have none) | #106 |
| Fairy-light string ~2.5× thicker (was one device pixel) | #106 |
| Running dust ~2× frequency | #106 |
| Procgen invariants: walls/trees/lamps stop overlapping; vitest suite across seeds; CI blocks merges without it (agents must extend the suite when expanding procgen — see CLAUDE.md) | #107 |
| Lamp posts every few metres along all paths, clearance-checked, coverage invariant | #107 |
| NPCs vibrating at stations (ride/movement double-ownership, 3,174 m/s runaway) fixed + jitter gate | #108 |

## Open — priority order

### 1. Ride exits (GAME-BREAKING)

Every ride respawns the player inside its booth, trapped forever; the game
is unplayable after any ride. **Every ride gets a dedicated exit point with
its own node in the paths graph**; players and NPCs appear there after
riding. Universal safety net: no dismount may place a rider on a non-clear
spot (collision-checked, slide to nearest clear). Becomes the EXIT rule in
GAME_DESIGN.md. Coaster routes become pure plans (like `train/plan.ts`) so
the graph knows exits at build time.

### 2. Rail Race: bars invisible/ineffective

The duck-under bars are missing or hard to see, and holding accelerate the
whole ride wins — the bonk penalty never bites. Bars must read clearly from
the chase camera; prove the penalty headlessly (holding throughout must lose
to a clean-ducking rival).

### 3. One parameterised rail generator (all rail rides)

Every rails-based ride is a parameterisation of one shared route generator;
each ride has its **own rail colour**. Turning radius: Sky Cruiser tightest,
Rail Race high (gentle — the current curves are too tight to see where the
track goes), train highest of all.

**Algorithm (Jim's spec).** Incremental generate-and-backtrack, replacing
the radial-profile solve:
- a small per-ride vocabulary of segment types, each a 3D curve piece
  (cubic béziers with C1 joints recommended over b-splines: mirror the last
  control point across each joint so tangents match — segments stay locally
  reasoned, which a backtracking search needs);
- project the candidate segment forward; on collision with anything (plots,
  walls, other rides' corridors, the boundary) re-pick a different
  seeded-random option at that point;
- when options exhaust, backtrack a step and re-choose there, within a
  bounded retry budget;
- **outermost backtrack level: a new starting location for the whole
  track** (the station position is part of the search space, still subject
  to stall-adjacency and clearance rules);
- **loop-closure bias**: past some proportion of desired length, segment
  choice is increasingly biased toward steering back to the start, with the
  final segments landing on the start point at matching tangent;
- deterministic per seed — retries and restarts advance the RNG stream.

Also here: **the sleeper/plank bug** — ties are often at the wrong angle
and fail to bridge both rails. Place ties from the curve's parallel-transport
frame (tie axis = side vector) so perpendicularity is by construction, and
check each tie's endpoints sit on their rails.

Chord safety (segments cutting through obstacles between control points —
the castle clipping) becomes inherent: a candidate that clips is rejected.

### 4. Castle: deliberate fly-through window

Where the Sky Cruiser passes the castle it should be deliberate: a large
masonry-surrounded window in a castle **side wall — never a tower** — that
it flies through, boot-asserted (clearance around the cart, distance from
towers). The Rail Race keeps full avoidance.

### 5. Paths to nowhere

Some paths lead nowhere. The walking network derives from a **graph of
places to visit only** — the entrance **and exit** of every ride and
building are nodes — and no paved ribbon may terminate anywhere but a node.
CI invariant: every non-backbone edge ends within epsilon of a registered
node.

### 6. Park 2×, gentle-spline boundary

The park can be bigger and non-circular: procgen creates the boundary as a
gentle closed spline of approximately the right area, **about 2× current**.
Pinned park keeps its positions (new space is additive); the gate stays the
one fixed thing. All circular assumptions (extent limit, solve bands, rail
wall radius, play clamp) become distance-to-boundary. Sequenced after the
unified rail generator so both migrate onto one boundary abstraction.
Invariants: area tolerance, spline gentleness, wall continuity.

### 7. Level crossings become bridges

Paths cross the railway on hump-back or wooden bridges, not level
crossings: raised walkable deck (train clears beneath), ramps walkable,
nav-lattice routable, fence continuous beneath. check:park's "routes cross
only on a bridge deck" invariant finally used as written.

### 8. Ride stalls adjoin their rides

Every ride's stall stands NEXT TO its ride (deployed dodgems stall is ~17 m
from the dodgems). Only booth pins move; rides stay put; family screenshot
approval required since pinned positions change.

### 9. Ginormous slide on the rail generator

The slide currently ends inside the castle, stranding the player. Rebuild
it as a parameterisation of the shared generator (trough profile, open
curve, no loop bias), ridden first-person; if the grown-up rides too they
sit in front, lying down; ends at a proper exit node.

### 10. Keychain shop (in flight)

A keychain stall in the garden; collected (never bought) keychains dangle
from the player's backpack with a little sway; one equipped at a time; the
collect/swap dialog is the shared character-creation preview zoomed on the
backpack. Branch `keychain-shop` carries models + plan + partial state work;
restart scheduled 19:04.

### 11. Smaller recorded items

- **Tree climb wave**: after climbing, the player waves at the camera every
  few seconds; NPCs climb trees too.
- **Fountain statue**: a large grey-stone RiPika in the fountain's middle
  (research handoff on the flowers-stars branch history).
- **E-routing**: E must act on exactly the item the chip shows (a flower
  once stole the press from "Get on"). Follow-up noted on #103.
- **Castle floor NPC clipping**: not currently reproducible (NPCs can't get
  inside), but the mechanism is real — recipe in `HANDOFF-npc-vibrate.md`
  history for whoever wires NPCs indoors.
- **Ratchet tidy**: `anchor.reach:building` records 0.1, now measures 0.

### 12. Open family decision

**Ferris scenery canon.** Jim asked for the real park below the ferris car
with the wheel hidden; recorded canon (below.ts) deliberately shows a toy
park, then the whole Earth for 40 s. The glass floor (#102) may satisfy the
underlying wish. Decision pending: keep the toy-park/space fantasy, or
rebuild on the real park (~2,900-line change).
