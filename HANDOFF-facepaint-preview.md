# HANDOFF — facepaint-preview

Branch `facepaint-preview`, worktree `.claude/worktrees/facepaint-preview`.

**Task.** Family ruling: the face-painting stall must use the same code as
character creation (GAME_DESIGN.md's PREVIEW RULE), and its preview must zoom
in on the face. Presentation refactor only — the designs, and how a chosen
design is applied and persisted, do not change.

## Findings (recorded before writing code)

1. **The PREVIEW RULE already names this exact job.** GAME_DESIGN.md line 104:
   "face painting zooms right in on the face… The camera-follows-what-changed
   behaviour already exists in character creation — it is the thing to reuse,
   not to reimplement."
2. **The shared component needs no surgery.** `ui/characterCreationPreview.ts`
   (`CharacterPreview`) already has `PreviewFocus = 'all' | 'head' | 'hair' |
   'face' | 'body' | 'pet'`, and `boxFor('face')` **measures the model's own
   `facePatch` mesh** (`kid.root.getObjectByName('facePatch')`) and fits the
   camera distance to that box. So face framing is already derived from the
   model, never from a hardcoded height — a body-size variant would be
   followed for free. Nothing to re-derive.
3. **What was missing is only that the framing is transient.** `focus` eases
   back to `'all'` after `FOCUS_HOLD_SECONDS`. Face painting wants `'face'` as
   the *resting* framing. Hence the new `framing: 'full' | 'face'` constructor
   option → a `base` focus the camera returns to. Charcreate passes nothing
   and is bit-for-bit unchanged.
4. **The preview kid could not wear face paint.** `createKid` has no face-paint
   option; the overlay is a separate mesh (`createFacePaintOverlay` in
   `art/style/faces.ts`). `FacePaintStall.attachPlayer` builds it from three
   constants it had **duplicated out of `kid.ts`** (`PLAYER_HEAD_TILT`,
   `PLAYER_SKULL_RADIUS`, `PLAYER_FACE_SQUASH`) with a comment saying it only
   copied them because that PR's file ownership excluded `kid.ts`. Rather than
   make a *third* copy for the preview, `kid.ts` now exports one
   `attachFacePaint(kid)` helper and both call sites use it. Geometrically
   identical: a tilt group of `-HEAD_TILT` under `head` is the same space as
   `crown`, which is where `createFacePatch`'s mesh is parented.
5. **Layout is reused, not re-solved.** The panel adopts `.charcreate-body` /
   `.charcreate-preview` / `.charcreate-preview-canvas` / `.charcreate-controls`,
   which carry the 28 July phone-portrait fix (preview is a fixed band, the
   controls are the only scroller — nothing scrolls through the preview).
   `.facepaint-controls` is a second class on the controls element whose only
   job is `columns: auto`, because the design grid must not sit in charcreate's
   multi-column box.
6. **The preview must not render behind the park.** Charcreate's preview is
   disposed when the game starts; this one lives as long as the stall. So
   `CharacterPreview` gained `setRunning()` and the panel builds the preview
   lazily on first open, pauses its rAF loop on close, resumes on open. Pausing
   rather than disposing avoids churning WebGL contexts on repeated opens.

## Decisions

- Interaction grammar unchanged: arrows/WASD move the selection (now live on
  the model), `E`/`Enter`/`Space` confirms, a tap on a card confirms, exactly
  as before. Mouse hover previews too, and reverts on leave. Hovering "Wash it
  off" previews a clean face.
- Header dropped (glyph + "Face Painting!" + greeting), matching charcreate's
  slimming of 28 July. The close ✕ survives as `.facepaint-close`, absolutely
  positioned on the card — charcreate has no close button because it cannot be
  closed; this panel must be.
- Pet omitted from the preview (`petId: ''` → `shopItem` returns null): it is
  never in a face framing. The player's real worn hat *is* built — a brim shows
  at this distance.

## Status

- [x] Study, findings above
- [x] `kid.ts` `attachFacePaint` + `FacePaintStall` uses it
- [x] `CharacterPreview` framing option, face paint, setRunning
- [ ] `FacePaintPanel` rebuilt on the shared component
- [ ] CSS
- [ ] whatsnew
- [ ] `npm run build` green (exit 0)
- [ ] PR raised

## If you are taking over

Nothing is half-done as of the last commit; each commit compiles. The one
thing not done and not doable by me: **visual QA** — I do not own the browser.
The PR body lists exactly what to look at.
