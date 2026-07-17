// mcp-server.mjs — stdio MCP server exposing REUSE/PROTECT/INTEGRATE gates.
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

const ROOT = process.cwd()

function loadAtlas () { return loadRepotectorJson(ROOT, 'atlas.json') }
function loadIntent () { return loadRepotectorJson(ROOT, 'intent.json') }

// Wrap a handler so a missing .repotector yields a helpful message, not a crash.
function guard (fn) {
  return async (args) => {
    try {
      return await fn(args)
    } catch (err) {
      const text = /Missing \.repotector/.test(err.message)
        ? `${err.message}`
        : `Repotector error: ${err.message}`
      return { content: [{ type: 'text', text }], structuredContent: { error: text } }
    }
  }
}

function gitDiffFiles () {
  try {
    return execSync('git diff --name-only HEAD', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

const server = new McpServer({ name: 'psx-repotector', version: '1.0.0' })

server.registerTool('handshake', {
  title: 'PSX Handshake',
  description: 'Front door: orientation, ground rules, live quality gate, and a repo passport. Call this first.',
  inputSchema: {},
  outputSchema: { greeting: z.string(), passport: z.string(), verdict: z.string(), files: z.number() }
}, guard(async () => {
  const h = handshake(ROOT)
  return {
    content: [{ type: 'text', text: `${h.greeting}\nPassport: ${h.passport}\nGate: ${h.gates.verdict}\nGround rules:\n- ${h.groundRules.join('\n- ')}` }],
    structuredContent: { greeting: h.greeting, passport: h.passport, verdict: h.gates.verdict, files: h.map.files }
  }
}))

server.registerTool('find_existing', {
  title: 'REUSE — find existing',
  description: 'Search the Atlas for code that already implements an intent. Call before building anything new.',
  inputSchema: { intent: z.string() },
  outputSchema: { hits: z.array(z.object({ file: z.string(), score: z.number(), symbols: z.array(z.string()), purpose: z.string() })) }
}, guard(async ({ intent }) => {
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
  outputSchema: { changedFiles: z.array(z.string()), dependents: z.array(z.string()), routes: z.array(z.string()), components: z.array(z.string()), notFound: z.array(z.string()) }
}, guard(async ({ changedFiles }) => {
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
  outputSchema: { hits: z.array(z.object({ file: z.string(), score: z.number(), symbols: z.array(z.string()), purpose: z.string() })) }
}, guard(async ({ query }) => {
  const hits = findExisting(query, loadAtlas())
  const text = hits.length ? hits.map((h) => `• ${h.file} [${h.kind}] ${h.symbols.join(', ')}`).join('\n') : 'No matches in atlas.'
  return { content: [{ type: 'text', text }], structuredContent: { hits: hits.map(({ file, score, symbols, purpose }) => ({ file, score, symbols, purpose })) } }
}))

server.registerTool('canon_check', {
  title: 'INTEGRATE — canon check',
  description: 'Check changed files against the repo canon rules. Omit changedFiles to use git diff.',
  inputSchema: { changedFiles: z.array(z.string()).optional() },
  outputSchema: { violations: z.array(z.object({ file: z.string(), ruleId: z.string(), message: z.string() })) }
}, guard(async ({ changedFiles }) => {
  const files = (changedFiles && changedFiles.length) ? changedFiles : gitDiffFiles()
  const violations = canonCheck(files, loadIntent(), ROOT)
  const text = violations.length ? `${violations.length} canon violation(s):\n` + violations.map((v) => `• ${v.file}: ${v.message} (${v.ruleId})`).join('\n') : 'No canon violations.'
  return { content: [{ type: 'text', text }], structuredContent: { violations: violations.map(({ file, ruleId, message }) => ({ file, ruleId, message })) } }
}))

server.registerTool('quality_gates', {
  title: 'Quality gates',
  description: 'Run line-budget, structure, and secret-hygiene gates. Returns the proof verdict.',
  inputSchema: {},
  outputSchema: { verdict: z.string(), fingerprint: z.string().nullable(), gates: z.array(z.object({ name: z.string(), pass: z.boolean() })) }
}, guard(async () => {
  const proof = runGates(ROOT)
  const text = `Verdict: ${proof.verdict}\n` + proof.gates.map((g) => `• ${g.pass ? 'PASS' : 'FAIL'} ${g.name}`).join('\n')
  return { content: [{ type: 'text', text }], structuredContent: { verdict: proof.verdict, fingerprint: proof.fingerprint, gates: proof.gates.map((g) => ({ name: g.name, pass: g.pass })) } }
}))

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('PSX Repotector MCP ready (stdio) — tools: handshake, find_existing, blast_radius, atlas_query, canon_check, quality_gates')
