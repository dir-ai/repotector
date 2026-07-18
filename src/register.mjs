// register.mjs — the visitor ledger. Every AI that faces the repo must handshake
// and declare who it is BEFORE it may cross; entry and exit are logged, append-only,
// so the next agent (and the operator) can see who came, when, and what they did.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { repotectorDir } from './util.mjs'
import { filesChangedSince } from './freshness.mjs'

const LEDGER = 'register.jsonl'
// Sessions open longer than this are presumed dead (the agent was killed / the
// pipe closed) and get a synthesized depart on the next crossing. Agents die
// without signing out; the ledger must not fill with immortal open sessions.
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000

function ledgerPath (root) {
  return join(repotectorDir(root), LEDGER)
}

function ensureDir (root) {
  const dir = repotectorDir(root)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// A short, stable-enough session id from who + when + the passport signature.
function mintSessionId (who, passport) {
  const seed = `${who}|${Date.now()}|${passport ?? ''}`
  return createHash('sha256').update(seed).digest('hex').slice(0, 12)
}

function appendLine (root, entry) {
  ensureDir(root)
  appendFileSync(ledgerPath(root), JSON.stringify(entry) + '\n', 'utf8')
}

// Record an agent crossing the front door. Returns the minted session id.
// `who` is mandatory — an unidentified crossing is a policy violation upstream.
// `enterHead` (git sha at entry) is captured so a later depart can report the
// exact file delta of the visit.
export function recordEnter (root, { who, model, purpose, passport, enterHead }) {
  const sessionId = mintSessionId(who || 'anonymous', passport)
  appendLine(root, {
    event: 'enter',
    ts: new Date().toISOString(),
    sessionId,
    who: who || 'anonymous',
    model: model || null,
    purpose: purpose || null,
    passport: passport || null,
    enterHead: enterHead || null
  })
  return sessionId
}

// Record an agent leaving. `filesTouched` (the git delta since enter) is the
// resilient part: a depart carries the real work even when `summary` is absent.
export function recordDepart (root, { sessionId, summary, filesTouched, synthetic, reason, offClaim, evidence }) {
  appendLine(root, {
    event: 'depart',
    ts: new Date().toISOString(),
    sessionId: sessionId || null,
    summary: summary || null,
    filesTouched: filesTouched && filesTouched.length ? filesTouched : null,
    offClaim: offClaim && offClaim.length ? offClaim : null,
    evidence: evidence ?? null,
    synthetic: !!synthetic,
    reason: reason || null
  })
  return true
}

// Synthesize a depart for every session that entered but never left and is
// older than the TTL — the agent was killed / disconnected. Best-effort git
// delta attached. Returns the swept session ids. Call this on each new crossing.
export function sweepStaleSessions (root, { ttlMs = SESSION_TTL_MS, nowMs = Date.now() } = {}) {
  const { open } = readRegister(root)
  const swept = []
  for (const s of open) {
    if (nowMs - new Date(s.since).getTime() < ttlMs) continue // still plausibly live
    const filesTouched = filesChangedSince(root, s.enterHead)
    recordDepart(root, { sessionId: s.sessionId, synthetic: true, reason: 'stale session auto-departed (no sign-out)', filesTouched })
    swept.push(s.sessionId)
  }
  return swept
}

// The most-recently-opened session still inside (for CLI depart to close).
export function latestOpenSession (root) {
  const { open } = readRegister(root)
  if (!open.length) return null
  return open.slice().sort((a, b) => new Date(b.since) - new Date(a.since))[0]
}

// ── Claims: advisory work-zone soft-locks ───────────────────────────────────
// "kimi is working on auth/** — stay out." Nothing blocks a write (that would
// be theater on a filesystem we don't control); the teeth come from surfacing:
// handshake shows active claims, and a conflicting claim answers granted:false
// with who/why. Claims die with their session (depart, TTL sweep) or on release.

const DEFAULT_CLAIM_TTL_MS = 2 * 60 * 60 * 1000

export function recordClaim (root, { sessionId, who, paths, reason, ttlMs = DEFAULT_CLAIM_TTL_MS }) {
  appendLine(root, {
    event: 'claim',
    ts: new Date().toISOString(),
    sessionId: sessionId || null,
    who: who || null,
    paths: (paths || []).map(String).filter(Boolean),
    reason: reason || null,
    expiresAt: new Date(Date.now() + ttlMs).toISOString()
  })
}

export function recordRelease (root, { sessionId }) {
  appendLine(root, { event: 'release', ts: new Date().toISOString(), sessionId: sessionId || null })
}

// Reduce a glob to its literal prefix so overlap detection stays dead simple:
// two claims conflict when one literal root contains the other.
function claimRoot (path) {
  return String(path).replace(/\\/g, '/').replace(/[*?].*$/, '').replace(/\/+$/, '')
}

export function activeClaims (root, { nowMs = Date.now() } = {}) {
  const { entries, open } = readRegister(root)
  const openIds = new Set(open.map((s) => s.sessionId))
  const lastRelease = new Map()
  for (const e of entries) {
    if (e.event === 'release' && e.sessionId) lastRelease.set(e.sessionId, e.ts)
  }
  return entries.filter((e) => {
    if (e.event !== 'claim' || !openIds.has(e.sessionId)) return false
    const released = lastRelease.get(e.sessionId)
    if (released && released >= e.ts) return false
    if (e.expiresAt && new Date(e.expiresAt).getTime() <= nowMs) return false
    return true
  }).map((e) => ({ sessionId: e.sessionId, who: e.who, paths: e.paths || [], reason: e.reason, since: e.ts, expiresAt: e.expiresAt }))
}

// The active claims held by ONE session (for out-of-claim reconciliation).
export function sessionClaims (root, sessionId) {
  if (!sessionId) return []
  return activeClaims(root).filter((c) => c.sessionId === sessionId)
}

// Files not covered by any of the session's claimed zones. Empty when the
// session holds no claims (claims are optional — no claim, no scope check).
export function offClaimFiles (root, { sessionId, files }) {
  const claims = sessionClaims(root, sessionId)
  if (claims.length === 0) return []
  const roots = claims.flatMap((c) => c.paths.map(claimRoot))
  return (files || []).filter((file) => {
    const f = String(file).replace(/\\/g, '/')
    return !roots.some((r) => r === '' || f === r || f.startsWith(r + '/'))
  })
}

// Claims from OTHER live sessions that overlap the given paths.
export function claimConflicts (root, { paths, sessionId }) {
  const mine = (paths || []).map(claimRoot)
  return activeClaims(root).filter((c) => c.sessionId !== sessionId && c.paths.some((cp) => {
    const r = claimRoot(cp)
    return mine.some((m) => m === r || m.startsWith(r + '/') || r.startsWith(m + '/') || m === '' || r === '')
  }))
}

// ── Missions: the contract that turns a visit into verifiable work ─────────
// A mission binds goal + acceptance criteria + work zone + forbidden zones to
// the session. depart then reconciles what actually happened against it (the
// evidence pack) — "done" becomes something the register can check, not a
// courtesy the agent declares.

export function recordMission (root, { sessionId, who, goal, acceptance, claimPaths, forbiddenPaths, risk }) {
  appendLine(root, {
    event: 'mission',
    ts: new Date().toISOString(),
    sessionId: sessionId || null,
    who: who || null,
    goal: String(goal),
    acceptance: (acceptance || []).map(String).filter(Boolean),
    claimPaths: (claimPaths || []).map(String).filter(Boolean),
    forbiddenPaths: (forbiddenPaths || []).map(String).filter(Boolean),
    risk: risk || 'medium'
  })
}

// The latest mission declared by a session (missions are per-visit).
export function sessionMission (root, sessionId) {
  if (!sessionId) return null
  const { entries } = readRegister(root)
  const missions = entries.filter((e) => e.event === 'mission' && e.sessionId === sessionId)
  return missions.length ? missions[missions.length - 1] : null
}

// Missions of sessions still inside — surfaced at handshake so an arriving
// agent knows WHAT the others are doing, not just where.
export function activeMissions (root) {
  const { entries, open } = readRegister(root)
  const openIds = new Set(open.map((s) => s.sessionId))
  const latest = new Map()
  for (const e of entries) {
    if (e.event === 'mission' && openIds.has(e.sessionId)) latest.set(e.sessionId, e)
  }
  return [...latest.values()].map((m) => ({ sessionId: m.sessionId, who: m.who, goal: m.goal, claimPaths: m.claimPaths ?? [], risk: m.risk }))
}

// Files touched that fall inside a mission's FORBIDDEN zones.
export function forbiddenViolations (root, { sessionId, files }) {
  const mission = sessionMission(root, sessionId)
  const zones = mission?.forbiddenPaths ?? []
  if (zones.length === 0) return []
  const roots = zones.map(claimRoot)
  return (files || []).filter((file) => {
    const f = String(file).replace(/\\/g, '/')
    return roots.some((r) => r !== '' && (f === r || f.startsWith(r + '/')))
  })
}

// ── Decision records: the "why" that must not be renegotiated ──────────────
// The journal says WHAT happened; decisions say what was chosen, over what,
// and why — so agent 2 does not undo agent 1's deliberate choice. Stored as
// register events (one log, one truth); DECISIONS.md is a projection.

export function recordDecisions (root, { sessionId, who, decisions }) {
  for (const d of decisions || []) {
    if (!d || !d.chose || !d.because) continue
    appendLine(root, {
      event: 'decision',
      ts: new Date().toISOString(),
      sessionId: sessionId || null,
      who: who || null,
      chose: String(d.chose),
      over: d.over ? String(d.over) : null,
      because: String(d.because),
      paths: Array.isArray(d.paths) ? d.paths.map(String) : []
    })
  }
}

export function listDecisions (root, { topic, limit } = {}) {
  const { entries } = readRegister(root)
  let decisions = entries.filter((e) => e.event === 'decision')
  if (topic) {
    const t = String(topic).toLowerCase()
    decisions = decisions.filter((d) =>
      [d.chose, d.over, d.because, ...(d.paths || [])].filter(Boolean).some((s) => String(s).toLowerCase().includes(t)))
  }
  decisions.reverse() // newest first
  return typeof limit === 'number' ? decisions.slice(0, limit) : decisions
}

// Read the full ledger back. Returns every entry plus a derived view of which
// sessions are still "inside" (entered, never departed).
export function readRegister (root, { limit } = {}) {
  const p = ledgerPath(root)
  if (!existsSync(p)) return { entries: [], open: [], total: 0 }
  const lines = readFileSync(p, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  const entries = []
  for (const line of lines) {
    try { entries.push(JSON.parse(line)) } catch { /* skip a corrupt line, keep the log honest */ }
  }
  const departed = new Set(entries.filter((e) => e.event === 'depart' && e.sessionId).map((e) => e.sessionId))
  const open = entries
    .filter((e) => e.event === 'enter' && !departed.has(e.sessionId))
    .map((e) => ({ sessionId: e.sessionId, who: e.who, model: e.model, since: e.ts, purpose: e.purpose, enterHead: e.enterHead ?? null }))
  const view = typeof limit === 'number' ? entries.slice(-limit) : entries
  return { entries: view, open, total: entries.length }
}

const C = { b: '\x1b[1m', dim: '\x1b[2m', c: '\x1b[36m', y: '\x1b[33m', x: '\x1b[0m' }

export function printRegister (reg) {
  console.log(`\n${C.b}${C.c}⬡ Repotector visitor register${C.x} ${C.dim}(${reg.total} events)${C.x}`)
  if (reg.open.length) {
    console.log(`\n${C.b}Currently inside${C.x}`)
    for (const s of reg.open) console.log(`  ${C.y}●${C.x} ${s.who} ${C.dim}(${s.model ?? '?'}) since ${s.since} — ${s.purpose ?? 'no stated purpose'}${C.x}`)
  } else {
    console.log(`\n${C.dim}No agents currently inside.${C.x}`)
  }
  console.log(`\n${C.b}Recent crossings${C.x}`)
  for (const e of reg.entries.slice(-12)) {
    const arrow = e.event === 'enter' ? '→ IN ' : '← OUT'
    console.log(`  ${C.dim}${e.ts}${C.x} ${arrow} ${e.who ?? ''} ${e.summary ? C.dim + '— ' + e.summary + C.x : ''}`)
  }
  console.log('')
}
