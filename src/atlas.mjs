// atlas.mjs — builds a portable map of the repo (exports, imports, purpose, kind).
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { listSourceFiles, readSafe, fingerprint, repotectorDir, fileSize, MAX_SCAN_BYTES } from './util.mjs'
import { gitHead } from './freshness.mjs'
import { detectStack } from './stack.mjs'

// --- extraction ---------------------------------------------------------

// Pull exported symbol names from source text.
export function extractExports (src) {
  const names = new Set()
  // export const/function/class/type/interface/enum NAME
  const decl = /export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  let m
  while ((m = decl.exec(src))) names.add(m[1])
  // export default (anonymous)
  if (/export\s+default\b/.test(src)) names.add('default')
  // export { A, B as C }
  const braces = /export\s*\{([^}]*)\}/g
  while ((m = braces.exec(src))) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim()
      if (!part) continue
      const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)/)
      names.add(asMatch ? asMatch[1] : part.split(/\s+/)[0])
    }
  }
  // export * from '...'
  const star = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g
  while ((m = star.exec(src))) names.add(`* from ${m[1]}`)
  return [...names].filter(Boolean).sort()
}

// Pull import specifiers (the '...' after `from`, and bare `import '...'`).
export function extractImports (src) {
  const specs = new Set()
  const from = /\bfrom\s*['"]([^'"]+)['"]/g
  let m
  while ((m = from.exec(src))) specs.add(m[1])
  const bare = /\bimport\s*['"]([^'"]+)['"]/g
  while ((m = bare.exec(src))) specs.add(m[1])
  const req = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = req.exec(src))) specs.add(m[1])
  return [...specs].sort()
}

// First block comment or leading line comment becomes the purpose.
export function extractPurpose (src) {
  const block = src.match(/\/\*\*?([\s\S]*?)\*\//)
  if (block) {
    const line = block[1].split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim()).find(Boolean)
    if (line) return line.slice(0, 200)
  }
  const line = src.match(/^\s*\/\/\s?(.+)$/m)
  if (line) return line[1].trim().slice(0, 200)
  return ''
}

// Classify a file by path + naming + content heuristics.
export function classifyKind (path, src, exports) {
  const p = path.toLowerCase()
  if (/\.(config|rc)\.[cm]?[jt]s$/.test(p) || /(^|\/)(vite|next|tailwind|eslint|jest|rollup)\.config/.test(p)) return 'config'
  if (/(^|\/)(pages|app|routes)\//.test(p) || /\/route\.[cm]?[jt]sx?$/.test(p)) return 'route'
  if (exports.some((e) => /^use[A-Z]/.test(e)) || /(^|\/)hooks?\//.test(p)) return 'hook'
  const hasJsx = /return\s*\(?\s*</.test(src) || /=>\s*\(?\s*</.test(src)
  const pascalExport = exports.some((e) => /^[A-Z]/.test(e))
  if (hasJsx && pascalExport) return 'component'
  if (/(^|\/)(components?|ui)\//.test(p)) return 'component'
  if (/(^|\/)(pages?)\//.test(p)) return 'page'
  return 'lib'
}

// --- build --------------------------------------------------------------

export function buildAtlas (root) {
  const files = []
  const routes = []
  const components = []
  const fpParts = []
  for (const rel of listSourceFiles(root)) {
    const abs = join(root, rel)
    const tooBig = fileSize(abs) > MAX_SCAN_BYTES
    const src = tooBig ? '' : readSafe(abs)
    // Fingerprint the SIZE marker for big files so a swap still perturbs the fp
    // without paying to read a megabyte of minified output.
    fpParts.push(rel + '\0' + (tooBig ? `«large:${fileSize(abs)}»` : src))
    const exports = tooBig ? [] : extractExports(src)
    const imports = tooBig ? [] : extractImports(src)
    const purpose = tooBig ? '(large file — not scanned)' : extractPurpose(src)
    const kind = tooBig ? 'lib' : classifyKind(rel, src, exports)
    const entry = { path: rel, exports, imports, purpose, kind }
    files.push(entry)
    if (kind === 'route') routes.push({ path: rel, exports })
    if (kind === 'component') components.push({ path: rel, name: exports[0] || rel })
  }
  const stack = detectStack(root)
  return {
    generatedAt: null,
    builtAtHead: gitHead(root),
    stack,
    orientationLite: stack.orientationLite,
    files,
    routes,
    components,
    fingerprint: fingerprint(fpParts)
  }
}

export function writeAtlas (root) {
  const atlas = buildAtlas(root)
  const dir = repotectorDir(root)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'atlas.json'), JSON.stringify(atlas, null, 2))
  return atlas
}
