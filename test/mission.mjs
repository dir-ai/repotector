// v1.5 "Mission": the single verifiable chain — mission → claim → work →
// off-claim/forbidden → evidence pack → depart. Exercised over real MCP stdio.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PKG = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
const T = join(process.env.TEMP || '/tmp', 'rpt-mission')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
mkdirSync(join(T, '.repotector'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
writeFileSync(join(T, 'src', 'auth.ts'), 'export const auth = 1\n')
writeFileSync(join(T, 'src', 'billing.ts'), 'export const billing = 1\n')
git('add', '-A'); git('commit', '-qm', 'base')
writeFileSync(join(T, '.repotector', 'intent.json'), JSON.stringify({ domain: 'mission-test', standards: { maxFileLines: 300 }, structure: { requiredPaths: [] } }))
writeFileSync(join(T, '.repotector', 'atlas.json'), JSON.stringify({ fingerprint: 'x', files: [], routes: [], components: [] }))

let pass = 0, fail = 0
const check = (n, c, extra) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && extra ? `\n      ${String(extra).slice(0, 240)}` : ''}`) }

function connect () {
  const srv = spawn(process.execPath, [join(PKG, 'src', 'mcp-server.mjs')], { cwd: T, stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  const pending = new Map()
  srv.stdout.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line.trim()) continue
      try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } } catch { /* noise */ }
    }
  })
  let idc = 0
  const rpc = (method, params) => new Promise((res) => { const id = ++idc; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
  return { srv, rpc, call: (name, args) => rpc('tools/call', { name, arguments: args }) }
}

const a = connect()
await a.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } })
a.srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n')
await a.call('handshake', { who: 'agent-A' })

// declare the mission: zone src/auth, forbidden src/billing
const mission = await a.call('declare_mission', {
  goal: 'Add OAuth login to the auth module',
  acceptance: ['login endpoint responds', 'tokens stored securely'],
  claimPaths: ['src/auth.ts'],
  forbiddenPaths: ['src/billing.ts'],
  risk: 'medium',
})
const ms = mission.result?.structuredContent
check('mission accepted with briefing', ms?.missionAccepted === true && ms?.briefing?.gates, JSON.stringify(mission.result).slice(0, 200))
check('mission auto-claims the zone', ms?.briefing?.claimGranted === true)
check('briefing carries merge status + protected paths fields', 'merge' in (ms?.briefing ?? {}) && 'protectedPaths' in (ms?.briefing ?? {}))

// agent B sees the mission at handshake
const b = connect()
await b.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't2', version: '0' } })
b.srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n')
const hsB = await b.call('handshake', { who: 'agent-B' })
check('agent-B sees the mission in progress', (hsB.result?.structuredContent?.activeMissions ?? []).some((m) => /OAuth/.test(m.goal)))
// and colliding claim is refused
const clB = await b.call('claim', { paths: ['src/auth.ts'] })
check('agent-B colliding claim refused with attribution', clB.result?.structuredContent?.granted === false)
b.srv.kill()

// agent A works: inside zone AND in the forbidden zone (violation)
writeFileSync(join(T, 'src', 'auth.ts'), 'export const auth = 2 // oauth\n')
writeFileSync(join(T, 'src', 'billing.ts'), 'export const billing = 2 // sneaky edit\n')

const dep = await a.call('depart', {
  summary: 'OAuth added',
  acceptanceReport: [{ criterion: 'login endpoint responds', status: 'done' }],
})
const ds = dep.result?.structuredContent
check('evidence pack produced', !!ds?.evidence && ds.evidence.goal.includes('OAuth'))
check('machine-verified section present (gates/merge/files)', ['gates', 'mergeClean', 'filesTouched'].every((k) => k in (ds?.evidence?.machineVerified ?? {})))
check('forbidden violation CAUGHT (src/billing.ts)', (ds?.offForbidden ?? []).includes('src/billing.ts'))
check('agent-declared report kept distinct (source marked)', (ds?.evidence?.agentDeclared ?? []).every((r) => r.source === 'agent-declared'))
check('unreported criteria surfaced honestly', (ds?.evidence?.criteriaWithoutReport ?? []).includes('tokens stored securely'))
a.srv.kill()

// the evidence is persisted in the register (next agent can audit it)
const reg = execFileSync(process.execPath, ['-e', `
const fs=require('fs');
const lines=fs.readFileSync(String.raw\`${join(T, '.repotector', 'register.jsonl')}\`,'utf8').trim().split('\\n').map(JSON.parse);
const dep=lines.reverse().find(e=>e.event==='depart'&&e.evidence);
console.log(JSON.stringify({hasEvidence:!!dep, goal:dep?.evidence?.goal??null}));
`], { encoding: 'utf8' })
check('evidence persisted on the register depart event', JSON.parse(reg).hasEvidence === true)

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
