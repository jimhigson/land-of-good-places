# HANDOFF — the `Activity` refactor (ORDER-OF-WORK Wave 3)

Branch `activity-refactor`, worktree `.claude/worktrees/activity`.
Owner of `src/entities/npc/wanderDriver.ts` and `src/entities/npc/activities/*`.

**This is a pure refactor. Behaviour must not change.** Every RNG call must
still happen in the same order on the same frame, because each child has its
own seeded stream (`new Rng(NPC_SEED + i * 977)` in `NpcSystem`) and the park's
determinism is the only way anyone reproduces "that kid got stuck by the west
wall".

---

## The shape of the abstraction

Four things every one of the four blocks re-implemented by hand, and what each
becomes:

| the block did | now |
| --- | --- |
| an eligibility gate (cooldown + seeded chance + a shared cap) | `BudgetSlot` + the activity's own cooldown |
| an off-graph walk to a point | `Errand` — **the rails live here** |
| a hold-the-frame state machine | `Activity.update() → boolean` |
| a rejoin-the-graph exit | `ActivityHost.rejoinGraph(context, how)` |

### `Activity` (`activities/activity.ts`)

```ts
interface Activity {
  readonly name: string;
  readonly hold: ActivityHold;   // how much of the child it takes
  readonly busy: boolean;        // "I am mid-something, do not poach me"
  update(host, context, intent): boolean;   // true = I owned this frame
  onArrive?(host, context): boolean;        // claim the arrival moment (the climb)
}
```

**`hold` is the part that is not obvious and is load-bearing.** The four blocks
did *not* take the same amount of the child, and the differences are visible:

- `'steering'` — owns where the child walks; the social tail (wave blend, hop,
  expression) still runs over the top. Chat *depends* on this: it asks for a
  wave and lets the tail blend it. (chat, face paint)
- `'intent'` — owns the whole intent; the social tail is skipped, so the
  activity writes its own `expression`. (train trip)
- `'child'` — as `'intent'`, and the child does not even notice the player:
  offered the frame *before* `reactToPlayer`, so no waves, no copied hops, and
  — this matters — **no RNG drawn** for the wave roll. (tree climb)

Activities are tried in a fixed array order, `'child'` holds first (before the
player is noticed), then the rest (after). First one to return `true` owns the
frame; nothing after it runs. Array order is `[climb, chat, train, paint]`,
which is exactly the order `update()` used to test them in.

`busy` is the "must not be abandoned halfway" property, exposed once instead of
each block reaching into another block's fields. Today only chat consults it
(`host.othersBusy(this)`), which is precisely what it did before.

### `Errand` (`activities/errand.ts`) — the dropped safety rails

`ErrandLimits` has **four required fields**: `arriveRadius`, `timeout`,
`abandonRadius`, `unstick`. Required, not optional, so the next person to write
a walk cannot forget to answer "and if it never arrives?". That is the whole
point of the class: the train block asked those questions, the face-paint block
was copy-adapted from it and dropped them, and the answer was a permanent hang
(see below).

`Backstop` is the same idea for a *hold* rather than a walk (the train's
`WAIT_TIMEOUT`) — a countdown you have to give a value to.

### `rejoinGraph(context, how)`

Three exits existed, two of them different for no reason. Preserved as a named
enum rather than silently unified, because unifying them is a behaviour change:

- `'full'` — nearest node becomes `current`, `previous` **and** `target`; any
  pause is cancelled; a fresh leg chosen. The train's version, and the
  canonical one.
- `'legacy'` — leaves `target` and any in-progress pause alone. What chat and
  face paint did. **Should become `'full'`** in the follow-up PR.
- `'inPlace'` — the child never moved (the climb): just pick a fresh leg.

---

## What the dropped safety rails turned out to be

`driveFacePaintVisit`'s `walking` phase was copy-adapted from the train's walk
and dropped **both** of its guards:

1. **`WALK_TIMEOUT` (60 s)** — the train gives up on a walk it cannot finish.
   Face paint had no timeout of any kind, and `legElapsed`/`LEG_TIMEOUT` is not
   ticked in paint mode either, so nothing else caught it.
2. **`steerTowards`'s stuck-sidestep** (`STUCK_WINDOW` 2.5 s / `STUCK_DISTANCE`
   0.8 m, then a couple of metres sideways) — the only thing that unwedges a
   child steering off-graph, which the walk to the stall is.

Consequence (= ARCHITECTURE-REVIEW Review 2, C1, P1): a child wedged on the way
to the stall pushes at the scenery **forever**, and because
`paintedOrVisitingCount()` counts `paintVisit !== 'none'`, that child holds one
of the four `MAX_CONCURRENT_PAINTED` slots forever. Four unlucky children and
face painting quietly stops happening for the rest of the session.

**Not fixed in this PR** (behaviour must not change). It is declared instead, in
one loud line that a reviewer cannot miss:

```ts
timeout: NO_TIMEOUT,   // BUG: ARCHITECTURE-REVIEW C1 — preserved, not endorsed
unstick: false,
```

---

## Other things found while moving the code (report, do not fix here)

- **The train can steal a child already walking to the paint stall.** Order is
  chat → train → paint, and nothing checks `busy` except chat. The paint visit
  is not lost (it resumes after the trip) but the slot is held for the whole
  ride. Fix: have the runner honour `busy` — one line, but it changes which
  activity wins, so it is a behaviour change.
- **The social tail overwrites `intent.lookAt` for `'steering'` activities.**
  `if (this.pausing && this.lookYaw !== null) intent.lookAt = this.lookYaw;`
  runs after chat/paint have set `lookAt`, and `pausing` is never cleared when
  they take over — so a chat that starts mid-pause has the child talking to the
  player while looking somewhere else.
- ARCHITECTURE-REVIEW C2 (paint decal detaches during trips/climbs) and C3
  (hop/wave leak across the train block) are both still live and both now
  one-liners inside the new structure.

---

## How "behaviour must not change" was checked

`npm run check:crowd` (`scripts/trace-npc-driver.mts`) drives twelve children
for 25 minutes of park time past a scripted player, a two-stop train and a
face-paint stall, one child pinned to the spot so the walk timeouts and the
stuck-sidestep are exercised rather than dead. It hashes every intent field
plus target node, seat, climb phase and speech bubble, every frame.

```
origin/main   covered climbs=29 trips=81 chats=75 paints=4 waves=62906 hops=310   trace=ba8f7deb
this branch   covered climbs=29 trips=81 chats=75 paints=4 waves=62906 hops=310   trace=ba8f7deb
```

The script only touches the driver's long-standing public surface, so the first
line was produced by running the same file, unedited, in a detached worktree at
`origin/main`. Re-run it that way if you doubt any later change.

## Progress

- [x] read everything; design settled
- [x] `activities/activity.ts`, `errand.ts`, `budget.ts`
- [x] tree climb moved
- [x] train trip moved
- [x] chat moved
- [x] face paint moved
- [x] core tidied, docs updated, `npm run build` green
- [x] PR raised: #84

Public surface that must not move (other files import it):
`WanderDriver`, `WanderOptions`, `ClimbPhase`, `ClimberBudget`,
`registerFacePaintStall`, `paintedNpcFaces`, and the getters `climbing`,
`climbTree`, `climbPhase`, `climbProgress`, `climbGroundSpot`,
`chatBubbleText`, `trainSeat`, `targetNode`. All are re-exported / delegated
from `wanderDriver.ts`, so no file outside `entities/npc/activities/` changes.
