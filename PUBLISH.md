# Publishing Repotector — operator steps

Everything buildable without your credentials is done and verified. These steps
need your npm / GitHub accounts, so they are yours to run. Do them in order; do
not start step 4 until 1–3 are done — publishing starts the copyability clock.

## 1. Claim the names (do first — verified free 2026-07-18)

- **npm:** the unscoped name `repotector`. Reserve it by publishing (step 4), or
  claim early with a `0.0.0` placeholder.
- **GitHub:** the org/repo `dir-ai/repotector` (server.json and
  `mcpName: io.github.dir-ai/repotector` assume this).

Squatting risk is real for a name this good — this precedes everything else.

## 2. Decide name + license (two pending decisions left to you)

- **name:** `package.json` still says `@psxsystem/repotector`. The decided
  direction is the **unscoped `repotector`** as the free core (scoped names
  don't become verbs), with `@psxsystem/repotector` kept as an alias. To ship
  the free core: set `"name": "repotector"`. The `bin` already exposes both
  `repotector` and `psx-repotector`, and every doorway already says `repotector`.
- **license:** still `UNLICENSED`. The blueprint's free-core promise is **MIT**.
  A free standard that isn't openly licensed won't be adopted. Set
  `"license": "MIT"` and add a `LICENSE` file if you accept that direction.

## 3. Bring the package under the sync plane (durability)

This folder is a local git repo with no remote — the reason earlier versions
kept vanishing. Before publishing, make it a real synchronized PSX project
(UUID + remote to the box) so it can never be lost again, and so `repotector`
guards its own repo (dogfooding: run `npx repotector init` here).

## 4. Publish with provenance

```bash
npm login
# from the package root:
npm publish --access public --provenance
```

`--provenance` (Sigstore) is table stakes in 2026 — a trust tool without it is
self-refuting. Run it from CI (GitHub Actions with `id-token: write`) so the
provenance attestation is real.

## 5. List on the MCP registry

`server.json` is prepared (`io.github.dir-ai/repotector`, npm package
`repotector`, stdio transport, `mcp` arg). Submit it to the official MCP registry
once the npm package is live.

## 6. Then — and only then — the launch

- Benchmark: tokens-to-first-correct-edit with vs without `city_map` on ~10
  public repos, plus the second-handshake rate. Publish the number.
- Show HN: **"Agents knock before they touch your repo."**
- North star to watch: repeat-handshake rate (repos where a *second* session
  handshakes within 30 days) — not download counts.

## What is already done (v2 build, verified)

- Security fixes (symlink-safe walk, vendor-aware git-scoped secret gate, canon
  path containment).
- REPOTECTOR/2 identity, MCP `isError` + `initialize` instructions, passport tag.
- Read-only walk-free handshake + git freshness stamps.
- Grandfathered baseline (never red on day one) + non-JS orientation-lite.
- Resilient depart + self-healing register (TTL sweep, git-delta departs).
- Five doors with managed blocks + pinned `.mcp.json`; SECURITY.md honesty pass.

All covered by harness tests (76 checks green across 6 suites + a real stdio MCP
smoke). See the git log.
