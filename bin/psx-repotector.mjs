#!/usr/bin/env node
// psx-repotector — portable repo guardian CLI.
// Subcommands: init | handshake | gates | atlas | dna | mcp
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAtlas } from '../src/atlas.mjs'
import { writeDna } from '../src/dna.mjs'
import { runGates, printProof, checkLineBudget, checkStructure, checkSecretHygiene } from '../src/gates.mjs'
import { snapshotFromGates, writeBaseline } from '../src/baseline.mjs'
import { handshake, printHandshake } from '../src/handshake.mjs'
import { repotectorDir, loadRepotectorJson } from '../src/util.mjs'
import { readRegister, printRegister, recordDepart } from '../src/register.mjs'
import { cityMap, printCityMap } from '../src/city-map.mjs'
import { setLock, clearLock, loadPolicy, isLocked } from '../src/lock.mjs'

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
    boundedContexts: inferBoundedContexts(root),
    canonRules: []
  }
  writeFileSync(p, JSON.stringify(intent, null, 2))
  return { path: p, created: true }
}

function installTemplates (root) {
  const tplDir = join(PKG_ROOT, 'templates')
  const map = { 'AGENTS.md': 'AGENTS.md', 'CLAUDE.md': 'CLAUDE.md', '.cursorrules': '.cursorrules' }
  const installed = []
  for (const [src, dest] of Object.entries(map)) {
    const from = join(tplDir, src)
    const to = join(root, dest)
    if (!existsSync(from)) continue
    if (existsSync(to)) continue
    copyFileSync(from, to)
    installed.push(dest)
  }
  return installed
}

function cmdInit () {
  console.log('⬡ PSX Repotector — init')
  const intent = writeIntent(ROOT)
  console.log(`  intent.json ${intent.created ? 'created' : 'kept (exists)'}`)
  const atlas = writeAtlas(ROOT)
  console.log(`  atlas.json  ${atlas.files.length} files, ${atlas.routes.length} routes, ${atlas.components.length} components (fp ${atlas.fingerprint})`)
  const dna = writeDna(ROOT, atlas)
  console.log(`  dna.json    ${dna.entities.length} entities, ${dna.api_contracts.length} contracts`)
  const proof = runGates(ROOT)
  const debt = proof.baselineDebt?.length ?? 0
  console.log(`  proof.json  verdict ${proof.verdict}${debt ? ` — ${debt} pre-existing item(s) grandfathered (never fails you on day one)` : ''}`)
  if (atlas.orientationLite) {
    console.log(`  stack       ${atlas.stack.primary} — orientation-lite (JS/TS deep-map only; ${atlas.stack.total} source files counted)`)
  }
  const installed = installTemplates(ROOT)
  console.log(`  docs        ${installed.length ? installed.join(', ') : 'none (already present)'}`)
  console.log('\nNext: wire the MCP server → command "npx psx-repotector mcp". Try: psx-repotector handshake')
}

function cmdAtlas () {
  const atlas = writeAtlas(ROOT)
  console.log(`atlas.json written — ${atlas.files.length} files, fingerprint ${atlas.fingerprint}`)
}

function cmdDna () {
  let atlas = null
  try { atlas = loadRepotectorJson(ROOT, 'atlas.json') } catch { atlas = writeAtlas(ROOT) }
  const dna = writeDna(ROOT, atlas)
  console.log(`dna.json written — ${dna.entities.length} entities, ${dna.api_contracts.length} contracts`)
}

async function cmdMcp () {
  await import('../src/mcp-server.mjs')
}

function cmdRegister () {
  printRegister(readRegister(ROOT))
}

function cmdDepart () {
  const summary = process.argv.slice(3).join(' ') || null
  recordDepart(ROOT, { sessionId: null, summary })
  console.log('← Departure logged.')
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

function fail (msg) { console.error(`Error: ${msg}`); process.exit(1) }

async function main () {
  const cmd = process.argv[2] || 'help'
  try {
    switch (cmd) {
      case 'init': return cmdInit()
      case 'atlas': return cmdAtlas()
      case 'dna': return cmdDna()
      case 'gates': return printProof(runGates(ROOT))
      case 'handshake': return printHandshake(handshake(ROOT))
      case 'register': return cmdRegister()
      case 'depart': return cmdDepart()
      case 'city-map': case 'map': return cmdCityMap()
      case 'baseline': return cmdBaseline()
      case 'lock': return cmdLock()
      case 'mcp': return await cmdMcp()
      case 'help': case '--help': case '-h':
        console.log('psx-repotector <init|handshake|register|depart|city-map|baseline|lock|gates|atlas|dna|mcp>')
        return
      default: return fail(`unknown command "${cmd}". Try: psx-repotector help`)
    }
  } catch (err) {
    fail(err.message)
  }
}

main()
