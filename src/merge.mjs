// merge.mjs — the portable front door of merge safety. When several agents
// commit in parallel, the pain is discovering conflicts AT land time. This
// module shifts that left with zero network and zero worktree damage:
//   merge_check → `git merge-tree --write-tree` TRIAL merge of HEAD × target
//   (the integration base), reporting clean/conflicted + the exact files —
//   BEFORE anyone commits into a collision.
// Conflicted files are attributed to the live claims (v1.2) and, when a PSX
// Workbench mirror is present, to the Merge Machine's leases
// (.psx/merge/leases.json) — Repotector surfaces the heavy engine, it never
// re-implements it (worktrees, seal, landing stay in the Workbench).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { activeClaims } from './register.mjs'

function git (root, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024, ...opts,
  })
}

// The integration base: explicit target, else the branch upstream, else
// origin's default branch. All LOCAL refs — we never fetch (zero network);
// staleness is stated, not hidden.
export function resolveTarget (root, target) {
  if (target) return String(target)
  try { return git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).trim() || null } catch { /* no upstream */ }
  try {
    const ref = git(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).trim()
    if (ref && ref !== 'origin/HEAD') return ref
  } catch { /* no origin */ }
  return null
}

// Merge Machine bridge: the Workbench may project its live leases into the
// repo mirror. Read-only, best-effort, provenance-marked.
export function psxLeases (root) {
  for (const rel of ['.psx/merge/leases.json', '.psx/merge-machine/leases.json']) {
    const p = join(root, rel)
    if (!existsSync(p)) continue
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'))
      const leases = Array.isArray(data) ? data : Array.isArray(data?.leases) ? data.leases : []
      return leases
        .filter((l) => l && Array.isArray(l.paths))
        .map((l) => ({ who: l.who ?? l.sessionId ?? 'merge-machine', paths: l.paths.map(String), reason: l.reason ?? null, source: 'psx-merge-machine' }))
    } catch { return [] }
  }
  return []
}

// All zones currently held: Repotector claims (register) + Merge Machine leases.
export function allZones (root, { excludeSessionId } = {}) {
  const claims = activeClaims(root)
    .filter((c) => c.sessionId !== excludeSessionId)
    .map((c) => ({ who: c.who ?? c.sessionId, paths: c.paths, reason: c.reason, source: 'claim' }))
  return [...claims, ...psxLeases(root)]
}

function zoneRoot (p) { return String(p).replace(/\\/g, '/').replace(/[*?].*$/, '').replace(/\/+$/, '') }

function zonesTouching (zones, file) {
  const f = String(file).replace(/\\/g, '/')
  return zones.filter((z) => z.paths.some((zp) => {
    const r = zoneRoot(zp)
    return r === '' || f === r || f.startsWith(r + '/')
  }))
}

// The trial merge. Returns:
//   { supported, target, ahead, behind, clean, conflicts:[{file, heldBy:[...]}], note }
// clean=null when no target/unsupported — an honest unknown, never a fake green.
export function mergeCheck (root, { target, excludeSessionId } = {}) {
  const resolved = resolveTarget(root, target)
  if (!resolved) {
    return { supported: true, target: null, ahead: null, behind: null, clean: null, conflicts: [], note: 'No integration base found (no upstream / origin) — nothing to trial-merge against.' }
  }

  let ahead = null
  let behind = null
  try {
    const counts = git(root, ['rev-list', '--left-right', '--count', `HEAD...${resolved}`]).trim().split(/\s+/)
    ahead = Number(counts[0]); behind = Number(counts[1])
  } catch { /* target may not resolve to a commit */ }

  // Include the UNCOMMITTED work: `git stash create` mints a commit-ish of the
  // working tree + index WITHOUT touching anything. An agent's not-yet-committed
  // edits must count — otherwise merge_check says CLEAN while the worktree is
  // already colliding. (Tracked changes only; brand-new untracked files are not
  // captured — stated, not hidden.)
  let ours = 'HEAD'
  let includesWorktree = false
  try {
    const stashOid = git(root, ['stash', 'create']).trim()
    if (stashOid) { ours = stashOid; includesWorktree = true }
  } catch { /* clean tree or stash unavailable → HEAD is the honest side */ }

  let conflictedFiles = []
  let clean = null
  try {
    git(root, ['merge-tree', '--write-tree', '--name-only', ours, resolved])
    clean = true
  } catch (error) {
    const status = error?.status
    const out = String(error?.stdout ?? '')
    if (status === 1) {
      clean = false
      // Output: <tree-oid>, conflicted file names, then a BLANK line followed by
      // informational prose (Auto-merging…, CONFLICT…) — stop at the blank line.
      const lines = out.split('\n').slice(1)
      const blank = lines.findIndex((line) => line.trim() === '')
      conflictedFiles = (blank === -1 ? lines : lines.slice(0, blank)).map((s) => s.trim()).filter(Boolean)
    } else {
      return { supported: false, target: resolved, ahead, behind, clean: null, conflicts: [], includesWorktree, note: 'git merge-tree --write-tree unavailable (needs git >= 2.38) — cannot trial-merge.' }
    }
  }

  const zones = allZones(root, { excludeSessionId })
  const conflicts = conflictedFiles.map((file) => ({ file, heldBy: zonesTouching(zones, file).map((z) => ({ who: z.who, source: z.source, reason: z.reason })) }))
  const worktreeNote = includesWorktree ? 'Includes your uncommitted (tracked) changes. ' : ''
  const note = worktreeNote + (behind === 0
    ? 'Up to date with the integration base.'
    : `Base has moved (${behind} commit(s) not in HEAD) — trial merge is against the LOCAL ref; fetch first for the freshest truth.`)
  return { supported: true, target: resolved, ahead, behind, clean, conflicts, includesWorktree, note }
}

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', dim: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }

export function printMergeCheck (m) {
  console.log(`\n${C.b}⬡ Merge check${C.x} ${C.dim}(trial merge HEAD × ${m.target ?? 'n/a'})${C.x}`)
  if (m.clean === null) { console.log(`  ${C.y}·${C.x} ${m.note}\n`); return }
  console.log(`  ahead ${m.ahead} · behind ${m.behind} ${C.dim}${m.note}${C.x}`)
  if (m.clean) {
    console.log(`  ${C.g}${C.b}CLEAN${C.x} — a merge would produce no conflicts.\n`)
    return
  }
  console.log(`  ${C.r}${C.b}${m.conflicts.length} CONFLICT(S)${C.x} — resolve BEFORE committing into the collision:`)
  for (const c of m.conflicts) {
    const held = c.heldBy.length ? ` ${C.y}(zone held by ${c.heldBy.map((h) => `${h.who}·${h.source}`).join(', ')})${C.x}` : ''
    console.log(`  ${C.r}✗${C.x} ${c.file}${held}`)
  }
  console.log('')
}
