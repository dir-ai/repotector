// util.mjs — shared, dependency-free helpers for scanning a repo portably.
import { readFileSync, readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'

// Directories we never descend into. Multi-stack: JS, Python, Rust/Java, PHP.
export const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', '.git', '.next', 'build', 'coverage', '.repotector', 'out', '.turbo', '.cache',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', 'target', '.gradle', 'vendor'
])

export const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

// Normalize a path to forward slashes so output is stable across OSes.
export function toPosix (p) {
  return p.split(sep).join('/')
}

// Recursively walk a directory, returning absolute file paths.
// Skips excluded directories. Deterministic (sorted).
// Never follows symlinks or junctions (lstat): a self-referencing link must not
// hang the walk, and out-of-tree link targets must not leak into the atlas or
// the fingerprint. The realpath visited-set is a second net against cycles.
export function walk (root, excludeDirs = DEFAULT_EXCLUDE_DIRS) {
  const out = []
  const visited = new Set()
  function rec (dir) {
    let real
    try { real = realpathSync(dir) } catch { return }
    if (visited.has(real)) return
    visited.add(real)
    let entries
    try { entries = readdirSync(dir) } catch { return }
    entries.sort()
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try { st = lstatSync(full) } catch { continue }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (excludeDirs.has(name)) continue
        rec(full)
      } else if (st.isFile()) {
        out.push(full)
      }
    }
  }
  rec(root)
  return out
}

// Read a file as UTF-8; return '' on failure.
export function readSafe (p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

// List source files (relative posix paths) under root.
export function listSourceFiles (root, excludeDirs = DEFAULT_EXCLUDE_DIRS) {
  return walk(root, excludeDirs)
    .filter((f) => SOURCE_EXTS.has(dotExt(f)))
    .map((f) => toPosix(relative(root, f)))
    .sort()
}

export function dotExt (p) {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i).toLowerCase()
}

// Deterministic sha256 (first 16 hex chars) over an array of strings.
export function fingerprint (parts) {
  const h = createHash('sha256')
  for (const s of parts) h.update(s)
  return h.digest('hex').slice(0, 16)
}

// Load a JSON file from .repotector, throwing a clear error if missing.
export function loadRepotectorJson (root, name) {
  const p = join(root, '.repotector', name)
  if (!existsSync(p)) {
    throw new Error(`Missing .repotector/${name} — run: psx-repotector init`)
  }
  return JSON.parse(readSafe(p))
}

export function repotectorDir (root) {
  return join(root, '.repotector')
}
