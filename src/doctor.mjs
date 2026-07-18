// doctor.mjs — "how protected is this repo, really?" One command, semaphore
// output, a concrete fix for every red. The command a team lead runs before
// approving agents on a repo — and the one early adopters show colleagues.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshness } from './freshness.mjs'
import { loadPolicy, isLocked } from './lock.mjs'
import { readRegister } from './register.mjs'

function readSafeLocal (p) { try { return readFileSync(p, 'utf8') } catch { return '' } }

export function runDoctor (root = process.cwd()) {
  const checks = []
  const add = (id, ok, detail, fix) => checks.push({ id, ok, detail, fix: ok ? null : fix })

  // State artifacts
  const hasIntent = existsSync(join(root, '.repotector', 'intent.json'))
  const hasAtlas = existsSync(join(root, '.repotector', 'atlas.json'))
  add('state', hasIntent && hasAtlas,
    hasIntent && hasAtlas ? 'intent.json + atlas.json present' : 'missing .repotector state',
    'run: repotector init')

  // Map freshness
  let atlas = null
  try { atlas = JSON.parse(readSafeLocal(join(root, '.repotector', 'atlas.json'))) } catch { /* covered above */ }
  const fresh = atlas ? freshness(root, atlas) : { state: 'unknown', why: 'no atlas' }
  add('freshness', fresh.state === 'fresh',
    `map ${fresh.state}${fresh.why ? ` (${fresh.why})` : ''}`,
    'run: repotector refresh')

  // Doors
  const agentsMd = readSafeLocal(join(root, 'AGENTS.md'))
  add('doors', /REPOTECTOR:BEGIN/.test(agentsMd),
    /REPOTECTOR:BEGIN/.test(agentsMd) ? 'doorway blocks installed' : 'AGENTS.md lacks the managed block',
    'run: repotector refresh (re-stamps the doors)')

  // MCP wiring
  let mcpWired = false
  try {
    const mcp = JSON.parse(readSafeLocal(join(root, '.mcp.json')))
    mcpWired = Boolean(mcp?.mcpServers?.repotector)
  } catch { /* absent or invalid */ }
  add('mcp', mcpWired,
    mcpWired ? '.mcp.json wires the repotector server' : '.mcp.json missing the repotector server',
    'run: repotector init (merges the pinned entry)')

  // Commit guard
  const hook = readSafeLocal(join(root, '.git', 'hooks', 'pre-commit'))
  add('hooks', /repotector/.test(hook),
    /repotector/.test(hook) ? 'pre-commit guard installed' : 'no pre-commit guard — gates are advisory only',
    'run: repotector hooks')

  // Register readable
  let registerOk = true
  let registerDetail = 'register readable'
  try {
    const reg = readRegister(root)
    registerDetail = `register readable (${reg.total} events, ${reg.open.length} inside)`
  } catch { registerOk = false; registerDetail = 'register unreadable' }
  add('register', registerOk, registerDetail, 'inspect .repotector/register.jsonl for corruption')

  // Lock status (informational — never red)
  const locked = isLocked(loadPolicy(root))
  add('lock', true, locked ? 'deep map passphrase-gated' : 'open (no lock) — optional', null)

  const reds = checks.filter((c) => !c.ok).length
  return { ok: reds === 0, reds, checks }
}

const C = { g: '\x1b[32m', r: '\x1b[31m', dim: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }

export function printDoctor (report) {
  console.log(`\n${C.b}⬡ Repotector doctor${C.x}`)
  for (const c of report.checks) {
    console.log(`  ${c.ok ? C.g + '●' : C.r + '●'}${C.x} ${c.id.padEnd(10)} ${c.detail}`)
    if (c.fix) console.log(`     ${C.dim}fix → ${c.fix}${C.x}`)
  }
  console.log(report.ok
    ? `\n  ${C.g}${C.b}All green — this repo is guarded.${C.x}\n`
    : `\n  ${C.r}${C.b}${report.reds} check(s) red.${C.x}\n`)
}
