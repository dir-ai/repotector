// Phase H: journal (diario di bordo) + whats_next.
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildJournal, journalTail, writeJournalMd } from '../src/journal.mjs'
import { whatsNext } from '../src/whats-next.mjs'
import { recordEnter, recordDepart } from '../src/register.mjs'
import { buildAtlas } from '../src/atlas.mjs'
import { buildDna } from '../src/dna.mjs'

const T = join(process.env.TEMP || '/tmp', 'rpt-phase-h')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
mkdirSync(join(T, '.repotector'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }

// two visits recorded in the register
const s1 = recordEnter(T, { who: 'agent-1', purpose: 'add refunds' })
recordDepart(T, { sessionId: s1, summary: 'Added refund endpoint; migration still pending', filesTouched: ['src/refund.ts'] })
const s2 = recordEnter(T, { who: 'agent-2', purpose: 'seat map' })
recordDepart(T, { sessionId: s2, summary: 'Wired seat map UI', filesTouched: ['src/seatmap.tsx'] })

const j = buildJournal(T)
check('journal has both visits', j.length === 2)
check('journal is newest-first', j[0].who === 'agent-2')
check('journal carries summary + files', j[0].summary === 'Wired seat map UI' && j[1].filesTouched.includes('src/refund.ts'))
const tail = journalTail(T, 1)
check('journalTail returns condensed latest', tail.length === 1 && tail[0].who === 'agent-2' && typeof tail[0].files === 'number')

writeJournalMd(T)
check('JOURNAL.md written with managed markers', existsSync(join(T, 'JOURNAL.md')) && /REPOTECTOR:BEGIN/.test(readFileSync(join(T, 'JOURNAL.md'), 'utf8')))
check('JOURNAL.md shows a visit', /agent-2/.test(readFileSync(join(T, 'JOURNAL.md'), 'utf8')))

// whats_next from DNA gaps + open thread ("pending") + TODO
writeFileSync(join(T, 'src', 'exists.ts'), 'export const x = 1 // TODO: validate input\n')
const atlas = buildAtlas(T); const dna = buildDna(T, atlas)
writeFileSync(join(T, '.repotector', 'atlas.json'), JSON.stringify(atlas))
writeFileSync(join(T, '.repotector', 'dna.json'), JSON.stringify(dna))
mkdirSync(join(T, '.psx', 'dna'), { recursive: true })
writeFileSync(join(T, '.psx', 'dna', 'head.json'), JSON.stringify({ clauses: [{ id: 'DNA-1', kind: 'feature', text: 'refund flow', claims: { paths: ['src/missing.ts'] } }] }))

// meta-mentions of TODO (in strings / sentences about todos) must NOT be flagged
writeFileSync(join(T, 'src', 'meta.ts'), 'const desc = "handles TODO/FIXME markers" // documents the TODO/FIXME feature\nconst re = /(TODO|FIXME)/\n')
const wn = whatsNext(T)
check('TODO scanner ignores meta-mentions (string + "TODO/FIXME" enumeration)', !wn.suggestions.some((s) => s.source === 'todo' && s.evidence.file === 'src/meta.ts'))
check('whats_next surfaces a missing DNA clause first', wn.suggestions[0].source === 'dna_coverage' && /DNA-1/.test(JSON.stringify(wn.suggestions[0].evidence)))
check('whats_next surfaces the pending open thread', wn.suggestions.some((s) => s.source === 'depart' && /pending/i.test(s.title)))
check('whats_next surfaces the TODO with file:line evidence', wn.suggestions.some((s) => s.source === 'todo' && s.evidence.file && s.evidence.line))
check('every suggestion carries evidence', wn.suggestions.every((s) => s.evidence && Object.keys(s.evidence).length > 0))

// empty is valid
rmSync(join(T, '.psx'), { recursive: true, force: true })
writeFileSync(join(T, 'src', 'exists.ts'), 'export const x = 1\n')
writeFileSync(join(T, '.repotector', 'atlas.json'), JSON.stringify(buildAtlas(T)))
rmSync(join(T, '.repotector', 'dna.inferred.json'), { force: true })
writeFileSync(join(T, '.repotector', 'dna.json'), JSON.stringify({ entities: [], api_contracts: [] }))
// fresh repo with no gaps/threads/todos → but journal still has "pending" thread; clear register
writeFileSync(join(T, '.repotector', 'register.jsonl'), '')
const wn2 = whatsNext(T)
check('whats_next returns empty=true honestly when no evidence', wn2.empty === true && wn2.suggestions.length === 0)

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
