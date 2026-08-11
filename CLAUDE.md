# Working on this repo

Read this before you touch anything. It is short on purpose.

## The one rule that keeps costing us work

**Never work in the shared checkout at `/Users/jim/dev/landOfGoodPlaces`.**

Many agents run at once on this project. On 27 July two agents wrote to that
directory at the same time: one left half-finished edits across five files,
which broke `tsc` for the other, who had to move its work out and restore the
tree by hand. Separately, an over-broad `git add -A` there swept an agent's
unfinished CSS onto `main`.

So, always:

```
git worktree add .claude/worktrees/<your-task-name> -b <your-branch> origin/main
```

Work there. Remove the worktree when you are done. If you find the shared
checkout on someone else's branch or carrying someone else's uncommitted
edits, **leave it exactly as you found it** — that is somebody's live work.

## Committing

- Commit as soon as a coherent chunk compiles. Do not save one big commit for
  the end — the API drops connections and an uncommitted branch dies with you.
- Never `git add -A` or `git add .`. Name the files you mean.
- `.claude/` is gitignored; worktree gitlinks must never reach `main`.

## Building

`npm run build` must pass. **Run it and check the exit code.** Never pipe a
build through `tail` or `head` — that masks the exit code, and we shipped a
non-compiling branch to `main` that way once.

TypeScript is strict with `exactOptionalPropertyTypes: true`: optional
properties must be **omitted**, never assigned `undefined`.

### Use current runtimes; never an old-version-only flag

The checks and `scripts/*.mts` run **straight on Node** — no bundler, no
transpile step — so this repo tracks **current Node** (26+; CI pins it, and
the cloud sandbox ships an older default, so install the latest and use it:
`scripts/with-node`). Modern Node runs TypeScript by *stripping types*, with
no flags. So two rules, and they are not style preferences — a violation
either fails to run or only runs on a Node nobody should still be on:

- **Erasable syntax only** (`erasableSyntaxOnly` is on, so `tsc` enforces
  it). Everything that is not purely a type is banned: **parameter
  properties** (`constructor(private x: T)` → declare the field and assign
  `this.x = x`), `enum` (use a `const` object + a union type), `namespace`,
  TS-only `import =`/`export =`, and experimental decorators. These are not
  types, so type-stripping cannot erase them; they are also, uniformly, the
  *older* way to write the same thing.
- **Never add a flag that only exists on an old Node.**
  `--experimental-transform-types` was the tell here: it makes an old Node
  transpile the non-erasable syntax above, and **it was removed in Node 26**,
  so a script carrying it dies with `bad option` on the runtime we actually
  use. It is an anachronism. If code needs a transpile flag to run, the code
  is wrong (see the rule above), not the runtime. The same goes for any flag
  you reach for to paper over a new runtime rejecting old input: fix the
  input. When a sandbox's bundled tools are too old, install the current
  version rather than writing to the old one's quirks.

## Expanding the procedural generation

`test/procgen/invariants.ts` proves the generated park is placed sanely — no
wall crossing another wall or the railway, no tree through a tree, no lamp in
anything, every path lit, every doormat usable — across the canonical seed and
four sweep seeds. **If you add to or change procgen, add or extend an invariant
in that file in the same PR.** It is one small function plus one line in the
list, and it then runs on every seed for free.

Two rules when you do: measure the park that was built, never the rules that
built it; and take thresholds from the game (`PLAYER_RADIUS`,
`TRACK_CLEARANCE`) rather than from the generator's own target. Never weaken an
assertion to make a seed pass — swap the seed and write down why.

`npm run test:procgen`. CI runs it on every PR and **blocks the merge**, so this
is not optional. It complements `check:park`, which owns whether the park
*works*; this owns whether its furniture is *placed sanely*.

## A check can pass without checking anything

Most of what cost us 5 August 2026 was one disease in different organs: **an
assertion reporting success about something it is not describing.** So: break
every check deliberately and watch it go red before you trust it green, and read
the failure message — it should carry real numbers, not `NaN` or `Infinity`.

- **A squash merge silently reverts branches that predate it.**
  `merge-base --is-ancestor` says *no* — the commits no longer exist under those
  hashes — so nothing warns you, and it shows up only as unexplained files in
  `git diff --stat origin/main..HEAD`. Five live branches carried a latent
  revert of #114. Dropping out of `git diff --name-only origin/main...HEAD`
  clears you only for files you never touched; for files you did touch, check
  your hunks are yours **and** that the other side's work is still in the file.
  **A rebase with no conflicts is not reassurance — that is the exact shape of a
  silent revert.**
- **A skipped test is not a passing test.** A static import of a seed-dependent
  module into `test/` loads `parkManifest.ts` before the seed is set and pins
  every seed to the default park: one failure and **76 silent skips**, where the
  tell was the *pass* count, not the fail count. Read facts from `ParkFacts` —
  `import type` is erased and safe.
- **Green can mean incapable of failing.** A helper wanting a `Vector3` was
  handed `[number, number]`; `.x` on a tuple is `undefined`, the arithmetic is
  `NaN`, and `NaN < x` is always false — so the running minimum stayed
  `Infinity` and the threshold never fired.
- **Quote the count off the screen, never the one you expected.** "All three
  tests fail" was reported while the terminal said `2 failed | 1 passed`.

## The browser

The chrome-devtools MCP uses a **single shared Chrome profile** — only one
agent can drive it at a time, and the Overseer says who. If you have not been
told you own it, do not use it: build-verify instead and list in your PR
exactly what needs visual QA.

If you do own it: **always pass `background: true` to `new_page`.** A
foreground page steals the user's focus and switches macOS Spaces, which is
horrible when they are doing something else. Close every page you open and
kill your dev server when you finish. See QA-PLAYBOOK.md.

**Kill only the dev server you started, by its PID.** Never `pkill -f vite`
or any other blanket process match — an agent did this on 28 July and took
out the user's own long-running hohjs GAME and EDITOR dev servers along with
its own. Note the exact PID (or the port) when you start your server, and
stop only that.

**Always run your own dev server on your own port.** Several agents are
often working at once, each wanting a live build to look at. Never assume a
default port (5173, 5260, whatever you have seen in a handoff) is free —
pick your own and pass it explicitly (`vite --port <yours> --strictPort`).
`--strictPort` is what makes a collision loud instead of silent: without it
Vite just picks the next free port for you and every note you take about
"my server is on 5260" quietly goes stale.

**When handing the user a URL to test, tell them to open it in a private/
incognito window, every time.** A port with no *currently running* collision
is not the same as a port nobody's *browser* has ever visited — this machine
has been running dev servers, from many agents, across many sessions, for
days, and port numbers get reused constantly. A stale service worker or save
from some completely unrelated earlier session can be sitting on a "fresh"
port already, silently serving old content with no error of any kind (found
the hard way, 1 August, three times on three different "fresh" ports in one
afternoon). A private window has guaranteed-empty storage regardless of that
history — it is the only actually reliable answer, cheaper than any amount of
cache-clearing forensics.

**Hand over the URL of the thing itself, never just the root.** If the feature
has a deep link, give `http://localhost:<port>/rail-race`, not
`http://localhost:<port>/` with a paragraph explaining where to walk. Jim asked
for this on 6 August after being sent bare roots for the slide, the Rail Race
and the trees in a row: a root URL makes him find the feature before he can
judge it, on a park that is different on every seed, and that cost is paid
again on every single round of feedback.

So, in order of preference:

- **A ride deep link** — `/rail-race`, `/slide`, `/sky-cruiser`, `/ferris`
  (the list below).
- **`/view?camPos=...&camDir=...`** for anything that is not a ride: a
  building, a statue, the boundary, a bit of scenery. It puts the camera on
  the thing, and it works on any seed.
- **Only then a bare root**, and if you are giving one, say so — "no deep link
  for this yet, walk out of the castle and turn left" — rather than leaving it
  to be discovered.

**If the feature you are asking about has no deep link, that is usually one
line to add** in `RIDE_DEEP_LINKS`, and worth adding rather than writing
directions. Say plainly which URL shows which thing when several are in
flight at once, because they will be on several ports.

**Deep links for reaching a ride under test without walking there:**
`/rail-race`, `/sky-cruiser` and `/ferris` skip straight past the welcome-back
prompt and board that ride the instant the park (or a freshly created
character, on a save-less profile) exists — see `RIDE_DEEP_LINKS` in
`main.ts`. `/slide` joins them when the ginormous slide lands. Add a ride by
adding one line there. It maps to a stall id and
works for **both** kinds of ride: a world ride that `Game.ts` wired into
`MiniGameHost.boardRide`, and a stall with a curtain mini-game behind it
(`/ferris` today), because `launchGame` tries the ride and falls back to
`MiniGameHost.open`.

**`/view` — a debug camera, for checking rendering without playing the game:**

```
/view?camPos=x,y,z&camDir=x,y,z&timeOfDay=HH:MM&space=0..1
```

Drops a free `PerspectiveCamera` at `camPos` looking along `camDir` (all
three are plain metres/a direction vector, comma-separated, no encoding
needed), and — only if `timeOfDay` is given — freezes the whole park at that
clock time via `gameStore.setPaused(true)`, the same mechanism the pause menu
uses. Frozen means genuinely still: `frameContext.dt` goes to zero for
everything, not just the sky, so NPCs, rides and animations all hold exactly
where they were rather than the sky alone matching the requested hour while
everything else keeps moving underneath it.

- Skips the welcome-back prompt and character creation the same way a ride
  deep link does (works on a save-less profile too) — see `parseDebugView` in
  `main.ts`, `Game.ts`'s `enterDebugView`.
- All four params are optional. `camPos` defaults to a wide establishing
  shot; `camDir` defaults to looking back at the origin from wherever `camPos`
  is (so `/view` with no params at all still points at the park, not empty
  sky); omitting `timeOfDay` leaves the clock running normally.
- `space=0..1` takes the sky **past night, towards space** —
  `DayNight.setSpaceFactor`, the blend the ferris wheel's climb drives. At 1
  the sky is flat space indigo whatever the clock says, the stars are full
  out, the sun and moon discs are gone and the park lights itself up below
  you. It is here so the look can be judged (and shown to the family) without
  a ride to climb. Unlike `timeOfDay` it does **not** freeze the park: it is a
  look override, not a clock.
- This is a URL a developer types, never a button a child presses — same
  spirit as `RIDE_DEEP_LINKS`, and it works against a production build too
  (not gated to dev), so it doubles as a way to inspect exactly what's live at
  `landofgoodplaces.blockstack.ing/view?...`.
- **Why this exists**: checking a single piece of geometry or lighting used to
  mean boarding a ride, faking button-holds through the input system, or
  pausing the whole engine and hoping nothing broke — all real techniques
  tried and discarded on 1 August while checking the rail race's spark-zone
  colouring. A URL that just puts the camera where you want it, frozen at the
  hour you want, is enormously cheaper than any of that.
- **The one non-obvious trap building this**: `dayNight.setPaused(true)`
  called directly does *not* stick — `Game.tick()` re-derives `DayNight`'s
  paused flag from `gameStore.get().paused` every single frame (that's how
  the real pause menu freezes the clock), so a one-off call straight to
  `DayNight` gets silently overwritten the very next frame. Go through
  `gameStore.setPaused(true)` instead, which is also the *better* result: it
  freezes everything, not just the sky.

## A stale service worker will waste your hour

This is a PWA, but as of 1 August the dev-mode service worker is **off by
default** (`vite.config.ts`'s `devOptions.enabled`) — a plain `npm run dev`
no longer registers one at all, so a fresh port just shows the current files,
like any other Vite project. Confirmed by measurement on 6 August: loading a
dev server in a clean browser profile gives `getRegistrations().length === 0`
and no caches, in a page where `isSecureContext` is `true` and a worker could
therefore perfectly well have registered.

**`npm run preview` is where a worker is expected, and where you test one.**
It serves the real `dist/` build with the real generated `sw.js` and precache
manifest. A dev-mode worker never could test the shipped one: `globPatterns`
precaches the *built* output, and dev has no built output to precache — so it
cached a different set of files by a different mechanism than the one that
reaches a phone. `VITE_PWA_DEV=1 npm run dev` still forces one on for the rare
job of poking the registration plumbing under HMR, but do not mistake it for a
test of what ships.

**A worker already installed on that port from an earlier session is still
live.** Turning the default off stops *new* ones being minted; it cannot
unregister one some tab registered last week, before this change, or under
`preview`, or from another agent's dev server on a port you have since
reused. That one keeps serving old JS to you, so your code changes silently
do not appear and a field you just added looks like it has vanished from your
own class. The cure is unchanged — in the page console:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
```

then hard-reload. If the game is behaving as though your edits do not exist
and you are on a plain `npm run dev` with no service worker running, suspect a
broken Vite HMR state instead — swapping many files at once under a *running*
dev server (a `git checkout`, a branch switch) can leave its module graph
inconsistent (`Failed to reload ...` in the console). Killing and restarting
the dev server fixes that in seconds; it is not worth debugging.

## How a deployed park notices it is out of date

Production polls `/version.txt` every two minutes (`src/version-check.ts`) and
nudges the service worker to check for a real update the moment that
disagrees with the bundle's own baked-in version — a browser only checks a
service worker for updates on navigation otherwise, and the family leaves the
game open on a phone for hours mid-session. `version.txt` is generated fresh
every build (`vite.config.ts`'s `versionFilePlugin`, straight into `dist/`,
never a tracked file) from the current commit; the poll is only a *trigger*
for the existing `onNeedRefresh` → `UpdateGate` flow, not a second update
path — pressing "Take me there!" still does exactly what it always did.

## Two definitions of one thing, kept in step by hand

The most common bug in this repo by a distance — six instances in one day: two
stand points on a booth, two `ParkBoundary` types, a hand-copied `GATE_RADIUS`
whose comment asserted it matched, a face patch tracking a surface it had left,
a backpack rule four of five shapes obeyed, three disagreeing exhibit lists.

**One owner; everyone else asks.** A comment promising that two numbers agree is
not a mechanism, and the copy is always found wrong by a child rather than by a
check. The next section is the worked example.

## Anything that looks solid must be solid

**A mesh a child can see and lean on has a collider that covers it, from every
approach.** Nothing derives a collider from a mesh, so the two are only ever
kept together on purpose — and a mesh whose collider has a hole in it is the
same disease as a check that cannot fail: it reads correctly, renders
correctly, screenshots correctly, and is wrong only when somebody walks
through it.

Jim, playing, 9 August 2026: *"The hotel building is not solid. I can walk
straight through it."* The tower's collision was a ring of eight chords built
by trimming **every** sector's start by the door's arc, when only the two
beside the doorway wanted trimming — so six evenly-spaced 0.32 rad gaps stood
open round the building, 1.49 m of clear air each against a 1.24 m-wide child,
and the "doorway" itself was 1.43 rad, nearly four times the door. Nobody could
see it: the crystals were drawn, the collider list was long, the code read
plausibly, and `check:hotel` had twenty probes about the *inside* of the hotel
and none about walking up to it. Measured afterwards on the built park, of 48
bearings marched at the facade, **22 got inside the shell and 8 reached its
middle**.

It also caused the *second* complaint the same day — *"the entry only
occasionally triggers if I step into exactly the right point"* — because you
could walk in beside the jambs and never touch the door's trigger band at all.
One hole, two bug reports, and neither found by a build.

So, for anything a child can walk up to:

- **Build the shell as geometry, not as trimmed angles.** A ring that closes,
  with the aperture cut where you want it, cannot lose a face to an
  off-by-one; a ring assembled from per-sector trims can, silently.
- **Probe it from outside, from many bearings, at more than one stride.**
  Marching a player-sized body at the thing and asserting where it stops is
  four lines (`scripts/check-hotel.mts` probe 22) and it is the only kind of
  check that can see this class of bug. A gap you cannot walk into at 5 cm a
  step you may still tunnel into at `PLAYER_LONGEST_STEP`.
- **Give the doorway the same treatment as the wall.** `CollisionWorld`
  sub-steps so a long frame cannot carry a child through a wall; a trigger band
  sampled once a frame has exactly the same hole pointed the other way. Ask
  what she *crossed*, not where she *landed* — `tapSpacing.ts`'s `bandCrossed`,
  against `Player.previousPosition`, is the one owner of that question.

## A face on a worn thing goes in its own UV texture, not a floating patch

RiPika's and Trilla's hood faces (`hoodShell.ts`/`hats.ts`) were built as a
separate decal mesh floating just in front of the hood's own dome. It was
wound the opposite way round from the dome, so its normals pointed at the
wearer's skull and `MeshToonMaterial`'s `FrontSide` culled it: invisible in
the running game while the mesh, the texture and the code all looked correct
on inspection, and *unfixable* by moving it further out — the first fix
tried, padding the stand-off distance, could not have worked, because the
mesh was never being drawn at all. Found the hard way (31 July 2026) by
casting a ray in from outside and finding it hit nothing. Fixed by baking the
face texture directly into the wearable's own UV mapping instead of a second
mesh — a second mesh that has to be positioned right, every time, is a second
place for exactly this kind of bug to hide.

**When a worn item needs a painted face (or any flat appliqué), paint it into
that item's own UV space. Do not add a second mesh positioned by a formula
that has to track the first one's surface.** One surface, one texture: there
is then no second formula that can fall out of sync when the first one
changes. This does not conflict with ART_DIRECTION.md §7's "nothing is
sculpted, the face is flat appliqué" rule — only *where* the flat texture
lives changes, not the no-sculpting principle.

## Handoff files

You can be pulled at zero warning. Keep a short `HANDOFF-<your-task>.md` on
your branch, updated at checkpoints — enough that a replacement can take over,
but never so much that writing it costs more than recovery would. Record
findings (a root cause, a decision, a formula) as soon as you have them, not
at the end.

## Before you design anything

- **GAME_DESIGN.md** is the canonical record of what the family asked for. Its
  absolute rules — HIGHLIGHT (rainbow outlines), TEXT/UI-SCALE, CONTROL (never
  tank controls) — apply everywhere, always.
- **ORDER-OF-WORK.md** is the authoritative order. It exists because a good
  half of the backlog invalidates other parts if taken in the wrong order.
- **ARCHITECTURE.md**, **ARCHITECTURE-DECISIONS.md**, **ART_DIRECTION.md**.

This is a game a father is building with his six-year-old daughter. When a
trade-off is close, pick the one a six-year-old will enjoy more.

## PRs

Raise with `gh pr create`. **Do not merge your own work** — every PR gets two
peer reviews plus QA, and the Overseer merges.

**Reviewers:** `gh pr review --request-changes` will be refused — every agent
commits as the same GitHub user, so GitHub thinks you are reviewing your own
PR. Post the review as a comment instead and **state the verdict plainly in
the first line** ("Verdict: changes requested"). The Overseer reads the text,
not the review state.
