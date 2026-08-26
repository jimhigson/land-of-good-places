# HANDOFF — issue #338, "cursor keys no longer walk the character"

Branch `fix-arrow-keys-338`, worktree `.claude/worktrees/fix-arrow-keys-338`.

## Headline

**The bug does not reproduce against the bytes that are actually deployed.**
Arrow keys, WASD and every other movement binding walk the character on every
boot path tried, including the production build whose chunks are *byte-identical*
to `landofgoodplaces.blockstack.ing`'s. No fix has been made to the input path,
because no defect has been found in it. What this branch adds is the check
whose absence is the real, uncontested part of #338: nothing in this repo
asserted that a key press moves a girl.

## What was proved, with numbers

Deployed commit is `b910cfb` (`/version.txt`), which is `origin/main`. A local
`vite build` of that commit produces chunks with the same content hashes as the
live site, and every one of them compares byte-identical:

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
| `/spawn?pos=0,0`, position read from the autosave | **production** | 0.403 m per key (the save quantises) |

Headless (`scripts/park-harness.mts` + the real `World`): the arrival hands
control back exactly once (`endRides=1`, `riding=false`), and after it finishes
nothing writes the player's pose again — `poseWrites` delta 0 over 120 frames
while she is moved 6 m by hand.

## What was ruled out

- **A latched `Player.riding`** — the issue's prime suspect. `riding=false` in
  every measurement above, including immediately after the arrival's handover
  and after `KeychainShop`'s locked view closes.
- **The arrival pinning her** — `ArrivalSequence.depart()` clears
  `playerPose.live` on its first frame and `reassertPlayerPose()` is a no-op
  from then on; measured, not read.
- **A stale or partial deploy on the server** — every asset and `sw.js` are
  byte-identical to a clean build of `b910cfb`.
- **The four merged PRs' diffs.** #337 is CI-only. #333 and #331 touch
  `IsoCamera` zoom/focus, not its `right`/`forward` basis. #286 did **not**
  touch `src/core/input/PointerControls.ts` or `src/entities/Player.ts` at all,
  contrary to the issue body — its `Game.ts` change is three lines of NavGrid
  wiring, and its `ArrivalSequence.ts` change is where *children* are released,
  not where the player is.

## What is left, and it is not in the bundle

The deployed artefact is sound, so whatever Jim saw was client-side. The
standing candidate — and it is not speculation, it is the thing he was
complaining about on the very same day, in `b910cfb`'s own commit message — is
**a stale service worker serving him an older build**. See CLAUDE.md, "How a
deployed park notices it is out of date": *"a failure to reload is an
unambiguous bug in the app"*. Verifying the server serves current code (which
the issue did) does not verify that his tab was *running* it.

**Do not close #338 on this branch's evidence alone.** What is needed next is
one datum only Jim can give: on the tab where the keys were dead, what did
`document.querySelector('script[src^="/assets/index-"]')` / the loaded chunk
names say — the current `index-BolPVpIr.js`, or something older?

## What this branch adds

- `scripts/check-walking.mts` + `npm run check:walking` — a real-browser check
  that holds every key in `KEYBOARD_MOVE_BINDINGS` at a real running park and
  asserts the player covers at least `0.1 × PLAYER_MAX_SPEED × hold` metres,
  across three boot paths (`/spawn`, after the keychain rack's locked
  `beginRide`/`endRide` view, and a returning save). Shaped after
  `check-deep-links.mts`; not in `npm run build` for the same reason that one
  is not — it needs a live server and a Chromium.

## Environment notes for whoever picks this up

- This sandbox's egress proxy MITMs TLS with a CA Chromium does not trust, and
  disabling verification is not allowed — so **the live site cannot be opened in
  a browser from here**. The workaround used was to mirror the deployed bytes
  with `curl` and prove them identical to a local build.
- A first-run boot (character creator → cat bus → park) takes **~9 minutes**
  under SwiftShader at 320×240. Budget for it; it does complete.
- Node 26 via `scripts/with-node` or `/root/.nvm/versions/node/v26.7.0/bin`.
