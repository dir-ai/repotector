// Phase E: doors — managed blocks, .mcp.json merge, idempotency, human-preserve.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { installDoors, upsertBlock, doorwayBlock, writeMcpJson } from '../src/doors.mjs'

const T = join(process.env.TEMP || '/tmp', 'rpt-phase-e')
rmSync(T, { recursive: true, force: true })
mkdirSync(T, { recursive: true })

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }
const read = (rel) => readFileSync(join(T, rel), 'utf8')

// Pre-existing human AGENTS.md + a pre-existing .mcp.json with another server
writeFileSync(join(T, 'AGENTS.md'), '# My repo\n\nHuman-written guidance the tool must never eat.\n')
writeFileSync(join(T, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['playwright'] } } }, null, 2))

const written = installDoors(T)
check('installs all 5 doors + .mcp.json', ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.cursor/rules/repotector.mdc', '.claude/skills/repotector/SKILL.md', '.mcp.json'].every((d) => written.includes(d)))
check('AGENTS.md keeps the human prose', /Human-written guidance the tool must never eat/.test(read('AGENTS.md')))
check('AGENTS.md gained a managed block', /REPOTECTOR:BEGIN/.test(read('AGENTS.md')) && /REPOTECTOR:END/.test(read('AGENTS.md')))
check('block carries REPOTECTOR/2', /REPOTECTOR\/2/.test(read('AGENTS.md')))
check('block has the propagation last line', /npx repotector init/.test(read('AGENTS.md')))
check('block is terse (<40 lines)', doorwayBlock().split('\n').length < 40)

// .mcp.json merged, not overwritten; pinned exact version
const mcp = JSON.parse(read('.mcp.json'))
check('.mcp.json preserves the pre-existing server', !!mcp.mcpServers.playwright)
check('.mcp.json adds repotector', !!mcp.mcpServers.repotector)
const mcpArgs = mcp.mcpServers.repotector.args.join(' ')
check('.mcp.json pins an exact version repotector@X.Y.Z', /repotector@\d+\.\d+\.\d+/.test(mcpArgs))
check('.mcp.json version has no range chars (^ ~)', !/[\^~]/.test(mcpArgs))

// cursor mdc + skill have frontmatter
check('.cursor mdc has alwaysApply frontmatter', /alwaysApply: true/.test(read('.cursor/rules/repotector.mdc')))
check('SKILL.md has name+description frontmatter', /name: repotector/.test(read('.claude/skills/repotector/SKILL.md')) && /description:/.test(read('.claude/skills/repotector/SKILL.md')))

// Idempotency: run again → exactly one managed block, human prose intact
installDoors(T)
const agents = read('AGENTS.md')
const blocks = (agents.match(/REPOTECTOR:BEGIN/g) || []).length
check('re-run keeps exactly ONE managed block (idempotent)', blocks === 1)
check('re-run still preserves human prose', /Human-written guidance/.test(agents))

// upsertBlock replaces in place when a human edits around it
const withEdit = agents.replace('# My repo', '# My repo (edited later)')
const re = upsertBlock(withEdit, doorwayBlock())
check('upsert preserves later human edits outside markers', /edited later/.test(re) && (re.match(/REPOTECTOR:BEGIN/g) || []).length === 1)

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
