# Releasing Repotector

Runbook for maintainers (human or AI session) — everything needed to ship a
release from a cold start. **There are no secrets to keep anywhere**: every
credential is either cached on the workstation or minted by CI via OIDC.

## Coordinates

| What | Where |
|---|---|
| Canonical working copy | `C:\Users\dir\psx-projects\psx-repotector` (Windows workstation) |
| Git remote | `https://github.com/dir-ai/repotector` (branch `main`) |
| npm package | [`repotector`](https://www.npmjs.com/package/repotector) (unscoped, MIT) |
| MCP registry name | `io.github.dir-ai/repotector` (`server.json`) |
| Container image | `ghcr.io/dir-ai/repotector` (`:X.Y.Z` + `:latest`) |
| CI | `.github/workflows/ci.yml` (every push) + `publish.yml` (on `v*` tag) |

## Auth model — why no stored credentials

- **git push** → Git Credential Manager on the workstation already holds the
  GitHub credential. `git push origin main` just works from a shell.
- **npm publish** → OIDC **trusted publishing**: npmjs.com is configured to
  trust this repo's GitHub Actions workflow. CI publishes with
  `--provenance`; no npm token exists anywhere.
- **MCP registry** → `mcp-publisher login github-oidc` inside CI. No token.
- **GHCR image** → pushed by CI with the ephemeral `GITHUB_TOKEN`. No token.

If a step asks you for a password/token, something is wrong — stop and check
the trusted-publisher config on npmjs.com (Package → Settings → Trusted
Publisher) instead of minting credentials.

## Release steps

1. Make the change; keep/extend tests in `test/` (suite runner: `npm test`,
   all suites must be green).
2. Bump the version in **both** `package.json` and `server.json`
   (`.version` and `.packages[0].version` — three fields total).
3. Commit on `main` (no feature branches by project rule), then:

   ```bash
   git tag vX.Y.Z
   git push origin main && git push origin vX.Y.Z
   ```

4. The `publish` workflow does the rest: sanity init on a throwaway repo →
   npm publish with provenance (idempotent — skips if the version exists) →
   MCP registry publish → Docker build, in-container smoke, multi-arch push
   to GHCR.

## Verify (do this every release)

```bash
npm view repotector version            # must print X.Y.Z (CDN can lag 1-2 min)
```

- Actions run green: https://github.com/dir-ai/repotector/actions
- MCP registry: search `repotector` — version listed.
- GHCR: https://github.com/dir-ai/repotector/pkgs/container/repotector
- Full published-package smoke (installs from npm as a real user, 26 checks):
  scratchpad script `smoke-published-*.mjs` from the workbench sessions, or
  minimally `npx -y repotector@X.Y.Z help` in an empty dir.

## Conventions

- Straight to `main`, tags only for releases, one release = one tag.
- `npm version` is NOT used (it does not know about `server.json`).
- Never introduce a network call in the core: zero-network is a SECURITY.md
  promise. Telemetry, if ever, is opt-in and a separate package.
- `src/gates.mjs` glob placeholder is the six-char escape `backslash-u0000` written
  OUT as an escape — never let a literal NUL byte into a source file.
