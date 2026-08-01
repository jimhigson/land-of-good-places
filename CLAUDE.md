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

**Deep links for reaching a ride under test without walking there:**
`/rail-race` and `/sky-cruiser` skip straight past the welcome-back prompt and
board that ride the instant the park (or a freshly created character, on a
save-less profile) exists — see `RIDE_DEEP_LINKS` in `main.ts`. Add a ride by
adding one line there; it reuses whatever stall id `Game.ts` already wired
into `MiniGameHost.boardRide`.

**`/view` — a debug camera, for checking rendering without playing the game:**

```
/view?camPos=x,y,z&camDir=x,y,z&timeOfDay=HH:MM
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
- All three params are optional. `camPos` defaults to a wide establishing
  shot; `camDir` defaults to looking back at the origin from wherever `camPos`
  is (so `/view` with no params at all still points at the park, not empty
  sky); omitting `timeOfDay` leaves the clock running normally.
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
like any other Vite project. Only `VITE_PWA_DEV=1 npm run dev` — testing the
manifest/update-toast machinery itself — turns it back on, and only for that
one run.

If you deliberately ran with `VITE_PWA_DEV=1` (or you are testing the real
production build via `vite preview`), the old trap still applies: a service
worker precached from **another agent's dev server on a different port** can
keep serving old JS to yours, so your code changes silently do not appear and
a field you just added looks like it has vanished from your own class. In the
page console:

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
