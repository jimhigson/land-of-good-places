import { readFileSync } from 'node:fs'
const scenario = process.argv[2] || 'happy'
const src = readFileSync(process.env.WF || new URL('./library-build.js', import.meta.url), 'utf8').replace('export const meta =', 'const meta =')
const calls = []
const logs = []
let gateCalls = 0, qaCalls = 0
const impl = (l) => ({ baseCommit: 'b-' + l, headCommit: 'h-' + l, commits: ['c1'], done: [], notDone: [], checks: [], reds: [], deviations: [], forJoin: [], ci: 'none', conflicts: [] })
const stubAgent = async (prompt, opts) => {
  const l = opts.label
  calls.push(l)
  if (typeof prompt !== 'string' || prompt.includes('undefined') && !prompt.includes('never assign undefined')) throw new Error('prompt for ' + l + ' contains "undefined"')
  if (scenario === 'dieC' && l === 'C12') return null
  if (scenario === 'dieF1' && l === 'F1A') return null
  if (scenario === 'dieRev' && l === 'rA5') return null
  const bk = (i) => ({ id: 'b' + i, title: 'T' + i, blurb: 'x', adversary: 'y', jokes: [], pages: [] })
  if (/^Dw/.test(l)) return scenario === 'deadWriters' ? null : { books: [bk(1), bk(2), bk(3)] }
  if (l === 'Dj') return { scores: [], chosen: [0, 1, 2].flatMap(i => [{ writer: 1, index: i, title: 't', notes: 'n' }, { writer: 2, index: i, title: 't', notes: 'n' }]), setNotes: 'set' }
  if (l === 'De') return { books: [1, 2, 3, 4, 5, 6].map(bk) }
  if (/^r|^RF/.test(l) && l !== 'PRrev') return { findings: l.endsWith('13') || l === 'RFa' || l === 'rA6' || l === 'rD' ? [{ file: 'x.ts', severity: 'minor', lens: 'faithful', summary: 's-' + l, evidence: 'e', fix: 'f' }] : [], checked: [] }
  if (/^G\d/.test(l)) { gateCalls++; return { green: scenario === "gatered" ? gateCalls >= 2 : true, headCommit: 'g', local: [], ci: 'run', stepSets: 'ok', fixed: [], failures: gateCalls < 2 ? ['x'] : [] } }
  if (/^Q\d/.test(l)) { qaCalls++; return { approved: qaCalls >= 2, headCommit: 'q', defects: qaCalls < 2 ? [{ what: 'w', where: 'p', severity: 'major' }] : [], screenshots: [], verified: [] } }
  if (/^QF/.test(l)) return { green: true, headCommit: 'qf', local: [], ci: 'run', stepSets: 'ok', fixed: [], failures: [] }
  if (l === 'P' || l === 'PF') return { prNumber: 999, branch: 'feat/library-714', headCommit: 'p', previewUrl: 'https://x', previewVerified: true, links: [], ci: 'green', openIssues: [] }
  if (l === 'PRrev') return { verdict: 'changes requested', commentPosted: true, findings: [{ file: 'y', severity: 'major', lens: 'l', summary: 's', evidence: 'e', fix: 'f' }] }
  return impl(l)
}
globalThis.agent = async (p, o) => { await new Promise(r => setTimeout(r, Math.random() * 5)); return stubAgent(p, o) }
globalThis.parallel = async thunks => Promise.all(thunks.map(t => t().catch(() => null)))
globalThis.phase = () => {}
globalThis.log = m => logs.push(m)
const cached = scenario === 'relaunch' ? { F1A: impl('F1A'), F1B: impl('F1B'), F2: impl('F2') } : scenario === 'cached' ? { F1A: impl('F1A'), F1B: impl('F1B'), F2: impl('F2'), FM: impl('FM'), A5: impl('A5') } : {}
globalThis.args = { heads: { art: 'a', building: 'b', books: 'c', shared: 'd' }, cached, writingElsewhere: scenario === 'relaunch' }
const fn = new Function('return (async () => {' + src + '\n})()')
const result = await fn()
console.log('scenario', scenario, '->', result.status, result.where || '')
console.log('calls', calls.length, calls.join(' '))
console.log('logs', logs.join(' | '))
