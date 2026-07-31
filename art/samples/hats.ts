import { ART } from '../../src/art/style/artPalette';
import { PALETTE } from '../../src/core/palette';
import { CharacterPreview } from '../../src/ui/characterCreationPreview';
import { HAT_KINDS, type HatKind } from '../../src/art/models/hats';

/**
 * A minimal, static hat-fitting room — for screenshotting a hat exactly as
 * the character creator would show it, without the creator's own turntable,
 * blink and mood timers moving between two shots that are meant to be
 * compared pixel for pixel.
 *
 * Reuses `CharacterPreview` itself (the exact class `CharacterCreation.ts`
 * drives), not a re-implementation of it, so what this shows is provably what
 * a child sees. The only difference from the live creator is that the render
 * loop is driven **once**, by hand, with `dt = 0`, instead of by
 * `requestAnimationFrame` — see ART-AGENT-NOTES.md §6, "how to actually get a
 * matched before/after screenshot": freeze the clock rather than trust two
 * screenshots taken at two different animation phases to mean anything.
 *
 * `?hat=cap` picks the hat kind (any `HatKind`, default `party`). The kid's
 * skin/hair/outfit/eye/backpack/pet are the same defaults
 * `CharacterCreation.ts` opens on, so this is the exact starting pose a real
 * child would tap through.
 *
 * `window.__hatPreviewReady` is set `true` once the single frame has been
 * drawn and the loop is stopped — the screenshot tool waits on it rather than
 * guessing a timeout.
 */

const params = new URLSearchParams(location.search);
const requested = params.get('hat');
const kind: HatKind = (HAT_KINDS as readonly string[]).includes(requested ?? '')
  ? (requested as HatKind)
  : 'party';

const wrap = document.getElementById('preview-wrap') as HTMLDivElement;
const label = document.getElementById('hat-label') as HTMLDivElement;
label.textContent = kind;

const preview = new CharacterPreview({ framing: 'full' });
preview.canvas.style.width = '100%';
preview.canvas.style.height = '100%';
wrap.appendChild(preview.canvas);
preview.resize(wrap.clientWidth, wrap.clientHeight);

preview.update({
  skin: ART.kidSkin,
  hair: PALETTE.hair,
  hairStyle: 'bunches',
  outfit: PALETTE.outfit,
  eye: ART.kidEye,
  backpack: 'satchel',
  backpackColour: PALETTE.backpack,
  hatId: `hat.${kind}`,
  petId: 'toy.ripika',
});

// One manual frame, dt = 0 (see `frame`'s own `this.lastTime ? … : 0`), then
// stop the loop before the browser ever gets to run a second one off its own
// requestAnimationFrame. That is what makes two runs of this page — one per
// build — pixel-comparable rather than two different points on a turntable.
type PreviewInternals = { frame: (time: number) => void };
(preview as unknown as PreviewInternals).frame(0);
preview.setRunning(false);

declare global {
  interface Window {
    __hatPreviewReady?: boolean;
    __hatPreview?: CharacterPreview;
  }
}
window.__hatPreviewReady = true;
// Exposed for manual console poking only (e.g. turning the stage to check a
// hat from a 3/4 angle) — nothing in this file reads it back.
window.__hatPreview = preview;
