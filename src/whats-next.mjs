// whats-next.mjs — "what should I work on?" derived, never invented. Four
// evidence sources, ranked; the deterministic floor SUGGESTS, the visiting agent
// THINKS. Hard rule: no suggestion without a citable evidence object, and an
// empty answer is a valid answer — filler is the death of trust.
import { join } from 'node:path'
import { walk, readSafe, toPosix, dotExt, SOURCE_EXTS } from './util.mjs'
import { dnaCoverage } from './dna-layer.mjs'
import { buildJournal } from './journal.mjs'

// A real TODO lives in a comment, right after the comment opener (only
// whitespace between), and is not part of a "TODO/FIXME" enumeration or a regex
// alternation. This kills the meta false-positives — the word "TODO" inside a
// string literal or a sentence *about* todos is not a todo.
const TODO_RE = /(?:\/\/|#|\/\*|\*|<!--)\s*(TODO|FIXME|HACK|XXX)\b(?![/|])/

function todoScan (root, cap = 20) {
  const hits = []
  for (const abs of walk(root)) {
    if (!SOURCE_EXTS.has(dotExt(abs))) continue
    const rel = toPosix(abs).replace(toPosix(root) + '/', '')
    const lines = readSafe(abs).split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (TODO_RE.test(lines[i])) {
        hits.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 120) })
        if (hits.length >= cap) return hits
      }
    }
  }
  return hits
}

export function whatsNext (root, { limit = 7 } = {}) {
  const suggestions = []

  // 1. DNA gaps — the strongest signal (authored > inferred).
  let cov = null
  try { cov = dnaCoverage(root) } catch { /* optional */ }
  if (cov) {
    for (const c of cov.clauses.filter((x) => x.status === 'missing' || x.status === 'partial')) {
      suggestions.push({
        rank: c.status === 'missing' ? 1 : 2,
        source: 'dna_coverage',
        title: `${c.status === 'missing' ? 'Implement' : 'Finish'} ${c.id}: ${c.text}`,
        evidence: { clause: c.id, status: c.status, provenance: c.provenance },
        confidence: c.provenance === 'authored' ? 'certain' : 'derived'
      })
    }
  }

  // 2. Open threads from recent departs (summaries that flag unfinished work).
  for (const j of buildJournal(root, { limit: 10 })) {
    if (j.summary && /\b(todo|pending|unfinished|next|stub|not yet|wip|left)\b/i.test(j.summary)) {
      suggestions.push({
        rank: 3,
        source: 'depart',
        title: `Follow up: ${j.summary}`,
        evidence: { who: j.who, ts: j.ts },
        confidence: 'derived'
      })
    }
  }

  // 3. TODO/FIXME markers — real but weak.
  for (const h of todoScan(root)) {
    suggestions.push({
      rank: 4,
      source: 'todo',
      title: `${h.text}`,
      evidence: { file: h.file, line: h.line },
      confidence: 'weak'
    })
  }

  suggestions.sort((a, b) => a.rank - b.rank)
  const top = suggestions.slice(0, limit)
  return {
    empty: top.length === 0,
    note: 'Suggestions cite evidence only; nothing here is generated.',
    suggestions: top
  }
}
