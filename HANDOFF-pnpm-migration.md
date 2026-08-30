# Handoff — pnpm migration (#400)

Branch `build/pnpm-12-rc`, worktree `.claude/worktrees/pnpm-migration`, cut
from `origin/main` @ `8e30c11d`.

## The version question, settled

Jim's ruling, 30 Aug: *"Use pnpm 12 rc not current stable release."*

**There is no current pnpm 12 RC.** The last was `12.0.0-rc.11` (24 Aug);
pnpm 12 went **stable on 26 Aug**, four days *before* the ruling, and
`12.1.0` landed 29 Aug. So the ruling rested on a premise that had already
expired.

It still resolves cleanly, because npm's `latest` tag is **still `11.24.0`** —
pnpm 12 sits on `next-12`. "The 12 line, not the current stable release" is
therefore exactly what Jim asked for. Raised with the Overseer rather than
guessed, put to Jim, who chose **`12.1.0`**. That is what is pinned.

Do not silently re-pin this. If it needs changing, it is a decision, not a
detail: it is load-bearing for the lockfile, `packageManager`, five workflows
and the docs.

## Watch out: `"pnpm run"` contains the substring `"npm run"`

Any `grep`/`perl` for `npm run` matches inside `pnpm run` too, so a naive
"residual npm" check reports false positives and a naive replace mangles
already-converted text on a second pass. Every check and replace here uses a
negative lookbehind, `(?<!p)npm run`. This bit twice before it was spotted.

## Done, committed and pushed

1. `5733bfcb` — `packageManager: pnpm@12.1.0`, `pnpm-lock.yaml` in,
   `package-lock.json` out, 58 `npm run` → `pnpm run` inside package.json.
2. `1a3fc17e` — all **five** workflows (not two: `deploy`,
   `procgen-invariants` ×2 jobs, `pr-preview`, `update-adoption`,
   `live-version`). `pnpm/action-setup@v4` goes *before* `setup-node`,
   because `cache: pnpm` needs the binary to exist. Version comes from
   `packageManager`, so there is one place to bump.
   `npm ci`'s `--fetch-retries` flags moved to a new `.npmrc` rather than
   being dropped. `live-version.yml` gets the binary but deliberately **no**
   install and **no** `cache: pnpm` — that job has no `node_modules` by design.
3. `7c04a58f` — live-instruction docs. `HANDOFF-*.md` deliberately untouched
   (historical records). CLAUDE.md gains the install line + an explicit "do
   not symlink another worktree's `node_modules`", and its "chain is 16
   steps" corrected to 47.

## Do not touch

`deploy.yml`'s `timeout-minutes: 30` and `cancel-in-progress: false`. Both
were hard-won when the publish job was killed at a 15-minute cap and reported
as `cancelled`, leaving the site stale for hours. The diff there is the
install block only — verified.

**PR #397 also edits `deploy.yml`.** Whichever lands second rebases
deliberately.

## Gates

| gate | exit |
|---|---|
| `pnpm install --frozen-lockfile` | **0** |
| `pnpm exec tsc --noEmit` | **0** |
| full 47-step `build` | **0** |
| `test:procgen` (not in chain) | **0** — 458 tests, 14 files |
| `check:castle` | **0** |
| `check:park` | **0** — 19/19 attractions, 240/240 waypoints |
| `blend:castle` → `pack:castle` round trip | **0** |

**Build chain compared by name, not count** — captured from
`git show origin/main:package.json` vs this branch, package-manager-agnostic:
**47 vs 47, none dropped, none added, order identical.** A count alone would
not catch a substitution.

**And 47 steps *executed*, which is a different claim.** pnpm echoes each
script body as a `$ ` line, so every named step was matched to its own body
in the log: 45 that way, `vite build` by `✓ built in 428ms` plus `dist/`
artifacts, and `tsc --noEmit` positionally — it sits in a `&&` chain and the
steps after it ran, which is only possible if it exited 0. `check:park-boot`
passed inside the chain, so the #324 flake did not appear.

`blend:castle` rewrote `art/blend/castle.blend` (Blender always does; not
caused by this change) and it was reverted. The *shipped* asset came back
byte-identical to `origin/main`.

## The disk saving, measured

`du` **cannot see it on macOS.** pnpm's install log says packages are
*cloned*, not hardlinked: on APFS it uses copy-on-write `clonefile`, which
shares physical blocks but gives every file its own inode. So `du -csh`
across two worktrees reports 358 MB — 179 + 179, apparently no sharing at
all — and would have made this look like a failure. Measure free space
instead:

| | |
|---|---|
| `du` per worktree (misleading) | 179 MB |
| **true marginal cost of a second worktree** | **7 MB** |
| npm's cost for the same worktree | 179 MB, unshared |
| second-worktree install time | **1.35 s** |

**96% off per additional worktree.** At the 169-worktree peak in #400:
npm ≈ 30 GB, pnpm ≈ 1.3 GB.

The shared store at `~/Library/pnpm/store` is 10 GB, but it is a one-time
cost shared across every project on the machine, and `pnpm store prune`
reclaims whatever is unreferenced.

## Still owed

- PR referencing #400, quoting Jim's ruling.
- **Merge authority granted** for this PR only, when everything is genuinely
  green. Then prove the site still publishes with `pnpm run check:live-version`
  — the check that asks what is actually being served, not whether a run went
  green — and report what live shows.

## If a red appears

`check:park-boot` is a known load-dependent flake (#324). Re-run it quiet,
and run it on `origin/main` too, before believing it is yours.
