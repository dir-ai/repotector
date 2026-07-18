// canon.mjs — INTEGRATE gate: do changed files follow the repo's canon rules?
// Applies intent.canonRules (regex patterns) against the content of changed files.
import { readFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'

// Containment: a caller-supplied path must stay inside the repo root — this is
// tool input reachable over MCP, so "../../" must not read arbitrary files.
function readFile (root, rel) {
  const abs = resolve(root, rel.replace(/\\/g, '/'))
  const back = relative(resolve(root), abs)
  if (back.startsWith('..') || isAbsolute(back)) return null
  try { return readFileSync(abs, 'utf8') } catch { return null }
}

// rules: [{ id, pattern (regex string), message, canonicalFix, flags? }]
// By convention a rule flags a VIOLATION when its pattern MATCHES.
export function canonCheck (changedFiles, intent, root = process.cwd()) {
  const rules = intent?.canonRules ?? []
  const violations = []
  if (!Array.isArray(rules) || rules.length === 0) return violations
  const compiled = rules.map((r) => {
    let re = null
    // g/y flags carry a persistent lastIndex across .test() calls — silently
    // skipping every other file. Strip them; a violation check needs one match.
    const flags = (r.flags || 'm').replace(/[gy]/g, '')
    // Oversized patterns are skipped, not compiled: canonRules is agent-writable
    // intent.json input and a crafted 10KB pattern is a ReDoS vector against
    // every future gate run.
    if (typeof r.pattern !== 'string' || r.pattern.length > 300) return { ...r, re: null }
    try { re = new RegExp(r.pattern, flags) } catch { re = null }
    return { ...r, re }
  })
  for (const raw of changedFiles || []) {
    const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '')
    const src = readFile(root, rel)
    if (src == null) continue
    for (const r of compiled) {
      if (!r.re) continue
      if (r.re.test(src)) {
        violations.push({
          file: rel,
          ruleId: r.id,
          message: r.message || `violates ${r.id}`,
          canonicalFix: r.canonicalFix || null
        })
      }
    }
  }
  return violations
}
