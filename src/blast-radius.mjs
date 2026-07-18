// blast-radius.mjs — PROTECT gate: what breaks if these files change?
// Builds the reverse import graph from the atlas and walks transitive dependents.

const CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// Resolve a relative import specifier from `fromFile` to an atlas path.
function resolveSpecifier (fromFile, spec, pathSet) {
  if (!spec.startsWith('.')) return null
  const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
  const parts = (fromDir ? fromDir + '/' : '') + spec
  const stack = []
  for (const seg of parts.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') {
      // Escaping the repo root is NOT an atlas edge — resolving it anyway
      // would fabricate a ghost dependency on some unrelated top-level file.
      if (stack.length === 0) return null
      stack.pop()
    } else stack.push(seg)
  }
  const base = stack.join('/')
  const candidates = [base]
  for (const e of CANDIDATE_EXTS) candidates.push(base + e)
  for (const e of CANDIDATE_EXTS) candidates.push(base + '/index' + e)
  return candidates.find((c) => pathSet.has(c)) || null
}

// Map: importedFile -> Set of files that import it.
export function buildReverseGraph (atlas) {
  const pathSet = new Set(atlas.files.map((f) => f.path))
  const rev = new Map()
  for (const f of atlas.files) {
    for (const spec of f.imports || []) {
      const target = resolveSpecifier(f.path, spec, pathSet)
      if (!target) continue
      if (!rev.has(target)) rev.set(target, new Set())
      rev.get(target).add(f.path)
    }
  }
  return rev
}

export function blastRadius (changedFiles, atlas) {
  const result = { changedFiles: [], dependents: [], routes: [], components: [], notFound: [] }
  if (!atlas || !Array.isArray(atlas.files)) return result
  const pathSet = new Set(atlas.files.map((f) => f.path))
  const rev = buildReverseGraph(atlas)
  const byPath = new Map(atlas.files.map((f) => [f.path, f]))

  const seed = []
  for (const c of changedFiles || []) {
    const norm = c.replace(/\\/g, '/').replace(/^\.\//, '')
    if (pathSet.has(norm)) { seed.push(norm); result.changedFiles.push(norm) } else result.notFound.push(norm)
  }

  const dependents = new Set()
  const queue = [...seed]
  while (queue.length) {
    const cur = queue.shift()
    for (const dep of rev.get(cur) || []) {
      if (!dependents.has(dep) && !seed.includes(dep)) {
        dependents.add(dep)
        queue.push(dep)
      }
    }
  }
  result.dependents = [...dependents].sort()

  const impacted = new Set([...seed, ...dependents])
  for (const p of impacted) {
    const f = byPath.get(p)
    if (!f) continue
    if (f.kind === 'route') result.routes.push(p)
    if (f.kind === 'component') result.components.push(p)
  }
  result.routes.sort()
  result.components.sort()
  return result
}
