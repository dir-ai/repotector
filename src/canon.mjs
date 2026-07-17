// canon.mjs — INTEGRATE gate: do changed files follow the repo's canon rules?
// Applies intent.canonRules (regex patterns) against the content of changed files.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readFile (root, rel) {
  try { return readFileSync(join(root, rel.replace(/\\/g, '/')), 'utf8') } catch { return null }
}

// rules: [{ id, pattern (regex string), message, canonicalFix, flags? }]
// By convention a rule flags a VIOLATION when its pattern MATCHES.
export function canonCheck (changedFiles, intent, root = process.cwd()) {
  const rules = intent?.canonRules ?? []
  const violations = []
  if (!Array.isArray(rules) || rules.length === 0) return violations
  const compiled = rules.map((r) => {
    let re = null
    try { re = new RegExp(r.pattern, r.flags || 'm') } catch { re = null }
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
