# CLAUDE.md — guarded by PSX Repotector ⬡

Claude: before you build or edit anything in this repo, handshake with the guardian.
It carries the repo's map (Atlas), its DNA baseline, and the REUSE/PROTECT/INTEGRATE gates.

## Start here

```
npx psx-repotector handshake      # orientation + live gate + passport
npx psx-repotector mcp            # start the stdio MCP server, then use its tools
```

## Use the MCP tools before acting

1. `find_existing({ intent })` — REUSE. Does this already exist? Extend, don't rebuild.
2. `blast_radius({ changedFiles? })` — PROTECT. What breaks if I touch these files?
   Omit `changedFiles` to derive them from `git diff`.
3. `canon_check({ changedFiles? })` — INTEGRATE. Am I following the repo's patterns?
4. `atlas_query({ query })` — ask the map about structure.
5. `quality_gates()` — line-budget, structure, secret-hygiene proof.
6. `handshake()` — re-orient any time.

## Rules

- Reuse first, protect before editing, integrate to canon.
- Every source file stays under 300 lines.
- No real secrets, no tracked non-example `.env`.

If a tool reports missing state, run `npx psx-repotector init`.
