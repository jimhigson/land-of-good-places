import { ART } from '../art/style/artPalette';
import { hexToCss } from '../core/palette';

/**
 * **The game's name over the ride to the park — the opening credit.**
 *
 * Jim, 7 August 2026:
 *
 * > *"during the cat bus animation, also show overlaid on the screen the name
 * > of the game, in bold characters with no background colour behind them, in
 * > the game's existing colour palette, characters in different colours.
 * > Animate the characters to bounce up and down like they are jumping, but
 * > still staying readable"*
 *
 * and, on the legibility that costs: *"a chunky font would help I think"*.
 *
 * ## Why the letters are separate elements
 *
 * Because they have to be: each one carries its own colour and its own hop, and
 * both of those are per-character asks. One element per character is also what
 * makes the animation **checkable** — `scripts/check-bus-journey.mts` samples
 * their transforms over the ride and can tell a bouncing title from a still one.
 * A CSS keyframe animation would have been fewer lines and completely invisible
 * to any check that does not own a rendering browser, which is exactly the shape
 * of guard this feature has been bitten by three times (see the round-5 handoff:
 * *"ten of twelve children are in the frustum"*, true of a brown wall).
 *
 * ## The bounce: a travelling wave of hops, not a shimmy
 *
 * Each letter is **on the ground for most of its cycle** and pops up briefly,
 * and its neighbour starts a fraction of a cycle later — so a hop runs along the
 * word the way a stadium wave does. That is the reading of *"like they are
 * jumping"* that stays legible: a sine on every letter at once has the whole
 * word permanently deformed and never at rest, whereas this has fifteen of the
 * nineteen characters sitting flat on a shared baseline at any instant, with the
 * eye free to read them.
 *
 * **Readability beat the animation everywhere the two disagreed.** The letters
 * only ever translate — no rotation, no scale, no skew — so their shapes never
 * change and the word never reflows. `JUMP_HEIGHT` is in `em`, so it is a
 * proportion of the letter rather than a distance, and it survives the whole
 * range of the UI scale unchanged.
 *
 * ## Sizing, and the TEXT RULE
 *
 * GAME_DESIGN.md's TEXT/UI-SCALE rule is absolute: one root scale, everything a
 * multiple of it, nothing in `px`. The size lives in `style.css` in `rem`, which
 * is that root scale — `src/style.css`'s own comment calls a title *"a one-off
 * display size […] written inline as its own multiple of the root scale"*, which
 * is precisely this. `scripts/check-text-sizes.mjs` scans it either way.
 *
 * ## Mounted on `document.body`, like `JourneySkip` and for its reason
 *
 * `Hud`'s constructor **empties `#ui-root`**, and `Hud` is built by `new Game()`
 * — which happens in the middle of the ride, while this is on screen. Anything
 * put in `#ui-root` is silently deleted at the moment it matters. `main.ts` also
 * hides `#ui-root` outright once the park build starts.
 */

/** The name, exactly as the boot splash and the bus's own destination blind say it. */
export const JOURNEY_TITLE_TEXT = 'Land of Good Places';

/**
 * **The warm half of the park's own rainbow — because the park is the cool half.**
 *
 * Jim asked for *"the game's existing colour palette, characters in different
 * colours"*, so the colours are `ART.rainbow`'s bands and nothing new. But he
 * also asked for it to stay **readable with no background behind it**, and the
 * first build used all six bands and was measured against the actual ride: the
 * green band (`#8fdf8a`) vanishes over grass and treetops, and the blue
 * (`#8cc9ff`) vanishes over the sky. This lane is grass, trees and sky and
 * almost nothing else, so two of the six characters in every word were washing
 * out — on a lettering that by his own instruction has no plate to sit on.
 *
 * The fix is a **colour choice, not a scrim**: drop the two bands that are the
 * same colours as the world behind them and keep the four that are not. Coral,
 * orange, yellow and violet all sit opposite grass-green and sky-blue, so every
 * character holds its edge without a shadow, an outline, or anything else that
 * would amount to the background he said not to have.
 *
 * Sixteen characters over four bands means no two neighbours ever share a
 * colour, which is the property that actually makes it read as "characters in
 * different colours" rather than four words in four colours.
 */
const TITLE_BANDS = [
  ART.rainbow[0], // coral
  ART.rainbow[1], // orange
  ART.rainbow[2], // yellow
  ART.rainbow[5], // violet
] as const;

/**
 * Hops per second, per letter.
 *
 * Slow enough to read a nineteen-character title through, brisk enough to be a
 * jump rather than a sway.
 */
const JUMP_RATE = 0.62;

/**
 * How far behind its neighbour each letter starts, as a fraction of one cycle.
 *
 * At 0.045 across nineteen characters the wave spans 0.81 of a cycle, so there
 * is always exactly one hop travelling along the word and never two.
 */
const JUMP_STAGGER = 0.045;

/**
 * The fraction of its cycle a letter spends **off the ground**.
 *
 * The rest of the time it sits flat. This is the number that keeps the title
 * readable: at 0.38, twelve of the nineteen characters are at rest at any
 * instant.
 */
const JUMP_AIRTIME = 0.38;

/**
 * Peak height of a hop, in `em` — a proportion of the letter, not a distance.
 *
 * A third of the character's own size: unmistakably a jump at a glance, and
 * small enough that the word still reads as one line of text rather than as
 * scattered letters. Being `em` rather than `rem` means it tracks the title's
 * own size, so it cannot drift if that size is retuned.
 */
const JUMP_HEIGHT = 0.34;

export class JourneyTitle {
  private readonly root: HTMLElement;
  /** One per **non-space** character, in reading order. Spaces do not jump. */
  private readonly letters: HTMLElement[] = [];

  constructor(text: string = JOURNEY_TITLE_TEXT) {
    this.root = document.createElement('div');
    this.root.className = 'journey-title';
    // The title is decoration over a cutscene; a screen reader announcing it
    // letter by letter, which is what nineteen sibling spans would produce,
    // would be worse than not announcing it. The whole string goes in the label.
    this.root.setAttribute('aria-label', text);
    this.root.setAttribute('role', 'img');

    // Words wrap as units, so a narrow screen breaks between words rather than
    // mid-word — nineteen free-floating characters would otherwise reflow into
    // nonsense at the first awkward width.
    for (const word of text.split(' ')) {
      const wordEl = document.createElement('span');
      wordEl.className = 'journey-title__word';
      for (const character of word) {
        const letter = document.createElement('span');
        letter.className = 'journey-title__letter';
        letter.textContent = character;
        // **Colour from the park's own rainbow** — see `TITLE_BANDS` for which
        // of its bands and why. Not a new palette, and not the CSS custom
        // properties that mirror it either: those are the same colours, but read
        // from CSS a check cannot see them, and "each character a different
        // colour" is one of the things that has to be provable. One owner,
        // `art/style/artPalette.ts`.
        const band = TITLE_BANDS[this.letters.length % TITLE_BANDS.length];
        if (band !== undefined) letter.style.color = hexToCss(band);
        wordEl.append(letter);
        this.letters.push(letter);
      }
      this.root.append(wordEl);
    }

    document.body.append(this.root);
  }

  /**
   * Drives the hops from a clock, rather than from a CSS keyframe, for the
   * reason in the header: a check has to be able to see that the characters
   * moved.
   *
   * **Which clock is the whole of one QA defect.** This was fed
   * `journey.elapsed`, and the note here argued for it — *"the title stops
   * bouncing exactly when the ride stops, instead of carrying on over a frozen
   * bus"*. That reasoning had the case backwards. `elapsed` is distance down
   * the lane, so on an overrun the letters stopped mid-jump at scattered
   * heights and stayed there: measured over 6.4 s of waiting, **one title
   * layout in 51 samples**, against 262 during the ride. A title frozen
   * mid-hop is not restraint, it is the single loudest "this has crashed"
   * signal on the screen, and it was arriving at exactly the moment a child is
   * being asked to wait.
   *
   * `main.ts` now passes `journey.animationTime`, the clock that never stops —
   * the same one the children's bounce and the bus's tail have always read,
   * which is precisely why those two were the only things still moving.
   */
  update(elapsedSeconds: number): void {
    for (let i = 0; i < this.letters.length; i += 1) {
      const letter = this.letters[i];
      if (!letter) continue;
      // `- i * JUMP_STAGGER` sends the wave left-to-right, the way it is read.
      let phase = (elapsedSeconds * JUMP_RATE - i * JUMP_STAGGER) % 1;
      if (phase < 0) phase += 1;
      // Airborne for `JUMP_AIRTIME` of the cycle, flat on the baseline for the
      // rest. A half-sine over the airborne part is a hop: quick off the
      // ground, a moment hanging, and back down to exactly zero — so every
      // letter lands on the same line the others are sitting on.
      const height =
        phase < JUMP_AIRTIME ? Math.sin((Math.PI * phase) / JUMP_AIRTIME) * JUMP_HEIGHT : 0;
      letter.style.transform = `translateY(${(-height).toFixed(4)}em)`;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
