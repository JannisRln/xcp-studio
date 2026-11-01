# XCP Studio Documentation Hub

This directory is the authoritative, versioned engineering knowledge base. Distinguish **TARGET** specifications from verified **CURRENT** implementation. Read [implementation status](implementation-status.md) before claiming a feature is delivered.

## Product and engineering

| Document | Purpose |
| --- | --- |
| [Product specification](product-specification.md) | End-to-end workflows, functional domains, safety and release acceptance |
| [Requirements](requirements.md) | Immutable requirement IDs and verifiable acceptance criteria |
| [Architecture](architecture.md) | Current and target system boundaries, ownership and data flow |
| [API contract](api-contract.md) | Current REST/WS routes versus proposed versioned schemas |
| [Implementation status](implementation-status.md) | Time-stamped evidence-based capability snapshot |
| [Roadmap](roadmap.md) | Milestones, critical path and independent workstreams |
| [Security and safety](security-safety.md) | Local API trust boundaries, hardware and calibration guard policy |

## Agent collaboration and work tracking

| Document | Purpose |
| --- | --- |
| [Agent entrypoint](../AGENTS.md) | Mandatory starting point for coding agents |
| [Agent workflow](agent-workflow.md) | Claiming, conflict avoidance, contract-first PRs, status updates |
| [Ticket index](tickets/INDEX.md) | 16 implementation tasks, dependencies, priority, GitHub issues |
| [Ticket rules](tickets/README.md) | Frontmatter schema and lifecycle |
| [Ticket template](tickets/TEMPLATE.md) | Copy when adding new tasks |
| [Architecture decisions](adr/README.md) | Explicit cross-cutting design decisions |
| [Test strategy](test-strategy.md) | Quality gates, fixture matrix, E2E/HIL evidence |

## Developer/operator references

- [Simulator behavior](xcp-simulator.md): implemented XCP commands, memory addresses, HTTP/WS flow and gaps.
- [PCAN adapter guide](pcan-basic.md): existing Windows adapter vs production integration.
- [Simulator runbook](runbook.md): startup, smoke checks, troubleshooting and safe evidence collection.

## Working with multiple agents

1. Review requirements, architecture and status; choose a READY ticket with fulfilled dependencies.
2. Claim the ticket and respect owned paths before editing code; coordinate contracts with T-0012.
3. Build and test the feature, including negative cases; update the ticket, API specification and ADRs when affected.
4. Open an issue-linked PR and wait for green CI **on the final head SHA**.
5. Mark the ticket DONE only after merge and accepted test evidence.

Run the local documentation checks with python scripts/check_docs.py from repository root; CI should run the same script. Doxygen comments are always English.
