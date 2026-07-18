// v1.4 "Trust" fixes: merge_check sees UNCOMMITTED work; hook fails OPEN.
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mergeCheck } from '../src/merge.mjs'

const PKG = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
const BIN = join(PKG, 'bin', 'psx-repotector.mjs')
const T = join(process.env.TEMP || '/tmp', 'rpt-trust')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }
const cli = (...a) => {
  try { return { out: execFileSync(process.execPath, [BIN, ...a], { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 } }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 } }
}

// base + divergence on main
writeFileSync(join(T, 'src', 'app.ts'), 'export const title = "Hello"\n')
git('add', '-A'); git('commit', '-qm', 'base')
writeFileSync(join(T, 'src', 'app.ts'), 'export const title = "MAIN"\n')
git('commit', '-qam', 'main edit')
git('checkout', '-q', '-b', 'feature', 'HEAD~1')

// ── THE GPT BUG: uncommitted conflicting edit must NOT read CLEAN ──
writeFileSync(join(T, 'src', 'app.ts'), 'export const title = "FEATURE (uncommitted)"\n')
const m = mergeCheck(T, { target: 'main' })
check('uncommitted conflicting edit → clean=false (was the false-CLEAN bug)', m.clean === false)
check('includesWorktree=true when dirty', m.includesWorktree === true)
check('conflict list has ONLY file paths (no git prose)', m.conflicts.every((c) => !/^(Auto-merging|CONFLICT)/.test(c.file)))
check('note states worktree inclusion', /uncommitted/.test(m.note))

// committed state still works and clean tree does not claim worktree inclusion
git('checkout', '-q', '--', '.')
const m2 = mergeCheck(T, { target: 'main' })
check('clean tree → includesWorktree=false', m2.includesWorktree === false)

// ── THE KIMI LOCKOUT: hook must block ONLY on drift (exit 2), fail OPEN otherwise ──
cli('init')
const hooks = cli('hooks')
check('hooks installs', /Commit guard installed|updated/.test(hooks.out))
const shim = readFileSync(join(T, '.git', 'hooks', 'pre-commit'), 'utf8')
check('shim pins the ABSOLUTE CLI path (no npx at commit time)', shim.includes('psx-repotector.mjs') && !/npx/.test(shim))
check('shim blocks only on exit 2', /-eq 2/.test(shim))
check('shim fails OPEN on tool failure', /failing OPEN/.test(shim))

// gates exit codes: clean → 0; regression → 2 (the code the shim blocks on)
const g1 = cli('gates')
check('gates clean → exit 0', g1.code === 0)
writeFileSync(join(T, 'src', 'big.ts'), '// x\n'.repeat(400))
const g2 = cli('gates')
check('gates regression → exit 2 (dedicated drift code)', g2.code === 2)

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
