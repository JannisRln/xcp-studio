# Agent entrypoint — XCP Studio

This file is the mandatory starting point for coding and documentation agents, including agents launched in parallel.

1. Read [product specification](docs/product-specification.md), [requirements](docs/requirements.md), [architecture](docs/architecture.md) and [implementation status](docs/implementation-status.md) **before** changing code.
2. Select one independent [ticket](docs/tickets/INDEX.md), read its dependencies and **claim it** in a PR. GitHub issues are cross-references; the markdown ticket is the versioned implementation plan.
3. Read the [multi-agent workflow](docs/agent-workflow.md), [test strategy](docs/test-strategy.md), [API contract](docs/api-contract.md) and relevant [ADRs](docs/adr/README.md).
4. Work on a dedicated feature branch. Never modify main directly; use a ticket-linked PR. Do not merge with failed/pending required CI or pending contract review.
5. Follow the ticket's module ownership. Cross-module DTO, session, lockfile or CI modifications need explicit coordination; do not overwrite another agent's work.
6. Keep Rust public interfaces and TypeScript API consumers in agreement. Add/update contract tests for every exposed API change.
7. Prefer simulator tests. Hardware access and calibration writes are safety-sensitive: never assert capability or enable writes without verification and explicit safe-state policy.
8. Do not use generated frontend values as real ECU measurements. Mark simulation clearly; distinguish current code from target specification.
9. Doxygen comments and all code documentation comments must be **in English**. Keep documentation and API identifiers in clear, consistent English.
10. Before requesting merge, run/document validation: Rust fmt/check, clippy (where implemented), cargo tests; frontend install, typecheck/build and tests; docs validator. If tooling is unavailable, report that and rely on CI instead of claiming tests passed.
11. Update ticket acceptance checklist and evidence links only after proof; keep known limitations and follow-up work explicit.
12. Consult [PR template](.github/PULL_REQUEST_TEMPLATE.md) and include Ticket, Requirements, Tests/Evidence, API/Docs impact and rollback notes.

## Important existing limitations

- Current backend is simulator-first; PCAN adapter exists but is not exposed as a production UI session transport; Vector hardware is not integrated.
- Current WebSocket stream is per-client XCP polling, not a shared DAQ acquisition engine.
- ELF parsing has partial DWARF support only.
- Calibration writes are not exposed through a guarded public API.
- PR #18 proposes the modular dashboard and may still be awaiting merge; verify latest GitHub PR/branch state rather than assuming.

All agents must avoid claiming a requirement is complete simply because an initial endpoint or screen exists.
