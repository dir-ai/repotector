// lock.mjs — OPTIONAL passphrase lock. A repo MAY choose to gate the deep map
// (atlas/dna/genome/phenome/blast) behind a passphrase; by default there is NO
// lock and everything is open. The handshake is ALWAYS free — identifying
// yourself is never gated, only reading the deep internals can be.
//
// Honest scope: this is a SOFT gate at the MCP boundary (an agent that reads
// files straight off disk is not stopped by it). Encryption-at-rest of the
// .repotector artifacts is the strong follow-up (Phase 3b).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { repotectorDir } from './util.mjs'

const POLICY = 'policy.json'

// Tools that a lock, when enabled, may gate. The handshake / register / depart
// are deliberately NOT gateable — arriving and identifying must always work.
export const GATEABLE_TOOLS = ['find_existing', 'blast_radius', 'atlas_query', 'canon_check', 'quality_gates', 'city_map']

function policyPath (root) {
  return join(repotectorDir(root), POLICY)
}

export function loadPolicy (root) {
  const p = policyPath(root)
  if (!existsSync(p)) return { lock: { enabled: false } }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    return { lock: { enabled: false }, ...parsed }
  } catch {
    return { lock: { enabled: false } }
  }
}

// Turn the lock ON with a passphrase. Stores only a salted scrypt hash — never
// the passphrase itself. `gated` defaults to the whole deep map.
export function setLock (root, passphrase, gated = GATEABLE_TOOLS) {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('Passphrase too short (min 4 chars).')
  }
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(passphrase, salt, 32).toString('hex')
  const policy = loadPolicy(root)
  policy.lock = { enabled: true, algo: 'scrypt', salt, hash, gated }
  writeFileSync(policyPath(root), JSON.stringify(policy, null, 2), 'utf8')
  return policy.lock
}

// Turn the lock OFF (requires the current passphrase to avoid a silent unlock).
export function clearLock (root, passphrase) {
  const policy = loadPolicy(root)
  if (!policy.lock?.enabled) return { enabled: false }
  if (!verifyPassphrase(policy, passphrase)) throw new Error('Wrong passphrase — lock not cleared.')
  policy.lock = { enabled: false }
  writeFileSync(policyPath(root), JSON.stringify(policy, null, 2), 'utf8')
  return policy.lock
}

export function verifyPassphrase (policy, passphrase) {
  const lock = policy?.lock
  if (!lock?.enabled) return true
  if (!passphrase) return false
  try {
    const got = scryptSync(passphrase, lock.salt, 32)
    const want = Buffer.from(lock.hash, 'hex')
    return got.length === want.length && timingSafeEqual(got, want)
  } catch {
    return false
  }
}

export function isLocked (policy) {
  return Boolean(policy?.lock?.enabled)
}

export function isGated (policy, tool) {
  if (!isLocked(policy)) return false
  const gated = policy.lock.gated || GATEABLE_TOOLS
  return gated.includes(tool)
}
