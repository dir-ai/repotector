// Phase D: resilient depart + register self-healing.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { recordEnter, recordDepart, readRegister, sweepStaleSessions, latestOpenSession } from '../src/register.mjs'
import { filesChangedSince, gitHead } from '../src/freshness.mjs'

const T = join(process.env.TEMP || '/tmp', 'rpt-phase-d')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
mkdirSync(join(T, '.repotector'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
writeFileSync(join(T, 'src', 'a.ts'), 'export const a = 1\n')
git('add', '.'); git('commit', '-q', '-m', 'c1')

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }

// enter captures head; make a change; depart reports the delta
const head0 = gitHead(T)
const sid = recordEnter(T, { who: 'agent-1', enterHead: head0 })
writeFileSync(join(T, 'src', 'b.ts'), 'export const b = 2\n')
const touched = filesChangedSince(T, head0)
check('filesChangedSince sees the new working file', touched.includes('src/b.ts'))
check('filesChangedSince ignores .repotector artifacts', !touched.some((f) => f.startsWith('.repotector/')))
recordDepart(T, { sessionId: sid, summary: 'added b', filesTouched: touched })
let reg = readRegister(T)
check('session closed after depart (0 open)', reg.open.length === 0)
const dep = reg.entries.find((e) => e.event === 'depart' && e.sessionId === sid)
check('depart entry carries filesTouched', dep.filesTouched && dep.filesTouched.includes('src/b.ts'))

// stale sweep: an old open session (backdated) gets auto-departed
const oldTs = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
// hand-write a stale enter directly
writeFileSync(join(T, '.repotector', 'register.jsonl'),
  readRegister(T).entries.map((e) => JSON.stringify(e)).join('\n') + '\n' +
  JSON.stringify({ event: 'enter', ts: oldTs, sessionId: 'deadbeef1234', who: 'ghost', enterHead: head0 }) + '\n')
check('ghost session is open before sweep', readRegister(T).open.some((s) => s.sessionId === 'deadbeef1234'))
const swept = sweepStaleSessions(T)
check('sweep returns the ghost session id', swept.includes('deadbeef1234'))
reg = readRegister(T)
check('ghost session closed after sweep', !reg.open.some((s) => s.sessionId === 'deadbeef1234'))
const gd = reg.entries.find((e) => e.event === 'depart' && e.sessionId === 'deadbeef1234')
check('synthetic depart flagged + reason', gd.synthetic === true && /stale/.test(gd.reason))

// a FRESH open session is NOT swept (concurrency safety)
const freshSid = recordEnter(T, { who: 'agent-2', enterHead: head0 })
sweepStaleSessions(T)
check('fresh session survives the sweep', readRegister(T).open.some((s) => s.sessionId === freshSid))
check('latestOpenSession returns the fresh one', latestOpenSession(T).sessionId === freshSid)

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
