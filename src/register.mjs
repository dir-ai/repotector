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
export function recordDepart (root, { sessionId, summary, filesTouched, synthetic, reason }) {
  appendLine(root, {
    event: 'depart',
    ts: new Date().toISOString(),
    sessionId: sessionId || null,
    summary: summary || null,
    filesTouched: filesTouched && filesTouched.length ? filesTouched : null,
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
