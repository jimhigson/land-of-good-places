/**
 * **How long one spoken line stays on screen — the one rule, for every speaker.**
 *
 * Lifted verbatim out of `world/hotel/Hotel.ts` (its reception's check-in
 * script) for the library's owl, the second thing in the game that talks in a
 * paced run of lines. Two speakers holding their lines by two private copies of
 * this would be CLAUDE.md's "two definitions of one thing, kept in step by
 * hand": the day one was retuned, the hotel and the library would read at two
 * different speeds and nothing would notice but a child.
 *
 * Proportional to its length, because a four-word line held as long as a
 * twelve-word one reads as the game having stalled. Floored well above reading
 * speed: nobody in this family is reading these — a six-year-old is looking at
 * the shape of a speech bubble and waiting for the next one.
 */
export function lineSeconds(line: string): number {
  return Math.min(3.8, Math.max(2.1, 1.5 + line.split(' ').length * 0.22));
}
