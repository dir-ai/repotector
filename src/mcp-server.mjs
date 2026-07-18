// mcp-server.mjs — stdio MCP server. The repo's front door for any arriving AI.
//
// HARD PROTOCOL: an agent must `handshake` (declaring who it is) BEFORE any deep
// tool answers — arrival is logged in the visitor register. The deep map MAY be
// passphrase-gated (optional, per-repo); the handshake itself never is.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { loadRepotectorJson } from './util.mjs'
import { handshake } from './handshake.mjs'
import { runGates } from './gates.mjs'
import { findExisting } from './find-existing.mjs'
import { blastRadius } from './blast-radius.mjs'
import { canonCheck } from './canon.mjs'
import { cityMap } from './city-map.mjs'
import { dnaQuery, dnaCoverage, dnaDiff } from './dna-layer.mjs'
import { recordEnter, recordDepart, readRegister, sweepStaleSessions } from './register.mjs'
import { loadPolicy, verifyPassphrase, isGated, isLocked } from './lock.mjs'
import { gitHead, filesChangedSince } from './freshness.mjs'
import { PROTOCOL_ID, PKG_VERSION, SERVER_NAME, INIT_INSTRUCTIONS } from './protocol.mjs'

const ROOT = process.cwd()

// One process == one session: memo atlas.json by mtime so repeated deep-tool
// calls don't re-read+parse it each time; invalidates the moment it is rewritten.
let atlasMemo = null // { mtimeMs, data }
function loadAtlas () {
  try {
    const m = statSync(join(ROOT, '.repotector', 'atlas.json')).mtimeMs
    if (atlasMemo && atlasMemo.mtimeMs === m) return atlasMemo.data
    const data = loadRepotectorJson(ROOT, 'atlas.json')
    atlasMemo = { mtimeMs: m, data }
    return data
  } catch {
    return loadRepotectorJson(ROOT, 'atlas.json') // surfaces the "run init" error
  }
}
function loadIntent () { return loadRepotectorJson(ROOT, 'intent.json') }

// One MCP process == one client == one session. Track who crossed and whether
// they have presented the passphrase (when the repo is locked).
let session = null // { sessionId, who, unlocked }

// isError:true tells a conformant MCP client the tool call failed so the agent
// self-corrects in one turn instead of treating the refusal as a normal answer.
function guard (fn) {
  return async (args) => {
    try {
      return await fn(args)
    } catch (err) {
      const text = /Missing \.repotector/.test(err.message) ? err.message : `Repotector error: ${err.message}`
      return { content: [{ type: 'text', text }], isError: true, structuredContent: { error: text } }
    }
  }
}

function deny (text, extra = {}) {
  return { content: [{ type: 'text', text }], isError: true, structuredContent: { denied: true, reason: text, ...extra } }
}

// Every deep tool passes through here: handshake-first, then optional lock.
function protect (toolName, fn) {
  return guard(async (args) => {
    if (!session) {
      return deny('⛔ Handshake required. Call `handshake` and declare who you are before using this repo — every crossing is logged.',
        { code: 'HANDSHAKE_REQUIRED', fix: 'call handshake({ who }) first', protocol: PROTOCOL_ID })
    }
    const policy = loadPolicy(ROOT)
    if (isGated(policy, toolName) && !session.unlocked) {
      return deny(`🔒 This repo asks for a passphrase before the deep map. Call \`unlock\` to read ${toolName}. (Compliance signal for protocol-following agents — see SECURITY.md; not filesystem access control.)`,
        { locked: true, code: 'LOCKED', fix: 'call unlock({ passphrase })' })
    }
    return fn(args)
  })
}

function gitDiffFiles () {
  try {
    return execSync('git diff --name-only HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

const server = new McpServer(
  { name: SERVER_NAME, version: PKG_VERSION },
  { instructions: INIT_INSTRUCTIONS }
)

server.registerTool('handshake', {
  title: 'PSX Handshake — MANDATORY first call',
  description: 'Front door. Declare who you are; you are logged into the visitor register and handed the ground rules, live gate, city-map summary, and a passport. Call this FIRST, before any other tool.',
  inputSchema: {
    who: z.string().describe('Who you are: agent name / model / operator, e.g. "claude-code@dir".'),
    model: z.string().optional().describe('Your underlying model, if distinct from `who`.'),
    purpose: z.string().optional().describe('One line on why you are here.')
  },
}, guard(async ({ who, model, purpose }) => {
  // Clean up sessions that entered and never signed out (agent killed / pipe
  // closed) before logging this crossing — the ledger self-heals on every visit.
  try { sweepStaleSessions(ROOT) } catch { /* best-effort */ }
  const h = handshake(ROOT)
  const enterHead = gitHead(ROOT)
  const sessionId = recordEnter(ROOT, { who, model, purpose, passport: h.passport, enterHead })
  const policy = loadPolicy(ROOT)
  const locked = isLocked(policy)
  session = { sessionId, who, unlocked: !locked, enterHead }
  const instructions = [...h.groundRules]
  if (locked) instructions.push('This repo is LOCKED — call `unlock` with the passphrase before reading the deep map (atlas/blast/dna).')
  instructions.push('When you leave, call `depart` with a one-line summary so the register stays complete.')
  const mapNote = h.freshness.state === 'fresh' ? '' : ` (map ${h.freshness.state}${h.freshness.why ? ': ' + h.freshness.why : ''} — run quality_gates for a live check)`
  const text = `${h.greeting}\nWelcome, ${who}. You are registered (session ${sessionId}).\n` +
    `Passport: ${h.passport}\nGate: ${h.gates.verdict}${mapNote}${locked ? '\n🔒 Deep map is LOCKED — call unlock next.' : ''}\n\nGround rules:\n- ${instructions.join('\n- ')}`
  return { content: [{ type: 'text', text }], structuredContent: { greeting: h.greeting, sessionId, passport: h.passport, verdict: h.gates.verdict, freshness: h.freshness, locked, instructions } }
}))

server.registerTool('unlock', {
  title: 'Unlock the deep map',
  description: 'Present the repo passphrase to unlock the gated deep-map tools for this session. Only needed if the repo is locked.',
  inputSchema: { passphrase: z.string().describe('The repo passphrase.') },
}, guard(async ({ passphrase }) => {
  if (!session) return deny('⛔ Handshake first, then unlock.')
  const policy = loadPolicy(ROOT)
  if (!isLocked(policy)) { session.unlocked = true; return { content: [{ type: 'text', text: 'This repo is not locked — nothing to unlock.' }], structuredContent: { unlocked: true, message: 'not locked' } } }
  if (verifyPassphrase(policy, passphrase)) {
    session.unlocked = true
    return { content: [{ type: 'text', text: '🔓 Unlocked. The deep map is now available for this session.' }], structuredContent: { unlocked: true, message: 'unlocked' } }
  }
  return deny('🔒 Wrong passphrase — still locked.', { unlocked: false })
}))

server.registerTool('depart', {
  title: 'Sign out of the repo',
  description: 'Log your exit in the visitor register with a one-line summary of what you did. Call this when you finish.',
  inputSchema: { summary: z.string().optional().describe('One line: what you changed or concluded.') },
}, guard(async ({ summary }) => {
  const filesTouched = session ? filesChangedSince(ROOT, session.enterHead) : []
  recordDepart(ROOT, { sessionId: session?.sessionId, summary, filesTouched })
  const who = session?.who
  session = null
  const delta = filesTouched.length ? ` You touched ${filesTouched.length} file(s): ${filesTouched.slice(0, 8).join(', ')}${filesTouched.length > 8 ? '…' : ''}.` : ''
  return { content: [{ type: 'text', text: `← ${who ?? 'agent'} signed out.${delta} Safe travels.` }], structuredContent: { departed: true, filesTouched } }
}))

server.registerTool('register', {
  title: 'Read the visitor register',
  description: 'See who has entered/left the repo and who is currently inside. The full arrival/exit log.',
  inputSchema: { limit: z.number().optional() },
}, protect('register', async ({ limit }) => {
  const reg = readRegister(ROOT, { limit })
  const text = (reg.open.length ? `Currently inside:\n${reg.open.map((s) => `• ${s.who} (since ${s.since})`).join('\n')}` : 'No agents currently inside.') +
    `\n\nTotal logged crossings: ${reg.total}`
  return { content: [{ type: 'text', text }], structuredContent: { open: reg.open.map((s) => ({ who: s.who, sessionId: s.sessionId, since: s.since })), total: reg.total } }
}))

server.registerTool('city_map', {
  title: 'City map — what is built vs missing',
  description: 'The info-point: DNA intent, brain pointers (atlas/genome/phenome), skeleton, and built-vs-missing so you can continue work without re-exploring.',
  inputSchema: {},
}, protect('city_map', async () => {
  const m = cityMap(ROOT)
  const text = `City map — ${m.domain}` + (m.note ? `\n⚑ ${m.note}` : '') +
    `\nfiles=${m.status.files} routes=${m.status.routes} components=${m.status.components}` +
    `\nbrain: dna=${m.brain.dna.present} genome=${m.brain.genome.present} phenome=${m.brain.phenome.present}` +
    (m.status.missing.length ? `\nMISSING: ${m.status.missing.join(', ')}` : '\nAll declared paths present.')
  return { content: [{ type: 'text', text }], structuredContent: { domain: m.domain, stack: m.stack, orientationLite: m.orientationLite, note: m.note, status: m.status } }
}))

server.registerTool('find_existing', {
  title: 'REUSE — find existing',
  description: 'Search the Atlas for code that already implements an intent. Call before building anything new.',
  inputSchema: { intent: z.string() },
}, protect('find_existing', async ({ intent }) => {
  const hits = findExisting(intent, loadAtlas())
  const text = hits.length
    ? `Found ${hits.length} candidate(s) — REUSE before rebuilding:\n` + hits.map((h) => `• ${h.file} [${h.score}] ${h.symbols.join(', ')}`).join('\n')
    : 'No existing match found — safe to build new.'
  return { content: [{ type: 'text', text }], structuredContent: { hits: hits.map(({ file, score, symbols, purpose }) => ({ file, score, symbols, purpose })) } }
}))

server.registerTool('blast_radius', {
  title: 'PROTECT — blast radius',
  description: 'Compute transitive dependents, impacted routes and components for changed files. Omit changedFiles to use git diff. Call before editing.',
  inputSchema: { changedFiles: z.array(z.string()).optional() },
}, protect('blast_radius', async ({ changedFiles }) => {
  const files = (changedFiles && changedFiles.length) ? changedFiles : gitDiffFiles()
  const r = blastRadius(files, loadAtlas())
  const text = `Changed: ${r.changedFiles.length} → dependents: ${r.dependents.length}, routes: ${r.routes.length}, components: ${r.components.length}` +
    (r.dependents.length ? `\nDependents:\n${r.dependents.map((d) => '• ' + d).join('\n')}` : '')
  return { content: [{ type: 'text', text }], structuredContent: r }
}))

server.registerTool('atlas_query', {
  title: 'Query the Atlas',
  description: 'Keyword search across the repo map (paths, exports, purposes).',
  inputSchema: { query: z.string() },
}, protect('atlas_query', async ({ query }) => {
  const hits = findExisting(query, loadAtlas())
  const text = hits.length ? hits.map((h) => `• ${h.file} [${h.kind}] ${h.symbols.join(', ')}`).join('\n') : 'No matches in atlas.'
  return { content: [{ type: 'text', text }], structuredContent: { hits: hits.map(({ file, score, symbols, purpose }) => ({ file, score, symbols, purpose })) } }
}))

server.registerTool('canon_check', {
  title: 'INTEGRATE — canon check',
  description: 'Check changed files against the repo canon rules. Omit changedFiles to use git diff.',
  inputSchema: { changedFiles: z.array(z.string()).optional() },
}, protect('canon_check', async ({ changedFiles }) => {
  const files = (changedFiles && changedFiles.length) ? changedFiles : gitDiffFiles()
  const violations = canonCheck(files, loadIntent(), ROOT)
  const text = violations.length ? `${violations.length} canon violation(s):\n` + violations.map((v) => `• ${v.file}: ${v.message} (${v.ruleId})`).join('\n') : 'No canon violations.'
  return { content: [{ type: 'text', text }], structuredContent: { violations: violations.map(({ file, ruleId, message }) => ({ file, ruleId, message })) } }
}))

server.registerTool('quality_gates', {
  title: 'Quality gates',
  description: 'Run line-budget, structure, and secret-hygiene gates. Returns the proof verdict.',
  inputSchema: {},
}, protect('quality_gates', async () => {
  const proof = runGates(ROOT)
  const debtN = proof.baselineDebt?.length ?? 0
  const text = `Verdict: ${proof.verdict} (regressions: ${proof.regressions?.length ?? 0}, grandfathered debt: ${debtN})\n` +
    proof.gates.map((g) => `• ${g.pass ? 'PASS' : 'FAIL'} ${g.name}${g.debt ? ` (+${g.debt} grandfathered)` : ''}`).join('\n') +
    (proof.regressions?.length ? '\nRegressions:\n' + proof.regressions.map((r) => `  ▲ ${r.file || r.missing} ${r.secret ? '(' + r.secret + ')' : r.lines ? '(' + r.lines + ' lines, ' + r.kind + ')' : ''}`).join('\n') : '')
  return { content: [{ type: 'text', text }], structuredContent: { verdict: proof.verdict, fingerprint: proof.fingerprint, regressions: proof.regressions, baselineDebt: proof.baselineDebt, gates: proof.gates.map((g) => ({ name: g.name, pass: g.pass, debt: g.debt })) } }
}))

// If the client disconnects without calling depart, synthesize one so the
// register closes cleanly. A hard SIGKILL can't be caught — the TTL sweep on
// the next handshake is the reliable net; this covers the graceful cases.
let closing = false
function synthDepartOnExit (reason) {
  if (closing || !session) return
  closing = true
  try {
    const filesTouched = filesChangedSince(ROOT, session.enterHead)
    recordDepart(ROOT, { sessionId: session.sessionId, synthetic: true, reason, filesTouched })
  } catch { /* best-effort */ }
}

server.registerTool('dna_query', {
  title: 'DNA — what the repo SPECIFIED',
  description: 'Read the intent layer. Returns clauses of what was specified, marked authored (PSX Workbench mirror) or inferred (reverse-DNA, with confidence + sources) — never merged. Filter by clause id or topic.',
  inputSchema: { clause: z.string().optional(), topic: z.string().optional() },
}, protect('dna_query', async ({ clause, topic }) => {
  const q = dnaQuery(ROOT, { clause, topic })
  const text = `DNA (${q.provenance}) — ${q.count} clause(s)\n` +
    q.clauses.slice(0, 20).map((c) => `• ${c.id} [${c.kind}${c.confidence != null ? ' ~' + c.confidence : ''}] ${c.text}`).join('\n')
  return { content: [{ type: 'text', text }], structuredContent: q }
}))

server.registerTool('dna_coverage', {
  title: 'DNA coverage — built vs missing',
  description: 'Per specified clause: implemented / partial / missing / unmapped, computed from its claims vs the Atlas. The single source of built-vs-missing truth.',
  inputSchema: {},
}, protect('dna_coverage', async () => {
  const cov = dnaCoverage(ROOT)
  const t = cov.totals
  const text = `DNA coverage (${cov.provenance}) — implemented ${t.implemented}, partial ${t.partial}, missing ${t.missing}, unmapped ${t.unmapped}\n` +
    cov.clauses.filter((c) => c.status === 'missing' || c.status === 'partial').slice(0, 15).map((c) => `• ${c.status.toUpperCase()} ${c.id}: ${c.text}`).join('\n')
  return { content: [{ type: 'text', text }], structuredContent: cov }
}))

server.registerTool('dna_diff', {
  title: 'DNA diff — which clauses a change touches',
  description: 'Given changed files (omit to use git diff), which specified clauses they implement/modify, and which files are off-DNA (claimed by no clause). Deterministic — no semantic guessing.',
  inputSchema: { changedFiles: z.array(z.string()).optional() },
}, protect('dna_diff', async ({ changedFiles }) => {
  const files = (changedFiles && changedFiles.length) ? changedFiles : gitDiffFiles()
  const d = dnaDiff(ROOT, files)
  const text = `DNA diff (${d.provenance}) — ${d.touched.length} clause(s) touched, ${d.offDna.length} off-DNA file(s)\n` +
    d.touched.map((t) => `• ${t.relation} ${t.clause}: ${t.text}`).join('\n')
  return { content: [{ type: 'text', text }], structuredContent: d }
}))

const transport = new StdioServerTransport()
transport.onclose = () => { synthDepartOnExit('stdio closed'); process.exit(0) }
process.on('SIGINT', () => { synthDepartOnExit('client disconnected (SIGINT)'); process.exit(0) })
process.on('SIGTERM', () => { synthDepartOnExit('client disconnected (SIGTERM)'); process.exit(0) })
process.on('beforeExit', () => synthDepartOnExit('server exited'))

await server.connect(transport)
console.error(`PSX Repotector MCP ready (stdio · ${PROTOCOL_ID} · v${PKG_VERSION}) — handshake-first; tools: handshake, unlock, depart, register, city_map, find_existing, blast_radius, atlas_query, canon_check, quality_gates, dna_query, dna_coverage, dna_diff`)
