# CLAUDE.md — guarded by PSX Repotector ⬡

Claude: before you build or edit anything in this repo, **handshake with the guardian
and declare who you are** — every crossing is logged. It carries the repo's map (Atlas),
its DNA baseline, the city-map, and the REUSE/PROTECT/INTEGRATE gates.

## Start here (mandatory, in order)

```
handshake({ who: "claude-code@you", purpose: "..." })   # logs your entry; required first
npx psx-repotector mcp                                  # stdio MCP server (handshake-first)
unlock({ passphrase })                                  # only if the repo is locked
city_map()                                              # built vs missing, before you plan
depart({ summary })                                     # sign out when you finish
```

## Use the MCP tools before acting

1. `city_map()` — INFO. What did the DNA specify, what is built, what is MISSING?
2. `register({ limit? })` — who has entered/left, who is inside now.
3. `find_existing({ intent })` — REUSE. Does this already exist? Extend, don't rebuild.
4. `blast_radius({ changedFiles? })` — PROTECT. What breaks if I touch these files?
   Omit `changedFiles` to derive them from `git diff`.
5. `canon_check({ changedFiles? })` — INTEGRATE. Am I following the repo's patterns?
6. `atlas_query({ query })` — ask the map about structure.
7. `quality_gates()` — line-budget, structure, secret-hygiene proof.

## Rules

- Reuse first, protect before editing, integrate to canon.
- Every source file stays under 300 lines.
- No real secrets, no tracked non-example `.env`.

If a tool reports missing state, run `npx psx-repotector init`.
