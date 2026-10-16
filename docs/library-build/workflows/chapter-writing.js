// RESUME NOTE: the three writers and the judge already ran on 14 Oct; their output is committed in
// docs/library-build/chapter-books/ (drafts.json, judging.json, DRAFTS.md). Only the editor is left:
// run chapter-editor.js, not this.
export const meta = {
  name: 'library-chapter-books-writing',
  description: 'Write six chapter books for the Library (about 30 words a page, jokes, adventure, an adversary, a warm ending): three writers from different angles, a judge picks six, an editor finishes them',
  phases: [
    { title: 'Write', detail: 'three writers, three books each: funny, adventure, mystery and friendship' },
    { title: 'Judge', detail: 'score all nine, choose six as a set, with edit notes' },
    { title: 'Edit', detail: 'apply the notes, count every page, write chapter-books.json' },
  ],
}
const REPO = '/Users/jim/dev/landOfGoodPlaces'
const SCRATCH = '/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch'
const INTEG = { branch: 'feat/library-714' }
const CHAPTER_JSON = SCRATCH + '/chapter-books.json'
const JIM_BOOKS = "Jim, 14 Oct 2026: 'we also need some more grown-up books, these are ok for a 3 year old, so keep them, but add more that have ~30 words per page and more involved story lines with jokes, adventure, adversaries, conflict, but resolve well. A 6 year old advanced reader needs a bit more.'"
const CHAPTER_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'camelCase, unique, not one of the twelve existing ids' },
          title: { type: 'string', description: 'at most 24 characters' },
          blurb: { type: 'string', description: 'one sentence: what happens' },
          adversary: { type: 'string', description: 'who or what is in the way, and how it resolves' },
          jokes: { type: 'array', items: { type: 'string' }, description: 'the jokes, and which page each is on' },
          pages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                words: { type: 'number', description: 'the word count of text, counted' },
                picture: {
                  type: 'object',
                  properties: {
                    setting: { type: 'string' },
                    models: { type: 'array', items: { type: 'string' }, description: 'the game models (by their names in the code) and any simple primitive props' },
                    action: { type: 'string', description: 'what is happening in the picture: exactly what this page says' },
                    mood: { type: 'string' },
                  },
                  required: ['setting', 'models', 'action'],
                },
              },
              required: ['text', 'words', 'picture'],
            },
          },
        },
        required: ['id', 'title', 'blurb', 'adversary', 'jokes', 'pages'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['books'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: { writer: { type: 'number' }, index: { type: 'number' }, title: { type: 'string' }, score: { type: 'number', description: '0-100' }, why: { type: 'string' } }, required: ['writer', 'index', 'title', 'score', 'why'] } },
    chosen: { type: 'array', items: { type: 'object', properties: { writer: { type: 'number' }, index: { type: 'number', description: '0-based index of the book in that writer\'s list' }, title: { type: 'string' }, notes: { type: 'string', description: 'the specific edits this book needs before it ships' } }, required: ['writer', 'index', 'title', 'notes'] } },
    setNotes: { type: 'string', description: 'what the six need as a set: variety, shelf order, shared characters, anything repeated' },
  },
  required: ['scores', 'chosen', 'setNotes'],
}

const WRITER_ANGLES = [
  'FUNNY. The laughs drive it: a pompous or grumpy adversary, silly misunderstandings, a running gag, puns and funny voices; the hero wins by being clever and kind.',
  'ADVENTURE. A quest across the park against the clock or the weather: a storm, a lost treasure, a broken ride, a rival racer; brave choices, teamwork and a triumphant finish.',
  'MYSTERY AND FRIENDSHIP. Something strange is happening (things going missing, odd footprints, noises at night); clues, a suspect, and a twist where the "villain" was misunderstood and becomes a friend.',
]

const STORY_BRIEF = `You are writing children's books for Land of Good Places, a cute 3D theme-park game Jim is building with his six-year-old daughter Eleri. The game's library already has twelve picture books with one short sentence a page, for the littlest readers. ${JIM_BOOKS}

Read first (read-only: edit, commit or push nothing): the twelve existing books (git -C ${REPO} show origin/${INTEG.branch}:src/world/library/books.ts), how their pictures are composed from the game's own 3D models (git show the same branch's src/world/library/reader/pagePictures.ts and readerAssets.ts, and the PICTURE_MODELS list), and GAME_DESIGN.md for the park, its rides and its characters. Every page gets ONE picture rendered from the game's models, so each page's picture must be composable from models the game already has (name them as the code does) plus, at most, simple props made of primitive shapes.

The rules for every book:
- a title of at most 24 characters;
- 8 to 10 pages; each page 24 to 36 words (aim for 30), British English, for an advanced six-year-old reader: some longer words are welcome, sentences stay clear;
- a real story: a hero from the park, an adversary (a grump, a trickster, a storm, a rival) and a conflict that builds, at least two jokes a six-year-old will laugh at, and a warm, satisfying ending in which the adversary is outwitted kindly, befriended, or turns out to have been misunderstood;
- gentle peril only: nothing frightening at bedtime, nobody hurt, nobody cruel, no real-world brands or characters;
- set in the Land of Good Places, using its rides, places and characters; the library itself (the owl librarian, the sleeping cat) may appear, and a rumour that a dragon who loves books lives somewhere secret is allowed, never where;
- each page's picture spec shows exactly what that page's text says.`

function writerPrompt(angle) {
  return `${STORY_BRIEF}

YOUR ANGLE: ${angle}
Write THREE complete chapter books in that spirit, all different from each other. Count every page's words and report the count. Return them as structured output.`
}

function judgePrompt(drafts) {
  return `${STORY_BRIEF}

YOU ARE THE JUDGE. Below are chapter books from ${drafts.length} writers. Score every book 0-100 on: would an advanced six-year-old LOVE it (the jokes land, the adventure pulls, the adversary and the conflict are real, the ending is warm and earned); reading level and length (24-36 words a page, 8-10 pages, clear sentences); fit with the park and its characters; whether every page can be pictured from the game's models (check the names against the code); and safety (gentle peril only). Then choose the best SIX as a set: favour variety (not six of one shape), and give each chosen book the specific edits it needs before it ships (a joke that falls flat, a page over length, a picture that cannot be built, a muddled beat). Say what the six need as a set (shelf order, repeated names, shared characters).
${JSON.stringify(drafts, null, 1)}`
}

function editorPrompt(chosen, setNotes) {
  return `${STORY_BRIEF}

YOU ARE THE EDITOR. The judge chose these six books, each with its notes, and these notes for the set: ${setNotes}
Make every edit the notes ask for, then polish: each joke lands for a six-year-old, every page is 24-36 words (count them and report the real count), titles at most 24 characters, ids camelCase and unique, names consistent across the set, British English, and each picture spec buildable from the game's models (re-check the names in the code) and showing exactly what its page says. Order the six as they should stand on the shelf. Write the final result as JSON to ${CHAPTER_JSON} (the same shape as your structured output) and return it.
${JSON.stringify(chosen, null, 1)}`
}


phase('Write')
const drafts = await parallel(WRITER_ANGLES.map((a, i) => () => agent(writerPrompt(a), { label: 'Dw' + (i + 1), phase: 'Write', schema: CHAPTER_SCHEMA })))
const good = drafts.map((d, i) => (d && d.books && d.books.length ? { writer: i + 1, books: d.books } : null)).filter(Boolean)
if (!good.length) return { status: 'no drafts', drafts }
phase('Judge')
const judged = await agent(judgePrompt(good), { label: 'Dj', phase: 'Judge', schema: JUDGE_SCHEMA })
if (!judged) return { status: 'judge died', drafts }
const chosen = judged.chosen
  .map(c => { const w = good.find(g => g.writer === c.writer); return w && w.books[c.index] ? { book: w.books[c.index], notes: c.notes } : null })
  .filter(Boolean)
phase('Edit')
const final = await agent(editorPrompt(chosen, judged.setNotes), { label: 'De', phase: 'Edit', schema: CHAPTER_SCHEMA })
return { status: final ? 'done' : 'editor died', cached: { Dw1: drafts[0], Dw2: drafts[1], Dw3: drafts[2], Dj: judged, De: final } }
