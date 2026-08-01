import { hexToCss } from '../core/palette';
import { hexToHsv, hsvToHex } from './colour';

/**
 * A bespoke, kid-styled "any colour" picker — a hue/richness wheel plus a
 * brightness bar — added alongside the curated swatch rows (skin tone, hair,
 * eyes, clothes) rather than replacing them. See `ui/CharacterCreation.ts`'s
 * `buildSwatchSection`, the only place this is used.
 *
 * **Why additive, not a replacement:** the curated swatches are a one-tap
 * "good defaults" case tuned to look right on a toon-shaded kid; this exists
 * for the child who wants something the six presets do not cover. Losing the
 * one-tap presets to save one control would make the common case slower for
 * every child to save a screen for the occasional one.
 *
 * **No hex, no RGB/HSL numbers, anywhere.** The whole picker is a shape you
 * drag and a bar you drag, plus a round swatch showing exactly what you would
 * get — the same "what you see is what you get" grammar the curated swatches
 * already use (their own `title`/`aria-label` name a colour in words, never
 * in numbers).
 *
 * **The wheel is exact HSV, not a canvas approximation.** Two CSS
 * background layers, stacked: a `conic-gradient` sweeping hue by angle, and a
 * `radial-gradient` fading white at the centre to transparent at the rim.
 * Because the radial fade is linear in radius, the composited colour at a
 * point `(angle, radius)` is exactly `white·(1−s) + hue(angle)·s` where
 * `s = radius / wheelRadius` — which is precisely how HSV desaturates a
 * colour at full value. No canvas, no per-pixel readback, no CORS taint: the
 * colour under the pointer is computed from geometry alone (see
 * {@link pickFromWheel}), and drawn from the same two gradients every kid's
 * `.charcreate-swatch` dot already uses `--swatch-colour` for.
 *
 * **The value bar is exact too.** `R`, `G` and `B` are each linear in `V` for
 * a fixed `H` and `S` (scale hue/saturation's contribution and the "add
 * black" term both scale with `V`), so a plain `linear-gradient(black,
 * <hue at V=1>)` is not an approximation of the value ramp, it *is* the value
 * ramp — every stop along it is a real, reachable HSV colour.
 *
 * **Keyboard fallback (documented tradeoff).** The rest of the game's
 * pickers (face paint, hair style) use arrow-keys-move-the-selection + E-to-
 * pick, because they choose among a short discrete list. A colour wheel has
 * no such list — there is nothing to "move a cursor onto and then commit",
 * because dragging already commits continuously, the same way clicking a
 * curated swatch commits immediately with no separate confirm step. So here
 * the arrows drive the value directly, in coarse fixed steps, rather than
 * moving between discrete options:
 *   - **wheel focused:** ← / → step hue by 15°, ↑ / ↓ step richness
 *     (saturation) by 10%, Home goes fully pale, End goes fully rich.
 *   - **brightness bar focused:** ← / ↓ darker, → / ↑ brighter, by 10% a
 *     step, Home/End to the ends.
 * Every step fires the same live `onChange` a drag does, so a keyboard-only
 * child sees the result exactly as it happens, with no separate step to
 * confirm it.
 */
export interface ColourWheelPickerHandlers {
  /** Fires continuously — on every drag step and every coarse key step. */
  onChange(colour: number): void;
  /**
   * Fires once from {@link ColourWheelPicker.openWith} and once from
   * {@link ColourWheelPicker.close} — never from `toggle` directly, since
   * `toggle` only ever calls one of those two. Lets the owner (`buildSwatchSection`)
   * hide the curated preset row while the wheel is open: those buttons are not
   * usefully actionable mid-drag, and hiding them frees the vertical space the
   * wheel + brightness bar + Done button need most on a small screen.
   */
  onOpenChange?(open: boolean): void;
}

/** Hue steps left/right on the wheel move by, in degrees. */
const HUE_STEP = 15;
/** Saturation/value steps a key press moves by. */
const AXIS_STEP = 0.1;

export class ColourWheelPicker {
  /** The swatch-styled button that opens the panel. Append beside the curated swatches. */
  readonly trigger: HTMLButtonElement;
  /** The wheel + bar + preview. Append once, after the swatch row; hidden until opened. */
  readonly panel: HTMLElement;

  private readonly wheel: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly doneButton: HTMLButtonElement;

  private readonly handlers: ColourWheelPickerHandlers;
  private open = false;
  private h = 0;
  private s = 0;
  private v = 1;

  /** rAF-coalesced: a drag can fire far more pointer events than the preview
   * needs — see `CharacterPreview.update`'s doc comment on why a rebuild is
   * cheap but not free. At most one `onChange` (and one 3D rebuild) per
   * rendered frame, however fast the finger moves. */
  private rafHandle: number | null = null;
  private pendingColour: number | null = null;

  constructor(handlers: ColourWheelPickerHandlers) {
    this.handlers = handlers;

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'charcreate-swatch colourwheel-trigger';
    this.trigger.setAttribute('aria-label', 'Custom colour');
    this.trigger.title = 'Custom colour';
    this.trigger.innerHTML = '<span class="colourwheel-trigger-glyph">+</span>';
    this.trigger.setAttribute('aria-expanded', 'false');

    this.panel = document.createElement('div');
    this.panel.className = 'colourwheel-panel';
    this.panel.dataset.open = 'false';
    this.panel.hidden = true;

    const top = document.createElement('div');
    top.className = 'colourwheel-top';

    this.wheel = document.createElement('div');
    this.wheel.className = 'colourwheel-wheel';
    this.wheel.tabIndex = 0;
    // A true two-axis control has no single ARIA role built for it; `slider`
    // is the closest fit for a screen reader, so it is given the one axis
    // that reads as an "amount" (richness/saturation, the same 0–100 scale
    // the brightness bar below already uses) rather than being left with no
    // `aria-valuenow` at all, which browsers fill in with an arbitrary 50.
    this.wheel.setAttribute('role', 'slider');
    this.wheel.setAttribute('aria-label', 'Colour and richness');
    this.wheel.setAttribute('aria-valuemin', '0');
    this.wheel.setAttribute('aria-valuemax', '100');
    this.cursor = document.createElement('div');
    this.cursor.className = 'colourwheel-cursor';
    this.wheel.append(this.cursor);

    this.preview = document.createElement('div');
    this.preview.className = 'colourwheel-preview';
    this.preview.setAttribute('aria-hidden', 'true');

    top.append(this.wheel, this.preview);

    this.bar = document.createElement('div');
    this.bar.className = 'colourwheel-value';
    this.bar.tabIndex = 0;
    this.bar.setAttribute('role', 'slider');
    this.bar.setAttribute('aria-label', 'Brightness');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', '100');
    this.thumb = document.createElement('div');
    this.thumb.className = 'colourwheel-value-thumb';
    this.bar.append(this.thumb);

    const hint = document.createElement('p');
    hint.className = 'colourwheel-hint';
    hint.textContent = 'Drag to mix any colour!';

    this.doneButton = document.createElement('button');
    this.doneButton.type = 'button';
    this.doneButton.className = 'colourwheel-done';
    this.doneButton.textContent = 'Done';

    this.panel.append(top, this.bar, hint, this.doneButton);

    // Opening/closing the trigger is driven entirely by the owner (see
    // `toggle`) — it, not this class, knows the field's *current* colour to
    // seed the wheel from, since a curated swatch may have been picked since
    // the panel last closed.
    this.doneButton.addEventListener('click', () => this.close());
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        this.trigger.focus();
      }
    });

    this.bindWheel();
    this.bindBar();
    this.syncGeometry();
  }

  /** Whether the panel is currently expanded. */
  get isOpen(): boolean {
    return this.open;
  }

  /** Marks the trigger's own selection ring — the active colour is a custom one. */
  setSelected(selected: boolean): void {
    this.trigger.dataset.selected = selected ? 'true' : 'false';
    this.trigger.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }

  /** Seeds the wheel and bar from a colour, without firing {@link onChange}. */
  setColour(hex: number): void {
    const { h, s, v } = hexToHsv(hex);
    this.h = h;
    this.s = s;
    this.v = v;
    this.syncGeometry();
  }

  /** Opens the panel, seeded from `hex`. */
  openWith(hex: number): void {
    this.setColour(hex);
    this.open = true;
    this.panel.hidden = false;
    this.panel.dataset.open = 'true';
    this.trigger.setAttribute('aria-expanded', 'true');
    this.handlers.onOpenChange?.(true);
    // The panel can expand below the visible fold of `.charcreate-controls`'s
    // scroll region (see that class in style.css), especially once the wheel
    // + brightness bar + hint + Done button are all showing at once on a
    // phone — scroll it into view rather than leaving a child to find it.
    // `requestAnimationFrame`: `hidden` was just cleared this same tick, and
    // an element still `display: none` reports a zero-size bounding rect,
    // which `scrollIntoView` cannot aim at correctly.
    requestAnimationFrame(() => {
      // Same accessibility rule the rest of the game's animations follow
      // (see `characterCreationPreview.ts`'s `spinsAllowed`) — reduced-motion
      // gets an instant jump instead of a smooth scroll. `?? true` treats an
      // environment with no `matchMedia` at all the same way: instant, not
      // smooth, is the safe fallback when the preference can't be read.
      const reduceMotion =
        typeof window === 'undefined' ||
        (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true);
      this.panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.panel.dataset.open = 'false';
    this.trigger.setAttribute('aria-expanded', 'false');
    this.handlers.onOpenChange?.(false);
    // Matches the game's other panels: fade out via CSS, then actually hide
    // (`hidden`) so a closed panel cannot be tabbed into.
    window.setTimeout(() => {
      if (!this.open) this.panel.hidden = true;
    }, 180);
  }

  /** Opens seeded from `hex` if closed; closes if already open. */
  toggle(hex: number): void {
    if (this.open) this.close();
    else this.openWith(hex);
  }

  // -------------------------------------------------------------- internals

  private bindWheel(): void {
    const pick = (clientX: number, clientY: number) => {
      const rect = this.wheel.getBoundingClientRect();
      const radius = rect.width / 2;
      const x = clientX - rect.left - radius;
      const y = clientY - rect.top - radius;
      const dist = Math.min(Math.hypot(x, y), radius);
      this.s = radius > 0 ? dist / radius : 0;
      if (dist > 0.001) {
        let angle = (Math.atan2(y, x) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        this.h = angle;
      }
      this.commit();
    };

    let dragging = false;
    this.wheel.addEventListener('pointerdown', (event) => {
      dragging = true;
      capturePointer(this.wheel, event.pointerId);
      this.wheel.focus();
      pick(event.clientX, event.clientY);
      event.preventDefault();
    });
    this.wheel.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      pick(event.clientX, event.clientY);
    });
    const stop = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      releasePointer(this.wheel, event.pointerId);
    };
    this.wheel.addEventListener('pointerup', stop);
    this.wheel.addEventListener('pointercancel', stop);

    // Coarse keyboard fallback — see this class's doc comment.
    this.wheel.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'ArrowRight':
          this.h = (this.h + HUE_STEP) % 360;
          break;
        case 'ArrowLeft':
          this.h = (this.h - HUE_STEP + 360) % 360;
          break;
        case 'ArrowUp':
          this.s = Math.min(1, this.s + AXIS_STEP);
          break;
        case 'ArrowDown':
          this.s = Math.max(0, this.s - AXIS_STEP);
          break;
        case 'Home':
          this.s = 0;
          break;
        case 'End':
          this.s = 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      this.commit();
    });
  }

  private bindBar(): void {
    const pick = (clientX: number) => {
      const rect = this.bar.getBoundingClientRect();
      const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      this.v = Math.max(0, Math.min(1, t));
      this.commit();
    };

    let dragging = false;
    this.bar.addEventListener('pointerdown', (event) => {
      dragging = true;
      capturePointer(this.bar, event.pointerId);
      this.bar.focus();
      pick(event.clientX);
      event.preventDefault();
    });
    this.bar.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      pick(event.clientX);
    });
    const stop = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      releasePointer(this.bar, event.pointerId);
    };
    this.bar.addEventListener('pointerup', stop);
    this.bar.addEventListener('pointercancel', stop);

    this.bar.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          this.v = Math.min(1, this.v + AXIS_STEP);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          this.v = Math.max(0, this.v - AXIS_STEP);
          break;
        case 'Home':
          this.v = 0;
          break;
        case 'End':
          this.v = 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      this.commit();
    });
  }

  /** Recomputes the derived colour, redraws the cursor/thumb/preview, and reports it. */
  private commit(): void {
    this.syncGeometry();
    const colour = hsvToHex(this.h, this.s, this.v);
    this.pendingColour = colour;
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      if (this.pendingColour !== null) {
        this.handlers.onChange(this.pendingColour);
        this.pendingColour = null;
      }
    });
  }

  /** Moves the cursor/thumb to match `h`/`s`/`v`, and repaints the bar + preview. */
  private syncGeometry(): void {
    const angleRad = (this.h * Math.PI) / 180;
    const x = 50 + Math.cos(angleRad) * this.s * 50;
    const y = 50 + Math.sin(angleRad) * this.s * 50;
    this.cursor.style.left = `${x}%`;
    this.cursor.style.top = `${y}%`;
    this.wheel.setAttribute('aria-valuenow', String(Math.round(this.s * 100)));

    // Exact HSV value ramp for this hue/saturation — see the class doc comment.
    const richHex = hsvToHex(this.h, this.s, 1);
    this.bar.style.setProperty('--colourwheel-rich', hexToCss(richHex));
    this.thumb.style.left = `${this.v * 100}%`;
    this.bar.setAttribute('aria-valuenow', String(Math.round(this.v * 100)));

    const colour = hsvToHex(this.h, this.s, this.v);
    this.preview.style.setProperty('--colourwheel-preview', hexToCss(colour));
  }
}

/**
 * `setPointerCapture`/`releasePointerCapture` throw `NotFoundError` if the
 * given pointer id is not currently active — which a real finger or mouse
 * always is by the time `pointerdown` reaches this code, but a handful of
 * older/edge-case UAs (and, usefully, any test harness driving pointer
 * events synthetically) do not guarantee it. Capture is purely an upgrade
 * (it keeps the drag tracking outside the element's own bounds); losing it
 * must never take the rest of the handler down with an uncaught exception.
 */
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Not fatal — see the doc comment above.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    // Not fatal — see the doc comment above.
  }
}
