/**
 * What kind of machine are we playing on?
 *
 * Three questions, answered once at boot, because all three of them are asked
 * from more than one place and none of their answers change while the tab is
 * open:
 *
 * - is this a touch screen? (which controls to show, which hint to print)
 * - how many device pixels can we afford? (phones lie about their DPR)
 * - is this a low-end device? (shadow map size)
 *
 * Kept free of imports apart from `constants` so anything can depend on it.
 */
import { MAX_PIXEL_RATIO, SHADOW_MAP_SIZE } from './constants';

/**
 * True on phones and tablets.
 *
 * `maxTouchPoints` rather than `'ontouchstart' in window`: the latter is true in
 * every desktop Chrome with device emulation *off* as soon as a touch-capable
 * monitor is plugged in, and false in some emulation modes. A pointer:coarse
 * media query is the tie-breaker for hybrids.
 *
 * Note this is "has a touch screen", not "has no keyboard" — a Surface gets both
 * sets of controls, which is exactly right.
 */
export function isTouchDevice(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  if (navigator.maxTouchPoints > 0) return true;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * Device pixel ratio, capped.
 *
 * A modern phone reports 3, which means rendering nine times as many pixels as
 * the CSS layout asks for. Two is already past the point anybody can see the
 * difference on a 6" screen, and it is the difference between 60fps and 25.
 */
export function pixelRatioCap(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

interface DeviceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/**
 * A cheap, conservative guess at "this phone will struggle".
 *
 * `deviceMemory` is only exposed by Chromium and is quantised to 0.25/0.5/1/2/
 * 4/8, so 4 or less really does mean a modest device. Safari reports neither,
 * which is why the default when both are missing is "not low end" — being wrong
 * in that direction costs sharpness, not playability.
 */
export function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hints = navigator as unknown as DeviceHints;
  if (typeof hints.deviceMemory === 'number' && hints.deviceMemory <= 4) return true;
  if (typeof hints.hardwareConcurrency === 'number' && hints.hardwareConcurrency <= 4) return true;
  return false;
}

/**
 * Shadow map resolution for this machine: full size normally, one notch down on
 * a low-end device. Halving it quarters the shadow pass's fill cost, and with
 * VSM's blur on top the softness hides most of the lost detail.
 */
export function shadowMapSize(): number {
  return isLowEndDevice() ? SHADOW_MAP_SIZE / 2 : SHADOW_MAP_SIZE;
}
