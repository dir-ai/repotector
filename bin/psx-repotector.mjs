#!/usr/bin/env node
// psx-repotector — portable repo guardian CLI.
// Subcommands: init | handshake | gates | atlas | dna | mcp
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAtlas } from '../src/atlas.mjs'
import { writeDna } from '../src/dna.mjs'
import { runGates, printProof } from '../src/gates.mjs'
import { handshake, printHandshake } from '../src/handshake.mjs'
import { repotectorDir, loadRepotectorJson } from '../src/util.mjs'

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
  console.log(`  proof.json  verdict ${proof.verdict}`)
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
      case 'mcp': return await cmdMcp()
      case 'help': case '--help': case '-h':
        console.log('psx-repotector <init|handshake|gates|atlas|dna|mcp>')
        return
      default: return fail(`unknown command "${cmd}". Try: psx-repotector help`)
    }
  } catch (err) {
    fail(err.message)
  }
}

main()
