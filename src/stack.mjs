// stack.mjs — detect the repo's primary language. The atlas extractors are
// JS/TS-shaped; run them on a Python/Go/Rust repo and you get a confident EMPTY
// map ("0 files, 0 routes") that reads as "trivial repo". That first screenshot
// brands the tool a toy. So we detect the stack and, when JS is not the bulk of
// the repo, we mark the map orientation-lite and SAY the deep extractors do not
// apply — an honest thin answer over a confident wrong one.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { walk, dotExt } from './util.mjs'

const MANIFESTS = [
  { file: 'package.json', stack: 'node' },
  { file: 'deno.json', stack: 'deno' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'requirements.txt', stack: 'python' },
  { file: 'go.mod', stack: 'go' },
  { file: 'Cargo.toml', stack: 'rust' },
  { file: 'composer.json', stack: 'php' },
  { file: 'Gemfile', stack: 'ruby' },
  { file: 'pom.xml', stack: 'jvm' },
  { file: 'build.gradle', stack: 'jvm' }
]

const EXT_LANG = {
  '.ts': 'js', '.tsx': 'js', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.php': 'php', '.rb': 'ruby',
  '.java': 'jvm', '.kt': 'jvm', '.cs': 'dotnet', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp'
}

export function detectStack (root) {
  const counts = {}
  for (const abs of walk(root)) {
    const lang = EXT_LANG[dotExt(abs)]
    if (lang) counts[lang] = (counts[lang] || 0) + 1
  }
  const byCount = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const primary = byCount.length ? byCount[0][0] : 'unknown'
  const jsCount = counts.js || 0
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const manifests = [...new Set(MANIFESTS.filter((m) => existsSync(join(root, m.file))).map((m) => m.stack))]
  const jsFamily = primary === 'js' || ((manifests.includes('node') || manifests.includes('deno')) && jsCount > 0)
  // Orientation-lite when JS is not the bulk: the JS extractors won't represent
  // this repo, so downstream must not present their emptiness as truth.
  const orientationLite = total > 0 && !jsFamily && jsCount / total < 0.5
  return { primary, jsFamily, orientationLite, counts, total, manifests }
}
