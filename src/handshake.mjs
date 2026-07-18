// handshake.mjs — the front door: orients any arriving AI, runs gates live, mints a passport.
import { createHash } from 'node:crypto'
import { loadRepotectorJson } from './util.mjs'
import { readLatestProof } from './gates.mjs'
import { freshness } from './freshness.mjs'
import { PROTOCOL_ID } from './protocol.mjs'

const GROUND_RULES = [
  'REUSE first: call find_existing before building — do not rebuild what already exists.',
  'PROTECT before edit: call blast_radius on files you touch — do not break dependents/routes.',
  'INTEGRATE to canon: call canon_check — follow the repo\'s established patterns.',
  'Keep source files under the line budget (default 300 lines).',
  'Query the map with atlas_query instead of guessing structure.'
]

function passport (atlas, proof, intent) {
  const proto = PROTOCOL_ID.replace('/', '-')
  const seed = [proto, atlas?.fingerprint ?? 'nofp', proof?.verdict ?? '?', intent?.domain ?? '?'].join('|')
  const sig = createHash('sha256').update(seed).digest('hex').slice(0, 12)
  return `PSX-PASSPORT/${proto}::${intent?.domain ?? 'repo'}::${atlas?.fingerprint ?? 'nofp'}::${proof?.verdict ?? 'UNKNOWN'}::${sig}`
}

// Read-only and walk-free: reads the cached verdict (last gate run) and stamps
// freshness via git — no tree scan, no disk write. The front door must be fast
// and must work on a read-only checkout. Run `quality_gates` for a live verdict.
export function handshake (root = process.cwd()) {
  const intent = loadRepotectorJson(root, 'intent.json')
  const atlas = loadRepotectorJson(root, 'atlas.json')
  const proof = readLatestProof(root) ?? { verdict: 'UNKNOWN', stale: true }
  const fresh = freshness(root, atlas)
  const map = {
    fingerprint: atlas.fingerprint,
    files: atlas.files.length,
    routes: atlas.routes.length,
    components: atlas.components.length,
    boundedContexts: intent.boundedContexts ?? [],
    stack: atlas.stack?.primary ?? 'unknown',
    orientationLite: !!atlas.orientationLite
  }
  return {
    greeting: `⬡ PSX Repotector guarding "${intent.domain ?? 'this repo'}". I am the front door — handshake done.`,
    intent,
    groundRules: GROUND_RULES,
    map,
    gates: proof,
    freshness: fresh,
    passport: passport(atlas, proof, intent)
  }
}

const C = { b: '\x1b[1m', dim: '\x1b[2m', g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' }

export function printHandshake (h) {
  console.log(`\n${C.b}${C.c}⬡ PSX Repotector${C.x}`)
  console.log(`${h.greeting}\n`)
  console.log(`${C.b}Map${C.x} ${C.dim}(fingerprint ${h.map.fingerprint})${C.x}`)
  console.log(`  files=${h.map.files}  routes=${h.map.routes}  components=${h.map.components}`)
  if (h.map.boundedContexts.length) console.log(`  contexts: ${h.map.boundedContexts.join(', ')}`)
  console.log(`\n${C.b}Ground rules${C.x}`)
  for (const r of h.groundRules) console.log(`  • ${r}`)
  const ok = h.gates.verdict === 'INTENT_HONORED'
  console.log(`\n${C.b}Gate${C.x}: ${ok ? C.g : C.r}${h.gates.verdict}${C.x} ${C.dim}(map ${h.freshness.state}${h.freshness.why ? ': ' + h.freshness.why : ''})${C.x}`)
  console.log(`\n${C.b}Passport${C.x}\n  ${C.c}${h.passport}${C.x}\n`)
}
