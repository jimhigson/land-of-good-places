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

## A stale service worker will waste your hour

This is a PWA. A service worker precached from **another agent's dev server on
a different port** can keep serving old JS to yours: your code changes silently
do not appear, and a field you just added looks like it has vanished from your
own class. If the game is behaving as though your edits do not exist, this is
why. In the page console:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
```

then hard-reload. Suspect it early rather than debugging code that is correct.

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
