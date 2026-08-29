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

## Who does what

Five roles. You are told which one you are; if you were not told, you are an
Engineer.

### Engineer

**Default model: Opus.** Picks up a GitHub issue, implements it, ships a PR.

- **One engineer per ticket, always. Run as many at once as there are
  tickets ready** — engineers are the unit that scales here, and they only
  collide if two are put on the same issue.
- Verify your work **in a real browser** if one is available to you — see
  "The browser" below for who owns it and how to ask. If no browser is
  available, build-verify and list in the PR exactly what needs visual QA.
- **Close every browser instance you opened and kill your own dev server by
  PID when you finish.** A browser left open is the next agent's blocked
  turn.
- Need a 3D asset you cannot make from primitives? **Request it from the 3D
  Artist** rather than modelling it inline — see ART_DIRECTION.md for when
  something has to be authored geometry rather than procedural.

### 3D Artist

Produces assets for Engineers, in Blender. **Runs on Jim's Mac only** — both
routes below need the Blender on that machine, so this role cannot run in a
sandbox or a cloud session.

There are **two ways to drive Blender, and the difference decides how many
Artists can run at once.**

- **Headless CLI — the default, and unlimited.**
  `/Applications/Blender.app/Contents/MacOS/Blender --background --python <script>`
  Each run is its own process, so **any number of Artists can work in
  parallel**. This is how the bridge stone kit was actually built
  (`art/blend/bridge_stones_*.py`, `npm run blend:bridge-stones`). Build,
  export and render as committed scripts: reproducible, diffable, and
  re-runnable by whoever comes next.
- **The live MCP session — one at a time.** The `mcp__blender__*` tools drive
  the single Blender window open on Jim's machine, so **only one Artist may
  own it**, same rule as the browser, and the Overseer says who. Use it for
  interactive inspection, not as the default way to build.

We got this wrong on 29 August: this file said one Artist at a time because
there is one Blender, which queued work for no reason. The live *session* is
the scarce resource; Blender itself is not.

Two rules whichever route you use:

- **Every script reads shared constants from one owner; never copy a number
  between scripts.** The bridge's build script read them properly while its
  render script hand-copied them and drifted, so the committed renders were
  of a different bridge than the branch built.
- Inspect before you change anything, respect existing names and structure,
  and never destructively modify an object without asking. Follow
  ART_DIRECTION.md and record what you produced in ASSET_MANIFEST.md.

### Overseer

Allocates the browser and the Artist, decides who works on what, and merges.

- **Runs a loop that checks on every other agent every 10 minutes, and
  restarts any that have terminated or are deeply stuck.** Agents die
  without warning here — a dropped connection, a killed session — and the
  handoff file on their branch is what a restart picks up from. Unwatched,
  a dead agent looks exactly like a slow one.
- Merges PRs. Nobody merges their own work.
- **Sizes the fleet to demand — spawns and retires agents without asking.**
  Jim, 29 August 2026: *"Manage the number of artists and spawn and retire
  Opus5 agents to match demand."* Standing authority, not a per-case
  approval. If three tickets are ready, run three engineers; if the asset
  queue is long, run several headless Artists; when a workstream is done,
  retire its agent rather than leaving it idle. Default to Opus.
- Speaks to Jim only as set out in "The Overseer stays silent" below.

### Reviewer

Reviews a PR someone else raised (see "PRs" below for how many per PR).
`gh pr review --request-changes` will be refused — every agent commits as
the same GitHub user, so GitHub thinks you are reviewing your own PR. Post
the review as a comment instead and **state the verdict plainly in the
first line** ("Verdict: changes requested"). The Overseer reads the text,
not the review state.

### QA

Signs off the routine per QA-PLAYBOOK.md; escalates anything ambiguous to
the Overseer rather than signing it off.

## Committing

- **Commit after every meaningful edit, and push.** Not every coherent chunk,
  not every compiling milestone — every edit that would be annoying to redo. A
  commit is cheap; re-deriving a change you already reasoned your way to is not.
- **Push, don't just commit.** A local-only commit still dies with the
  worktree, and — just as costly — it is **invisible to the Overseer**, who
  watches pushed branches to tell a working agent from a dead one. On 29
  August an engineer committed diligently for 52 minutes without pushing and
  was chased as missing while it was in fact fine. Push after every commit.
- Do not save one big commit for the end. The API drops connections and an
  uncommitted branch dies with you. On 29 August 2026 three engineers were
  killed mid-response thirteen times in one morning by streaming failures
  alone; every one of them resumed without losing work, and the only reason
  is that their edits were already committed. The two that had nothing
  committed when they died had to start their step again.
- It does not matter that a commit is small, or that the branch history ends
  up long. Nobody has ever been harmed by a granular history on a feature
  branch; plenty of work has been lost to a tidy one that never got made.
- Never `git add -A` or `git add .`. Name the files you mean.
- `.claude/` is gitignored; worktree gitlinks must never reach `main`.

## Zero tolerance for CI failure

**ZERO failures in CI are acceptable.** A failure in CI is just as serious
as a failure of the deployed application, and must never be brushed aside —
not as "pre-existing," not as "unrelated to this PR," not as "known,"
not as anything else. A red check on `main` is `main` being broken, in
exactly the same sense a crash in the shipped game would be.

**Flakiness is equal to failure.** No retries to gloss over a flaky check —
the fix is to find and remove the root non-determinism, regardless of how
hard that is. A check that fails one run in five is not "mostly passing," it
is failing; treat it exactly like a check that fails every time.

**Flaky is equal to failing is equal to a complete failure to deliver.**
Live this from here on: a red check anywhere, on any branch, gets root-caused
and fixed before anything else proceeds — never disclosed-and-left, never
"someone else's problem," never deferred because a PR's own diff didn't
cause it. If a check is red when you find it, fixing it is the work now.

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

## Procgen backtracks on collision, always

Jim, 22 August 2026, on the bridge planner clamping to a hard-coded minimum
width and shipping a known-too-close edge rather than finding a placement
that actually clears: **"the procgen should backtrack on collisions and make
some different decisions until it works - literally the same way the procgen
always works."** This is the standing rule for every generator in this
codebase, not a one-off fix for bridges: on a real collision, try a different
decision — a different width, position, or orientation, clearing a movable
obstacle the way pylon placement fells foliage, or as a last resort falling
back to a simpler alternative (a level crossing instead of a bridge) — never
shrink to a floor and accept a result that still doesn't clear.

**Because every feature generates step by step at the same time, not one
system finishing before the next starts, "backtrack" means checking the real
collision world as it stands at that moment, not just the two or three
obstacle classes a given generator happens to know about by name.** A
generator that only checks itself against a hand-picked obstacle list will
silently miss whatever a sibling system placed there — the exact shape of
issues #317 and #319. If a generator in this codebase does not yet backtrack
this way, that is a bug in the generator: refactor it until it does, rather
than documenting the gap as a known limitation.

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

- **`/spawn?pos=x,z&facing=deg`** whenever the thing is somewhere he would
  **stand at or interact with**, rather than only look at — a moved prop, a
  fixed collider, a doorway, a bug's own square metre. It puts the real,
  controllable character on that exact spot, so he can walk about, bump into
  things and press the button, which is the only way to answer "does this
  feel right?". Works on any seed and on any coordinate, so nothing has to
  be wired up in advance. This is the default answer now.
- **A ride deep link** — `/rail-race`, `/slide`, `/sky-cruiser`, `/ferris`
  (the list below) — when the thing to see is a **specific ride**, boarded.
  `/spawn` cannot board one; these can, and they still skip the walk.
- **`/view?camPos=...&camDir=...`** when it really is a **pure look-at-this**:
  a rooftop, the boundary, the sky at 21:40, a bit of geometry seen from an
  angle no player could stand at. A free camera goes where a child cannot,
  and freezes the clock, which `/spawn` deliberately does not.
- **Only then a bare root**, and if you are giving one, say so — "no deep link
  for this yet, walk out of the castle and turn left" — rather than leaving it
  to be discovered.

Between the top two: **if the answer to "what should he do when he gets
there?" is anything other than "ride it", use `/spawn`.** Between `/spawn` and
`/view`: **if he needs to be *in* the park rather than *above* it, use
`/spawn`.** Sending a bare root for a spot that has coordinates is now the
same mistake as sending a bare root for a ride that has a deep link — the
coordinates are free, and you already have them from whatever you were
measuring.

**If the feature you are asking about has no deep link, that is usually one
line to add** in `RIDE_DEEP_LINKS`, and worth adding rather than writing
directions. Say plainly which URL shows which thing when several are in
flight at once, because they will be on several ports.

**The same rule applies to PR preview URLs, not just local dev servers.**
When handing Jim a Cloudflare Workers preview link (`wrangler versions
upload --preview-alias`'s `pr-<number>-<commit-sha>-land-of-good-places.blockstack.workers.dev`
— a new URL every push, with the real git commit hash in it so it's
traceable to a specific commit; old versions are **not** deleted — Cloudflare
rejects this repo's token for that — so always pull the URL fresh from the
PR's current "Deploy PR preview" comment/check, never reuse or guess an
older one), append the feature's deep-link path exactly as you would for
`localhost` — the same
`origin/main..HEAD` build sitting behind a different host is still a park
he has to find his way around blind on a root URL. Before opening a PR (or
before handing a preview link over if the PR is already open), check
whether the feature has an existing entry in `RIDE_DEEP_LINKS` or a
documented `/view` camera; if it doesn't and reaching the feature would
otherwise mean walking or triggering game state, add one on that PR's own
branch — it travels with the branch into the preview build for free. Not
everything needs one: an input-handling or gesture fix (pinch-to-zoom,
tap-and-hold) has no "place" to link to — say so plainly instead of forcing
a link that adds nothing.

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

**`/spawn` — the real player, standing anywhere you like (#320):**

```
/spawn?pos=x,z&facing=deg
```

Skips character creation and the cat bus, then puts the **actual character**
on that coordinate, ready to walk. Not a camera: collision, interact zones,
the parade, the HUD and every control are live on the first frame, so the
thing you sent somebody to look at can be walked around, bumped into and
pressed. Jim, 21 August 2026: *"we need a way to go straight into the game,
skipping character creation, and the bus, and with the player starting at a
given co-ordinate."*

- **`pos=x,z`** — plain metres, comma-separated, no encoding, the same style
  as `/view`'s `camPos`. **Two numbers is the normal form**: the height is
  then sampled from the ground under her, which is the answer anyone reading
  a coordinate off a top-down view wants and cannot supply. `pos=x,y,z` is
  accepted too, in the same order `camPos` takes, for the places where the
  ground is not a function of the terrain — a deck, a bridge, a castle floor.
- **`facing=deg`** — the same yaw `Player.facing` keeps, in degrees: `0` looks
  along +Z, `90` along +X. Optional; omitted, she turns to look at the middle
  of the park, so a URL with no bearing in it still opens on something.
- **Works on a fresh profile and on a returning save**, exactly as the ride
  deep links do — the welcome-back prompt is skipped either way, because
  there is nobody to ask. On a returning save it deliberately ignores
  `save.place` (everything else the save carries is kept): a save written
  inside the hotel restores by position *plus* room adoption, and teleporting
  out afterwards would leave her standing in the park inside a hotel room's
  bounds.
- **A bad coordinate never breaks the boot.** An unreadable `pos` logs a
  console warning and opens the park at the ordinary spawn instead — these
  are typed by hand, often off a screenshot, and a missed comma should not
  fail in front of whoever was sent the link.
- **For an interior, use the `/hotel…` links, not this.** Those bind the play
  bounds to the room they land in; `/spawn` drops her at a world coordinate
  and does not, so a coordinate inside a building gets you the geometry
  without the space.
- Same spirit as the two below: a URL a developer types, never a button a
  child presses, and it works against a production build too — so
  `landofgoodplaces.blockstack.ing/spawn?pos=...` stands you on the live park.
- See `parseDebugSpawn` and the `DeepLink` union in `main.ts`, and
  `Game.enterDebugSpawn`.

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

If the game is behaving as though your edits do not exist — a field you just
added looks like it has vanished from your own class — **use the
`stale-dev-server` skill**. It covers the stale worker left on your port by an
earlier session, the broken Vite HMR module graph after a branch switch, and
why `npm run preview` is the only honest test of the shipped worker.

This is about an agent's own local dev server, never a real player. A real
person stuck on stale content on `landofgoodplaces.blockstack.ing` is the bug
in "How a deployed park notices it is out of date" below — go fix the update
mechanism, do not hand them a console command.


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

**And the page adopts a waiting build itself, on a reload.** `prompt` mode
parks a downloaded build in the browser's `waiting` state, and **a reload
cannot promote it** — the tab being reloaded is still a client of the old
worker for the whole navigation, so the old one is never the last client to
go. That is issue #341, and it is why a real player sat on a months-old
bundle through reload after reload while the gate correctly re-offered every
time. So `src/update-adoption.ts` owns one question — *has anyone touched
this page yet?* — and on a page nobody has, `UpdateGate` presses its own
button. Once she is playing, it waits to be asked, because a swap means a
reload and a reload mid-ride loses the ride; that is also why `skipWaiting`
stays **false** in `vite.config.ts` (it would swap the precache under a
playing page, and the park generates through a dozen lazy imports that would
then 404). `npm run check:update-adoption` drives two real builds and one
persistent Chromium profile through exactly that, both directions.

**If this mechanism does not get a real player onto a new deploy on its
own, that is a bug in the app, full stop — never a known quirk to route
around.** Jim, 26 August 2026, after being told to open devtools and run
`serviceWorker.getRegistrations()`/`caches.delete()` by hand on the live
site: *"I don't care what CLAUDE.md documents, write into that [doc] not
to use this as an excuse and a failure to reload is an unambiguous bug in
the app... I'm not going to type commands to work around your bugs."* He
is right, and the line below is the one that made that mistake possible:
it let an agent read "known failure mode" as "acceptable failure mode."
It is not. A player — Jim, Eleri, anyone else who ever opens this game —
must never be handed a console command, an incognito-window instruction,
or any other manual step to see the deploy that is supposed to already be
live. If `version.txt`'s poll, the SW update check it triggers, or
`UpdateGate` itself is not reliably getting a real open tab onto the new
build, root-cause and fix *that*, with the same zero-tolerance standard
this file already holds CI to — do not note it here as a thing to expect.
The next section's console commands are for an **agent's own local dev
server** while building a feature, never for a real player on the
deployed site; if you catch yourself about to hand one to Jim, that is the
signal the real bug is still open.

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

Paint a worn item's face (or any flat appliqué) into that item's own UV space.
Never add a second mesh positioned by a formula that has to track the first
one's surface. Full account of the bug this came from, and why the obvious fix
could not have worked, is in `src/art/models/CLAUDE.md`, which loads whenever
you work in that directory.


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

## QA is not optional, and it is not paperwork

On 17 August a full pipeline of "QA approved" PRs shipped a furniture piece
sitting square across a doorway, a pet that never got into its bed, and a
"grid-aligned" park whose paths were a wiggly, un-grid, un-circular mess —
three separate features, three separate QA sign-offs, and not one of them
had ever actually been looked at. Every "QA" pass had been `tsc` plus the
check scripts, re-reading what the build already said. That is not QA. It
proves the code is *sound*; it says nothing about whether the game is
*right*. Only eyes on a rendered frame can say that, so:

**The QA agent's job, no exceptions: open every feature the PR touches, in
an actual running browser, and look at it.** Work out what "correct" looks
like for a person playing the game, then go and see whether that is what is
on screen. A doorway-clearance fix means standing a character in every
doorway the PR touches and confirming nothing blocks it. A "pets sleep in
beds" fix means putting a pet-owning character to sleep and watching the pet
actually walk to a bed. A grid-aligned-park fix means looking at the
top-down camera, not inferring the shape of the paths from a segment-length
assertion. If a feature can be seen, QA must see it before it can be signed
off. "The checks pass" is an engineer's claim, not a QA verdict.

**The QA agent runs on Opus, not a smaller or faster model.** This is the one
stage in the whole pipeline that is pure judgement — does this look right,
does this play right, is this actually what was asked for — and it carries
the most weight of any gate here. Give it the model that can tell the
difference.

**Before a sandboxed QA agent does *any* QA work, update the sandbox's Chrome
to the latest available version first.** An old bundled browser can render,
or fail to render, differently from what a real player sees — the same
"old tool, new input" trap CLAUDE.md's Node section warns about elsewhere.
Do this before opening a single page, not after finding something odd.

**If a real browser is not available to the QA agent — for any reason: no
chrome-devtools MCP connected, no ownership granted, a sandboxed environment
with no route to a rendered page, anything at all — every agent on this
project halts immediately, not just the one PR waiting on QA.** New
engineering work, new PRs, new merges: all of it stops until browser-based
QA is possible again. Do not quietly fall back to build-verify and call it
QA. Do not write "no visual QA was performed" in a handoff and let the PR
proceed to sign-off anyway — that sentence is a stop sign, not a footnote.
The correct response to "I cannot open a browser" is: stop everything, tell
the human plainly that QA is blocked and why, and wait for them to unblock
it. An unverified backlog growing while nobody can check it is not
progress — it is debt nobody can see accumulating. Five minutes of the
human's time to unblock QA costs far less than one more feature shipping
unseen.

## Send the screenshot, don't just describe it

18 August, Jim's own ruling: **it is cheaper for him to look at a screenshot
than to open the app**, most of the time. A QA verdict of "the desk is
clearly visible from the entrance" is a claim; the frame it was read off is
the evidence, and the evidence is worth more than the claim it supports —
this is the same principle as "quote the count off the screen, never the one
you expected" applied to pixels instead of numbers.

So: **whenever a QA pass (or any agent) produces a screenshot of something a
human would judge by eye — layout, clearance, a UI element, "does this look
right" — send the actual image to the Overseer, who relays it to Jim.** This
is not limited to QA sign-off: any new visual feature, reported up, should
come with a screenshot rather than a paragraph describing one. Text is for
what a screenshot can't show (measurements, verdicts, what was clicked);
the screenshot is for what it can.

- **QA/engineer agents**: when you capture a screenshot worth a human's
  judgement, hand it to whoever you report to (the Overseer, if you were
  dispatched by one) rather than only describing its contents in your
  summary. Keep describing what you saw in words too — the image is in
  addition to the verdict, not instead of it.
- **The Overseer**: relay every such screenshot to Jim promptly, don't hold
  a batch waiting for "the full picture" — a screenshot from twenty minutes
  ago that's still sitting in a subagent's output is exactly the kind of
  work that reads as progress but isn't, until it's actually in front of
  him.
- **Backfill, don't just apply forwards.** If a QA pass already ran and took
  real screenshots before this rule existed, don't let that evidence stay
  buried in a subagent transcript — send it retroactively.

**And it belongs on the issue, not only in chat.** Jim's own follow-up rule,
18 August: any design feedback he gives — verbally, mid-conversation — gets
posted onto the relevant GitHub issue or PR as a comment, and any screenshot
that informed it (or that a QA/engineer pass produced afterward) gets
attached there too. A conversation is not a record; the issue thread is.
Chat is where the discussion happens, but the next agent to pick up that
issue reads the issue, not this transcript — feedback that only exists here
is invisible to them. GitHub issue comments don't take a raw local file
path, so host images by committing them to a dedicated orphan branch (e.g.
`qa-screenshots`) and linking the `raw.githubusercontent.com` URL — keeps
binary screenshots out of `main`'s and every feature branch's own history.

## Agents persist and stay current

Don't exit the moment one task is done — stay resumable (via `SendMessage`)
so the Overseer can hand you follow-on work without a fresh spin-up. Before
starting real work, and again before opening or updating a PR, `git fetch
origin main` and rebase onto it — a branch built on a stale base can silently
carry an already-fixed bug back in (PR #311 rebuilt the disco ball at its old
position because it branched before PR #306, which moved it, had merged).

**Check your diff before every push — with three dots, not two:**

```
git diff --stat origin/main...HEAD
```

Account for every file. A deletion there is one **you** made, and if you did
not mean to make it, it is a revert about to ship.

**Use three dots. Two dots will lie to you**, and on 29 August it lied to
three agents in a row. `origin/main..HEAD` (two dots) diffs the two commits,
so every file added to `main` since you branched appears as a **deletion in
your branch** — 48 files on one branch that had touched 10. Two of those
agents reported a catastrophic latent revert; one Overseer broadcast the
alarm fleet-wide and wrote this very section wrongly before checking. There
was nothing there. `origin/main...HEAD` (three dots) diffs from the merge
base and shows only what you actually changed — which is also what GitHub
merges, so it is the honest question.

Rebasing makes the two agree, which is why rebasing "fixed" the phantom and
made it look real. **Rebase because your base is stale, not because a
two-dot stat frightened you.**

The residue of truth: a badly resolved conflict during a rebase *can* delete
someone else's work, and then the deletion is yours and three-dot shows it.
That is what you are looking for.

## Editing this file

When Jim asks for a change to CLAUDE.md itself, edit it and push straight to
`main` — no worktree-and-PR round trip, no asking first.

## The Overseer stays silent

Jim, 22 August 2026, after an essay-length message buried the actual open
questions in it: **"The overseer to the user should be SILENT - every word
said that is not either presenting work that is ready to review or a
question on how to progress is STRICTLY FORBIDDEN."**

Every message to Jim is one of exactly two things: work that is ready for
him to review, or a question he needs to answer to unblock progress.
Nothing else — no status narration, no explanations of what happened and
why, no reassurance, no restating what he already knows, no defending a
past message. If a message has neither a ready-to-review deliverable nor a
live question in it, do not send it.

## PRs

Raise with `gh pr create`. **Do not merge your own work** — every PR gets
**one** peer review plus QA, and the Overseer merges.

One reviewer, not two. Jim's ruling, first given 1 August 2026 and confirmed
29 August: a second reviewer on the same diff bought nothing the first had
not already found, and cost a whole agent. Spend that agent on the next
ticket instead. If a diff is genuinely too large or too risky for one
reviewer to hold, that is a sign to split the PR, not to add a second pair
of eyes to an unsplittable one.

**Anything invisible to a player: merge it as soon as a QA agent has looked
at it. Do not ask Jim.** Jim, 27 August 2026: *"for anything invisible, just
merge it now so long as a qa agent already looked at it"*, and, the same
minute: *"I can't approve what I can't see."* That is the whole reasoning —
asking him to sign off on a change with nothing on screen spends his
attention and gives him no way to judge it. The approval was never real.

**Invisible** means a player would not notice it: a check script, a CI
workflow, a seeded RNG, a regression test, a lockfile, a docs or comment
change, a refactor with no behavioural change, a service-worker or caching
fix whose whole point is that a fresh visit looks identical, a deep link
only a developer types. If in doubt, ask whether you could write the
one-sentence "you will see X when you do Y" that the preview-link rule
above demands — if you cannot, it is invisible, so merge it rather than
sending him a link he cannot judge.

**Visible changes still wait for Jim**, and still get their preview link
plus that sentence. Anything a child could see in the park — geometry,
layout, colour, animation, UI, controls, a new item — is his call, however
small and however confident you are.

The bar before an invisible merge is unchanged in every other respect: the
normal code review, real CI green on the actual head commit (not a local
run), and **a QA agent having actually looked** — which for an invisible
change means having measured the thing it claims to fix, not merely having
watched `tsc` pass. A check that was never broken deliberately and watched
go red has not been QA'd, whatever the exit code says.

This supersedes the earlier one-PR-wide `/spawn` exception (issue #320,
21 August 2026), which is now just an instance of this rule.

**Reviewers:** `gh pr review --request-changes` will be refused — every agent
commits as the same GitHub user, so GitHub thinks you are reviewing your own
PR. Post the review as a comment instead and **state the verdict plainly in
the first line** ("Verdict: changes requested"). The Overseer reads the text,
not the review state.

**Never give Jim a link to a PR. Give the deploy preview, always.** Jim,
26 August 2026: *"I want preview links. Add to CLAUDE.md to never give links
to PRs, only preview deploys."* This is absolute, and it is not the earlier
"unless he asks" version — a `github.com/.../pull/NNN` URL does not belong in
a message to Jim at all. A PR page is a diff and a comment thread; it does not
show him the feature, and he does not merge by clicking one (the Overseer
merges through its own workflow).

What to send instead: the Cloudflare Workers deploy-preview URL with the
feature's own deep link appended —
`https://pr-280-a1b2c3d-land-of-good-places.blockstack.workers.dev/rail-race`,
never `.../pull/280` — exactly per this file's own "hand over the URL of the
thing itself" rule above. **Pull the preview URL from that PR's "Deploy PR
preview" check run or its posted comment; never construct one by hand.** The
posted comment is regenerated on every push and always names the newest
build, so the newest such comment is the only trustworthy source.

Referring to a PR by *number* in prose ("#340 adds the `/bridge` link") is
fine and often necessary — it is the clickable `github.com` URL that is
banned. If a preview genuinely does not exist for something (a CI-only
change, a workflow edit, a docs commit), say so plainly rather than
substituting a PR link to fill the gap.

**Every preview link carries one sentence saying what to look at — and if
there is nothing to look at, do not send the link.** Jim, 27 August 2026,
after being sent a preview of a service-worker fix and finding a game that
looked exactly like production: *"all you gave me was a link that looks
exactly the same as prod with literally nothing for me to check. Stop
wasting my time."* He was right. Opening a link, hunting for a difference,
and finding none is worse than being told nothing at all — it spends his
attention and returns nothing.

So, two rules, both absolute:

- **One sentence, before the link, naming the thing he will see and where.**
  Not what the PR does — what is different on screen and how to get to it.
  "Walk in from the gate; you now cross the railway on a bridge instead of
  a flat crossing" is a sentence. "Fixes the keyring outline" is not: it
  says nothing about what he is looking for or where to stand.
- **If the change is invisible or unplayable, send no link at all.** A CI
  check, a workflow edit, a seeded RNG, a regression test, a docs commit, a
  service-worker fix whose whole point is that a fresh visit looks
  identical — none of these has anything for him to see. Say in one line
  what changed and that there is nothing to look at. Do not manufacture a
  link so the message has one in it.

The tell that you are about to break this: you are writing "load it and
then reload" or "you won't see anything but…". If you cannot finish the
sentence "you will see X when you do Y", there is nothing to send.

Bear in mind that a *fresh* preview URL is a browser profile he has never
visited, so anything that only manifests for a returning player (a stale
cache, a save, an installed service worker) is by construction invisible
there. Those get verified by an agent's own measurement and reported as a
result, never handed to him as something to check.

**One caveat found the hard way, 26 August 2026:** this sandbox's egress
policy returns **403 for `*.workers.dev`**, for `curl` as well as for a
headless browser, so an agent here **cannot verify a preview URL it hands
over**. Two links were given to Jim that failed on him before this was
understood. So: take the URL from the PR's own preview comment (never
assemble it), and if you have not been able to load it yourself, say that
in the same breath rather than implying you checked it. The live domain
`landofgoodplaces.blockstack.ing` *is* reachable by `curl` from here, so
anything already merged can and should be verified for real.
