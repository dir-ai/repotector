// baseline.mjs — the grandfather record. Law #1: a repo is NEVER red on day one.
// init snapshots the debt that already exists; gates then fail only on
// REGRESSIONS against that floor (new offenders, an offender that grew, a new
// leak, a required path newly gone). Pre-existing debt is reported, never
// blocking — a tool that fails your repo the moment you install it gets
// uninstalled the moment you install it.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repotectorDir } from './util.mjs'
import { gitHead } from './freshness.mjs'

const FILE = 'baseline.json'
export function baselinePath (root) { return join(repotectorDir(root), FILE) }

export function readBaseline (root) {
  const p = baselinePath(root)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

// Snapshot the CURRENT findings as the grandfathered floor.
export function snapshotFromGates (gates, root) {
  const g = (name) => gates.find((x) => x.name === name) || {}
  const lineBudget = {}
  for (const o of g('line-budget').offenders ?? []) lineBudget[o.file] = o.lines
  return {
    schema: 'repotector.baseline/1',
    builtAtHead: gitHead(root),
    lineBudget,
    secrets: (g('secret-hygiene').leaks ?? []).map((l) => `${l.file}::${l.kind}`).sort(),
    trackedEnv: (g('secret-hygiene').trackedEnv ?? []).slice().sort(),
    structureMissing: (g('structure').missing ?? []).slice().sort()
  }
}

export function writeBaseline (root, baseline) {
  try {
    mkdirSync(repotectorDir(root), { recursive: true })
    writeFileSync(baselinePath(root), JSON.stringify(baseline, null, 2))
    return true
  } catch { return false }
}

// Split every current finding into regressions (new or worse than baseline) and
// grandfathered debt (present at baseline, no worse). Pure — returns both lists.
export function classify (gates, baseline) {
  const base = baseline || { lineBudget: {}, secrets: [], trackedEnv: [], structureMissing: [] }
  const lbBase = base.lineBudget || {}
  const secretSet = new Set(base.secrets || [])
  const envSet = new Set(base.trackedEnv || [])
  const missSet = new Set(base.structureMissing || [])
  const regressions = []
  const debt = []
  for (const g of gates) {
    if (g.name === 'line-budget') {
      for (const o of g.offenders ?? []) {
        const known = Object.prototype.hasOwnProperty.call(lbBase, o.file)
        const worse = known && o.lines > lbBase[o.file]
        const rec = { gate: 'line-budget', file: o.file, lines: o.lines, budget: g.max, kind: !known ? 'new' : (worse ? 'grew' : 'debt') }
        ;(!known || worse ? regressions : debt).push(rec)
      }
    } else if (g.name === 'secret-hygiene') {
      for (const l of g.leaks ?? []) {
        const rec = { gate: 'secret-hygiene', file: l.file, secret: l.kind }
        ;(secretSet.has(`${l.file}::${l.kind}`) ? debt : regressions).push(rec)
      }
      for (const e of g.trackedEnv ?? []) {
        const rec = { gate: 'secret-hygiene', file: e, trackedEnv: true }
        ;(envSet.has(e) ? debt : regressions).push(rec)
      }
    } else if (g.name === 'structure') {
      for (const m of g.missing ?? []) {
        const rec = { gate: 'structure', missing: m }
        ;(missSet.has(m) ? debt : regressions).push(rec)
      }
    } else if (g.name === 'protected-paths') {
      // Change-based, never grandfathered: touching a protected path is a
      // regression by definition — there is no "pre-existing" touched state.
      for (const file of g.touched ?? []) {
        regressions.push({ gate: 'protected-paths', file })
      }
    }
  }
  return { regressions, debt }
}
