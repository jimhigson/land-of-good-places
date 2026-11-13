/**
 * **Write a `data-*` flag only when it changes** (120 fps plan, item 17).
 *
 * `element.dataset.x = 'false'` over a value that is already `'false'` is not
 * free: the browser cannot know the string is the same until it has queued a
 * mutation record and marked the element's style dirty, so the next frame pays
 * a style recalculation for a page on which nothing changed. Three setters
 * called from the frame loop did exactly that — the screen controls, the
 * keyring rack's close button and the face-paint hint — and between them made
 * the document recalculate style **on every single frame** of the park:
 * measured at the spawn on seed 5, 3.00 attribute writes and 1.00 style
 * recalculation a frame, with nothing on the page moving.
 *
 * The attribute itself is read back rather than mirrored in a field, so this
 * stays right whoever else writes it (each of those elements is also set once,
 * directly, where it is built). Reading an attribute forces no style or layout.
 *
 * `pnpm run check:dom-churn` holds the count at zero.
 *
 * @returns whether anything was written.
 */
export function setDataFlag(element: HTMLElement, name: string, value: string): boolean {
  if (element.dataset[name] === value) return false;
  element.dataset[name] = value;
  return true;
}
