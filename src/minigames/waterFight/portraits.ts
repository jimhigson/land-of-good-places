import { damp } from '../../core/mathUtils';
import { createPortraitStrip, type PortraitInfo } from '../portraitStrip';

/**
 * The water fight's own layer on top of the shared {@link createPortraitStrip}:
 * a wet overlay for splashed portraits and a brief smile for whoever landed
 * one.
 *
 * **Why this exists (27 July 2026 feedback).** The messages that used to pop
 * up over the garden — "Hee hee!", "SOAKED Nell!", "3 in a row!" — sat right
 * in the middle of the screen, exactly where a six-year-old is trying to
 * watch the fight. GAME_DESIGN's fix is to move that feedback out to the edge
 * and turn it into something you glance at rather than read: a little face
 * for everybody in the fight, which goes wet when they get splashed and
 * smiles when they land one. Nothing here ever covers the lawn.
 *
 * The row of heads themselves — painting a face, laying it over a skin disc
 * with a hair fringe, swapping expressions — is `minigames/portraitStrip.ts`,
 * shared with whichever other mini-game wants the same "portraits instead of
 * pop-ups" fix next (the dodgems are getting one; see that module's doc
 * comment). This file only adds the two things that are specific to water:
 * the drippy wet fade and the splash-triggered smile timer.
 */

export type PortraitFighterInfo = PortraitInfo;

export interface WaterFightPortraits {
  /** This fighter just landed a splash on somebody: a brief smile. */
  score(index: number): void;
  /** Called every frame with whether this fighter currently has drippy wet hair. */
  setSoaked(index: number, soaked: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

interface WetState {
  readonly circle: HTMLElement;
  readonly wetElement: HTMLElement;
  /** 0 = dry, 1 = fully soaked. Damped towards `soakTarget` every frame. */
  soakShown: number;
  soakTarget: boolean;
  /** Seconds left showing the happy face before it reverts to neutral. */
  smileLeft: number;
}

export function createPortraitRow(
  container: HTMLElement,
  fighters: readonly PortraitFighterInfo[],
): WaterFightPortraits {
  const strip = createPortraitStrip(container, fighters);

  const wet: WetState[] = strip.entries.map((entry) => {
    const wetElement = document.createElement('div');
    wetElement.className = 'wf-portrait-wet';
    wetElement.innerHTML =
      '<span class="wf-drip"></span><span class="wf-drip"></span><span class="wf-drip"></span>';
    entry.circle.append(wetElement);

    return { circle: entry.circle, wetElement, soakShown: 0, soakTarget: false, smileLeft: 0 };
  });

  return {
    score(index: number): void {
      const entry = wet[index];
      if (!entry) return;
      if (entry.smileLeft <= 0) strip.setExpression(index, 'happy');
      entry.smileLeft = 0.8;
      // The bounce, including its retrigger-while-already-bouncing handling,
      // belongs to the shared strip — the dodgems want exactly the same one.
      strip.pop(index);
    },

    setSoaked(index: number, soaked: boolean): void {
      const entry = wet[index];
      if (entry) entry.soakTarget = soaked;
    },

    update(dt: number): void {
      for (let i = 0; i < wet.length; i += 1) {
        const entry = wet[i];
        if (!entry) continue;

        if (entry.smileLeft > 0) {
          entry.smileLeft -= dt;
          if (entry.smileLeft <= 0) {
            entry.smileLeft = 0;
            strip.setExpression(i, 'neutral');
          }
        }

        // Fast in, slow out — the same shape as the 3D soak fade in
        // `child.ts`, so the portrait and the actual child agree on the joke.
        const target = entry.soakTarget ? 1 : 0;
        entry.soakShown = damp(entry.soakShown, target, target > entry.soakShown ? 0.05 : 0.4, dt);
        const opacity = entry.soakShown < 0.015 ? 0 : entry.soakShown;
        entry.wetElement.style.opacity = opacity === 0 ? '0' : opacity.toFixed(3);
      }
    },

    dispose(): void {
      strip.dispose();
    },
  };
}
