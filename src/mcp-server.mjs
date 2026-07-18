// mcp-server.mjs — stdio MCP server. The repo's front door for any arriving AI.
//
// HARD PROTOCOL: an agent must `handshake` (declaring who it is) BEFORE any deep
// tool answers — arrival is logged in the visitor register. The deep map MAY be
// passphrase-gated (optional, per-repo); the handshake itself never is.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { execSync } from 'node:child_process'
import { z } from 'zod'
import { loadRepotectorJson } from './util.mjs'
import { handshake } from './handshake.mjs'
import { runGates } from './gates.mjs'
import { findExisting } from './find-existing.mjs'
import { blastRadius } from './blast-radius.mjs'
import { canonCheck } from './canon.mjs'
import { cityMap } from './city-map.mjs'
import { recordEnter, recordDepart, readRegister } from './register.mjs'
import { loadPolicy, verifyPassphrase, isGated, isLocked } from './lock.mjs'
import { PROTOCOL_ID, PKG_VERSION, SERVER_NAME, INIT_INSTRUCTIONS } from './protocol.mjs'

const ROOT = process.cwd()

function loadAtlas () { return loadRepotectorJson(ROOT, 'atlas.json') }
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
      return deny(`🔒 This repo's deep map is locked. Call \`unlock\` with the passphrase to read ${toolName}.`,
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
  const h = handshake(ROOT)
  const sessionId = recordEnter(ROOT, { who, model, purpose, passport: h.passport })
  const policy = loadPolicy(ROOT)
  const locked = isLocked(policy)
  session = { sessionId, who, unlocked: !locked }
  const instructions = [...h.groundRules]
  if (locked) instructions.push('This repo is LOCKED — call `unlock` with the passphrase before reading the deep map (atlas/blast/dna).')
  instructions.push('When you leave, call `depart` with a one-line summary so the register stays complete.')
  const text = `${h.greeting}\nWelcome, ${who}. You are registered (session ${sessionId}).\n` +
    `Passport: ${h.passport}\nGate: ${h.gates.verdict}${locked ? '\n🔒 Deep map is LOCKED — call unlock next.' : ''}\n\nGround rules:\n- ${instructions.join('\n- ')}`
  return { content: [{ type: 'text', text }], structuredContent: { greeting: h.greeting, sessionId, passport: h.passport, verdict: h.gates.verdict, locked, instructions } }
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
  recordDepart(ROOT, { sessionId: session?.sessionId, summary })
  const who = session?.who
  session = null
  return { content: [{ type: 'text', text: `← ${who ?? 'agent'} signed out. Safe travels.` }], structuredContent: { departed: true } }
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
  const text = `City map — ${m.domain}\nfiles=${m.status.files} routes=${m.status.routes} components=${m.status.components}` +
    `\nbrain: dna=${m.brain.dna.present} genome=${m.brain.genome.present} phenome=${m.brain.phenome.present}` +
    (m.status.missing.length ? `\nMISSING: ${m.status.missing.join(', ')}` : '\nAll declared paths present.')
  return { content: [{ type: 'text', text }], structuredContent: { domain: m.domain, status: m.status } }
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
  const text = `Verdict: ${proof.verdict}\n` + proof.gates.map((g) => `• ${g.pass ? 'PASS' : 'FAIL'} ${g.name}`).join('\n')
  return { content: [{ type: 'text', text }], structuredContent: { verdict: proof.verdict, fingerprint: proof.fingerprint, gates: proof.gates.map((g) => ({ name: g.name, pass: g.pass })) } }
}))

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`PSX Repotector MCP ready (stdio · ${PROTOCOL_ID} · v${PKG_VERSION}) — handshake-first; tools: handshake, unlock, depart, register, city_map, find_existing, blast_radius, atlas_query, canon_check, quality_gates`)
