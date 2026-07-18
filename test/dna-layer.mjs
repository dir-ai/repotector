// Phase G: the DNA layer — inference, authored-vs-inferred, coverage, diff.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadDnaClauses, writeInferredDna, dnaQuery, dnaCoverage, dnaDiff } from '../src/dna-layer.mjs'
import { buildAtlas } from '../src/atlas.mjs'
import { buildDna } from '../src/dna.mjs'

import { fileURLToPath } from 'node:url'
const PKG = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]+$/, '')
const BIN = join(PKG, 'bin', 'psx-repotector.mjs')
let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`) }

function mkrepo (name) {
  const T = join(process.env.TEMP || '/tmp', name)
  rmSync(T, { recursive: true, force: true })
  mkdirSync(join(T, 'src'), { recursive: true })
  mkdirSync(join(T, '.repotector'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: T })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: T })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: T })
  return T
}
const seed = (T) => {
  const atlas = buildAtlas(T); const dna = buildDna(T, atlas)
  writeFileSync(join(T, '.repotector', 'atlas.json'), JSON.stringify(atlas))
  writeFileSync(join(T, '.repotector', 'dna.json'), JSON.stringify(dna))
  return { atlas, dna }
}

// ── FOREIGN repo → inferred DNA ──
const F = mkrepo('rpt-dna-foreign')
writeFileSync(join(F, 'README.md'), '# App\n\n## Refund handling\n\n## Seat map holds\n')
writeFileSync(join(F, 'src', 'refund.ts'), 'export function createRefund() { return 1 }\n')
writeFileSync(join(F, 'src', 'refund.test.ts'), "describe('a ticket holder can request a refund within 48h', () => { it('settles to original method', () => {}) })\n")
const { atlas: fa, dna: fd } = seed(F)

const inf = writeInferredDna(F, { atlas: fa, baseDna: fd })
check('inference produces clauses', inf.clauses.length > 0)
check('all inferred clauses are provenance=inferred', inf.clauses.every((c) => c.provenance === 'inferred'))
check('inferred confidence never exceeds 0.6 cap', inf.clauses.every((c) => c.confidence <= 0.6))
check('test description became a clause', inf.clauses.some((c) => /request a refund within 48h/.test(c.text)))
check('README heading became a clause', inf.clauses.some((c) => /Refund handling|Seat map holds/.test(c.text)))
const loaded = loadDnaClauses(F, { atlas: fa, baseDna: fd })
check('loadDnaClauses returns inferred when no .psx', loaded.provenance === 'inferred')

// ── AUTHORED mirror wins and is NOT merged with inferred ──
const A = mkrepo('rpt-dna-authored')
seed(A)
mkdirSync(join(A, '.psx', 'dna'), { recursive: true })
writeFileSync(join(A, '.psx', 'dna', 'head.json'), JSON.stringify({
  domain: 'ticketing',
  clauses: [{ id: 'DNA-014', kind: 'feature', text: 'Refunds up to 48h before event start.', claims: { paths: ['src/refund.ts'], tables: ['refunds'] } }]
}))
writeFileSync(join(A, 'src', 'refund.ts'), 'export function createRefund() {}\n')
writeInferredDna(A) // even if an inferred file exists...
const la = loadDnaClauses(A)
check('authored mirror takes precedence over inferred', la.provenance === 'authored')
check('authored clauses are not polluted by inferred ones', la.clauses.every((c) => c.provenance === 'authored') && la.clauses.some((c) => c.id === 'DNA-014'))

// ── COVERAGE: claim resolves → implemented; missing path → missing ──
const C = mkrepo('rpt-dna-cov')
writeFileSync(join(C, 'src', 'exists.ts'), 'export const x = 1\n')
seed(C)
mkdirSync(join(C, '.psx', 'dna'), { recursive: true })
writeFileSync(join(C, '.psx', 'dna', 'head.json'), JSON.stringify({
  clauses: [
    { id: 'C-1', kind: 'feature', text: 'built thing', claims: { paths: ['src/exists.ts'] } },
    { id: 'C-2', kind: 'feature', text: 'unbuilt thing', claims: { paths: ['src/missing.ts'] } }
  ]
}))
const cov = dnaCoverage(C)
check('coverage marks a resolved-claim clause implemented', cov.clauses.find((c) => c.id === 'C-1').status === 'implemented')
check('coverage marks a missing-claim clause missing', cov.clauses.find((c) => c.id === 'C-2').status === 'missing')
check('coverage totals add up', cov.totals.implemented === 1 && cov.totals.missing === 1)

// ── DIFF: changed file touching a clause path → touched; else off-DNA ──
const d = dnaDiff(C, ['src/exists.ts', 'src/random.ts'])
check('dna_diff flags the touched clause', d.touched.some((t) => t.clause === 'C-1' && t.files.includes('src/exists.ts')))
check('dna_diff reports off-DNA files', d.offDna.includes('src/random.ts'))

// ── CLI end-to-end ──
execFileSync(process.execPath, [BIN, 'init'], { cwd: F, encoding: 'utf8' })
check('CLI init writes dna.inferred.json on foreign repo', existsSync(join(F, '.repotector', 'dna.inferred.json')))
const covOut = execFileSync(process.execPath, [BIN, 'dna-coverage'], { cwd: F, encoding: 'utf8' })
check('CLI dna-coverage runs', /DNA coverage \(inferred\)/.test(covOut))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
