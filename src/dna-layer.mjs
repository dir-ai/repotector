// dna-layer.mjs — access to what the repo SPECIFIED (the DNA), kept honest
// against what the Atlas shows is BUILT. Two provenances, never merged:
//   authored  — the PSX Workbench mirror (.psx/dna/head.json). Ground truth.
//   inferred  — reverse-DNA from tests/README/entities/routes for foreign repos,
//               each clause carrying a confidence (capped at 0.6 — confidence is
//               earned by evidence, not eloquence) and its sources.
// Clause shape: { id, kind, text, claims:{paths,symbols,routes,tables},
//                 provenance, confidence, sources }.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { walk, readSafe, toPosix, dotExt, repotectorDir, loadRepotectorJson, SOURCE_EXTS } from './util.mjs'

const INFERRED_FILE = 'dna.inferred.json'
const INFERRED_CONF_CAP = 0.6

function readJsonSafe (p) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

const emptyClaims = () => ({ paths: [], symbols: [], routes: [], tables: [] })

// ── AUTHORED: normalize whatever shape the Workbench mirror uses ────────────
function authoredClauses (head) {
  if (!head || typeof head !== 'object') return []
  const norm = (c, i) => ({
    id: c.id || `DNA-${String(i + 1).padStart(3, '0')}`,
    kind: c.kind || 'feature',
    text: c.text || c.statement || c.description || c.title || String(c),
    claims: { ...emptyClaims(), ...(c.claims || {}) },
    provenance: 'authored',
    confidence: null,
    sources: null
  })
  if (Array.isArray(head.clauses)) return head.clauses.map(norm)
  if (Array.isArray(head.requirements)) return head.requirements.map(norm)
  const ctx = head.boundedContexts || head.bounded_contexts
  if (Array.isArray(ctx)) return ctx.map((c, i) => norm({ kind: 'boundary', text: typeof c === 'string' ? c : (c.name || c.text), claims: c.claims }, i))
  // Last resort: a single intent clause so authored DNA is never empty-dropped.
  const text = head.intent || head.domain || head.description
  return text ? [norm({ kind: 'invariant', text }, 0)] : []
}

// ── INFERRED: mine intent from evidence (deterministic) ─────────────────────
function inferClauses (root, atlas, baseDna) {
  const clauses = []
  const add = (kind, text, confidence, source, claims) =>
    clauses.push({ id: '', kind, text: text.slice(0, 240), claims: { ...emptyClaims(), ...claims }, provenance: 'inferred', confidence: Math.min(confidence, INFERRED_CONF_CAP), sources: [source] })

  // Test descriptions are the strongest free intent statements someone wrote.
  const testDescRe = /\b(?:describe|it|test)\s*\(\s*['"`]([^'"`]{6,120})['"`]/g
  for (const abs of walk(root)) {
    const rel = toPosix(abs).replace(toPosix(root) + '/', '')
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) && !/(^|\/)(tests?|__tests__)\//.test(rel)) continue
    if (!SOURCE_EXTS.has(dotExt(abs))) continue
    const src = readSafe(abs)
    let m; let n = 0
    while ((m = testDescRe.exec(src)) && n < 20) {
      const t = m[1].trim()
      if (/^(should|works|returns|handles|renders|test)/i.test(t) && t.length < 12) continue // low-signal
      add('feature', t, 0.6, { kind: 'test', file: rel, excerpt: t }, { paths: [rel] })
      n++
    }
  }
  // README headings — declared capabilities.
  for (const name of ['README.md', 'README.markdown', 'readme.md']) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    const md = readSafe(p)
    for (const h of [...md.matchAll(/^#{2,3}\s+(.{4,80})$/gm)].slice(0, 12)) {
      const t = h[1].trim()
      if (/^(install|usage|licen|contribut|table of|getting started|api)/i.test(t)) continue
      add('feature', t, 0.4, { kind: 'readme', file: name, excerpt: t }, {})
    }
    break
  }
  // Entities + routes are structural facts, not guesses.
  for (const e of baseDna?.entities ?? []) add('boundary', `Manages the "${e.name}" entity (${e.fields.length} fields).`, 0.5, { kind: 'entity', file: e.source, excerpt: e.name }, { tables: [e.name] })
  for (const c of baseDna?.api_contracts ?? []) add('feature', `Exposes ${c.method} ${c.path}.`, 0.5, { kind: 'route', file: 'api', excerpt: `${c.method} ${c.path}` }, { routes: [`${c.method} ${c.path}`] })

  // Stable ids, dedup by text.
  const seen = new Set()
  const out = []
  for (const c of clauses) {
    const key = c.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    c.id = `INF-${String(out.length + 1).padStart(3, '0')}`
    out.push(c)
  }
  return out
}

// ── load the DNA, preferring authored, never merging ────────────────────────
export function loadDnaClauses (root, { atlas, baseDna } = {}) {
  const authoredHead = readJsonSafe(join(root, '.psx', 'dna', 'head.json')) || readJsonSafe(join(root, '.psx', 'dna.json'))
  if (authoredHead) {
    const clauses = authoredClauses(authoredHead)
    if (clauses.length) return { provenance: 'authored', clauses }
  }
  const cached = readJsonSafe(join(repotectorDir(root), INFERRED_FILE))
  if (cached?.clauses?.length) return { provenance: 'inferred', clauses: cached.clauses, inferredAt: cached.inferredAt }
  // No cache yet: infer on the fly (does not write; call writeInferredDna to persist).
  const a = atlas || safeAtlas(root)
  const b = baseDna || safeBaseDna(root)
  return { provenance: 'inferred', clauses: inferClauses(root, a, b) }
}

function safeAtlas (root) { try { return loadRepotectorJson(root, 'atlas.json') } catch { return { files: [], routes: [], components: [] } } }
function safeBaseDna (root) { try { return loadRepotectorJson(root, 'dna.json') } catch { return { entities: [], api_contracts: [] } } }

export function writeInferredDna (root, { atlas, baseDna } = {}) {
  const clauses = inferClauses(root, atlas || safeAtlas(root), baseDna || safeBaseDna(root))
  const payload = { schema: 'repotector.dna.inferred/1', method: 'deterministic-v1', inferredAt: null, clauses }
  mkdirSync(repotectorDir(root), { recursive: true })
  writeFileSync(join(repotectorDir(root), INFERRED_FILE), JSON.stringify(payload, null, 2))
  return payload
}

// ── claim resolution vs the Atlas / baseline DNA ────────────────────────────
function resolveClaims (claims, atlas, baseDna) {
  const filePaths = new Set((atlas.files ?? []).map((f) => f.path))
  const exportSet = new Set((atlas.files ?? []).flatMap((f) => f.exports ?? []))
  const routeSet = new Set((baseDna.api_contracts ?? []).map((c) => `${c.method} ${c.path}`))
  const tableSet = new Set((baseDna.entities ?? []).map((e) => e.name.toLowerCase()))
  const check = (arr, pred) => arr.map((x) => ({ x, ok: pred(x) }))
  const resolved = { paths: [], symbols: [], routes: [], tables: [] }
  const unresolved = { paths: [], symbols: [], routes: [], tables: [] }
  const bucket = (kind, results) => results.forEach((r) => (r.ok ? resolved : unresolved)[kind].push(r.x))
  bucket('paths', check(claims.paths ?? [], (p) => [...filePaths].some((fp) => fp === p || fp.startsWith(p.replace(/\/$/, '') + '/') || fp.startsWith(p))))
  bucket('symbols', check(claims.symbols ?? [], (s) => exportSet.has(s)))
  bucket('routes', check(claims.routes ?? [], (r) => routeSet.has(r) || [...routeSet].some((x) => x.endsWith(r.split(' ').pop()))))
  bucket('tables', check(claims.tables ?? [], (t) => tableSet.has(t.toLowerCase())))
  const total = Object.values(resolved).concat(Object.values(unresolved)).reduce((a, b) => a + b.length, 0)
  const hits = Object.values(resolved).reduce((a, b) => a + b.length, 0)
  return { resolved, unresolved, total, hits }
}

function statusOf (r) {
  if (r.total === 0) return 'unmapped'
  if (r.hits === r.total) return 'implemented'
  if (r.hits === 0) return 'missing'
  return 'partial'
}

// ── public API used by the MCP tools + CLI ──────────────────────────────────
export function dnaQuery (root, { clause, topic } = {}) {
  const atlas = safeAtlas(root); const baseDna = safeBaseDna(root)
  const { provenance, clauses } = loadDnaClauses(root, { atlas, baseDna })
  let result = clauses
  if (clause) result = result.filter((c) => c.id === clause)
  if (topic) {
    const t = topic.toLowerCase()
    result = result.filter((c) => c.text.toLowerCase().includes(t) || c.id.toLowerCase() === t)
  }
  return { provenance, count: result.length, clauses: result }
}

export function dnaCoverage (root) {
  const atlas = safeAtlas(root); const baseDna = safeBaseDna(root)
  const { provenance, clauses } = loadDnaClauses(root, { atlas, baseDna })
  const per = clauses.map((c) => {
    const r = resolveClaims(c.claims, atlas, baseDna)
    return { id: c.id, kind: c.kind, provenance: c.provenance, confidence: c.confidence, status: statusOf(r), resolved: r.resolved, unresolved: r.unresolved, text: c.text }
  })
  const totals = { implemented: 0, partial: 0, missing: 0, unmapped: 0 }
  for (const p of per) totals[p.status]++
  return { provenance, totals, clauses: per }
}

export function dnaDiff (root, changedFiles) {
  const atlas = safeAtlas(root); const baseDna = safeBaseDna(root)
  const { provenance, clauses } = loadDnaClauses(root, { atlas, baseDna })
  const files = (changedFiles || []).map((f) => toPosix(f).replace(/^\.\//, ''))
  const touched = []
  for (const c of clauses) {
    const hitPaths = (c.claims.paths ?? []).filter((p) => files.some((f) => f === p || f.startsWith(p.replace(/\/$/, '') + '/') || p.startsWith(f)))
    if (hitPaths.length) touched.push({ clause: c.id, kind: c.kind, relation: c.kind === 'invariant' || c.kind === 'boundary' ? 'modifies' : 'implements', files: hitPaths, text: c.text })
  }
  const offDna = files.filter((f) => !clauses.some((c) => (c.claims.paths ?? []).some((p) => f === p || f.startsWith(p) || p.startsWith(f))))
  return { provenance, touched, offDna }
}

export function domainOf (root) { return basename(root) }
