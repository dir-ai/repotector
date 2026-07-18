// Test runner — the guardian verifies itself first. Runs every suite in this
// directory sequentially and fails on the first red total.
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const suites = readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs').sort()

let failed = 0
for (const suite of suites) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [join(here, suite)], { encoding: 'utf8' })
  const out = (result.stdout || '') + (result.stderr || '')
  const tail = out.trim().split('\n').pop() || ''
  const ok = result.status === 0
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${suite.padEnd(20)} ${tail}  (${Date.now() - started}ms)`)
  if (!ok) console.log(out.split('\n').filter((l) => /FAIL/.test(l)).join('\n'))
}

console.log(failed === 0 ? `\nAll ${suites.length} suites green.` : `\n${failed}/${suites.length} suite(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
