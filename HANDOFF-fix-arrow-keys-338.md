# HANDOFF — issue #338, "cursor keys no longer walk the character"

Branch `fix-arrow-keys-338`, worktree `.claude/worktrees/fix-arrow-keys-338`.

## Headline

**The bug does not reproduce against the bytes that are actually deployed.**
Arrow keys, WASD and tap-to-move all walk the character on every boot path
tried, including a production build whose chunks are *byte-identical* to
`landofgoodplaces.blockstack.ing`'s. No fix has been made to the input path,
because no defect was found in it. What this branch adds is the check whose
absence is the real, uncontested part of #338: nothing in this repo asserted
that a key press moves a girl.

Findings and the open question are posted on the issue itself:
https://github.com/jimhigson/land-of-good-places/issues/338#issuecomment-5425862320

## What was proved, with numbers

Deployed commit is `b910cfb` (`/version.txt`), which is `origin/main`. A local
`vite build` of that commit produces chunks with the same content hashes, and
every one compares byte-identical:

```
SAME clearance-C5Cok4_u.js  SAME index-BolPVpIr.js   SAME save-TgIdTesq.js
SAME generate-C8bDHmWe.js   SAME layout-_En1B_g2.js  SAME three.core-CSVaJEYX.js
SAME index-BZV6T57k.css     SAME mathUtils-_4XskpKf.js
SAME palette-B3uNe0QG.js    SAME prewarm-BCM35icO.js SAME prewarm-DjIy_IrE.js
SAME rolldown-runtime-DK3Fl9T5.js
sw.js IDENTICAL to local build   (precache manifest names assets/Game-Luw2wRm4.js,
                                  which is also what the local build emits)
```

Real Chromium, real `keydown`/`keyup` with real `KeyboardEvent.code`, position
read off `Player.position`:

| boot path | build | result |
|---|---|---|
| `/spawn?pos=0,0` | dev | every key 1.317 m per 1.2 s hold |
| `/spawn?pos=-1.6,51.6` (the real entrance spawn) | dev | 1.317 m |
| plain `/`, character creator → **full cat-bus arrival** → play | dev | ArrowUp 2.662 m, all others 1.317 m, `riding=false` |
| welcome-back prompt → "Keep playing!" (`continueGame`) | dev | all six keys 1.29–1.32 m |
| open + close pause / map / backpack / photo, then press a key | dev | 0.402–0.404 m, identical to baseline |
| `/spawn?pos=0,0`, position read from the autosave | **production** | 0.403 m per key (the save's 0.25 m epsilon, so a floor not a measurement) |

Headless (`scripts/park-harness.mts` + the real `World`): the arrival hands
control back exactly once (`endRides=1`, `riding=false`), and after it finishes
nothing writes the player's pose again — `poseWrites` delta 0 over 120 frames
while she is moved 6 m by hand.

## What was ruled out

- **A latched `Player.riding`** — the issue's prime suspect. `riding=false` in
  every measurement above, including immediately after the arrival's handover
  and after `KeychainShop`'s locked view closes with Esc.
- **The arrival pinning her** — `ArrivalSequence.depart()` clears
  `playerPose.live` on its first frame and `reassertPlayerPose()` is a no-op
  from then on; measured, not read.
- **A stale or partial deploy on the server** — every asset and `sw.js` are
  byte-identical to a clean build of `b910cfb`.
- **The four merged PRs' diffs.** `git diff --stat 0224746 b910cfb --
  src/core/input/` is **empty**: the input layer was not touched at all in the
  window. #337 is CI-only. #333 and #331 touch `IsoCamera`'s zoom and focus
  override, never its `right`/`forward` basis. #286 did **not** touch
  `PointerControls.ts` or `Player.ts`, contrary to the issue body — its
  `Game.ts` change is three lines of NavGrid wiring, and its
  `ArrivalSequence.ts` change is where *children* are released. The last change
  to any input file is `7442bfb` (#285), 17 August, nine days before the report.

## What is left, and it is not in the bundle

The deployed artefact is sound, so whatever Jim saw was client-side. The
standing candidate — not speculation, it is what he was complaining about the
same day, in `b910cfb`'s own commit message — is **a stale service worker
serving him an older build**. See CLAUDE.md, "How a deployed park notices it is
out of date": *"a failure to reload is an unambiguous bug in the app"*.
Verifying the server serves current code (which the issue did) does not verify
that his tab was *running* it.

**Do not close #338 on this branch's evidence alone.** One datum only Jim can
give would settle it: on the tab where the keys were dead, was the loaded script
`assets/index-BolPVpIr.js` (current) or an older hash?

## What this branch adds

`scripts/check-walking.mts` + `npm run check:walking` — a real-browser check
that holds every movement key at a real running park and asserts she covers at
least `PLAYER_RADIUS`, across three boot paths (`/spawn`, after the keychain
rack's locked `beginRide`/`endRide` view, and a returning save), plus a tap for
the touch road. Shaped after `check-deep-links.mts`; not in `npm run build` for
the same reason that one is not — it needs a live server and a Chromium.

### It was watched going red

Two deliberate breaks (`ArrowUp` dropped from `KEYBOARD_MOVE_BINDINGS`;
`endRide()` no longer clearing `ridingFlag`) → exit 1, 13 fouls, and the two
faults produce *distinguishable* signatures:

```
binding table: 7 movement keys bound, 8 expected — DISAGREE
[spawn] ArrowUp   FAILED: 0.000 m after 5100 ms held … amount 0; riding=false
[after keychain view] KeyW FAILED: 0.000 m after 5100 ms held … amount 1; riding=true
  - after keychain view: the character is still `riding` before a key was even
    pressed — input, collision and gravity are switched off, so no key can move
    her (Player.beginRide/endRide: something took control and did not give it back)
```

`amount 0` means the key never reached `InputSystem`; `amount 1, riding=true`
means it did and the player is locked. Reverted, the same check passes: 8 keys
plus a tap × 3 boot paths, exit 0.

## Environment notes for whoever picks this up

- This sandbox's egress proxy MITMs TLS with a CA Chromium does not trust, and
  disabling verification is not allowed — so **the live site cannot be opened in
  a browser from here**. The workaround used was to mirror the deployed bytes
  with `curl` (which does trust it) and prove them identical to a local build.
- A first-run boot (character creator → cat bus → park) takes **~9 minutes**
  under SwiftShader at 320×240. Budget for it; it does complete. `npm run
  check:walking` takes 15–25 min here for the same reason.
- Node 26 via `scripts/with-node` or `/root/.nvm/versions/node/v26.7.0/bin`.
- This worktree has **no `node_modules`**. Symlink the parent checkout's in to
  work here: `ln -sfn /home/user/land-of-good-places/node_modules node_modules`
  — and take it out again before you finish. `.gitignore` says `node_modules/`
  with a trailing slash, which does not match a *symlink*, so while it is there
  git reports it as untracked. Never `git add -A` in this repo anyway.
