# PSX Repotector ⬡

A **portable, self-contained** repo guardian that PSX System installs into every delivered
repo. It handshakes with any AI that arrives, generates the repo map (**Atlas**) and a **DNA**
baseline, and exposes — over an **MCP server** — the **REUSE / PROTECT / INTEGRATE** gates so no
AI rebuilds what already exists or breaks what is already there.

No platform, no framework, no workbench dependency. Pure Node ESM. Only two deps:
`@modelcontextprotocol/sdk` and `zod`.

## Install into any repo

```bash
cd /path/to/your/repo
npx @psxsystem/repotector init
```

`init` scans the repo and writes, under `.repotector/`:

| File          | What it is                                                        |
|---------------|-------------------------------------------------------------------|
| `intent.json` | The contract: standards, required paths, bounded contexts, rules. |
| `atlas.json`  | The map: every source file's exports, imports, purpose, kind, plus routes/components and a deterministic fingerprint. |
| `dna.json`    | Reverse-engineered entities + API contracts + intent.             |
| `proof.json`  | Quality-gate verdict (`INTENT_HONORED` / `DRIFT_DETECTED`).       |

It also drops `AGENTS.md`, `CLAUDE.md`, and `.cursorrules` (only if absent) so arriving AIs
know to handshake. `init` is idempotent and never overwrites your `intent.json` or docs.

## CLI

```bash
npx psx-repotector init        # scan + generate state + install docs
npx psx-repotector handshake   # orientation + live gate + passport
npx psx-repotector gates       # run quality gates, print verdict
npx psx-repotector atlas       # regenerate atlas.json
npx psx-repotector dna         # regenerate dna.json
npx psx-repotector mcp         # start the stdio MCP server
```

## Wire the MCP server into your client

The server speaks MCP over stdio. Example client config:

```json
{
  "mcpServers": {
    "psx-repotector": {
      "command": "npx",
      "args": ["psx-repotector", "mcp"]
    }
  }
}
```

### Tools exposed

- **`handshake`** — front door: orientation, ground rules, live gate, passport.
- **`find_existing({ intent })`** — REUSE: does it already exist? Don't rebuild.
- **`blast_radius({ changedFiles? })`** — PROTECT: transitive dependents + impacted
  routes/components. Omit `changedFiles` to use `git diff --name-only HEAD`.
- **`canon_check({ changedFiles? })`** — INTEGRATE: check the repo's canon rules.
- **`atlas_query({ query })`** — keyword search across the map.
- **`quality_gates()`** — line-budget, structure, secret-hygiene proof.

## The gates

- **Line budget** — no source file over `standards.maxFileLines` (default 300).
- **Structure** — every `structure.requiredPaths` entry exists.
- **Secret hygiene** — no tracked non-example `.env`, no `sk-…`/`glpat-…`/`AKIA…` leaks.

## Determinism

The Atlas `fingerprint` is a SHA-256 over sorted source contents (16 hex chars) with no
timestamps — the same tree always fingerprints the same. `generatedAt` is intentionally `null`.

## License

UNLICENSED — © PSX System.
