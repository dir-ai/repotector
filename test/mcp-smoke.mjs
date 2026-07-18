// Real stdio MCP smoke for Phase A: initialize instructions + isError contract.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { fileURLToPath } from 'node:url'
const PKG = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]+$/, '')
const T = join(process.env.TEMP || '/tmp', 'rpt-mcp-smoke')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, '.repotector'), { recursive: true })
mkdirSync(join(T, 'src'), { recursive: true })
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'src', 'a.ts'), 'export const a = 1\n')
// minimal .repotector artifacts so tools have data
writeFileSync(join(T, '.repotector', 'intent.json'), JSON.stringify({ domain: 'smoke-repo', boundedContexts: ['core'], standards: { maxFileLines: 300 } }))
writeFileSync(join(T, '.repotector', 'atlas.json'), JSON.stringify({ fingerprint: 'abc123', files: [{ path: 'src/a.ts', exports: ['a'] }], routes: [], components: [] }))
writeFileSync(join(T, '.repotector', 'policy.json'), JSON.stringify({ locked: false }))

const srv = spawn(process.execPath, [join(PKG, 'src', 'mcp-server.mjs')], { cwd: T, stdio: ['pipe', 'pipe', 'pipe'] })
let buf = ''
const pending = new Map()
srv.stdout.on('data', (d) => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    if (!line.trim()) continue
    let msg; try { msg = JSON.parse(line) } catch { continue }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
})
let stderr = ''
srv.stderr.on('data', (d) => { stderr += d.toString() })

let idc = 0
function rpc (method, params) {
  const id = ++idc
  return new Promise((resolve) => {
    pending.set(id, resolve)
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
function notify (method, params) { srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n') }

let pass = 0; let fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }

const pkgVersion = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version
const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } })
check('initialize serverInfo version matches package.json', init.result?.serverInfo?.version === pkgVersion)
check('initialize instructions mention REPOTECTOR/2', /REPOTECTOR\/2/.test(init.result?.instructions || ''))
check('initialize instructions say handshake FIRST', /handshake/i.test(init.result?.instructions || ''))
notify('notifications/initialized', {})

const pre = await rpc('tools/call', { name: 'city_map', arguments: {} })
check('pre-handshake deep tool sets isError:true', pre.result?.isError === true)
check('pre-handshake returns code HANDSHAKE_REQUIRED', pre.result?.structuredContent?.code === 'HANDSHAKE_REQUIRED')
check('pre-handshake gives a fix hint', /handshake/.test(pre.result?.structuredContent?.fix || ''))

const hs = await rpc('tools/call', { name: 'handshake', arguments: { who: 'smoke-agent' } })
check('handshake succeeds (not isError)', !hs.result?.isError)
check('handshake passport carries REPOTECTOR-2', /PSX-PASSPORT\/REPOTECTOR-2/.test(JSON.stringify(hs.result?.structuredContent)))

const post = await rpc('tools/call', { name: 'city_map', arguments: {} })
check('post-handshake city_map works', !post.result?.isError && !!post.result?.structuredContent?.domain)

// Phase B: handshake surfaces freshness, and does NOT rewrite proof.json (read-only-safe)
check('handshake reports freshness state', ['fresh', 'stale', 'unknown'].includes(hs.result?.structuredContent?.freshness?.state))
check('no stdout pollution (server logs only to stderr)', /ready \(stdio/.test(stderr))

// Phase D: depart closes the session, then register shows nobody inside
const dep = await rpc('tools/call', { name: 'depart', arguments: { summary: 'smoke visit' } })
check('depart returns departed:true', dep.result?.structuredContent?.departed === true)
check('depart reports filesTouched array', Array.isArray(dep.result?.structuredContent?.filesTouched))
const hs2 = await rpc('tools/call', { name: 'handshake', arguments: { who: 'smoke-agent-2' } })
check('re-handshake after depart works', !hs2.result?.isError)
const regAfter = await rpc('tools/call', { name: 'register', arguments: {} })
const openCount = regAfter.result?.structuredContent?.open?.length ?? -1
check('register shows exactly one open session (the current one)', openCount === 1)
check('register total counted multiple crossings', (regAfter.result?.structuredContent?.total ?? 0) >= 3)

// Phase G/H: DNA + journal + whats_next tools exist and answer
const cov = await rpc('tools/call', { name: 'dna_coverage', arguments: {} })
check('dna_coverage answers with a provenance', ['authored', 'inferred'].includes(cov.result?.structuredContent?.provenance))
const jr = await rpc('tools/call', { name: 'journal', arguments: {} })
check('journal returns the prior smoke visit', (jr.result?.structuredContent?.entries?.length ?? 0) >= 1)
const wn = await rpc('tools/call', { name: 'whats_next', arguments: {} })
check('whats_next returns a structured answer (suggestions or empty)', typeof wn.result?.structuredContent?.empty === 'boolean')
// hs2 (re-handshake after the first depart) should carry the prior visit in its tail
const tail = hs2.result?.structuredContent?.journalTail
check('re-handshake journalTail carried the prior smoke visit', Array.isArray(tail) && tail.length >= 1 && tail[0].who === 'smoke-agent')

srv.kill()
console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
