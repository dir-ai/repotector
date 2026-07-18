// Phase C2: stack detection + orientation-lite, plus real-CLI end-to-end.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { detectStack } from '../src/stack.mjs'

import { fileURLToPath } from 'node:url'
const PKG = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]+$/, '')
const BIN = join(PKG, 'bin', 'psx-repotector.mjs')
let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }

function mkrepo (name) {
  const T = join(process.env.TEMP || '/tmp', name)
  rmSync(T, { recursive: true, force: true })
  mkdirSync(T, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: T })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: T })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: T })
  return T
}
const cli = (T, ...a) => execFileSync(process.execPath, [BIN, ...a], { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── Python repo: orientation-lite ──
const PY = mkrepo('rpt-py')
mkdirSync(join(PY, 'app'), { recursive: true })
writeFileSync(join(PY, 'pyproject.toml'), '[project]\nname="x"\n')
for (let i = 0; i < 6; i++) writeFileSync(join(PY, 'app', `m${i}.py`), 'def f():\n    return 1\n')
writeFileSync(join(PY, 'README.md'), '# py\n')
const pyStack = detectStack(PY)
check('python repo → primary=python', pyStack.primary === 'python')
check('python repo → orientationLite=true', pyStack.orientationLite === true)
check('python repo → jsFamily=false', pyStack.jsFamily === false)

const pyInit = cli(PY, 'init')
check('CLI init on python repo mentions orientation-lite', /orientation-lite/.test(pyInit))
check('CLI init verdict present', /verdict INTENT_HONORED/.test(pyInit))
const pyHs = cli(PY, 'handshake')
check('CLI handshake works on python repo', /front door/.test(pyHs))

// ── JS repo: full map, grandfathered debt ──
const JS = mkrepo('rpt-js')
mkdirSync(join(JS, 'src'), { recursive: true })
writeFileSync(join(JS, 'package.json'), '{"name":"x","version":"1.0.0"}\n')
writeFileSync(join(JS, 'src', 'index.ts'), 'export const a = 1\n')
writeFileSync(join(JS, 'src', 'legacy.ts'), '// x\n'.repeat(400)) // day-one debt
const jsStack = detectStack(JS)
check('js repo → primary=js, jsFamily=true, not orientation-lite', jsStack.primary === 'js' && jsStack.jsFamily && !jsStack.orientationLite)

const jsInit = cli(JS, 'init')
check('CLI init on js repo is green despite 400-line file (grandfathered)', /verdict INTENT_HONORED/.test(jsInit))
check('CLI init reports grandfathered debt', /grandfathered/.test(jsInit))
check('baseline.json created by init', existsSync(join(JS, '.repotector', 'baseline.json')))

// gates green now; add a NEW oversize file → red
writeFileSync(join(JS, 'src', 'newbig.ts'), '// y\n'.repeat(400))
let jsGates = ''
try { jsGates = cli(JS, 'gates') } catch (e) { jsGates = (e.stdout || '') + (e.stderr || '') }
check('new oversize file flips gates to DRIFT_DETECTED', /DRIFT_DETECTED/.test(jsGates))
check('gates output names the regression', /newbig\.ts/.test(jsGates))

// re-baseline → green again
cli(JS, 'baseline')
const jsGates2 = cli(JS, 'gates')
check('after re-baseline, gates green again', /INTENT_HONORED/.test(jsGates2))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
