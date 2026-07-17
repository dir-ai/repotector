// register.mjs — the visitor ledger. Every AI that faces the repo must handshake
// and declare who it is BEFORE it may cross; entry and exit are logged, append-only,
// so the next agent (and the operator) can see who came, when, and what they did.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { repotectorDir } from './util.mjs'

const LEDGER = 'register.jsonl'

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
export function recordEnter (root, { who, model, purpose, passport }) {
  const sessionId = mintSessionId(who || 'anonymous', passport)
  appendLine(root, {
    event: 'enter',
    ts: new Date().toISOString(),
    sessionId,
    who: who || 'anonymous',
    model: model || null,
    purpose: purpose || null,
    passport: passport || null
  })
  return sessionId
}

// Record an agent leaving, with an optional summary of what it did.
export function recordDepart (root, { sessionId, summary }) {
  appendLine(root, {
    event: 'depart',
    ts: new Date().toISOString(),
    sessionId: sessionId || null,
    summary: summary || null
  })
  return true
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
    .map((e) => ({ sessionId: e.sessionId, who: e.who, model: e.model, since: e.ts, purpose: e.purpose }))
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
