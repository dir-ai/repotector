// journal.mjs — the diario di bordo. The register is the append-only source of
// truth; the journal is a READ projection of it: enter/depart pairs turned into
// "who did what, and what they left unfinished". handshake serves the tail so
// the next agent continues in two minutes instead of re-deriving the world.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readRegister, listDecisions } from './register.mjs'
import { PROTOCOL_ID } from './protocol.mjs'

// Build newest-first journal entries by pairing each depart with its enter.
export function buildJournal (root, { limit } = {}) {
  const { entries } = readRegister(root, {})
  const enters = new Map()
  for (const e of entries) if (e.event === 'enter') enters.set(e.sessionId, e)
  const out = []
  for (const e of entries) {
    if (e.event !== 'depart') continue
    const en = e.sessionId ? enters.get(e.sessionId) : null
    out.push({
      ts: e.ts,
      who: en?.who ?? 'agent',
      model: en?.model ?? null,
      purpose: en?.purpose ?? null,
      summary: e.summary ?? null,
      filesTouched: e.filesTouched ?? [],
      synthetic: !!e.synthetic,
      reason: e.reason ?? null
    })
  }
  out.reverse() // newest first
  return typeof limit === 'number' ? out.slice(0, limit) : out
}

// The last N entries, condensed — what handshake hands the arriving agent.
export function journalTail (root, n = 3) {
  return buildJournal(root, { limit: n }).map((j) => ({
    ts: j.ts,
    who: j.who,
    summary: j.summary || (j.synthetic ? `(auto: ${j.reason})` : '(no summary)'),
    files: j.filesTouched.length
  }))
}

const BEGIN = `<!-- REPOTECTOR:BEGIN ${PROTOCOL_ID} journal — managed block, regenerated -->`
const END = '<!-- REPOTECTOR:END -->'

// Regenerate JOURNAL.md (human-readable, git-diffable). Last 30 entries.
export function writeJournalMd (root, { limit = 30 } = {}) {
  const entries = buildJournal(root, { limit })
  const lines = [BEGIN, '# ⬡ Repotector journal', '', `_The repo's story — newest first. Regenerated from the visitor register (${PROTOCOL_ID})._`, '']
  if (!entries.length) lines.push('_No crossings recorded yet._')
  for (const j of entries) {
    const date = (j.ts || '').replace('T', ' ').replace(/\..*/, '')
    lines.push(`## ${date} — ${j.who}${j.synthetic ? ' _(auto-departed)_' : ''}`)
    if (j.purpose) lines.push(`*Purpose:* ${j.purpose}`)
    lines.push(j.summary ? j.summary : (j.synthetic ? `_${j.reason}_` : '_No summary left._'))
    if (j.filesTouched.length) lines.push('', `*Touched (${j.filesTouched.length}):* ${j.filesTouched.slice(0, 12).join(', ')}${j.filesTouched.length > 12 ? '…' : ''}`)
    lines.push('')
  }
  lines.push(END, '')
  writeFileSync(join(root, 'JOURNAL.md'), lines.join('\n'))
  return { path: 'JOURNAL.md', entries: entries.length }
}

// Regenerate DECISIONS.md — the record of what must NOT be renegotiated.
export function writeDecisionsMd (root, { limit = 50 } = {}) {
  const decisions = listDecisions(root, { limit })
  const lines = [BEGIN, '# ⬡ Decision records', '', `_Deliberate choices and their why — do not undo without a recorded counter-decision (${PROTOCOL_ID})._`, '']
  if (!decisions.length) lines.push('_No decisions recorded yet._')
  for (const d of decisions) {
    const date = (d.ts || '').replace('T', ' ').replace(/\..*/, '')
    lines.push(`## ${date} — ${d.chose}${d.over ? ` (over ${d.over})` : ''}`)
    lines.push(`*Why:* ${d.because}`)
    if (d.who) lines.push(`*By:* ${d.who}`)
    if ((d.paths || []).length) lines.push(`*Paths:* ${d.paths.join(', ')}`)
    lines.push('')
  }
  lines.push(END, '')
  writeFileSync(join(root, 'DECISIONS.md'), lines.join('\n'))
  return { path: 'DECISIONS.md', entries: decisions.length }
}
