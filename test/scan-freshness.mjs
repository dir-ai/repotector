// Phase B verification: read-only-safe handshake, freshness, big-file skip.
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildAtlas } from '../src/atlas.mjs'
import { runGates, readLatestProof } from '../src/gates.mjs'
import { handshake } from '../src/handshake.mjs'
import { freshness } from '../src/freshness.mjs'

const T = join(process.env.TEMP || '/tmp', 'rpt-phase-b')
rmSync(T, { recursive: true, force: true })
mkdirSync(join(T, 'src'), { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: T, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')

let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }

// small source + a >1MB "minified" file
writeFileSync(join(T, 'src', 'small.ts'), '// small module\nexport const x = 1\n')
writeFileSync(join(T, 'src', 'big.min.js'), 'var a=1;'.repeat(200000)) // ~1.4MB
check('big.min.js is >1MB', statSync(join(T, 'src', 'big.min.js')).size > 1024 * 1024)

// atlas: big file listed but not scanned; small file scanned
const atlas = buildAtlas(T)
const big = atlas.files.find((f) => f.path === 'src/big.min.js')
const small = atlas.files.find((f) => f.path === 'src/small.ts')
check('atlas lists the big file', !!big)
check('big file not scanned (empty exports, marker purpose)', big.exports.length === 0 && /not scanned/.test(big.purpose))
check('small file scanned (exports x)', small.exports.includes('x'))
check('atlas builtAtHead is null before first commit (honest)', atlas.builtAtHead === null)

// write artifacts to disk
mkdirSync(join(T, '.repotector'), { recursive: true })
writeFileSync(join(T, '.repotector', 'atlas.json'), JSON.stringify(atlas))
writeFileSync(join(T, '.repotector', 'intent.json'), JSON.stringify({ domain: 'b-test', standards: { maxFileLines: 300 }, structure: { requiredPaths: [] } }))

// runGates write:false must NOT create proof.json
runGates(T, { write: false })
check('runGates write:false does not write proof.json', !existsSync(join(T, '.repotector', 'proof.json')))
// runGates default writes it
const proof = runGates(T)
check('runGates default writes proof.json', existsSync(join(T, '.repotector', 'proof.json')) && !!proof.verdict)

// handshake must be read-only: capture proof.json mtime, handshake, assert unchanged
git('add', '.'); git('commit', '-q', '-m', 'init')
// rebuild atlas so builtAtHead == committed HEAD, rewrite it, regate
const atlas2 = buildAtlas(T)
check('atlas stamps builtAtHead after commit', typeof atlas2.builtAtHead === 'string' && atlas2.builtAtHead.length >= 7)
writeFileSync(join(T, '.repotector', 'atlas.json'), JSON.stringify(atlas2))
runGates(T)
const proofPath = join(T, '.repotector', 'proof.json')
const before = statSync(proofPath).mtimeMs
// backdate so any rewrite would change mtime
utimesSync(proofPath, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
const backdated = statSync(proofPath).mtimeMs
const h = handshake(T)
check('handshake does NOT rewrite proof.json (read-only)', statSync(proofPath).mtimeMs === backdated)
check('handshake returns a verdict', !!h.gates.verdict)
check('handshake freshness=fresh on clean committed tree', h.freshness.state === 'fresh')

// dirty the tree → stale
writeFileSync(join(T, 'src', 'small.ts'), '// changed\nexport const x = 2\n')
const fr = freshness(T, atlas2)
check('freshness=stale when working tree dirty', fr.state === 'stale' && /uncommitted/.test(fr.why || ''))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
