// v1.3 "Merge Guard": trial merge (merge-tree), zone attribution, MM bridge.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mergeCheck, psxLeases, allZones, resolveTarget } from '../src/merge.mjs'
import { recordEnter, recordClaim } from '../src/register.mjs'

import { fileURLToPath } from 'node:url'
const PKG = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]+$/, '')
const BIN = join(PKG, 'bin', 'psx-repotector.mjs')
const T = join(process.env.TEMP || '/tmp', 'rpt-v13')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }
const cli = (...a) => {
  try { return { out: execFileSync(process.execPath, [BIN, ...a], { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 } }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 } }
}

// base: shared file
writeFileSync(join(T, 'src', 'app.ts'), 'export const title = "Hello"\nexport const version = 1\n')
git('add', '-A'); git('commit', '-qm', 'base')

// main advances: agent A edits line 1
writeFileSync(join(T, 'src', 'app.ts'), 'export const title = "Hello from MAIN"\nexport const version = 1\n')
git('commit', '-qam', 'main change')

// feature branch from base: agent B edits the SAME line differently
git('checkout', '-q', '-b', 'feature', 'HEAD~1')
writeFileSync(join(T, 'src', 'app.ts'), 'export const title = "Hello from FEATURE"\nexport const version = 1\n')
git('commit', '-qam', 'feature change')

// 1) conflict detected before any commit into the collision
const m1 = mergeCheck(T, { target: 'main' })
check('trial merge detects the collision (clean=false)', m1.supported && m1.clean === false)
check('conflict names the exact file', m1.conflicts.some((c) => c.file === 'src/app.ts'))
check('ahead/behind computed', m1.ahead === 1 && m1.behind === 1)

// 2) attribution: a live claim on the zone shows who you collide with
mkdirSync(join(T, '.repotector'), { recursive: true })
const s1 = recordEnter(T, { who: 'agent-main' })
recordClaim(T, { sessionId: s1, who: 'agent-main', paths: ['src/**'] })
const m2 = mergeCheck(T, { target: 'main' })
check('conflicted file attributed to the claim holder', m2.conflicts[0].heldBy.some((h) => h.who === 'agent-main' && h.source === 'claim'))

// 3) Merge Machine bridge: .psx/merge/leases.json read + merged into zones
mkdirSync(join(T, '.psx', 'merge'), { recursive: true })
writeFileSync(join(T, '.psx', 'merge', 'leases.json'), JSON.stringify([{ who: 'merge-machine-session-7', paths: ['src/app.ts'], reason: 'seal in progress' }]))
const leases = psxLeases(T)
check('psx leases bridge reads the mirror', leases.length === 1 && leases[0].source === 'psx-merge-machine')
const zones = allZones(T)
check('allZones merges claims + MM leases', zones.some((z) => z.source === 'claim') && zones.some((z) => z.source === 'psx-merge-machine'))
const m3 = mergeCheck(T, { target: 'main' })
check('conflict attributed to the MM lease too', m3.conflicts[0].heldBy.some((h) => h.source === 'psx-merge-machine'))

// 4) non-conflicting divergence → clean
git('checkout', '-q', '-b', 'feature2', 'main')
writeFileSync(join(T, 'src', 'other.ts'), 'export const other = true\n')
git('add', '-A'); git('commit', '-qm', 'unrelated')
const m4 = mergeCheck(T, { target: 'main' })
check('non-conflicting branch → CLEAN', m4.clean === true && m4.conflicts.length === 0)

// 5) no target → honest unknown (never fake green)
const m5 = mergeCheck(T, { target: undefined })
check('no upstream/origin → clean=null with note', m5.clean === null && /No integration base/.test(m5.note))
check('resolveTarget honors explicit ref', resolveTarget(T, 'main') === 'main')

// 6) CLI: exit 0 on clean, 1 on conflict
const c1 = cli('merge-check', 'main')
check('CLI clean → exit 0 + CLEAN', c1.code === 0 && /CLEAN/.test(c1.out))
git('checkout', '-q', 'feature')
const c2 = cli('merge-check', 'main')
check('CLI conflict → exit 1 + file listed', c2.code === 1 && /src\/app\.ts/.test(c2.out))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
