# Repotector ⬡

**The repo guardian AI agents handshake with before they touch your code.**

An arriving agent knocks at the front door, is handed the map, and signs the
register on the way out — so the next agent continues in two minutes instead of
wandering for an hour, and a refactor doesn't quietly break what already works.

Portable and self-contained: pure Node ESM, two dependencies
(`@modelcontextprotocol/sdk`, `zod`). Works on any repo — JS/TS deeply, other
stacks in honest orientation-lite.

## Install into any repo

```bash
cd /path/to/your/repo
npx repotector init
```

`init` scans the repo (never fails you on day one — see *grandfathered baseline*
below), wires the MCP server into `.mcp.json`, and writes the doorway blocks so
every arriving agent knows to handshake. It writes only inside `.repotector/`
and inside `REPOTECTOR:BEGIN/END` markers — your prose and config are never
overwritten. See [SECURITY.md](./SECURITY.md) for the exact posture.

Under `.repotector/`:

| File            | What it is                                                            |
|-----------------|----------------------------------------------------------------------|
| `intent.json`   | The contract: standards, required paths, bounded contexts, canon rules. |
| `atlas.json`    | The map: exports/imports/purpose/kind per file, routes, components, stack, and a deterministic fingerprint. |
| `dna.json`      | Reverse-engineered entities + API contracts + intent.                |
| `baseline.json` | The grandfathered floor — the debt that existed on day one.          |
| `proof.json`    | Gate verdict, regressions vs grandfathered debt.                     |
| `register.jsonl`| The visitor ledger: who entered, when, what they touched, who's inside. |
| `dna.inferred.json` | Reverse-DNA clauses for foreign repos (skipped when a `.psx/` mirror exists). |

Plus, at the repo root, a regenerated **`JOURNAL.md`** — the diario di bordo,
newest-first, that `handshake` serves the tail of so the next agent continues
prior work instead of re-deriving it.

## The front door (handshake-first)

The MCP server refuses deep tools until an agent calls `handshake` — and the
`initialize` response already tells the agent to. In return the agent gets
oriented in one call, and its exit is recorded for the next one.

- **`handshake({ who, model?, purpose? })`** — orientation, ground rules, live
  gate verdict, map freshness, passport. Read-only and fast (no tree walk).
- **`city_map()`** — intent, stack, built-vs-missing, brain pointers. On a
  non-JS repo it says *orientation-lite* instead of faking an empty map.
- **`find_existing({ intent })`** — REUSE: does it already exist? Don't rebuild.
- **`blast_radius({ changedFiles? })`** — PROTECT: transitive dependents +
  impacted routes/components. Omit `changedFiles` to use the git diff.
- **`canon_check({ changedFiles? })`** — INTEGRATE: the repo's canon rules.
- **`atlas_query({ query })`** — keyword search across the map.
- **`quality_gates()`** — line-budget / structure / secret-hygiene, reported as
  regressions vs grandfathered debt.
- **`register()`** — who's inside now and the full crossing log.
- **`journal({ limit? })`** — the repo's recent story: what prior agents did and
  left unfinished. **`whats_next()`** — the sensible next work, derived from DNA
  gaps + open threads + TODOs, every suggestion citing its evidence.
- **`dna_query({ clause?, topic? })`** — what the repo *specified* (authored from
  a `.psx/` mirror, or inferred, never merged). **`dna_coverage()`** — per
  clause: implemented / partial / missing. **`dna_diff({ changedFiles? })`** —
  which clauses a change touches.
- **`depart({ summary? })`** — sign out; the git delta of your visit is recorded
  even if you forget the summary. Your summary becomes the next agent's briefing.

## Grandfathered baseline — never red on day one

A guardian that fails your repo the moment you install it gets uninstalled the
moment you install it. So `init` snapshots the debt that already exists
(oversize files, tracked secrets, missing paths). Gates then fail **only on
regressions** against that floor — a *new* offender, an offender that *grew*, a
*new* leak. Pre-existing debt is reported loudly, never blocking. `repotector
baseline` re-snapshots after you pay it down.

## v1.2 "Gatekeeper" — from advisor to checkpoint

- **Commit guard** — `repotector hooks` installs a pre-commit that runs the
  gates; `gates` exits non-zero on regressions, so hooks and CI actually block.
  Grandfathered baseline means it never blocks day-one debt — only new damage.
- **Protected paths** — `intent.protect.paths` globs (CI workflows, LICENSE…)
  that agents must not touch: change-based, never grandfathered, overridden only
  by editing the intent (an explicit, diffable act).
- **Claims** — `claim({ paths })` declares your work zone; overlapping claims
  from live sessions answer `granted:false` with who/why. Advisory by design
  (blocking would be theater on a filesystem we don't control); claims die with
  the session.
- **Decision records** — `depart({ decisions: [{ chose, over, because }] })`
  writes the *why* to the register and projects `DECISIONS.md`; the handshake
  serves standing decisions and `decisions_query` answers "was this deliberate?"
  — so agent 2 doesn't undo agent 1's choice.
- **`repotector doctor`** — one command, semaphore answer to "how protected is
  this repo, really?", with a fix for every red.

## v1.5 "Mission" — the single verifiable chain

The whole visit becomes one auditable contract:

```
handshake → declare_mission → (auto)claim → work
        → off-claim / forbidden reconciliation
        → evidence pack (machine-verified vs agent-declared)
        → depart → the next agent inherits it all
```

- **`declare_mission({ goal, acceptance, claimPaths?, forbiddenPaths?, risk? })`**
  — bind the visit to a contract: your zone is auto-claimed (conflicts
  surfaced), and you get a one-shot briefing (gates, merge status, standing
  decisions, protected paths).
- **Evidence pack at depart** — the register records what the MACHINE verified
  (gates verdict, trial-merge clean/conflicted, files touched, off-claim,
  forbidden violations) strictly apart from what the AGENT declared
  (per-criterion self-report); unreported criteria are listed, never assumed.
  "Done" becomes something the register can check, not a courtesy.
- Other agents see missions in progress at handshake — what you're doing, not
  just where.

## v1.3 "Merge Guard" — commit without colliding

- **merge_check** — a zero-damage TRIAL merge (git merge-tree) of HEAD against
  the integration base, run BEFORE you commit: reports clean/conflicted with
  the exact files, each attributed to who holds that zone (live claims — and,
  in PSX Workbench repos, the Merge Machine's leases via the .psx mirror).
  CLI: `repotector merge-check [target]` (exit 1 on conflicts, so hooks/CI
  can gate on it). Zero network: it trial-merges against your LOCAL refs and
  says so — fetch first for the freshest truth.

## Resilient register — agents die without signing out

Sessions that enter and never leave (the agent was killed, the pipe closed) are
auto-departed on the next handshake, with the git delta of what they touched.
The ledger never fills with immortal open sessions, and a depart carries real
work even when nobody called it.

## CLI

```bash
npx repotector init          # scan, wire .mcp.json, write the doors — day-one green
npx repotector refresh       # re-derive the map + re-stamp the doorway blocks
npx repotector handshake     # orientation + live gate + passport (logged visit)
npx repotector city-map      # built-vs-missing + brain pointers
npx repotector dna-coverage  # per specified clause: implemented / missing
npx repotector whats-next    # the sensible next work, with evidence
npx repotector journal       # the diario di bordo (regenerates JOURNAL.md)
npx repotector gates         # regressions vs grandfathered debt
npx repotector baseline      # re-snapshot the grandfathered floor
npx repotector register      # the visitor ledger
npx repotector lock <pass>   # optional passphrase gate on the deep map
npx repotector mcp           # start the stdio MCP server
```

## Honesty

Repotector guards repos, so it holds itself to its own standard. The lock is a
compliance signal, not filesystem access control; the register is
append-integrity, not tamper-proof; a static badge is self-reported. It spawns
only `git`, makes no network calls, and pins exact versions in `.mcp.json`. The
full threat model is in [SECURITY.md](./SECURITY.md) — no security theater.

## Determinism

The Atlas `fingerprint` is a SHA-256 over sorted source contents (16 hex chars),
no timestamps — the same tree always fingerprints the same. Large files (>1MB,
generated/minified) are marked, never read into the fingerprint. `builtAtHead`
stamps the git sha so freshness can be checked without a walk.

## License

MIT © PSX System. The core an agent needs in a repo is free forever; the
compounding brain (Genome cloud, authored DNA) is the premium layer.
