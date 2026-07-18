// city-map.mjs — the "info point" an arriving AI reads to understand the repo:
// what the DNA specified, what the Atlas shows is actually built, and therefore
// what is still MISSING — plus best-effort pointers to the Genome/Phenome/skeleton
// when a PSX Workbench mirror (.psx/) is present. It never re-derives the brain;
// it reads what the Workbench produced and surfaces it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadRepotectorJson, repotectorDir } from './util.mjs'

function readJsonSafe (p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

// Find the first existing file among candidates (relative to root).
function firstExisting (root, candidates) {
  for (const rel of candidates) {
    const p = join(root, rel)
    if (existsSync(p)) return { path: rel, data: readJsonSafe(p) }
  }
  return null
}

// The PSX Workbench writes a read-only mirror under .psx/. Locate the brain
// artifacts there when they exist; degrade gracefully to "absent" otherwise.
function brainPointers (root) {
  const psx = join(root, '.psx')
  const present = existsSync(psx)
  const dna = firstExisting(root, ['.psx/dna/head.json', '.psx/dna.json', '.repotector/dna.json'])
  const genome = firstExisting(root, ['.psx/genome/head.json', '.psx/genome.json', '.repotector/genome.json'])
  const phenome = firstExisting(root, ['.psx/phenome/head.json', '.psx/phenome.json', '.repotector/phenome.json'])
  return {
    psxMirror: present,
    dna: dna ? { present: true, source: dna.path } : { present: false },
    genome: genome ? { present: true, source: genome.path } : { present: false },
    phenome: phenome ? { present: true, source: phenome.path } : { present: false }
  }
}

// Skeleton = the structural shape: top-level source dirs + the intent's declared
// requiredPaths / boundedContexts, marked present/absent on disk.
function skeleton (root, intent, atlas) {
  const topDirs = []
  try {
    for (const name of readdirSync(root).sort()) {
      if (name.startsWith('.') || name === 'node_modules') continue
      if (statSync(join(root, name)).isDirectory()) topDirs.push(name)
    }
  } catch { /* ignore */ }
  const required = (intent.structure?.requiredPaths ?? []).map((rel) => ({ path: rel, present: existsSync(join(root, rel)) }))
  return { topDirs, requiredPaths: required, boundedContexts: intent.boundedContexts ?? [] }
}

// "Built vs missing": every declared requiredPath / context that is NOT present
// on disk is a gap the arriving AI should build (not rebuild what exists).
function builtVsMissing (root, intent, atlas) {
  const built = []
  const missing = []
  for (const rel of intent.structure?.requiredPaths ?? []) {
    (existsSync(join(root, rel)) ? built : missing).push(rel)
  }
  return {
    built,
    missing,
    routes: atlas.routes?.length ?? 0,
    components: atlas.components?.length ?? 0,
    files: atlas.files?.length ?? 0
  }
}

// Assemble the full city map. Requires .repotector/{intent,atlas}.json to exist.
export function cityMap (root = process.cwd()) {
  const intent = loadRepotectorJson(root, 'intent.json')
  const atlas = loadRepotectorJson(root, 'atlas.json')
  const stack = atlas.stack ?? null
  // Honesty note: when the JS extractors don't represent this repo, say so —
  // a "0 routes / 0 components" map on a Python repo is not a real map.
  const orientationLite = !!atlas.orientationLite
  const note = orientationLite && stack
    ? `orientation-lite: primary stack "${stack.primary}" (${stack.total} source files); the exports/routes/components map covers JS/TS only.`
    : null
  return {
    domain: intent.domain ?? 'this repo',
    intent: intent.intent ?? null,
    fingerprint: atlas.fingerprint ?? null,
    stack,
    orientationLite,
    note,
    brain: brainPointers(root),
    skeleton: skeleton(root, intent, atlas),
    status: builtVsMissing(root, intent, atlas)
  }
}

const C = { b: '\x1b[1m', dim: '\x1b[2m', c: '\x1b[36m', g: '\x1b[32m', y: '\x1b[33m', x: '\x1b[0m' }

export function printCityMap (m) {
  console.log(`\n${C.b}${C.c}⬡ City map — ${m.domain}${C.x} ${C.dim}(fp ${m.fingerprint})${C.x}`)
  if (m.intent) console.log(`${C.dim}intent:${C.x} ${m.intent}`)
  if (m.note) console.log(`${C.y}⚑ ${m.note}${C.x}`)
  console.log(`\n${C.b}Brain${C.x} ${C.dim}(from .psx mirror: ${m.brain.psxMirror})${C.x}`)
  for (const k of ['dna', 'genome', 'phenome']) {
    const b = m.brain[k]
    console.log(`  ${b.present ? C.g + '✓' : C.dim + '·'}${C.x} ${k}${b.present ? C.dim + ' → ' + b.source + C.x : C.dim + ' absent' + C.x}`)
  }
  console.log(`\n${C.b}Status${C.x}  files=${m.status.files} routes=${m.status.routes} components=${m.status.components}`)
  if (m.status.built.length) console.log(`  ${C.g}built:${C.x} ${m.status.built.join(', ')}`)
  if (m.status.missing.length) console.log(`  ${C.y}missing:${C.x} ${m.status.missing.join(', ')}`)
  console.log('')
}
