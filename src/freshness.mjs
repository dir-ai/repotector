// freshness.mjs — walk-free staleness signal. A map that is out of date must
// SAY SO rather than mislead. We answer "is the atlas still true?" using git
// only (HEAD sha + dirty flag) — no tree walk — so it is cheap enough to stamp
// on every tool response.
import { execFileSync } from 'node:child_process'

export function gitHead (root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch { return null }
}

export function isDirty (root) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })
    // Repotector's own generated artifacts must not count as "dirty" — otherwise
    // every repo reads stale the instant it is init'd (atlas/proof/register are
    // written into .repotector/). Source changes are what "stale" should mean.
    return out.split('\n').some((line) => {
      if (!line.trim()) return false
      const path = line.slice(3).replace(/\r$/, '')
      const real = path.includes(' -> ') ? path.split(' -> ').pop() : path
      return real !== '.repotector' && !real.startsWith('.repotector/')
    })
  } catch { return false }
}

// Files a session touched: committed since its enter-HEAD + current working-tree
// changes, minus Repotector's own artifacts. Powers the resilient depart — even
// a session that never signed out leaves a real file delta behind.
export function filesChangedSince (root, sinceHead) {
  const collect = (args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })
        .split('\n').map((s) => s.trim()).filter(Boolean)
    } catch { return [] }
  }
  const committed = sinceHead ? collect(['diff', '--name-only', `${sinceHead}..HEAD`]) : []
  const working = collect(['status', '--porcelain']).map((l) => {
    const p = l.slice(3)
    return p.includes(' -> ') ? p.split(' -> ').pop() : p
  })
  const set = new Set([...committed, ...working].filter((f) => f && f !== '.repotector' && !f.startsWith('.repotector/')))
  return [...set].sort()
}

// state: 'fresh' | 'stale' | 'unknown'. `atlas.builtAtHead` is stamped at build
// time (atlas.mjs). Without git, or without a stamp, we say 'unknown' — never a
// confident 'fresh' we cannot back up.
export function freshness (root, atlas) {
  const head = gitHead(root)
  const builtAtHead = atlas?.builtAtHead ?? null
  if (!head || !builtAtHead) {
    return { state: 'unknown', head, builtAtHead, dirty: isDirty(root), why: !head ? 'no git' : 'atlas has no build stamp' }
  }
  const dirty = isDirty(root)
  if (builtAtHead === head && !dirty) return { state: 'fresh', head, builtAtHead, dirty }
  const why = builtAtHead !== head ? `HEAD moved ${builtAtHead.slice(0, 7)}→${head.slice(0, 7)}` : 'uncommitted working-tree changes'
  return { state: 'stale', head, builtAtHead, dirty, why }
}
