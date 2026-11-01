# XCP Studio

Windows-first ECU measurement and calibration workstation under active development, implemented with a Rust XCP/CAN backend and a React/TypeScript UI.

**Current state:** functioning XCP simulator and scoped read/stream APIs; not a production-ready calibration tool. Hardware transport and ECU-side DAQ are not complete. The [implementation status](docs/implementation-status.md) distinguishes shipped behavior from targets.

## Documentation and development coordination

**Start with the [documentation hub](docs/README.md).**

| Resource | Purpose |
| --- | --- |
| [Complete product specification](docs/product-specification.md) | User workflows, feature scope, nonfunctional/safety requirements and release acceptance |
| [Requirements](docs/requirements.md) | Stable requirement IDs with acceptance criteria and ticket mapping |
| [System architecture](docs/architecture.md) | Rust/React architecture, session ownership, metadata and streaming boundaries |
| [API contract](docs/api-contract.md) | Current REST/WebSocket endpoints versus proposed versioned API |
| [Implementation status](docs/implementation-status.md) | Evidence-based current capabilities and gaps |
| [Agent workflow](docs/agent-workflow.md) | Parallel agent rules, ownership, handoff and review |
| [Markdown ticket index](docs/tickets/INDEX.md) | 16 ticket files with scope, dependencies, owned paths and tests |
| [Roadmap](docs/roadmap.md) | Milestones, dependencies and suggested parallel work |
| [Test strategy](docs/test-strategy.md) | Unit, integration, E2E, simulator and HIL checks |
| [Security and safety](docs/security-safety.md) | Loopback defaults and hardware/calibration safeguards |
| [Simulator runbook](docs/runbook.md) | Setup, smoke test and troubleshooting |

**For coding agents:** begin with [AGENTS.md](AGENTS.md). Claim a READY ticket under docs/tickets/, use its owned paths, link the PR to requirements and evidence, and do not mark DONE before green CI and merge. GitHub Issues #3–#13 remain linked discussion trackers; Markdown tickets are the reviewed implementation contract. Cross-cutting decisions are in [ADRs](docs/adr/README.md).

## Interactive browser preview (no ECU)

A GitHub Pages demo build uses the real React UI, **uPlot Canvas** signal charts, configurable measurement windows and simulated, visibly changing measurements. The browser-only REST/WebSocket simulator is explicitly labeled and **cannot connect to an ECU**. The normal local build still uses the real Rust backend.

The [Pages setup guide](docs/github-pages-demo.md) describes the deployment workflow and the required repository administrator action to enable GitHub Pages for this private repository. Until Pages is enabled and its site is verified, the public URL is **not** claimed to be live.

## Primary workflow: Live View

The application opens the **Live View** first. Connect the XCP simulator, choose signals, then start a backend-owned acquisition to watch live values and charts. It shows browser-observed receive rate, sample freshness, connection state and detected gaps, and reattaches to the same backend acquisition after transient WebSocket failures. **Stopping the backend acquisition is explicit; leaving the page does not stop it.** CSV export is optional and is only a bounded recent browser preview. Recording is deferred behind reliability and usability of live monitoring.

The simulator initializes fixed values, so a flat chart is expected even while live events are arriving. The LIVE indicator reflects recently received XCP samples, **not changing signal values** or guaranteed ECU DAQ rate.

## What already works (prototype)

- XCP master and deterministic simulated ECU with CONNECT, DISCONNECT, SET_MTA, UPLOAD and DOWNLOAD.
- HTTP API for simulator connect/status/disconnect, raw memory read and typed multi-signal snapshot.
- WebSocket stream using **per-client polling** of actual simulator memory, not ECU DAQ.
- ELF symbol inspection and initial DWARF compilation-unit detection.
- Frontend with simulator read/stream capabilities; the modular dashboard from PR #18 is merged in main.
- A Windows PCAN-Basic transport implementation in xcp-core, **not yet** wired as a production backend session.

The simulator seeds u32 1850 at 0x1000 and f32 88.5 at 0x1004. Values remain constant unless explicitly changed. Typed DWARF resolution, pointer chains, A2L, complete calibration write verification, DAQ, durable recordings and Vector adapter support remain work items.

## Local setup

Prerequisites: Rust stable (rustfmt and clippy; installed using rust-toolchain.toml), Node.js 22, npm, Git. Windows is the release-gating platform. Docker is not required.

Start backend (from root):

~~~sh
cargo run -p xcp-server
~~~

In a separate terminal:

~~~sh
cd frontend
npm ci
npm run dev
~~~

Open the Vite localhost URL. Backend health: http://127.0.0.1:8080/api/health. Vite proxies HTTP and should proxy WebSocket upgrades to xcp-server. See [runbook](docs/runbook.md) and [API contract](docs/api-contract.md).

**Dependency lockfile:** frontend/package-lock.json is versioned; use npm ci for reproducible frontend dependency installation.

## Developer setup, formatting and tests

Enable the versioned local pre-commit formatting check once per clone:

~~~sh
chmod +x .githooks/pre-commit  # Git Bash/macOS/Linux, if not executable
git config core.hooksPath .githooks
~~~

Before committing Rust changes:

~~~sh
cargo fmt --all
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
~~~

For frontend changes:

~~~sh
cd frontend
npm ci
npm run build
npm test
~~~

For documentation/tickets:

~~~sh
python scripts/check_docs.py
~~~

The pre-commit hook **checks** Rust formatting and deliberately does not modify files. Existing CI runs cargo fmt --all inside a **temporary runner before tests**, so it does not commit formatted changes back to GitHub. GitHub API-created commits bypass local hooks; always verify CI on the current head SHA. CI executes Clippy and npm ci; enabling *required* GitHub branch protection is a separate administrator action described in [branch protection](docs/branch-protection.md). See [test strategy](docs/test-strategy.md).

## Hardware and calibration safety

The simulator is a test double. PCAN/Vector hardware access and calibration writes must not be considered validated merely because a Rust helper compiles or a mock API responds. Do not expose the loopback backend on public interfaces without security controls. Physical hardware writes are disabled by policy until explicit operator confirmation, resource checks and verified tests are available.

Guides: [PCAN-Basic](docs/pcan-basic.md), [simulator](docs/xcp-simulator.md), [safety](docs/security-safety.md).

## Delivery and contribution policy

One ticket, one independent branch/PR, reviewed interface contract and tests, clear owner and acceptance evidence. Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) and [branch protection policy](docs/branch-protection.md). Do not merge pending or failing CI. Do not claim full XCP DAQ, reliable hardware calibration or performance targets without measured evidence. Code documentation and Doxygen comments are written in **English**.
