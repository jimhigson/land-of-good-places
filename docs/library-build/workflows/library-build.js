// RESUME NOTE (14 Oct 2026, paused): this is the orchestration script the Library build was running
// when Jim paused it. Read HANDOFF-library-resume.md first. To relaunch it with the Workflow tool:
//  - pass args.cached with a result object for every stage that is already done (see the handover's
//    "Relaunching the pipeline" table for the stage keys and their head commits);
//  - SCRATCH is a gitignored scratch folder for logs and screenshots; PLAN is the committed plan;
//  - dry-run any edit first: node docs/library-build/workflows/dryrun.mjs happy  (stubs agent()).
export const meta = {
  name: 'library-build-parts-4-5',
  description: 'Integrate the four Library branches, build parts 4 (owl, readable shelves, story time) and 5 (den, dragon, cat) in three parallel tracks plus a fourth that writes and builds six chapter books, review every step, gate, browser-QA and finish the single Library PR',
  phases: [
    { title: 'Foundation', detail: 'merge art + building + groundwork + books into feat/library-714, open the draft Library PR from feat/library; then plan steps 0-4 in two parallel halves' },
    { title: 'Books & owl', detail: 'track A: plan steps 5-6, each reviewed while the next is built' },
    { title: 'Cushions & kids', detail: 'track B: plan steps 7-8, each reviewed while the next is built' },
    { title: 'Den', detail: 'track C: plan steps 11-13, each reviewed while the next is built' },
    { title: 'Chapter books', detail: 'track D: three writers, a judge and an editor write six chapter books while an engineer builds their reader, shelf and award; two engineers picture them; review' },
    { title: 'Story time', detail: 'merge A + B; plan step 9 and step 10 labels and tap spacing; milestone push to the PR' },
    { title: 'Join', detail: 'merge C; plan step 14 and the cross-part pieces; milestone push to the PR' },
    { title: 'Finish', detail: 'review + QA on the deployed preview in parallel, then fix, PR CI green, re-QA' },
    { title: 'PR', detail: 'ready for review, one peer review, preview verified' },
  ],
}

const REPO = '/Users/jim/dev/landOfGoodPlaces'
const SCRATCH = '/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch'
const PLAN = REPO + '/.claude/worktrees/library-714/docs/library-build/PLAN-parts-4-5.md'
const INTEG = { branch: 'feat/library-714', wt: REPO + '/.claude/worktrees/library-714', handoff: 'HANDOFF-library-714.md' }
const PRB = 'feat/library'
const ASSETS = { branch: 'feat/library-714-assets', wt: REPO + '/.claude/worktrees/library-714-assets' }
const TRACK = {
  A: { key: 'A', name: 'track A (readable shelves and the owl)', phase: 'Books & owl', branch: 'feat/library-714-owl', wt: REPO + '/.claude/worktrees/library-714-owl', handoff: 'HANDOFF-library-owl.md' },
  B: { key: 'B', name: 'track B (story cushions and the library children)', phase: 'Cushions & kids', branch: 'feat/library-714-kids', wt: REPO + '/.claude/worktrees/library-714-kids', handoff: 'HANDOFF-library-kids.md' },
  C: { key: 'C', name: 'track C (den walls, secret shelf, dragon and cat)', phase: 'Den', branch: 'feat/library-714-den', wt: REPO + '/.claude/worktrees/library-714-den', handoff: 'HANDOFF-library-den.md' },
}
const TRACK_D = { key: 'D', name: 'track D (six chapter books for an advanced six-year-old reader)', phase: 'Chapter books', branch: 'feat/library-714-books2', wt: REPO + '/.claude/worktrees/library-714-books2', handoff: 'HANDOFF-library-books2.md' }
const CHAPTER_JSON = SCRATCH + '/chapter-books.json'
const JIM_BOOKS = "Jim, 14 Oct 2026: 'we also need some more grown-up books, these are ok for a 3 year old, so keep them, but add more that have ~30 words per page and more involved story lines with jokes, adventure, adversaries, conflict, but resolve well. A 6 year old advanced reader needs a bit more.'"
const HEADS = (args && args.heads) || {}
const CACHED = (args && args.cached) || {}
const results = {}

const CONTEXT = `You are an Engineer on Land of Good Places, a cute 3D theme-park game Jim is building with his six-year-old daughter Eleri. Jim is unavailable for the whole build and will not answer questions: decide, write the decision and its reason in your handoff file, and carry on. When a trade-off is close, pick the one a six-year-old will enjoy more. Follow the repo's CLAUDE.md exactly (it is in your context).

THE FEATURE. The Library (epic #714): a pillared library building with a dim, cosy reading room. Parts 1-3 are finished on their own branches: the Blender art kit (art/library-715: src/art/assets/library.glb and libraryGlb.ts with LIBRARY_GLB_BASE64 and LIBRARY_FACES), the building and its reading room (feat/library-building-716: src/world/library/*, src/art/models/libraryAssets.ts, scripts/check-library.mts), and twelve readable picture books with a 3D paper reader (feat/library-books-717: src/world/library/reader/*, scripts/check-book-reader.mts). A groundwork branch (feat/library-714-shared) holds the plan's shared owners that live outside src/world/library (speechTiming, Player.isRunning, the 'listening' posture, CollisionWorld.restoreWall, SpritePuffs, visibleReachXZ, the 'card' inventory kind and grantKeepsakeOnce, libraryCard.ts, seatedPose.mts, the NPC seated/driver seams, the new chimes). Parts 4 (#718: owl librarian, readable shelves, library card, recommendation, shush, story time with three library children) and 5 (#719: secret bookcase door, hidden den with a baby dragon, sleeping library cat) are built from ONE plan that was designed, judged and decided already:
  ${PLAN}
Before you edit anything, read the plan's "What changed since the six designs were written", "Ground rules", "The seams both parts share", "Numbers and their single owners" and "Decisions" sections, and every step section your task names, in full. Where this prompt overrides the plan (branch names, handoff file names, which track does what, what is already done), this prompt wins.

BRANCHES. The integration branch is ${INTEG.branch} (worktree ${INTEG.wt}, handoff ${INTEG.handoff}); everyone pushes their work there or to their own track branch, after every meaningful edit. The single Library PR (a draft until the end) has its head on a SEPARATE branch, ${PRB}, which only ever moves at a milestone, by a fast-forward push of the integration head (git push origin ${INTEG.branch}:${PRB}). The reason: every push to a PR head starts a CI run that re-solves all 16 parks (30-45 minutes) and cancels the run before it, so pushing work-in-progress there would mean no run ever finishes and no preview ever deploys. Never push to ${PRB} unless your task says so. After the foundation, three tracks work in parallel, each on its own branch cut from the foundation head, and are merged back: track A (Steps 5-6: readable shelves, the owl) on ${TRACK.A.branch}, track B (Steps 7-8: story cushions, the library children) on ${TRACK.B.branch}, track C (Steps 11-13: den walls, secret shelf, dragon and cat) on ${TRACK.C.branch}. A fourth track, D, adds six CHAPTER BOOKS (${JIM_BOOKS}) on ${TRACK_D.branch}: about 30 words a page, 8-10 pages, their own shelf slots, a reader layout for a paragraph of text, and a Big reader award; the twelve picture books stay exactly as they are, and every count of books must derive from BOOKS.length, never a typed twelve. Step 9 (story time), Step 10's labels and tap spacing, Step 14 and the cross-part pieces are done on ${INTEG.branch} after the merges. Raise no other pull request: Jim's ruling is ONE PR for the whole Library.

PARKS, LOCALLY. A check that builds a World needs the park for the tree's exact source hash, and a fresh hash means solving it (seed 5 alone is about 20 minutes of acceptance loops). Read the parks notes in HANDOFF-library-shared.md (git show origin/feat/library-714-shared:HANDOFF-library-shared.md) and HANDOFF-library-building.md (the dev-server hash trap) before you run one: they record how to hydrate .parks from a CI parks artifact or a sibling worktree whose manifest hash matches, and how to build only the seed you need. Batch your edits, then run the World-building checks once per batch.

HOUSE RULES THAT BITE HERE.
- Work only in the worktree your task names. Never edit, build, commit or run a server in the shared checkout ${REPO} (it carries somebody else's live edits).
- pnpm only. Agent shells have no fnm hook: if node --version is below 26, prefix commands with fnm exec --using=26 -- (or use scripts/with-node). The running pnpm must be 12.1.0: pnpm exec node -e "console.log(process.env.npm_config_user_agent)".
- Never a bare git stash (the stack is shared with other sessions; use a WIP commit). Never git add -A or '.': name every file. Commit AND push after every edit that would be annoying to redo; end every commit message with the line: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Run checks and read their exit codes. Never pipe a check through head or tail; redirect output to a file under ${SCRATCH} and grep the file. Quote counts off the screen, never the ones you expected.
- Erasable TypeScript only (no parameter properties, enums or namespaces); exactOptionalPropertyTypes (omit optional fields, never assign undefined). Colours from PALETTE/ART only. Seeded Rng only, never Math.random. One owner per number: import it, never copy it.
- Anything drawn is solid: a collider in the same commit, topIsAbsolute for knee-high props, never a hollow CollisionWorld box a child could get inside. libraryKeepOuts / keepOutsFor is the single owner of where she must be able to stand; prove reachability with an instrument whose control has run.
- Every new check is broken deliberately and watched go red before it is trusted green; paste the red output with the geometry or input it was proved against into your handoff. Coverage notes go to process.stderr. A check that could pass vacuously gets a vacuity guard.
- If you touch the check chain in package.json, verify it by parsing the scripts object and comparing step SETS against origin/main and every merged branch; never grep, never trust a rerere replay (rerere is on in this repo).
- Every line of text a child reads is one sentence of at most 50 characters (titles at most 24); check:brevity owns that.
- No new PointLight (the room's light budget is 8 of 8). Never black (the darkest colour is PALETTE.ink).
- The prebuilt parks: almost every file here is inside the prebuilt-parks source closure (scripts/lib/park-source-hash), so each commit has a new park hash and a check that builds a World may first spend minutes accepting a park. Batch edits before running World-building checks. Do NOT dispatch CI unless your task says so; the orchestrator gates at fixed points.
- Keep your handoff file current at every checkpoint: what is done, decisions with reasons, red transcripts with geometry, and a "For the join" list of anything your plan steps reach into that belongs to another track.
- If your worktree or branch already exists when you start, you are a restart: read the handoff and git log, verify what is claimed done (never trust it), and continue from where it stops.
- Your final message is consumed by a script: return exactly the structured output requested.`

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    baseCommit: { type: 'string', description: 'branch head before you changed anything (on a restart: the head the step started from, from the handoff)' },
    headCommit: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    done: { type: 'array', items: { type: 'string' } },
    notDone: { type: 'array', items: { type: 'string' }, description: 'anything in the task not done, with the reason' },
    checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, exit: { type: 'string' }, counts: { type: 'string' } }, required: ['name', 'exit'] } },
    reds: { type: 'array', items: { type: 'string' }, description: 'each deliberate red: the mutation, the command, the failing lines, the geometry' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'every departure from the plan, with the reason' },
    forJoin: { type: 'array', items: { type: 'string' }, description: 'pieces left for the merge/join agent, with where they go' },
    findingsFixed: { type: 'array', items: { type: 'string' } },
    findingsRejected: { type: 'array', items: { type: 'string' }, description: 'finding + why it is not real, with evidence' },
    conflicts: { type: 'array', items: { type: 'string' }, description: 'merge conflicts met and how each was resolved (merge tasks only)' },
    ci: { type: 'string', description: 'CI run id and every job conclusion, if your task dispatched CI; otherwise "none"' },
  },
  required: ['baseCommit', 'headCommit', 'commits', 'done', 'notDone', 'checks', 'reds', 'deviations', 'forJoin', 'ci'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          lens: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'string', description: 'the command you ran and its output, or the exact lines read' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'lens', 'summary', 'evidence', 'fix'],
      },
    },
    checked: { type: 'array', items: { type: 'string' }, description: 'what you verified and found right' },
  },
  required: ['findings', 'checked'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    green: { type: 'boolean' },
    headCommit: { type: 'string' },
    local: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, exit: { type: 'string' }, notes: { type: 'string' } }, required: ['name', 'exit'] } },
    ci: { type: 'string', description: 'run id, head sha it ran on, and every job with its conclusion' },
    stepSets: { type: 'string', description: 'the parsed check-chain comparison: every main step present, plus the additions' },
    fixed: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
    findingsFixed: { type: 'array', items: { type: 'string' } },
    findingsRejected: { type: 'array', items: { type: 'string' } },
  },
  required: ['green', 'headCommit', 'local', 'ci', 'stepSets', 'fixed', 'failures'],
}

const QA_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    headCommit: { type: 'string' },
    defects: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, where: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, screenshot: { type: 'string' } }, required: ['what', 'where', 'severity'] } },
    screenshots: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, shows: { type: 'string' } }, required: ['path', 'shows'] } },
    verified: { type: 'array', items: { type: 'string' }, description: 'each thing looked at and found right, with how' },
    notes: { type: 'string' },
  },
  required: ['approved', 'headCommit', 'defects', 'screenshots', 'verified'],
}

const PR_SCHEMA = {
  type: 'object',
  properties: {
    prNumber: { type: 'number' },
    branch: { type: 'string' },
    headCommit: { type: 'string' },
    previewUrl: { type: 'string', description: 'the preview host exactly as the newest Deploy PR preview comment gives it' },
    previewVerified: { type: 'boolean' },
    links: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, sentence: { type: 'string' } }, required: ['url', 'sentence'] } },
    screenshotUrls: { type: 'array', items: { type: 'string' } },
    ci: { type: 'string', description: 'Checks and Procgen invariants (and every other job) with conclusions, on the PR head' },
    openIssues: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['prNumber', 'branch', 'headCommit', 'previewUrl', 'previewVerified', 'links', 'ci', 'openIssues'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes requested'] },
    commentPosted: { type: 'boolean' },
    findings: REVIEW_SCHEMA.properties.findings,
  },
  required: ['verdict', 'commentPosted', 'findings'],
}

// ---------------------------------------------------------------- helpers

async function run(key, prompt, opts) {
  if (Object.prototype.hasOwnProperty.call(CACHED, key)) {
    log(key + ': result taken from the earlier run')
    results[key] = CACHED[key]
    return CACHED[key]
  }
  const r = await agent(prompt, Object.assign({ label: key }, opts))
  results[key] = r
  if (!r) throw new Error('STOP ' + key + ': the agent returned nothing (crash or usage limit)')
  return r
}

// A run() whose death is reported instead of thrown (reviews and QA are worth having, never worth stopping for).
async function soft(key, prompt, opts) {
  try { return await run(key, prompt, opts) } catch (e) { log(String(e && e.message || e)); return null }
}

function findingsOf(review) {
  return (review && review.findings) || []
}

function fixFirst(label, findings) {
  if (!findings.length) return ''
  return `
FIRST, the review of ${label} reported these findings. Judge EACH one yourself against the code and the plan (a reviewer can be wrong), fix the real ones (commit and push each fix), and record every rejection with its evidence. Only then start the new work.
${JSON.stringify(findings, null, 1)}
`
}

function reviewPrompt(what, wt, branch, impl, taskText, key) {
  return `${CONTEXT}

YOU ARE THE REVIEWER of ${what}, on branch ${branch} (worktree ${wt}), commits ${impl.baseCommit}..${impl.headCommit}. Do not edit or push that branch (its engineer may already be building the next step on it). To run or mutate anything, make your own scratch worktree: cd ${REPO} && git fetch origin && git worktree add ${REPO}/.claude/worktrees/review-${key}-$(date +%s) ${impl.headCommit} --detach, then pnpm install --frozen-lockfile in it, and remove it (git worktree remove --force) when you are done.

The engineer's task was:
--- TASK ---
${taskText}
--- THE ENGINEER'S REPORT ---
${JSON.stringify(impl, null, 1)}
--- END ---

Review the diff (git diff ${impl.baseCommit}..${impl.headCommit}) through four lenses, and report only what you can show with evidence:
1. FAITHFUL AND COMPLETE: every bullet of the plan's step(s) is implemented as specified, or the deviation is recorded with a good reason; numbers come from their single owners (the plan's "Numbers" table); nothing outside the task's scope changed; the three-dot diff holds only intended files; anything pushed to "For the join" really belongs there.
2. HOUSE RULES: anything drawn is solid from every approach (capsules, topIsAbsolute, no hollow box a child can enter); keep-outs and reachability (a stand spot or seat newly blocked?); one owner per number; TypeScript strictness and erasable syntax; PALETTE/ART colours; seeded randomness; brevity of every child-facing line; no PointLight, never black; tappable things get the rainbow highlight; a new mesh name that could match an existing parkFacts pattern (the castle-wall-plate trap).
3. CHECKS THAT CAN FAIL: run the step's targeted checks on ${impl.headCommit} yourself (exit codes read, clause counts quoted); perform at least two of the plan's red mutations for this step yourself and confirm they go red with real numbers (not NaN or Infinity); confirm coverage notes go to stderr; look for clauses that could pass vacuously or measure the wrong thing.
4. A SIX-YEAR-OLD PLAYING: does it play right (chip labels, timing, what she sees, nothing that traps or confuses her), and is it cute?
An empty findings list is the right answer when it is the true one. Severity: blocker = wrong behaviour, a child stuck or walking through something, a check that cannot fail, or a red gate; major = plan departure with no reason, a missing check or red proof, a rule break; minor = everything else worth fixing.`
}

const STEP = {
  5: { title: 'the readable books on their shelves', notes: 'check-book-reader item 6 is served: run it through check:served-book-reader (parse package.json for the exact name). Re-run check:tap-spacing and quote the new pair counts. Track D is adding six chapter books in parallel (BOOKS grows to eighteen and LIBRARY_READABLE_SLOTS grows with it, in the same index order), so never type twelve anywhere: every count, every clause and every message derives from BOOKS.length, and the pairing stays by index with the length throw.' },
  6: { title: 'the owl at her desk: solid, alive, the card, the recommendation, the shush', notes: 'The WITH A REAL CHILD harness already exists in check-library (the foundation built its skeleton): add the OWL, CARD, RECOMMEND and SHUSH clauses to it. The shush\'s "she is not in the den" condition and Step 12\'s shush suppression belong to the join (the den is track C): put them under "For the join". In check-labels add only the registration line [\'the library\', world.library.screenLabels]; scene 5 comes at Step 10.' },
  7: { title: 'sitting on the story cushions (the player)', notes: 'ridePose\'s \'listening\' posture and scripts/lib/seatedPose.mts (with check-castle importing it) were built on the groundwork branch and are in the foundation: verify they are present and match the plan, fix any gap, do not rebuild them. Note from the groundwork engineer: seatedErrors measures the lowest non-outline vertex, which cannot see ONE lifted foot, so the plan\'s SIT red ("set a leg to -0.7") must rotate BOTH legs or it comes out green. The SIT clause uses the WITH A REAL CHILD harness the foundation built.' },
  8: { title: 'the library\'s three children', notes: 'residentLooks.ts, NpcSystem\'s PLAYER_SEPARATION export, ResidentSpec.driver and the riding/seated push rules, and NpcCharacter\'s seated API were built on the groundwork branch and are in the foundation: verify each against the plan\'s Step 8 bullets and fix any gap, then build the library side (layout kid plans, libraryKidDriver.ts, LibraryKids.ts, Library kidsRoot/residents/attachNpcs, World wiring, the parkFacts exclusion without which every seed fails, the KIDS check). KIDS den-avoidance is Step 14 (the join). Run every ride and NPC check the plan lists for this step.' },
  11: { title: 'the den\'s walls: a gap in the west wall, a lintel, a walled pocket (west-2 still seals it)', notes: 'All of Step 11 is yours, including the LIGHT sweep over den cells.' },
  12: { title: 'the secret leaf: pull, swing, two collider states, guard, fades', notes: 'All of Step 12 is yours except the owl\'s shush suppression while she is in the den (the owl is track A): put that under "For the join".' },
  13: { title: 'the baby dragon and the sleeping cat', notes: 'All of Step 13 is yours except check-labels scene 5\'s cat and dragon visits (scene 5 is created at Step 10, after the merge): put them under "For the join". The check-labels registration of world.library.screenLabels is added by track A; your creatureBubble only has to be in Library.screenLabels.' },
}

function stepTask(t, n, base, prevFindings, prevLabel) {
  const s = STEP[n]
  return `${CONTEXT}

YOUR TASK: plan Step ${n} — ${s.title} — on ${t.name}.
Worktree ${t.wt}, branch ${t.branch}, handoff ${t.handoff}. If the worktree does not exist yet: cd ${REPO} && git fetch origin && git worktree add ${t.wt} -b ${t.branch} ${base}, then pnpm install --frozen-lockfile in it, and push with git push -u origin ${t.branch}. If it exists, git pull and carry on from the handoff (an earlier step of this track, or an earlier attempt at this one, used it).
You are one of three tracks working in parallel off the same foundation commit (${base}). Stay inside your step; where the plan's text reaches into another track's work, leave that piece for the join and write it under "For the join" in your handoff and in your result. A reviewer is reading your previous step while you build this one; its findings reach you or the merge agent later, so do not wait for it.
Track-specific notes: ${s.notes}
${fixFirst(prevLabel, prevFindings)}
Do Step ${n} exactly as the plan specifies it: the files, the changes, the check it adds and the reds it proves. Commit and push after each meaningful edit. Before you return: tsc --noEmit and pnpm run typecheck:test exit 0; the step's targeted checks pass with clause counts quoted; every red the plan names for this step was proved and pasted with its geometry in the handoff; git diff --stat ${base}...HEAD accounts for every file; everything is pushed.`
}

// One track: each step is reviewed while the next is built. Findings from a review that has
// finished by the time the next step starts go to that step's engineer; the rest go to the merge.
async function track(t, steps, base) {
  const out = { ok: true, at: null, leftover: [] }
  const reviews = []
  try {
    for (const n of steps) {
      const key = t.key + n
      const ready = reviews.filter(r => r.settled && !r.handed)
      ready.forEach(r => { r.handed = true })
      const handed = ready.flatMap(r => findingsOf(r.value))
      const label = ready.map(r => r.label).join(' and ')
      const task = stepTask(t, n, base, handed, label)
      const impl = await run(key, task, { phase: t.phase, schema: IMPL_SCHEMA })
      log(`${key}: ${impl.commits.length} commits, ${handed.length} earlier findings handled`)
      const entry = { label: `plan Step ${n} on ${t.name}`, settled: false, handed: false, value: null }
      entry.promise = soft('r' + key, reviewPrompt(entry.label, t.wt, t.branch, impl, task, 'r' + key), { phase: t.phase, schema: REVIEW_SCHEMA })
        .then(v => { entry.value = v; entry.settled = true })
      reviews.push(entry)
    }
    await Promise.all(reviews.map(r => r.promise))
    for (const r of reviews) {
      if (!r.handed && findingsOf(r.value).length) out.leftover.push({ label: r.label, findings: findingsOf(r.value) })
    }
  } catch (e) {
    out.ok = false
    out.at = String(e && e.message || e)
    await Promise.all(reviews.map(r => r.promise))
  }
  return out
}

function leftoverText(list) {
  return list.map(x => fixFirst(x.label, x.findings)).join('\n')
}

function stopped(where) {
  log('Stopped: ' + where)
  return { status: 'stopped', where, results }
}

const MILESTONE = (what) => `
MILESTONE: when everything above is committed, pushed and its checks are green, move the PR head: git push origin ${INTEG.branch}:${PRB} (a fast-forward; if it is refused, the branches have diverged: stop and report it, never force). That push starts the PR's CI and its preview deploy, which shows Jim ${what}. Do not wait for it.`

// ---------------------------------------------------------------- track D: the chapter books

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

function infraTask(base) {
  return `${CONTEXT}

YOUR TASK: track D's engineering base for six CHAPTER BOOKS — everything they need except their words and pictures, which a writing panel is producing right now. ${JIM_BOOKS}
Worktree ${TRACK_D.wt}, branch ${TRACK_D.branch}, handoff ${TRACK_D.handoff}. If the worktree does not exist: cd ${REPO} && git fetch origin && git worktree add ${TRACK_D.wt} -b ${TRACK_D.branch} ${base}, pnpm install --frozen-lockfile, git push -u origin ${TRACK_D.branch}. Read the books' own handoff (HANDOFF-library-books.md) and the reader's code first.
Build, with checks that can fail and reds proved:
1. A book kind: the twelve existing books are picture books and stay byte-identical in text and pictures; chapter books are a second kind. Shape the data so that two engineers adding three chapter books each, in parallel, only meet in one short list: one file per chapter book (its pages and its picture compositions) and one index listing them in shelf order, with BOOKS = picture books then chapter books.
2. The reader's chapter page: a picture and a paragraph of about 30 words (up to 40) on one page, legible in landscape spreads and on a phone held upright, at a text size that honours GAME_DESIGN.md's TEXT/UI-SCALE rule (read it; record the size you chose and why). check-book-reader gets clauses that measure every chapter page's text box in both orientations (no clipping, no overflow, the size never below the minimum), proved red with an over-long fixture page that lives in the check, never in the game.
3. check:brevity: a chapter-book page shape with its own limits (20-40 words; each sentence at most 120 characters; titles still at most 24), keyed by the chapter kind only. Prove the carve-out cannot leak: a picture-book page with two sentences must still go red.
4. Shelves: six more LIBRARY_READABLE_SLOTS, in the same index order as the chapter books, together on a "big readers" stretch of shelving of your choosing, with stand spots that are real keep-outs. Avoid the secret shelf (bookcase west-2) and the west wall where the den's doorway will be cut, the owl's desk, the story rug's cushions and the children's aisles (read the plan's Steps 7, 8 and 11 for where those go). Track A is building the shelf books from SHELF_BOOKS (BOOKS paired with LIBRARY_READABLE_SLOTS by index) in parallel; nothing of yours may type twelve. check:library's REACHABILITY and keep-out clauses must stay green with the new stands.
5. Awards: every book keeps one Cute-o-dex bookmark; the existing all-the-books prize stays tied to the twelve picture books, so the littlest reader's path is unchanged; add a SECRETS row { id: 'secret.bigReader', name: 'Big reader', icon: '📚', done: 'You read every chapter book!' }, discovered the moment the last chapter book is read (one owner of that rule), with a vitest that proves it and its red.
6. Story time (built later, on the integration branch) will read picture books only, because a chapter page is far too long for a speech bubble: export one predicate that says which books story time may read, so it has a single owner.
Until the real books arrive, use fixtures inside the checks only; ship no placeholder book. Before you return: tsc, typecheck:test, check:brevity, check:library, check:served-book-reader, the vitests, all exit 0 with counts quoted; reds pasted; pushed. Return under "done" the exact file layout the two book engineers must follow.`
}

function booksTask(infra, which, from, to) {
  const sub = { branch: TRACK_D.branch + '-' + which, wt: TRACK_D.wt + '-' + which }
  return `${CONTEXT}

YOUR TASK: put chapter books ${from + 1} to ${to} into the game, words and pictures. ${JIM_BOOKS}
The final text and picture specs are in ${CHAPTER_JSON} (books[${from}] to books[${to - 1}]; another engineer is doing the rest in parallel). If that file does not exist yet, the writing panel's editor is still finishing it (it is the editor's last act): check for it every few minutes, and if it has not appeared within 90 minutes, stop and report that. The engineering base (book kind, reader layout, brevity shape, shelf slots, Big reader award) is on ${TRACK_D.branch} at ${infra.headCommit}; its engineer's report, including the file layout you must follow, is below. Work on your own branch: cd ${REPO} && git fetch origin && git worktree add ${sub.wt} -b ${sub.branch} ${infra.headCommit}, pnpm install --frozen-lockfile, git push -u origin ${sub.branch} (if it exists you are a restart).
For each book: its file with the pages exactly as written (you may only fix a typo or trim a page that fails check:brevity, and record it), and a picture for every page composed from the game's own models the way the picture books' pictures are, showing exactly what that page says. Then LOOK at every page: render each spread through the served reader in headless Chrome (playwright-core, chromium.launch({ channel: 'chrome', headless: true }), throwaway profile), open each screenshot with the Read tool and fix any page whose picture does not show its words, whose characters are cropped, faceless or floating, or whose text does not fit. Keep the screenshots under ${SCRATCH}/books2/${which}/.
Before you return: tsc, typecheck:test, check:brevity, check:served-book-reader, check:library, exit 0 with counts quoted; everything pushed to ${sub.branch}; only your books' files and your one line per book in the index touched.
The base engineer's report:
${JSON.stringify(infra, null, 1)}`
}

function booksMergeTask(infra, ba, bb) {
  return `${CONTEXT}

YOUR TASK: merge track D's two book branches into ${TRACK_D.branch}, in ${TRACK_D.wt}: git pull; git merge --no-ff origin/${TRACK_D.branch}-a; git merge --no-ff origin/${TRACK_D.branch}-b; resolve the index (shelf order as in ${CHAPTER_JSON}). Then tsc, typecheck:test, check:brevity, check:library, check:served-book-reader and the vitests, exit codes read and counts quoted; read three chapter books cover to end through the served reader in headless Chrome and look at every screenshot. Push, remove the two sub-worktrees (${TRACK_D.wt}-a, ${TRACK_D.wt}-b) once clean and pushed, and update ${TRACK_D.handoff} with the whole track's state.
Reports: base ${JSON.stringify(infra, null, 1)}
books A ${JSON.stringify(ba, null, 1)}
books B ${JSON.stringify(bb, null, 1)}`
}

const D_STATE = { done: false, ok: false, at: null, leftover: [], head: null }
async function trackD(base) {
  try {
    const elsewhere = !!(args && args.writingElsewhere) && !Object.prototype.hasOwnProperty.call(CACHED, 'De')
    const writing = elsewhere ? Promise.resolve(null) : (async () => {
      const drafts = await parallel(WRITER_ANGLES.map((a, i) => () => soft('Dw' + (i + 1), writerPrompt(a), { phase: TRACK_D.phase, schema: CHAPTER_SCHEMA })))
      const good = drafts.map((d, i) => (d && d.books && d.books.length ? { writer: i + 1, books: d.books } : null)).filter(Boolean)
      if (!good.length) throw new Error('STOP Dw: every writer returned nothing')
      const judged = await run('Dj', judgePrompt(good), { phase: TRACK_D.phase, schema: JUDGE_SCHEMA })
      const chosen = judged.chosen
        .map(c => { const w = good.find(g => g.writer === c.writer); return w && w.books[c.index] ? { book: w.books[c.index], notes: c.notes } : null })
        .filter(Boolean)
      if (chosen.length < 4) throw new Error('STOP Dj: the judge chose only ' + chosen.length + ' usable books')
      return await run('De', editorPrompt(chosen, judged.setNotes), { phase: TRACK_D.phase, schema: CHAPTER_SCHEMA })
    })()
    const [final, infra] = await Promise.all([writing, run('Di', infraTask(base), { phase: TRACK_D.phase, schema: IMPL_SCHEMA })])
    log(final ? 'Chapter books written: ' + final.books.map(b => b.title).join(', ') : 'Chapter books: the words come from the separate writing run, through ' + CHAPTER_JSON)
    const n = final ? final.books.length : 6
    const half = Math.ceil(n / 2)
    const [ba, bb] = await Promise.all([
      run('Dba', booksTask(infra, 'a', 0, half), { phase: TRACK_D.phase, schema: IMPL_SCHEMA }),
      run('Dbb', booksTask(infra, 'b', half, n), { phase: TRACK_D.phase, schema: IMPL_SCHEMA }),
    ])
    const dm = await run('Dm', booksMergeTask(infra, ba, bb), { phase: TRACK_D.phase, schema: IMPL_SCHEMA })
    const whole = Object.assign({}, dm, { baseCommit: base, commits: [].concat(infra.commits, ba.commits, bb.commits, dm.commits), reds: [].concat(infra.reds, ba.reds, bb.reds, dm.reds), deviations: [].concat(infra.deviations, ba.deviations, bb.deviations, dm.deviations) })
    const review = await soft('rD', reviewPrompt('track D, the six chapter books (their words, their pictures, the reader\'s chapter page, the brevity shape, the shelf slots and the Big reader award); judge the stories too, as an advanced six-year-old would', TRACK_D.wt, TRACK_D.branch, whole, infraTask(base), 'rD'), { phase: TRACK_D.phase, schema: REVIEW_SCHEMA })
    if (findingsOf(review).length) D_STATE.leftover.push({ label: 'track D (the chapter books)', findings: findingsOf(review) })
    D_STATE.head = dm.headCommit
    D_STATE.ok = true
  } catch (e) {
    D_STATE.at = String(e && e.message || e)
  }
  D_STATE.done = true
  return D_STATE
}

const D_MERGE = (where) => `
TRACK D (the chapter books) is finished on ${TRACK_D.branch}: merge it here too (git merge --no-ff origin/${TRACK_D.branch}) and keep both sides' intent (its six books, shelf slots, brevity shape, reader page and Big reader award; read ${TRACK_D.handoff}). Story time reads picture books only, through track D's predicate. After the merge, check:library, check:brevity and check:served-book-reader must be green with everything from ${where} in.
${leftoverText(D_STATE.leftover)}`


// ---------------------------------------------------------------- foundation

phase('Foundation')
const headsText = Object.keys(HEADS).length
  ? 'The four source branches were at these heads when this run started (confirm with git fetch; if one has moved since, take its newest head and say so): ' + JSON.stringify(HEADS)
  : 'Take each source branch at its current origin head.'

const F1A_TASK = `${CONTEXT}

YOUR TASK: FOUNDATION, the merge — fast. Jim has seen nothing of the Library yet and is waiting for a preview: get the four finished branches merged and the draft PR open as quickly as is safe. Leave the slow World-building checks to the PR's CI.

${headsText}
If ${INTEG.wt} exists you are a restart (see the house rules). Otherwise: cd ${REPO} && git fetch origin && git worktree add ${INTEG.wt} -b ${INTEG.branch} origin/main, then pnpm install --frozen-lockfile, and push with git push -u origin ${INTEG.branch}.
Merge with --no-ff, in this order: origin/art/library-715, origin/feat/library-building-716 (which merged art itself, so art is mostly a no-op there), origin/feat/library-714-shared, origin/feat/library-books-717. That order is the one the groundwork branch measured as cleanest with git merge-tree: read the merge-forecast table and its resolutions in HANDOFF-library-shared.md (git show origin/feat/library-714-shared:HANDOFF-library-shared.md) first. Resolve every conflict keeping both sides' intent; run tsc --noEmit after each merge. Expect conflicts in package.json, src/Game.ts, src/main.ts, scripts/check-deep-links.mts, test/procgenShards.ts, src/state/types.ts, ASSET_MANIFEST.md and scripts/check-copy-brevity.mts. Two need judgement:
- check:deep-links: art (69dfa5df, carried by building and the groundwork) and books (9083ecd4) each fixed the same pre-existing /reptile-house?at= race differently. Read both commits and both handoffs' accounts and keep the version (or the combination) that removes the root cause: waiting for the change of space to finish AND for her to be on the spot. Never a retry.
- types.ts: 'book' (books) and 'card' (groundwork) are both appended to CUTE_CATEGORIES: keep both, 'book' then 'card', each with its own doc comment.
For package.json, rebuild every check:shard-N chain deterministically as origin/main's step set plus each branch's additions, then parse the scripts object and prove the set equality (paste it in ${INTEG.handoff}); inspect every hunk rerere resolved by itself. Make sure every branch's own handoff file survives and that books' src/world/library/reader/* and building's src/art/models/libraryAssets.ts and libraryKit.ts are intact.
Quick local checks only, exit codes read: tsc --noEmit, pnpm run typecheck:test, check:brevity, check:library-glb, check:png-integrity, check:chain-coverage, check:seed-coverage, the vitest test/store/library-card.test.ts, and pnpm run build. Push.
Then open the PR: git push origin ${INTEG.branch}:${PRB}, and gh pr create --draft --base main --head ${PRB} --title "The Library: owl librarian, picture books, story time and a secret dragon den (#714)" with a body (write it to a file) that says plainly: this is the single PR for the whole Library (#714-#719); what is in the preview now (the pillared library on its plot, the dim reading room inside, the twelve paper picture books via /book?id=<id> and the Cute-o-dex bookmarks); what is still being built on this same PR (the owl librarian and library card, readable shelves, story time, the secret den with the baby dragon, the sleeping cat); "Closes #714, #715, #716, #717, #718, #719"; and as its very last line: 🤖 Generated with [Claude Code](https://claude.com/claude-code). Write ${INTEG.handoff} with the merge notes and the PR number, push, and return as soon as the PR exists (do not wait for CI). Put the PR number in "done" as "PR #<n>".`

let F1A
try { F1A = await run('F1A', F1A_TASK, { phase: 'Foundation', schema: IMPL_SCHEMA }) } catch (e) { return stopped('F1A: ' + e) }
log('Merged and PR opened: ' + JSON.stringify(F1A.done.filter(d => /PR #\d+/.test(d))))

const F1B_TASK = `${CONTEXT}

YOUR TASK: FOUNDATION, first half of the plan work — plan Step 0, Step 1 change 5 and Step 2's remainder, on ${INTEG.branch} in ${INTEG.wt} (git pull first; read ${INTEG.handoff}). Another engineer is building Steps 3-4 in parallel on ${ASSETS.branch}; stay off their files (libraryAssets.ts, libraryKit.ts, the creature/face modules, readerAssets.ts, check-asset-contract.mts, main.ts, Game.ts, check-deep-links.mts, and check-library.mts except where Step 0 only reads it).
A. The PR's CI started on the merge commit (PR head ${PRB}). Check it at the end of your task: gh run list --branch ${PRB} and gh run view <id> --json jobs. If any job is red, root-cause and fix it on ${INTEG.branch} (a red here is a red under everything the tracks will build), and record it.
B. Plan Step 0, in full: the facts (the glb node list and pivots, LIBRARY_FACES, BOOKS.length === LIBRARY_READABLE_SLOTS.length === 12, which source libraryAssets.ts draws cases/cushions/armchairs from with the sizes printed, whether the glb is already decoded and where (libraryKit.ts), whether /library?at= already exists as a parsed deep link, each check:shard-N step set) and the baselines (exit codes and clause counts) of check:library, check:labels, check:tap-spacing, check:brevity, check:assets, check:hotel, check:reptile-house, check:npc-presence, check:jitter, check:climb-wave. ${INTEG.handoff} on ${INTEG.branch} replaces the plan's HANDOFF-library-owl-den.md: three tracks will read it.
C. Plan Step 1 change 5 only (props.ts: box returns its three WallColliders, detach and attach, den?: true on KeepOut and on layout's StandSpot copied by libraryKeepOuts, the zero-length wall capsule). Changes 1-4, 6 and 7 came from the groundwork branch: verify they are present after the merge.
D. Plan Step 2's remainder: src/world/library/libraryLines.ts exactly as the plan gives it, libraryCopyForBrevity, and check-copy-brevity's two loops (library copy and SECRETS). Verify the groundwork's state slice (the 'card' kind, grantKeepsakeOnce, libraryCard.ts and its vitest) after the merge. Prove both of Step 2's reds and paste them.
Before you return: tsc, typecheck:test, check:brevity, check:library and the vitest exit 0 with counts quoted; everything pushed. Do NOT push to ${PRB}.`

const F2_TASK = `${CONTEXT}

YOUR TASK: FOUNDATION, second half of the plan work — plan Step 3 (the library's creatures as assets), plan Step 4 (/library becomes a parsed deep link), and the WITH A REAL CHILD harness skeleton in check-library. You work on your own branch so that the first half (Steps 0-2, on ${INTEG.branch}) can run at the same time: cd ${REPO} && git fetch origin && git worktree add ${ASSETS.wt} -b ${ASSETS.branch} ${F1A.headCommit}, pnpm install --frozen-lockfile, git push -u origin ${ASSETS.branch} (if the worktree exists you are a restart). Read ${INTEG.handoff} first. Stay off the first half's files (props.ts, layout.ts, libraryLines.ts, check-copy-brevity.mts, ${INTEG.handoff}); keep your own notes in HANDOFF-library-assets.md.
Step 3 and Step 4: exactly as the plan specifies, with their checks and reds, adapted to what the merge really contains. The building branch already decodes the glb (src/art/models/libraryKit.ts) and may already parse /library?at=: one decode and one table (extend what is there, never a second decode), and one parsed link (finish what is there to the plan's shape).
The harness: three tracks will add clauses to check-library's "WITH A REAL CHILD" section in parallel, so it must exist before they start. Build it per the plan's Step 6 "Checks" paragraph: quietly(() => new Player(world.collision, camera, spawn)), scene.add(player.group), world.attachPlayer(player), an InputSystem, and a step() running input.update -> player.update -> camera.update -> library.update at 1/60 (and world.npcs.update, so Step 8 can rely on it), attached after the DOORS, FADE and LIGHT probe clauses. Give it one honest clause of its own (from the arrival, steered into the room with input.setNavigationMove for 2 s, she travels at least 1.5 m and stays within 0.02 of the floor), prove that clause red by blocking her path, and expose the harness through a small helper documented at its top.
Before you return: tsc --noEmit, typecheck:test, check:library, check:assets, check:deep-links and check:served-deep-links exit 0 with counts quoted; the reds pasted; everything pushed to ${ASSETS.branch}. Do NOT push to ${INTEG.branch} or ${PRB}: the orchestrator merges your branch.`

let F1B, F2
try {
  ;[F1B, F2] = await Promise.all([
    run('F1B', F1B_TASK, { phase: 'Foundation', schema: IMPL_SCHEMA }),
    run('F2', F2_TASK, { phase: 'Foundation', schema: IMPL_SCHEMA }),
  ])
} catch (e) { return stopped('foundation halves: ' + e) }
const pD = trackD(F1B.headCommit)

const FM_TASK = `${CONTEXT}

YOUR TASK: merge the foundation's second half into ${INTEG.branch}, in ${INTEG.wt}: git pull, then git merge --no-ff origin/${ASSETS.branch}. Resolve any conflict keeping both halves' intent (the first half did Steps 0-2 there; the second did Steps 3-4 and the WITH A REAL CHILD harness on ${ASSETS.branch}; read HANDOFF-library-assets.md and fold its facts into ${INTEG.handoff}, then delete HANDOFF-library-assets.md in the same commit). Then tsc, typecheck:test, check:library, check:assets, check:brevity, check:served-deep-links and the library-card vitest, exit codes read and counts quoted. Push ${INTEG.branch}. Remove ${ASSETS.wt} (git worktree remove, after confirming it is clean and pushed). Three tracks start from your head commit the moment you return, so it must be green.`
let FM
try { FM = await run('FM', FM_TASK, { phase: 'Foundation', schema: IMPL_SCHEMA }) } catch (e) { return stopped('FM: ' + e) }
const base = FM.headCommit
log('Foundation head for the three tracks: ' + base)

// The foundation's reviews run while the tracks build; their findings are fixed at the first merge.
const foundationImpl = { baseCommit: F1A.baseCommit, headCommit: FM.headCommit, commits: [].concat(F1A.commits, F1B.commits, F2.commits, FM.commits), done: [].concat(F1A.done, F1B.done, F2.done, FM.done), notDone: [].concat(F1A.notDone, F1B.notDone, F2.notDone), checks: [].concat(F1A.checks, F1B.checks, F2.checks, FM.checks), reds: [].concat(F1B.reds, F2.reds), deviations: [].concat(F1A.deviations, F1B.deviations, F2.deviations, FM.deviations), forJoin: [], conflicts: [].concat(F1A.conflicts || [], FM.conflicts || []), ci: F1B.ci }
const pRF = parallel([
  () => soft('RFa', `${CONTEXT}

YOU ARE THE INTEGRATION REVIEWER of ${INTEG.branch} at ${FM.headCommit}. Do not edit or push that branch; use your own detached scratch worktree (cd ${REPO} && git fetch origin && git worktree add ${REPO}/.claude/worktrees/review-RFa-$(date +%s) ${FM.headCommit} --detach; pnpm install --frozen-lockfile; remove it when done).
The branch merged origin/art/library-715, origin/feat/library-building-716, origin/feat/library-714-shared and origin/feat/library-books-717 into origin/main, then built plan Steps 0-4 in two halves and merged them. Your lens is ONLY the merges: prove that nothing from any branch was lost or altered by a conflict resolution. For each source branch, compare what it changed against main (git diff origin/main...origin/<branch>) with what the integration holds, file by file, and explain every difference not explained by Steps 0-4 (${INTEG.handoff} says what those steps changed). Parse package.json's scripts object at each merge commit and at the head and compare every check:shard-N step SET against main's and each branch's: every step present before must still be present. Read the PR's CI on the merge commit (gh run list --branch ${PRB}): which head it ran on and every job's conclusion.
The engineers' combined report: ${JSON.stringify(foundationImpl, null, 1)}`, { phase: 'Foundation', schema: REVIEW_SCHEMA }),
  () => soft('RFb', reviewPrompt('plan Steps 0-4 on the integration branch (Step 0 facts and baselines, Step 1 change 5, Step 2 remainder, Step 3 creatures as assets, Step 4 the parsed /library link, and the WITH A REAL CHILD harness skeleton)', INTEG.wt, INTEG.branch, foundationImpl, F1B_TASK + '\n\n' + F2_TASK, 'RFb'), { phase: 'Foundation', schema: REVIEW_SCHEMA }),
])

// ---------------------------------------------------------------- three tracks

const pA = track(TRACK.A, [5, 6], base)
const pB = track(TRACK.B, [7, 8], base)
const pC = track(TRACK.C, [11, 12, 13], base)
const [ra, rb] = await Promise.all([pA, pB])
const RF = await pRF
if (!ra.ok || !rb.ok) {
  await pC
  return stopped('track A/B: ' + [ra.at, rb.at].filter(Boolean).join('; '))
}

// ---------------------------------------------------------------- story time (A + B merged)

phase('Story time')
const dAtM1 = D_STATE.done && D_STATE.ok
const M1_TASK = `${CONTEXT}

YOUR TASK: merge tracks A and B into ${INTEG.branch}, then build plan Step 9 (story time) and Step 10's labels scene and tap-spacing run, in ${INTEG.wt}.
1. git pull; git fetch origin; git merge --no-ff origin/${TRACK.A.branch}; git merge --no-ff origin/${TRACK.B.branch}; then git merge origin/main if main has moved (rebuild any check-chain resolution deterministically from parsed step sets). Resolve conflicts keeping both tracks' intent (both added to Library.ts, layout.ts, libraryAssets.ts, check-library.mts and Game.ts). Read both handoffs (${TRACK.A.handoff}, ${TRACK.B.handoff}) and their "For the join" lists. After merging, check:library must run every clause from both tracks green, in a sensible order (state left by one clause — a seated player, a card in the store — must not leak into another); also tsc, typecheck:test, check:labels, check:tap-spacing, check:brevity, check:hotel, check:npc-presence, check:jitter.
${fixFirst('the foundation (the merges and plan Steps 0-4)', RF.filter(Boolean).flatMap(findingsOf))}
${leftoverText(ra.leftover)}
${leftoverText(rb.leftover)}
2. Plan Step 9 in full: the Story listener secret (its own commit), the owl's flight with the measured cruise and the detached/attached capsule, storyTime.ts, the gathering and the reading of the book's own pages, the dispersal, abort on leaving, the story=now link, and the STORY and FLIGHT clauses with every red the plan names.
3. Plan Step 10's labels and tap spacing only: check-labels scene 5 (card, hello, first Read zone, the owl coverage gap) and check:tap-spacing with the library pair counts quoted.
Story time reads picture books only (a chapter page is far too long for a speech bubble): use track D's predicate if D is merged, otherwise write the rule so D's predicate can replace it, and list that for the join.
Track C (den, dragon, cat) is still being built in parallel and merges after you; leave anything that needs it for the join and list it.
${dAtM1 ? D_MERGE('tracks A, B and D') : 'Track D (six chapter books) is still being built; it merges at the join.'}
Before the milestone: tsc, typecheck:test, check:library, check:labels, check:tap-spacing, check:brevity, check:served-deep-links and check:served-book-reader exit 0 with counts quoted; reds pasted; everything pushed; ${INTEG.handoff} updated.
${MILESTONE('the owl librarian, the library card, the glowing recommendation, the readable shelves and story time')}`
let M1
try { M1 = await run('M1', M1_TASK, { phase: 'Story time', schema: IMPL_SCHEMA }) } catch (e) { await pC; return stopped('story time: ' + e) }
const pRM1 = soft('rM1', reviewPrompt('the merge of tracks A and B, plan Step 9 (story time) and Step 10\'s labels and tap spacing', INTEG.wt, INTEG.branch, M1, M1_TASK, 'rM1'), { phase: 'Story time', schema: REVIEW_SCHEMA })

const rc = await pC
const rM1 = await pRM1
if (!rc.ok) return stopped('track C: ' + rc.at)
const rd = await pD
if (!rd.ok) return stopped('track D: ' + rd.at)

// ---------------------------------------------------------------- join (C merged)

phase('Join')
const M2_TASK = `${CONTEXT}

YOUR TASK: merge track C into ${INTEG.branch}, then build plan Step 14 and every cross-part piece, in ${INTEG.wt}.
${fixFirst('the merge of A and B and Step 9 (story time)', findingsOf(rM1))}
${leftoverText(rc.leftover)}
1. git pull; git fetch origin; git merge --no-ff origin/${TRACK.C.branch}; then git merge origin/main if main has moved (rebuild any check-chain resolution deterministically). Resolve conflicts keeping both sides' intent (Library.ts, layout.ts, libraryAssets.ts, furnish.ts, secrets.ts, LABELS.md and check-library.mts were touched on both sides). check:library must then run every clause from all three tracks green and in a sensible order, in both secret-shelf states where the plan says so.
2. Every "For the join" item in ${TRACK.A.handoff}, ${TRACK.B.handoff}, ${TRACK.C.handoff} and ${INTEG.handoff}. At least: the owl does not shush while libraryDenContains(player) (Step 6's condition, Step 12's suppression, Decision 40), story time keeps going while she is in the den, check-labels scene 5's cat and dragon visits (Step 13), and anything else listed.
${dAtM1 ? '' : D_MERGE('all four tracks')}
3. Plan Step 14 in full: /library-den and the unsavable den links, check:tap-spacing's second snapshot with the shelf open, KIDS den avoidance with its red, ASSET_MANIFEST's Library creatures section, and the one-sentence library_build.py docstring correction. Leave HANDOFF-library-art.md alone.
4. Remove the three track worktrees now that their branches are merged (git worktree remove ${TRACK.A.wt}, ${TRACK.B.wt}, ${TRACK.C.wt}; only after confirming each is clean and fully pushed).
Before the milestone: tsc, typecheck:test, check:library, check:labels, check:tap-spacing, check:brevity, check:assets, check:served-deep-links, check:served-book-reader and the library-card vitest exit 0 with counts quoted; every red pasted; everything pushed; ${INTEG.handoff} updated with the whole build's state.
${MILESTONE('everything: the owl, the shelves and story time, plus the secret bookcase, the den, the baby dragon and the cat')}`
let M2
try { M2 = await run('M2', M2_TASK, { phase: 'Join', schema: IMPL_SCHEMA }) } catch (e) { return stopped('join: ' + e) }

// ---------------------------------------------------------------- finish: review + QA in parallel, then fix and gate

phase('Finish')
const QA_TASK = (round, prevQa) => `${CONTEXT}

YOU ARE QA for the whole Library: the draft PR whose head is ${PRB}. QA round ${round}.
Your job is to LOOK at the game the way a player sees it, not to re-read the checks. Look at the DEPLOYED PREVIEW, which is exactly what Jim will open: find the PR (gh pr list --head ${PRB}), wait until its newest "Deploy PR preview" comment (marker <!-- pr-preview-comment -->) names the current head of ${PRB} (git ls-remote origin ${PRB}; the comment links a pr-<n>-<sha7>-land-of-good-places.blockstack.workers.dev host — never assemble it), polling every few minutes in chunks under 10 minutes; if CI for that head goes red instead, report that as a blocker defect with the failing job. Drive it with Playwright (pnpm exec, playwright-core from any repo worktree, e.g. ${INTEG.wt}) launching Jim's installed Google Chrome headless with a throwaway profile, chromium.launch({ channel: 'chrome', headless: true }), so nothing appears on his screen and the shared Chrome profile is never touched; close every page as soon as you have read it.
Walk these as a player and screenshot each moment (save under ${SCRATCH}/qa/round-${round}/): the library from outside (the pillared front, the steps, the "The Library" name), walking in through the door (/library-door), the dim reading room, the owl at her desk (/library?at=6,8.7&facing=180): press Get a library card! and watch the ceremony, check the card in the backpack, press Say hello! and see a book glow; the readable books (press Read it! on one and turn two pages of the paper book, then close it; also /book?id=ripikaBalloon); the six chapter books on their big readers' shelf (open each, read every page, and judge whether the words fit and are easy to read on a laptop and on a phone held upright (use a 390x844 viewport), whether each picture shows what its page says, and whether the story is one an advanced six-year-old would love); sprint and jump near the owl (Shhh!); story time (/library?at=2.1,-8&facing=150&story=now): sit on a cushion, watch the owl fly over the stacks, the three children walk and sit with their feet on the floor, the pages read aloud; the secret shelf (/library?at=-15.8,-4&facing=270): pull the gold book, watch the bookcase swing away, walk into the den; the baby dragon (/library-den): its glow puff and Say hi!; the cat (/library?at=9.6,8.8&facing=180): Pet the cat!. Bump into the desk, a bookcase, the owl, the dragon's nest and the cat pile to confirm they are solid, and walk back out of the den and out of the library. Press through the game's own chips or zone actions (page.evaluate is fine) and move through the input system.
Judge as Jim and Eleri would: is it cute, is everything legible from the camera, does anything clip, float, z-fight, block a doorway, trap her, read wrong or feel broken? Is the room dim but never black? Every screenshot you report must be one you actually looked at (open it with the Read tool).
${prevQa ? 'The previous QA round reported: ' + JSON.stringify(prevQa, null, 1) + '\nIts defects have been worked on since: confirm each one is fixed, then look at everything again.' : ''}
approved = true only if you would put it in front of a six-year-old today.`

const [rM2, Q1] = await parallel([
  () => soft('rM2', reviewPrompt('the merge of track C, plan Step 14 and the cross-part pieces (shush in the den, story in the den, labels scene, tap spacing open/shut, KIDS den avoidance)', INTEG.wt, INTEG.branch, M2, M2_TASK, 'rM2'), { phase: 'Finish', schema: REVIEW_SCHEMA }),
  () => soft('Q1', QA_TASK(1, null), { phase: 'Finish', schema: QA_SCHEMA }),
])
let qa = Q1
let pending = findingsOf(rM2)
let gate = null
for (let round = 1; round <= 3; round++) {
  const qaDefects = qa && !qa.approved ? qa.defects : []
  try {
    gate = await run('G' + round, `${CONTEXT}

YOUR TASK: finish the Library on ${INTEG.branch} in ${INTEG.wt} (git pull first) and get the PR's CI green. Round ${round} of at most 3.
${fixFirst(round === 1 ? 'the join (track C merge, Step 14, the cross-part pieces)' : 'the previous round', pending)}
${qaDefects.length ? 'Browser QA (on the deployed preview) found these defects; its screenshots are local files you can open with the Read tool. Judge each (look at the screenshot and reproduce it), fix the real ones at the root with the house rules applied (a collider fix proved by a reachability instrument with its control; a visual fix looked at in a real headless browser yourself), and record any you reject with evidence:\n' + JSON.stringify(qa, null, 1) : (qa ? 'Browser QA approved the current preview.' : 'Browser QA did not report (its agent died); the next QA round will look.')}
${gate && !gate.green ? 'The previous round did not end green; its report: ' + JSON.stringify(gate, null, 1) : ''}
Then the gate: tsc, typecheck:test, pnpm run check:chain-coverage and check:seed-coverage locally; parse the scripts object and prove every check:shard-N step set equals origin/main's plus the Library's additions (list the additions); and push. If you changed anything, move the PR head (git push origin ${INTEG.branch}:${PRB}, fast-forward only). Then wait for the PR's CI on the head of ${PRB} (gh pr checks <n> --watch in chunks under 10 minutes; it re-solves the parks, 30-45 minutes) and read EVERY job. Zero tolerance: a red or a flake anywhere is root-caused and fixed (never retried into green, never called unrelated), pushed, moved to ${PRB} and waited for again. Return green only when every job on the final ${PRB} head is green, with that head and the run id.`, { phase: 'Finish', schema: GATE_SCHEMA })
  } catch (e) { return stopped('finish: ' + e) }
  const changed = qaDefects.length > 0
  if (gate.green && !changed && qa && qa.approved) break
  if (gate.green && (changed || !qa)) {
    qa = await soft('Q' + (round + 1), QA_TASK(round + 1, qa), { phase: 'Finish', schema: QA_SCHEMA })
    if (qa && qa.approved) break
  }
  pending = []
}
if (!gate || !gate.green) return stopped('the PR CI is still not green after 3 rounds')

// ---------------------------------------------------------------- PR

phase('PR')
const PR_TASK = `${CONTEXT}

YOUR TASK: make the Library PR ready for Jim's yes or no, in ${INTEG.wt} (git pull first). The PR's head is ${PRB} (gh pr list --head ${PRB}).
1. If origin/main has moved since the last merge of it, git merge origin/main (rebuild any check-chain resolution deterministically from the parsed step sets, never accepting a rerere replay), tsc, typecheck:test, build, push, move ${PRB} (fast-forward), and wait for every PR check to go green again (fix any red at the root). git diff --stat origin/main...HEAD with three dots, accounting for every file.
2. QA screenshots: commit QA's approved screenshots to the qa-screenshots orphan branch under library-714/ (check git ls-remote origin qa-screenshots first; create the orphan only if it does not exist; work in a scratch worktree, never the shared checkout) and use their raw.githubusercontent.com URLs.
3. Rewrite the PR body: what the feature is in a few plain sentences; "What to look at" with the preview deep links (host taken verbatim from the NEWEST "Deploy PR preview" comment, never assembled) and one sentence each saying what Jim will see when he does what (the plan's "Preview paths" table, tightened to what the build really does, plus /book?id=ripikaBalloon for the paper book and the library's outside); the six chapter books (titles, and where their shelf is) and the Big reader award; the decisions Jim should know about (the open-book pediment; the secret bookcase swinging into the den rather than into the room, Decision 21; three children rather than four; anything else the handoffs flag as a visible choice); the QA screenshots inline; "Closes #714, #715, #716, #717, #718, #719"; and as its very last line: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
4. Post QA's verdict as a PR comment: first line "QA: approved" (or "QA: not approved" with the open defects), then what was looked at and the screenshot links. If QA did not approve, list its open defects plainly in the body under "Known open issues" and in openIssues.
5. Verify the preview yourself: curl the host and each deep link for HTTP 200, and load /library?at=6,8.7&facing=180 in headless Chrome (playwright channel 'chrome', throwaway profile) and look at the screenshot.
6. gh pr ready (it leaves draft).
Return the PR number, the head, the preview host, the links with their sentences, the screenshot URLs and the CI conclusions.`
let pr
try {
  pr = await run('P', PR_TASK + '\n\nQA\'s final report:\n' + JSON.stringify(qa, null, 1) + '\n\nThe gate\'s final report:\n' + JSON.stringify(gate, null, 1), { phase: 'PR', schema: PR_SCHEMA })
} catch (e) { return stopped('PR: ' + e) }

const verdict = await soft('PRrev', `${CONTEXT}

YOU ARE THE ONE PEER REVIEWER of the Library PR #${pr.prNumber} (head ${pr.branch} at ${pr.headCommit}). Every step was reviewed while it was built; your job is the whole: read the full diff (gh pr diff ${pr.prNumber}), the handoffs and the PR body, and judge whether it is ready for Jim to say yes to. Run what you need from a detached scratch worktree of your own (remove it after). Post your review as a PR COMMENT (gh pr comment; gh pr review --request-changes is refused because every agent commits as the same GitHub user) whose first line states the verdict plainly: "Verdict: approve" or "Verdict: changes requested". Only blockers and majors you can evidence justify "changes requested".`, { phase: 'PR', schema: VERDICT_SCHEMA })

if (verdict && verdict.verdict !== 'approve') {
  try {
    pr = await run('PF', `${CONTEXT}

YOUR TASK: answer the peer review of the Library PR #${pr.prNumber}, in ${INTEG.wt} (git pull first).
${fixFirst('the PR', verdict.findings || [])}
Push, move ${PRB} (fast-forward), wait for every PR check to go green on the new head (fix any red at the root), re-read the NEWEST "Deploy PR preview" comment for the new preview host, update the PR body's links, and post a PR comment answering each finding (fixed with the commit, or rejected with the evidence).`, { phase: 'PR', schema: PR_SCHEMA })
  } catch (e) { return stopped('PR fix: ' + e) }
}

return { status: 'done', pr, verdict, qa, gate, results }
