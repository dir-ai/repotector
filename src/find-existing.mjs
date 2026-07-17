// find-existing.mjs — REUSE gate: "does this already exist? don't rebuild it."
// Scores atlas entries against an intent string (keywords over path/exports/purpose).

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'with', 'in', 'on', 'add', 'create',
  'build', 'make', 'new', 'that', 'this', 'is', 'be', 'it', 'component', 'feature', 'page'
])

export function tokenize (text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  )]
}

export function findExisting (intent, atlas) {
  const terms = tokenize(intent)
  if (!atlas || !Array.isArray(atlas.files) || terms.length === 0) return []
  const hits = []
  for (const f of atlas.files) {
    const path = f.path.toLowerCase()
    const exportsBlob = (f.exports || []).join(' ').toLowerCase()
    const purpose = (f.purpose || '').toLowerCase()
    let score = 0
    const matched = []
    for (const t of terms) {
      let s = 0
      if (path.includes(t)) s += 3
      if (exportsBlob.includes(t)) s += 4
      if (purpose.includes(t)) s += 2
      if (s > 0) { score += s; matched.push(t) }
    }
    if (score > 0) {
      const symbols = (f.exports || []).filter((e) =>
        matched.some((t) => e.toLowerCase().includes(t))
      )
      hits.push({
        file: f.path,
        score,
        matched,
        symbols: symbols.length ? symbols : (f.exports || []).slice(0, 5),
        purpose: f.purpose || '',
        kind: f.kind
      })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12)
}
