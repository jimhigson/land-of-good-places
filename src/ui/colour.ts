/**
 * Plain HSV <-> hex conversions for {@link ColourWheelPicker}. No DOM, no
 * three.js — kept separate so the maths can be read (and reused) on its own.
 *
 * HSV, not HSL: the wheel fixes V (brightness) at 1 and draws hue by angle,
 * saturation by radius — see `ColourWheelPicker`'s doc comment for why that
 * maps exactly onto a plain white-to-hue radial fade in CSS, with no canvas
 * or per-pixel maths needed. The value slider then scales every channel by
 * the same factor, which is exact because R, G and B are each linear in V
 * for a fixed H and S — a black-to-hue CSS `linear-gradient` is therefore not
 * an approximation of the value ramp, it *is* the value ramp.
 */

/** Hue in `[0, 360)`, saturation and value in `[0, 1]`. */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

/** HSV to a bare hex number, the format every colour field in the game stores. */
export function hsvToHex(h: number, s: number, v: number): number {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toByte = (n: number) => Math.round((n + m) * 255);
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

/** The inverse of {@link hsvToHex}, for seeding the wheel from a stored colour. */
export function hexToHsv(hex: number): Hsv {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}
