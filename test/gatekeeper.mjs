// v1.2 "Gatekeeper" verification: protected paths, claims, decisions, hooks, doctor.
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runGates } from '../src/gates.mjs'
import {
  recordEnter, recordClaim, recordRelease, activeClaims, claimConflicts,
  recordDecisions, listDecisions, recordDepart,
} from '../src/register.mjs'
import { writeDecisionsMd } from '../src/journal.mjs'
import { runDoctor } from '../src/doctor.mjs'

import { fileURLToPath } from 'node:url'
const PKG = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]+$/, '')
const BIN = join(PKG, 'bin', 'psx-repotector.mjs')
const T = join(process.env.TEMP || '/tmp', 'rpt-v12')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
mkdirSync(join(T, '.github', 'workflows'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
writeFileSync(join(T, 'src', 'a.ts'), 'export const a = 1\n')
writeFileSync(join(T, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
git('add', '-A'); git('commit', '-qm', 'c1')

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }
const cli = (...a) => {
  try { return { out: execFileSync(process.execPath, [BIN, ...a], { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 } }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 } }
}

// init (seeds protect.paths)
cli('init')
const intent = JSON.parse(readFileSync(join(T, '.repotector', 'intent.json'), 'utf8'))
check('init seeds protect.paths', Array.isArray(intent.protect?.paths) && intent.protect.paths.includes('.github/workflows/**'))

// clean tree → green + exit 0
const clean = cli('gates')
check('gates on clean tree: INTENT_HONORED, exit 0', /INTENT_HONORED/.test(clean.out) && clean.code === 0)

// touch a protected path → red + exit 1, never grandfathered
writeFileSync(join(T, '.github', 'workflows', 'ci.yml'), 'name: ci\non: push\n')
const prot = cli('gates')
check('touching protected workflow → DRIFT + exit 2 (dedicated)', /DRIFT_DETECTED/.test(prot.out) && prot.code === 2)
check('gates names the protected file', /protected path touched: \.github\/workflows\/ci\.yml/.test(prot.out))
// revert → green again (change-based, not stateful)
git('checkout', '--', '.github/workflows/ci.yml')
const clean2 = cli('gates')
check('reverting the protected edit → green again', /INTENT_HONORED/.test(clean2.out) && clean2.code === 0)

// programmatic protected check honors baseline independence
const proof = runGates(T, { write: false })
check('protected-paths gate present in proof', proof.gates.some((g) => g.name === 'protected-paths'))

// ── claims ──
const s1 = recordEnter(T, { who: 'kimi' })
recordClaim(T, { sessionId: s1, who: 'kimi', paths: ['src/auth/**'], reason: 'refactoring auth' })
check('claim is active', activeClaims(T).some((c) => c.who === 'kimi'))
const s2 = recordEnter(T, { who: 'claude' })
const conflicts = claimConflicts(T, { paths: ['src/auth/login.ts'], sessionId: s2 })
check('overlapping claim detected as conflict', conflicts.length === 1 && conflicts[0].who === 'kimi')
const noConf = claimConflicts(T, { paths: ['src/billing/**'], sessionId: s2 })
check('non-overlapping path has no conflict', noConf.length === 0)
recordRelease(T, { sessionId: s1 })
check('release clears the claim', activeClaims(T).length === 0)
// claims die with the session too
recordClaim(T, { sessionId: s2, who: 'claude', paths: ['src/x/**'] })
recordDepart(T, { sessionId: s2, summary: 'done' })
check('claim dies when its session departs', activeClaims(T).length === 0)

// ── decisions ──
const s3 = recordEnter(T, { who: 'architect' })
recordDecisions(T, { sessionId: s3, who: 'architect', decisions: [
  { chose: 'PostgreSQL', over: 'MongoDB', because: 'transactions across shipments and invoices', paths: ['src/db/**'] },
] })
const found = listDecisions(T, { topic: 'mongo' })
check('decision recorded and queryable by topic', found.length === 1 && found[0].chose === 'PostgreSQL')
writeDecisionsMd(T)
check('DECISIONS.md projected with managed markers', existsSync(join(T, 'DECISIONS.md')) && /REPOTECTOR:BEGIN/.test(readFileSync(join(T, 'DECISIONS.md'), 'utf8')) && /PostgreSQL/.test(readFileSync(join(T, 'DECISIONS.md'), 'utf8')))

// ── hooks ──
const hooks = cli('hooks')
check('hooks installs the commit guard', /Commit guard installed/.test(hooks.out) && existsSync(join(T, '.git', 'hooks', 'pre-commit')))
const hooks2 = cli('hooks')
check('hooks re-run updates the shim in place', /updated|already installed/.test(hooks2.out))

// ── doctor ──
const report = runDoctor(T)
const ids = Object.fromEntries(report.checks.map((c) => [c.id, c.ok]))
check('doctor: state+doors+mcp+hooks green', ids.state && ids.doors && ids.mcp && ids.hooks)
const doctorOut = cli('doctor')
check('doctor CLI runs', /Repotector doctor/.test(doctorOut.out))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
