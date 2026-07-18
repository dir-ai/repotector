# Security & honest threat model

Repotector guards repositories, so it is held to its own standard: it says
exactly what it does, and exactly what it does **not**.

## What Repotector does to your machine

- **Spawns nothing but `git`.** The only child process it runs is `git`
  (read-only queries: `rev-parse`, `status`, `diff`, `ls-files`). It starts no
  network connections, no daemons, no telemetry.
- **Writes only inside `.repotector/`** (its own artifacts) and, on `init` /
  `refresh`, the managed blocks in the doorway files (`AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `.cursor/rules/`, `.claude/skills/`) and a
  merged entry in `.mcp.json`. It never edits your source, never touches
  `.git/config`, never rewrites content outside its `REPOTECTOR:BEGIN/END`
  markers, and merges `.mcp.json` rather than overwriting it.
- **Dependencies:** the MCP SDK and `zod`. Nothing else.

## What the lock is — and is not

The optional passphrase lock (`repotector lock`) gates the **MCP deep-map
tools** for protocol-following agents. It is a **compliance signal, not access
control**: the `.repotector/` files are plaintext on disk, so any process with
a filesystem read (which every real agent has) can read them directly. The lock
does not, and does not claim to, make a repository "untouchable."

Real confidentiality requires encryption-at-rest (a paid tier, not in the open
core), and even that protects a clone at rest — not a live session that holds
the passphrase.

## What the register is — and is not

The visitor register (`.repotector/register.jsonl`) is an **append-integrity
ledger**: it detects accidental corruption, concurrent-write damage, and casual
manual edits, and it self-heals stale sessions. It is **tamper-evident, not
tamper-proof** — anyone with write access to the repo can rewrite it. Committing
it to git (a second, independent history) is the recommended way to raise that
bar. A cloud-notarized chain is a paid-tier addition, not a claim the open core
makes.

## What the badge is — and is not

An `INTENT_HONORED` badge rendered from a committed `proof.json` is
**self-reported**: the repo owner attests to their own gate result. A
third-party-verified badge requires the hosted endpoint that re-runs the gates
itself.

## Supply chain

When published, Repotector ships with npm provenance (Sigstore) and the
recommended install pins an exact version:

```json
{ "mcpServers": { "repotector": { "command": "npx", "args": ["-y", "repotector@X.Y.Z", "mcp"] } } }
```

`init` writes exactly this pinned form — never a floating range.

## Reporting

Found a discrepancy between this document and the code? That is itself a
security issue — open one at the project's issue tracker.
