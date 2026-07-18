// Verification harness for punch-list fixes 2-4 (walk, secret gate, canon).
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { walk } from '../src/util.mjs'
import { checkSecretHygiene } from '../src/gates.mjs'
import { canonCheck } from '../src/canon.mjs'

const T = join(process.env.TEMP || '/tmp', 'rpt-fix-test')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })

let pass = 0; let fail = 0
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`) }

// ── repo scaffold ──
execFileSync('git', ['init', '-q'], { cwd: T })
execFileSync('git', ['config', 'user.email', 't@t'], { cwd: T })
execFileSync('git', ['config', 'user.name', 't'], { cwd: T })
writeFileSync(join(T, '.gitignore'), '.env\n')
writeFileSync(join(T, 'src', 'clean.ts'), 'const label = "kiosk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\nconst task = "task-1234567890123456789012345678901234"\n')
writeFileSync(join(T, 'src', 'leak.ts'), 'const k = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA"\nconst o = "sk-proj-BBBBBBBBBBBBBBBBBBBBBBBB"\nconst s = "sk_live_CCCCCCCCCCCCCCCCCCCC"\n')
writeFileSync(join(T, '.env'), 'OPENAI_API_KEY=sk-proj-SECRETSECRETSECRETSECRET\n')
writeFileSync(join(T, 'outside-secret.txt'), 'sk-ant-api03-DDDDDDDDDDDDDDDDDDDDDDDD')
execFileSync('git', ['add', '.gitignore', 'src'], { cwd: T })

// 1) walk: junction self-loop must not hang, symlinked dirs never followed
try { symlinkSync(T, join(T, 'src', 'loop'), 'junction') } catch (e) { console.log('junction skipped:', e.message) }
const t0 = Date.now()
const files = walk(T)
check('walk terminates with self-junction (<2s)', Date.now() - t0 < 2000)
check('walk does not traverse the junction', !files.some((f) => f.includes('loop')))

// 2) secret gate
const sh = checkSecretHygiene(T, { scan: { excludeGlobs: [] } })
const kinds = sh.leaks.map((l) => l.kind).sort()
check('no false positive on kiosk-/task-', !sh.leaks.some((l) => l.file.includes('clean')))
check('finds sk-ant / sk-proj / stripe in leak.ts', ['anthropic-key', 'openai-key', 'stripe-key'].every((k) => kinds.includes(k)))
check('gitignored .env is NOT flagged as env-at-risk', sh.trackedEnv.length === 0)
check('gitignored .env content is NOT scanned as leak', !sh.leaks.some((l) => l.file === '.env'))

// now track an env file → must flag
writeFileSync(join(T, '.env.production'), 'X=1\n')
execFileSync('git', ['add', '-f', '.env.production'], { cwd: T })
const sh2 = checkSecretHygiene(T, {})
check('tracked .env.production IS flagged', sh2.trackedEnv.includes('.env.production'))

// 3) canon: traversal + g-flag
const intent = { canonRules: [{ id: 'no-foo', pattern: 'FOO_MARKER', flags: 'g' }] }
writeFileSync(join(T, 'src', 'a.ts'), 'FOO_MARKER\n')
writeFileSync(join(T, 'src', 'b.ts'), 'FOO_MARKER\n')
const v = canonCheck(['src/a.ts', 'src/b.ts'], intent, T)
check('g-flag stripped: both files flagged (no lastIndex skip)', v.length === 2)
const vt = canonCheck(['../rpt-fix-test/../../outside.txt', '..\\..\\windows\\win.ini'], intent, T)
check('path traversal contained (no violations, no read outside root)', vt.length === 0)

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
