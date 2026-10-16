export const meta = {
  name: 'library-chapter-books-editor',
  description: 'Finish the six Library chapter books: apply the judge\'s notes to the chosen drafts and write the final JSON',
  phases: [{ title: 'Edit', detail: 'one editor: the judge\'s notes, every page recounted, final JSON' }],
}
// The writers and the judge ran on 14 Oct 2026; their output is committed on feat/library-714 in
// docs/library-build/chapter-books/. This runs only the step that was cut off by the pause.
const REPO = '/Users/jim/dev/landOfGoodPlaces'
const OUT = REPO + '/.claude/library-build-scratch/chapter-books.json'
phase('Edit')
const final = await agent(`You are the EDITOR of six chapter books for Land of Good Places, a cute 3D theme-park game Jim is building with his six-year-old daughter Eleri. Jim, 14 Oct 2026: 'we also need some more grown-up books, these are ok for a 3 year old, so keep them, but add more that have ~30 words per page and more involved story lines with jokes, adventure, adversaries, conflict, but resolve well. A 6 year old advanced reader needs a bit more.'

Read (read-only; commit nothing): git -C ${REPO} show origin/feat/library-714:docs/library-build/chapter-books/DRAFTS.md (the judge's six, their notes and the set notes), the full drafts with picture specs in drafts.json and the judge's output in judging.json (same folder), the twelve existing picture books (src/world/library/books.ts) and how their pictures are built from the game's own models (src/world/library/reader/pagePictures.ts, readerAssets.ts, PICTURE_MODELS).

Make every edit the judge's notes ask for, then polish: each joke lands for a six-year-old, every page is 24-36 words (count them and report the real count), titles at most 24 characters, ids camelCase, unique and not one of the twelve picture books' ids, names consistent across the set, British English, gentle peril only, and each picture spec buildable from the game's models (re-check the names in the code) and showing exactly what its page says. Address the judge's set note that every adversary turns out to be misunderstood: vary how the six resolve. Order the six as they should stand on the shelf. Write the final result as JSON to ${OUT} (create the folder if needed) in the same shape as drafts.json's books (id, title, blurb, adversary, jokes, pages[{text, words, picture{setting, models, action, mood}}]) and return it.`, { label: 'De', phase: 'Edit', schema: { type: 'object', properties: { books: { type: 'array', items: { type: 'object' } }, notes: { type: 'string' } }, required: ['books'] } })
return final
