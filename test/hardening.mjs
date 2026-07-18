// Verification harness for the v1.5.1 trust fixes (Kimi round-4 defects):
// ghost graph edges, sessionId collisions, ReDoS on agent-writable inputs.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { extractImports } from '../src/atlas.mjs'
import { buildReverseGraph } from '../src/blast-radius.mjs'
import { mintSessionId } from '../src/register.mjs'
import { checkLineBudget } from '../src/gates.mjs'
import { canonCheck } from '../src/canon.mjs'
import { entitiesFromTs } from '../src/dna.mjs'

let pass = 0; let fail = 0
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`) }

// ── 1) ghost edges: imports in comments/strings are not graph edges ──
const ghostSrc = [
  "// copied from './old-util' — do not resurrect",
  "/* previously: import { x } from './removed' */",
  "const hint = \"see import stuff from './fake-path' in docs\"",
  "import { real } from './real-dep'",
  "import './side-effect'",
  "const lazy = require('./req-dep')"
].join('\n')
const ghost = extractImports(ghostSrc)
check('comment import is NOT an edge', !ghost.includes('./old-util') && !ghost.includes('./removed'))
check('string-literal mention is NOT an edge', !ghost.includes('./fake-path'))
check('real import IS an edge', ghost.includes('./real-dep'))
check('bare side-effect import captured', ghost.includes('./side-effect'))
check('require() captured', ghost.includes('./req-dep'))

// multi-line import still captured
const multi = extractImports("import {\n  a,\n  b,\n  c\n} from './multi'\n")
check('multi-line import captured', multi.includes('./multi'))

// export-from at start of file (no preceding newline)
check('export-from at file start captured', extractImports("export { z } from './z'").includes('./z'))

// ── 2) `..` root escape produces no edge ──
const atlas = {
  files: [
    { path: 'src/a.ts', imports: ['../../outside', './b'] },
    { path: 'src/b.ts', imports: [] },
    { path: 'outside.ts', imports: [] }
  ]
}
const rev = buildReverseGraph(atlas)
check('root-escaping ../../ import is not resolved', ![...rev.keys()].includes('outside.ts'))
check('normal relative import still resolves', rev.get('src/b.ts')?.has('src/a.ts') === true)

// ── 3) sessionId burst uniqueness ──
const ids = new Set()
for (let i = 0; i < 200; i++) ids.add(mintSessionId('same-agent'))
check('200 same-ms sessions mint 200 unique ids', ids.size === 200)

// ── 4) ReDoS: hostile glob in intent.scan.excludeGlobs stays fast ──
const T = join(process.env.TEMP || '/tmp', 'rpt-hardening-test')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
writeFileSync(join(T, 'src', 'a'.repeat(120) + '.ts'), 'const a=1\n'.repeat(400))
const hostile = {
  standards: { maxFileLines: 300 },
  scan: { excludeGlobs: ['*'.repeat(150) + '.xyz', ('**/'.repeat(60)) + 'nomatch.xyz', 'g'.repeat(500)] }
}
let t0 = Date.now()
const lb = checkLineBudget(T, hostile)
check('hostile globs terminate fast (<1s)', Date.now() - t0 < 1000)
check('hostile globs did not accidentally exclude the offender', lb.offenders.length === 1)
const sane = checkLineBudget(T, { standards: { maxFileLines: 300 }, scan: { excludeGlobs: ['src/**'] } })
check('legit ** glob still excludes', sane.offenders.length === 0)

// ── 5) ReDoS: oversized canon pattern is skipped, small evil one still bounded ──
writeFileSync(join(T, 'src', 'canon-target.ts'), 'a'.repeat(5000) + '\n')
const evil = {
  canonRules: [
    { id: 'huge', pattern: '(a+)+'.repeat(100), message: 'x' },
    { id: 'legit', pattern: 'forbiddenToken', message: 'y' }
  ]
}
t0 = Date.now()
const cv = canonCheck(['src/canon-target.ts'], evil, T)
check('oversized canon pattern skipped fast (<1s)', Date.now() - t0 < 1000)
check('oversized pattern produced no violation', !cv.some((v) => v.ruleId === 'huge'))
writeFileSync(join(T, 'src', 'canon-target.ts'), 'has forbiddenToken here\n')
check('legit canon rule still fires', canonCheck(['src/canon-target.ts'], evil, T).some((v) => v.ruleId === 'legit'))

// ── 6) dna entitiesFromTs bounded on unclosed brace ──
writeFileSync(join(T, 'src', 'types.ts'),
  'export interface Good { id: string\n  name: string\n}\n' +
  'export interface Broken {\n' + '  // unclosed forever\n' + 'const filler = 1\n'.repeat(3000))
t0 = Date.now()
const ents = entitiesFromTs(T)
check('unclosed interface scan stays fast (<2s)', Date.now() - t0 < 2000)
check('well-formed interface still extracted', ents.some((e) => e.name === 'Good' && e.fields.includes('id')))

rmSync(T, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
