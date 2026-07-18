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
- **`depart({ summary? })`** — sign out; the git delta of your visit is recorded
  even if you forget the summary. Your summary becomes the next agent's briefing.

## Grandfathered baseline — never red on day one

A guardian that fails your repo the moment you install it gets uninstalled the
moment you install it. So `init` snapshots the debt that already exists
(oversize files, tracked secrets, missing paths). Gates then fail **only on
regressions** against that floor — a *new* offender, an offender that *grew*, a
*new* leak. Pre-existing debt is reported loudly, never blocking. `repotector
baseline` re-snapshots after you pay it down.

## Resilient register — agents die without signing out

Sessions that enter and never leave (the agent was killed, the pipe closed) are
auto-departed on the next handshake, with the git delta of what they touched.
The ledger never fills with immortal open sessions, and a depart carries real
work even when nobody called it.

## CLI

```bash
npx repotector init        # scan, wire .mcp.json, write the doors — day-one green
npx repotector refresh     # re-derive the map + re-stamp the doorway blocks
npx repotector handshake   # orientation + live gate + passport (logged visit)
npx repotector city-map    # built-vs-missing + brain pointers
npx repotector gates       # regressions vs grandfathered debt
npx repotector baseline    # re-snapshot the grandfathered floor
npx repotector register    # the visitor ledger
npx repotector lock <pass> # optional passphrase gate on the deep map
npx repotector mcp         # start the stdio MCP server
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

UNLICENSED — © PSX System. (The open-core direction is MIT; see PUBLISH.md.)
