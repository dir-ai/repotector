#!/usr/bin/env node
// psx-repotector — portable repo guardian CLI.
// Subcommands: init | handshake | gates | atlas | dna | mcp
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAtlas } from '../src/atlas.mjs'
import { writeDna } from '../src/dna.mjs'
import { runGates, printProof, checkLineBudget, checkStructure, checkSecretHygiene } from '../src/gates.mjs'
import { snapshotFromGates, writeBaseline } from '../src/baseline.mjs'
import { handshake, printHandshake } from '../src/handshake.mjs'
import { repotectorDir, loadRepotectorJson } from '../src/util.mjs'
import { readRegister, printRegister, recordEnter, recordDepart, sweepStaleSessions, latestOpenSession } from '../src/register.mjs'
import { gitHead, filesChangedSince } from '../src/freshness.mjs'
import { cityMap, printCityMap } from '../src/city-map.mjs'
import { setLock, clearLock, loadPolicy, isLocked } from '../src/lock.mjs'
import { installDoors } from '../src/doors.mjs'
import { writeInferredDna, dnaQuery, dnaCoverage } from '../src/dna-layer.mjs'
import { buildJournal, writeJournalMd, writeDecisionsMd } from '../src/journal.mjs'
import { whatsNext } from '../src/whats-next.mjs'
import { runDoctor, printDoctor } from '../src/doctor.mjs'
import { listDecisions } from '../src/register.mjs'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = process.cwd()

function inferRequiredPaths (root) {
  return ['package.json', 'README.md', 'README.markdown', 'src']
    .filter((p) => existsSync(join(root, p)))
    .filter((p, i, a) => a.indexOf(p) === i)
    .slice(0, 4)
}

function inferBoundedContexts (root) {
  const dirs = new Set()
  for (const base of ['src', 'app', 'packages']) {
    const abs = join(root, base)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      try { if (statSync(join(abs, name)).isDirectory()) dirs.add(`${base}/${name}`) } catch { /* skip */ }
    }
  }
  return [...dirs].sort().slice(0, 20)
}

function writeIntent (root) {
  const dir = repotectorDir(root)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'intent.json')
  if (existsSync(p)) return { path: p, created: false }
  const domain = root.split(/[\\/]/).filter(Boolean).pop() || 'repo'
  const intent = {
    domain,
    intent: `Preserve and honor the existing structure of "${domain}".`,
    standards: { maxFileLines: 300 },
    scan: { excludeGlobs: ['**/*.min.js', '**/*.d.ts', '**/vendor/**'] },
    structure: { requiredPaths: inferRequiredPaths(root) },
    protect: { paths: ['.github/workflows/**', 'LICENSE'] },
    boundedContexts: inferBoundedContexts(root),
    canonRules: []
  }
  writeFileSync(p, JSON.stringify(intent, null, 2))
  return { path: p, created: true }
}

function cmdInit () {
  console.log('⬡ PSX Repotector — init')
  const intent = writeIntent(ROOT)
  console.log(`  intent.json ${intent.created ? 'created' : 'kept (exists)'}`)
  const atlas = writeAtlas(ROOT)
  console.log(`  atlas.json  ${atlas.files.length} files, ${atlas.routes.length} routes, ${atlas.components.length} components (fp ${atlas.fingerprint})`)
  const dna = writeDna(ROOT, atlas)
  console.log(`  dna.json    ${dna.entities.length} entities, ${dna.api_contracts.length} contracts`)
  // Reverse-DNA clauses for foreign repos (skipped when an authored .psx mirror
  // exists — that is ground truth and must not be shadowed).
  if (!existsSync(join(ROOT, '.psx'))) {
    const inf = writeInferredDna(ROOT, { atlas, baseDna: dna })
    console.log(`  dna.inferred ${inf.clauses.length} inferred clause(s) [reverse-DNA]`)
  }
  const proof = runGates(ROOT)
  const debt = proof.baselineDebt?.length ?? 0
  console.log(`  proof.json  verdict ${proof.verdict}${debt ? ` — ${debt} pre-existing item(s) grandfathered (never fails you on day one)` : ''}`)
  if (atlas.orientationLite) {
    console.log(`  stack       ${atlas.stack.primary} — orientation-lite (JS/TS deep-map only; ${atlas.stack.total} source files counted)`)
  }
  const doors = installDoors(ROOT)
  console.log(`  doors       ${doors.join(', ')}`)
  console.log('\nGuarded ⬡ — the MCP server is wired in .mcp.json (your client will prompt once). Try: psx-repotector handshake')
}

function cmdAtlas () {
  const atlas = writeAtlas(ROOT)
  console.log(`atlas.json written — ${atlas.files.length} files, fingerprint ${atlas.fingerprint}`)
}

// Re-derive the map and re-stamp the managed doorway blocks so an arriving agent
// never reads a stale contract. Keeps human prose (outside the markers) intact.
function cmdRefresh () {
  const atlas = writeAtlas(ROOT)
  const dna = writeDna(ROOT, atlas)
  if (!existsSync(join(ROOT, '.psx'))) writeInferredDna(ROOT, { atlas, baseDna: dna })
  const proof = runGates(ROOT)
  installDoors(ROOT)
  console.log(`⬡ Refreshed — atlas fp ${atlas.fingerprint}, verdict ${proof.verdict}, doorway blocks re-stamped.`)
}

function cmdDna () {
  let atlas = null
  try { atlas = loadRepotectorJson(ROOT, 'atlas.json') } catch { atlas = writeAtlas(ROOT) }
  const dna = writeDna(ROOT, atlas)
  console.log(`dna.json written — ${dna.entities.length} entities, ${dna.api_contracts.length} contracts`)
  if (!existsSync(join(ROOT, '.psx'))) {
    const inf = writeInferredDna(ROOT, { atlas, baseDna: dna })
    console.log(`dna.inferred.json written — ${inf.clauses.length} inferred clause(s)`)
  }
}

function cmdDnaCoverage () {
  const cov = dnaCoverage(ROOT)
  const t = cov.totals
  console.log(`\n⬡ DNA coverage (${cov.provenance}) — implemented ${t.implemented} · partial ${t.partial} · missing ${t.missing} · unmapped ${t.unmapped}`)
  for (const c of cov.clauses.filter((x) => x.status === 'missing' || x.status === 'partial').slice(0, 20)) {
    console.log(`  ${c.status === 'missing' ? '✗' : '◐'} ${c.id} ${c.text}`)
  }
  console.log('')
}

function cmdDnaQuery () {
  const arg = process.argv.slice(3).join(' ').trim()
  const q = dnaQuery(ROOT, arg ? { topic: arg } : {})
  console.log(`\n⬡ DNA (${q.provenance}) — ${q.count} clause(s)${arg ? ` matching "${arg}"` : ''}`)
  for (const c of q.clauses.slice(0, 25)) console.log(`  • ${c.id} [${c.kind}${c.confidence != null ? ' ~' + c.confidence : ''}] ${c.text}`)
  console.log('')
}

async function cmdMcp () {
  await import('../src/mcp-server.mjs')
}

function cmdRegister () {
  printRegister(readRegister(ROOT))
}

// A CLI handshake is a one-shot peek: log it as a complete visit (enter +
// depart) so the register stays truthful without leaving an immortal open
// session. Pass --who to attribute it.
function cmdHandshake () {
  try { sweepStaleSessions(ROOT) } catch { /* best-effort */ }
  const h = handshake(ROOT)
  printHandshake(h)
  const whoIdx = process.argv.indexOf('--who')
  const who = whoIdx >= 0 ? process.argv[whoIdx + 1] : 'cli'
  try {
    const sessionId = recordEnter(ROOT, { who, purpose: 'cli handshake', passport: h.passport, enterHead: gitHead(ROOT) })
    recordDepart(ROOT, { sessionId, synthetic: true, reason: 'cli one-shot visit' })
  } catch { /* register optional on a bare peek */ }
}

// Close the most-recent still-open session (e.g. a crashed MCP agent) with the
// real file delta — never an orphan sessionId:null.
function cmdDepart () {
  const summary = process.argv.slice(3).filter((a) => a !== '--who').join(' ') || null
  const open = latestOpenSession(ROOT)
  if (open) {
    recordDepart(ROOT, { sessionId: open.sessionId, summary, filesTouched: filesChangedSince(ROOT, open.enterHead) })
    try { writeJournalMd(ROOT) } catch { /* projection, best-effort */ }
    console.log(`← Closed session ${open.sessionId} (${open.who}).`)
  } else {
    console.log('No open session to close.')
  }
}

function cmdJournal () {
  const entries = buildJournal(ROOT, { limit: 15 })
  console.log(`\n⬡ Journal — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (newest first)`)
  for (const j of entries) {
    const date = (j.ts || '').replace('T', ' ').replace(/\..*/, '')
    console.log(`  ${date}  ${j.who}${j.synthetic ? ' (auto)' : ''}: ${j.summary || (j.synthetic ? j.reason : '—')}${j.filesTouched.length ? ` [${j.filesTouched.length} files]` : ''}`)
  }
  writeJournalMd(ROOT)
  console.log('  (JOURNAL.md regenerated)\n')
}

function cmdWhatsNext () {
  const wn = whatsNext(ROOT)
  console.log('\n⬡ What’s next')
  if (wn.empty) { console.log('  Nothing concrete to suggest (no DNA gaps, threads, or TODOs). A real answer, not a gap.\n'); return }
  for (const s of wn.suggestions) console.log(`  • [${s.source}·${s.confidence}] ${s.title}`)
  console.log('')
}

function cmdCityMap () {
  printCityMap(cityMap(ROOT))
}

// Re-snapshot the grandfathered floor: after paying down (or accepting) debt,
// `baseline` makes the current state the new zero — future gates measure drift
// from here.
function cmdBaseline () {
  const intent = loadRepotectorJson(ROOT, 'intent.json')
  const gates = [checkLineBudget(ROOT, intent), checkStructure(ROOT, intent), checkSecretHygiene(ROOT, intent)]
  const snap = snapshotFromGates(gates, ROOT)
  writeBaseline(ROOT, snap)
  const items = Object.keys(snap.lineBudget).length + snap.secrets.length + snap.trackedEnv.length + snap.structureMissing.length
  console.log(`⬡ Baseline re-snapshotted — ${items} item(s) grandfathered as the new floor.`)
}

// lock <passphrase> [tool ...] → turn the OPTIONAL lock on. unlock is a session
// concept (MCP); the CLI `lock --off <passphrase>` clears it.
function cmdLock () {
  const args = process.argv.slice(3)
  if (args[0] === '--off') {
    clearLock(ROOT, args[1])
    console.log('🔓 Lock cleared — repo is open.')
    return
  }
  if (args[0] === '--status') {
    console.log(isLocked(loadPolicy(ROOT)) ? '🔒 Locked.' : '🔓 Open (no lock).')
    return
  }
  const passphrase = args[0]
  if (!passphrase) return fail('usage: psx-repotector lock <passphrase> | --off <passphrase> | --status')
  const gated = args.slice(1)
  const lock = setLock(ROOT, passphrase, gated.length ? gated : undefined)
  console.log(`🔒 Lock ON. Gated tools: ${lock.gated.join(', ')}. Handshake stays open; agents must \`unlock\` to read the deep map.`)
}

// Install the commit guard: pre-commit runs `gates` (grandfathered → it only
// blocks NEW regressions, never day-one debt). Never clobbers an existing hook.
function cmdHooks () {
  const hooksDir = join(ROOT, '.git', 'hooks')
  if (!existsSync(hooksDir)) return fail('no .git/hooks here — run inside a git repository.')
  const hookPath = join(hooksDir, 'pre-commit')
  const shim = '#!/bin/sh\n# repotector commit guard — blocks only NEW regressions (grandfathered baseline).\nexec npx --no-install repotector gates || exec npx -y repotector gates\n'
  if (existsSync(hookPath)) {
    const current = readFileSync(hookPath, 'utf8')
    if (/repotector/.test(current)) { console.log('✓ Commit guard already installed.'); return }
    return fail('a pre-commit hook already exists — add "npx repotector gates" to it manually (never clobbering yours).')
  }
  writeFileSync(hookPath, shim)
  try { chmodSync(hookPath, 0o755) } catch { /* windows: git runs hooks via sh regardless */ }
  console.log('⬡ Commit guard installed (.git/hooks/pre-commit) — gates run on every commit; only regressions block.')
}

function cmdDoctor () {
  const report = runDoctor(ROOT)
  printDoctor(report)
  if (!report.ok) process.exit(1)
}

function cmdDecisions () {
  const topic = process.argv.slice(3).join(' ').trim() || undefined
  const decisions = listDecisions(ROOT, { topic, limit: 20 })
  console.log(`\n⬡ Decisions${topic ? ` matching "${topic}"` : ''} — ${decisions.length}`)
  for (const d of decisions) console.log(`  • ${d.chose}${d.over ? ` over ${d.over}` : ''} — ${d.because}`)
  writeDecisionsMd(ROOT)
  console.log('  (DECISIONS.md regenerated)\n')
}

function fail (msg) { console.error(`Error: ${msg}`); process.exit(1) }

async function main () {
  const cmd = process.argv[2] || 'help'
  try {
    switch (cmd) {
      case 'init': return cmdInit()
      case 'atlas': return cmdAtlas()
      case 'dna': return cmdDna()
      case 'gates': {
        const proof = runGates(ROOT)
        printProof(proof)
        // Non-zero on regressions so hooks and CI can actually gate.
        if (proof.verdict !== 'INTENT_HONORED') process.exit(1)
        return
      }
      case 'hooks': return cmdHooks()
      case 'doctor': return cmdDoctor()
      case 'decisions': return cmdDecisions()
      case 'handshake': return cmdHandshake()
      case 'register': return cmdRegister()
      case 'depart': return cmdDepart()
      case 'city-map': case 'map': return cmdCityMap()
      case 'baseline': return cmdBaseline()
      case 'refresh': return cmdRefresh()
      case 'dna-coverage': case 'coverage': return cmdDnaCoverage()
      case 'dna-query': return cmdDnaQuery()
      case 'journal': return cmdJournal()
      case 'whats-next': case 'next': return cmdWhatsNext()
      case 'lock': return cmdLock()
      case 'mcp': return await cmdMcp()
      case 'help': case '--help': case '-h':
        console.log('psx-repotector <init|refresh|doctor|hooks|handshake|register|depart|journal|decisions|whats-next|city-map|baseline|dna|dna-coverage|dna-query|lock|gates|atlas|mcp>')
        return
      default: return fail(`unknown command "${cmd}". Try: psx-repotector help`)
    }
  } catch (err) {
    fail(err.message)
  }
}

main()
