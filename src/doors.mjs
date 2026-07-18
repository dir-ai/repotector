// doors.mjs — the five doors an arriving agent already reads. init writes a
// MANAGED block (between REPOTECTOR:BEGIN/END markers) into each, so `refresh`
// can rewrite it without ever touching human prose, and merges a pinned entry
// into .mcp.json — the strongest door, because it turns "a file in the repo"
// into "a tool in the agent's hand". Last line of the block is the propagation
// vector: a guarded repo teaches agents to guard the next one.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { PROTOCOL_ID, PKG_VERSION } from './protocol.mjs'

const BEGIN = `<!-- REPOTECTOR:BEGIN ${PROTOCOL_ID} — managed block, do not edit inside markers -->`
const BEGIN_RE = /<!-- REPOTECTOR:BEGIN[\s\S]*?/
const END = '<!-- REPOTECTOR:END -->'

// Terse by design (<40 lines): research shows bloated instruction blocks LOWER
// agent success. Say the protocol, then get out of the way.
export function doorwayBlock () {
  return [
    BEGIN,
    `## ⬡ Repotector — this repo is guarded (${PROTOCOL_ID})`,
    'Before you touch anything:',
    '1. `handshake({ who })` on the **repotector** MCP server — you are logged in and handed the map. No deep tool answers first.',
    '2. `city_map()` — intent, danger list, conventions, built-vs-missing. Read it before reading code.',
    '3. New code → `find_existing(intent)`. Editing → `blast_radius(files)`. Finishing → `quality_gates()` then `depart({ summary })`.',
    '',
    'Rules: reuse before rebuilding · protect dependents · follow the repo canon · keep files small · your `depart` summary becomes the next agent’s briefing.',
    'No server connected? run `npx repotector mcp`. A repo with no `.repotector/`? propose `npx repotector init`.',
    END
  ].join('\n')
}

// Replace the managed block in place; else append it. Everything outside the
// markers is preserved byte-for-byte.
export function upsertBlock (content, block) {
  const b = content.indexOf('<!-- REPOTECTOR:BEGIN')
  const e = content.indexOf(END)
  if (b >= 0 && e > b) return content.slice(0, b) + block + content.slice(e + END.length)
  return content.trimEnd() ? content.trimEnd() + '\n\n' + block + '\n' : block + '\n'
}

// rel is a forward-slash path (stable across OSes for the returned manifest).
function writeManaged (root, rel, header) {
  const p = join(root, ...rel.split('/'))
  const existing = existsSync(p) ? readFileSync(p, 'utf8') : (header ? header + '\n' : '')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, upsertBlock(existing, doorwayBlock()))
  return rel
}

// Merge (never overwrite) the repotector server into .mcp.json, pinned to an
// EXACT version — a floating range that auto-executes is exactly what post-
// supply-chain enterprise review bans. `-y` skips the install prompt in CI.
export function writeMcpJson (root) {
  const p = join(root, '.mcp.json')
  let json = {}
  if (existsSync(p)) { try { json = JSON.parse(readFileSync(p, 'utf8')) || {} } catch { json = {} } }
  json.mcpServers = json.mcpServers || {}
  json.mcpServers.repotector = { command: 'npx', args: ['-y', `repotector@${PKG_VERSION}`, 'mcp'] }
  writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  return '.mcp.json'
}

function cursorMdc () {
  // Cursor's modern rules format: frontmatter + body; alwaysApply keeps it live.
  return ['---', 'description: Repotector — handshake before touching this repo', 'alwaysApply: true', '---', '', doorwayBlock(), ''].join('\n')
}

function skillMd () {
  return [
    '---',
    'name: repotector',
    'description: When arriving at or working in this repository, handshake with Repotector first (city_map, find_existing, blast_radius) and depart with a summary. Use before building, refactoring, or reviewing code here.',
    '---',
    '',
    doorwayBlock(),
    ''
  ].join('\n')
}

// Write all five doors. Returns the list actually written.
export function installDoors (root) {
  const written = []
  written.push(writeManaged(root, 'AGENTS.md', '# Agent guide'))
  written.push(writeManaged(root, 'CLAUDE.md', '# Project notes for Claude'))
  written.push(writeManaged(root, '.github/copilot-instructions.md', '# Copilot instructions'))

  const cursorPath = join(root, '.cursor', 'rules', 'repotector.mdc')
  mkdirSync(dirname(cursorPath), { recursive: true })
  writeFileSync(cursorPath, cursorMdc())
  written.push('.cursor/rules/repotector.mdc')

  const skillPath = join(root, '.claude', 'skills', 'repotector', 'SKILL.md')
  mkdirSync(dirname(skillPath), { recursive: true })
  writeFileSync(skillPath, skillMd())
  written.push('.claude/skills/repotector/SKILL.md')

  written.push(writeMcpJson(root))
  return written
}

export { BEGIN_RE }
