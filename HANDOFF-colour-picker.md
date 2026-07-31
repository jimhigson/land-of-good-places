# HANDOFF — colour-picker

## Task
Add a kid-friendly "any colour" picker (no hex/RGB text) to every colour
customisation field, additive alongside curated swatches.

## Investigation (done)
Only 4 colour fields exist in the whole game, all in `CharacterCreation.ts`:
skin tone, hair colour, eye colour, clothes colour. All four use the same
`buildSwatchSection` helper. No other colour-customisable fields exist —
balloons/hats/pets are fixed catalogue items (`ShopItem`), not colour fields.
`facePaint` (FacePaintPanel) is a design *id*, not a colour, so it's out of
scope. `flowerColour` is a fixed enum picked from the world, not a UI colour
field. So: 4 fields, 1 file (`CharacterCreation.ts`), 1 shared helper.

State already stores these as bare `number` hex (`PlayerState.skinColour`
etc.) — a custom pick needs **no new state/type fields**, just another hex
number through the same `onPick` callback the curated swatches already use.

## Design landed
- New `src/ui/colour.ts`: pure `hsvToHex`/`hexToHsv`, no DOM.
- New `src/ui/ColourWheelPicker.ts`: the bespoke wheel + brightness bar +
  live preview swatch. Wheel = two stacked CSS gradients (conic hue +
  radial white-fade), not canvas — proven exact HSV math in the doc comment,
  not an approximation. Brightness bar = exact black-to-hue linear ramp
  (R/G/B are linear in V for fixed H/S).
- `CharacterCreation.ts`'s `buildSwatchSection` now also appends a
  "Custom colour" tile (rainbow conic-gradient dot, `+` glyph) that opens
  the picker inline, in the same section, so the character preview stays
  visible the whole time (satisfies PREVIEW RULE for free — no separate
  preview needed in the picker itself).
- Both curated-swatch clicks and wheel drags call the *same* `onPick`, so
  nothing downstream needs to know a colour was custom.
- Live-drag updates are rAF-coalesced (`ColourWheelPicker.commit()`) so a
  fast drag can't fire more full character rebuilds than one per frame.

## Keyboard (documented tradeoff, see ColourWheelPicker's doc comment)
No discrete list exists to arrow-key between, so arrows drive the value
directly instead of moving a cursor to then confirm with E (there is no
separate confirm step — dragging/keying already commits, same as a curated
swatch commits on click):
- wheel focused: ←/→ hue ±15°, ↑/↓ richness ±10%, Home/End = 0%/100% sat.
- bar focused: ←/↓ darker, →/↑ brighter, ±10%, Home/End = ends.
Escape closes the panel from anywhere inside it.

## Status
- `npm run build` — exit 0, confirmed directly (not piped).
- Committed: `db21c28` "Add an exact-HSV custom colour picker to character creation".
- **Not yet done:** browser QA (open each of the 4 fields, drag a genuinely
  custom colour, confirm it applies/previews, confirm no hex/numbers visible,
  test phone-portrait width). PR not yet raised.

## If picking this up cold
Read `src/ui/ColourWheelPicker.ts`'s doc comment first — it explains the
maths and the keyboard tradeoff in one place. The only integration point is
`CharacterCreation.ts`'s `buildSwatchSection` (search for `ColourWheelPicker`).
CSS lives in `src/style.css` right after `.charcreate-swatch:active`,
under the `---- the "Custom colour" tile...` comment block.
