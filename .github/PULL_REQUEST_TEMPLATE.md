# Pull request

## Summary

<!-- One paragraph: what does this PR change and why. -->

## Changes

<!-- Bullet list of files/behaviors touched. Group by area:
- Backend (`backend/`)
- Frontend (`frontend/`)
- Governance (`governance/`)
- Deployment (`deploy/`)
- Scripts (`scripts/`)
-->

## Why

<!-- Link to issue or describe motivation. If this changes a contract
promised by the Constitution (SSE event, MCP citation format, audit log
payload, public API), explain. -->

## Testing

<!-- How can a reviewer verify locally:
- `npm test --prefix backend` (must stay green)
- `npx tsc --noEmit` in backend AND frontend
- `node scripts/bundle-mcp.cjs --check` if MCP wiring changed
-->

## Governance / Constitution AI

<!-- Tick the boxes that apply: -->

- [ ] No contracts were broken (SSE events, MCP citations, audit_log).
- [ ] If a contract changed: ADR added under `governance/adr/`.
- [ ] If a Constitution principle changed: version bumped in `CONSTITUTION.md` + changelog row.

## Tests

- [ ] `npm test` passes (69/69 baseline must hold or grow).
- [ ] No new lint warnings.
- [ ] `tsc --noEmit` clean on both backend and frontend.

## License confirmation

By opening this PR I confirm my contribution is licensed under
**AGPL-3.0-only** (Patron shell). I followed the
[DCO](https://developercertificate.org).
