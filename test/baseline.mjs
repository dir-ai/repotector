// Phase C1 verification: grandfathered baseline — never red on day one.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runGates } from '../src/gates.mjs'
import { readBaseline } from '../src/baseline.mjs'

const T = join(process.env.TEMP || '/tmp', 'rpt-phase-c')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
mkdirSync(join(T, '.repotector'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }

const big = (n) => '// x\n'.repeat(n)
// Day-one debt: a 400-line file + a committed secret already present.
writeFileSync(join(T, 'src', 'legacy.ts'), big(400))
writeFileSync(join(T, 'src', 'keys.ts'), 'export const k = "sk-ant-api03-LEGACYLEGACYLEGACY"\n')
writeFileSync(join(T, '.repotector', 'intent.json'), JSON.stringify({ domain: 'c-test', standards: { maxFileLines: 300 }, structure: { requiredPaths: ['src'] } }))
git('add', '.'); git('commit', '-q', '-m', 'init with debt')

// FIRST run: must be green (grandfathered) and must write baseline.json
const p1 = runGates(T)
check('day-one verdict is INTENT_HONORED despite 400-line file + secret', p1.verdict === 'INTENT_HONORED')
check('baseline.json auto-written on first run', existsSync(join(T, '.repotector', 'baseline.json')))
check('baselineCreated flag set on first run', p1.baselineCreated === true)
check('pre-existing debt is reported (not hidden)', p1.baselineDebt.length >= 2)
check('zero regressions on day one', p1.regressions.length === 0)
const bl = readBaseline(T)
check('baseline records the 400-line offender', bl.lineBudget['src/legacy.ts'] === 401)
check('baseline records the legacy secret', bl.secrets.some((s) => s.startsWith('src/keys.ts::')))

// SECOND run, no changes: still green, no re-baseline
const p2 = runGates(T)
check('second run stays green', p2.verdict === 'INTENT_HONORED' && p2.baselineCreated === false)

// REGRESSION: a NEW 400-line file appears → red
writeFileSync(join(T, 'src', 'newbig.ts'), big(400))
const p3 = runGates(T)
check('NEW oversize file is a regression → DRIFT_DETECTED', p3.verdict === 'DRIFT_DETECTED')
check('regression names the new file', p3.regressions.some((r) => r.file === 'src/newbig.ts' && r.kind === 'new'))
check('the grandfathered file is NOT a regression', !p3.regressions.some((r) => r.file === 'src/legacy.ts'))

// GROWTH: a baseline offender grows beyond its baseline → regression
writeFileSync(join(T, 'src', 'newbig.ts'), '') // remove the new-file regression
writeFileSync(join(T, 'src', 'legacy.ts'), big(500))
const p4 = runGates(T)
check('grandfathered file that GROWS becomes a regression', p4.regressions.some((r) => r.file === 'src/legacy.ts' && r.kind === 'grew'))

// NEW secret → regression; legacy secret stays debt
writeFileSync(join(T, 'src', 'legacy.ts'), big(400)) // restore
writeFileSync(join(T, 'src', 'newkeys.ts'), 'export const n = "sk-ant-api03-BRANDNEWBRANDNEW"\n')
const p5 = runGates(T)
check('NEW secret is a regression', p5.regressions.some((r) => r.file === 'src/newkeys.ts' && r.secret))
check('legacy secret stays grandfathered debt', p5.baselineDebt.some((r) => r.file === 'src/keys.ts'))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
