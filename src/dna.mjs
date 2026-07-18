// dna.mjs — derives a DNA baseline (entities, api_contracts, intent) from code.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { walk, readSafe, toPosix, repotectorDir, dotExt } from './util.mjs'

// Entities from CREATE TABLE statements in .sql files.
export function entitiesFromSql (root) {
  const out = []
  for (const abs of walk(root)) {
    if (dotExt(abs) !== '.sql') continue
    const src = readSafe(abs)
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)["`]?\s*\(([\s\S]{0,8000}?)\)\s*;/gi
    let m
    while ((m = re.exec(src))) {
      const name = m[1].split('.').pop()
      const fields = m[2]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^(primary|foreign|constraint|unique|check|--)/i.test(l))
        .map((l) => l.split(/\s+/)[0].replace(/["`,]/g, ''))
        .filter(Boolean)
      out.push({ name, fields: [...new Set(fields)], source: 'sql' })
    }
  }
  return out
}

// Entities from TS type/interface declarations.
export function entitiesFromTs (root) {
  const out = []
  for (const abs of walk(root)) {
    const ext = dotExt(abs)
    if (ext !== '.ts' && ext !== '.tsx') continue
    const src = readSafe(abs)
    // Bounded body span: an unclosed brace in a big file must not send the
    // lazy quantifier scanning to EOF for every declaration (quadratic blowup).
    const re = /(?:export\s+)?(?:interface|type)\s+([A-Z][\w]*)\s*(?:=\s*)?\{([\s\S]{0,4000}?)\}/g
    let m
    while ((m = re.exec(src))) {
      const fields = [...m[2].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[?:]/gm)].map((x) => x[1])
      if (fields.length) out.push({ name: m[1], fields: [...new Set(fields)], source: 'ts' })
    }
  }
  return out
}

// API contracts from fastify/express-style handlers and Next route files.
export function apiContracts (root, atlas) {
  const out = []
  const seen = new Set()
  const push = (method, path) => {
    const key = `${method} ${path}`
    if (!seen.has(key)) { seen.add(key); out.push({ method, path }) }
  }
  for (const abs of walk(root)) {
    const ext = dotExt(abs)
    if (!['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(ext)) continue
    const src = readSafe(abs)
    const re = /\b(?:app|router|server|fastify|r)\s*\.\s*(get|post|put|patch|delete|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi
    let m
    while ((m = re.exec(src))) push(m[1].toUpperCase(), m[2])
    // Next.js route handlers: exported HTTP verbs inside app/**/route.*
    if (/route\.[cm]?[jt]sx?$/.test(toPosix(abs))) {
      for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const rx = new RegExp(`export\\s+(?:async\\s+)?function\\s+${verb}\\b|export\\s+const\\s+${verb}\\b`)
        if (rx.test(src)) push(verb, routePathFromFile(root, abs))
      }
    }
  }
  // Fall back to atlas route kinds if nothing matched.
  if (out.length === 0 && atlas) {
    for (const r of atlas.routes) push('ANY', '/' + r.path.replace(/\.[^.]+$/, ''))
  }
  return out
}

function routePathFromFile (root, abs) {
  const rel = toPosix(abs)
  const m = rel.match(/(?:app|pages|routes)\/(.+?)\/route\.[^.]+$/)
  return m ? '/' + m[1] : '/' + basename(rel)
}

export function buildDna (root, atlas) {
  const entities = [...entitiesFromSql(root), ...entitiesFromTs(root)]
  const contracts = apiContracts(root, atlas)
  const domain = basename(root)
  const intent = `Baseline DNA for "${domain}" reverse-engineered from ${entities.length} entities and ${contracts.length} API contracts.`
  return {
    domain,
    entities,
    api_contracts: contracts,
    relationships: [],
    intent,
    derivation: 'reverse from code'
  }
}

export function writeDna (root, atlas) {
  const dna = buildDna(root, atlas)
  const dir = repotectorDir(root)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dna.json'), JSON.stringify(dna, null, 2))
  return dna
}
