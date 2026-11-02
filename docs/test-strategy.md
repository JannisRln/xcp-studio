# Test, Quality and Release Verification Strategy

**Purpose:** trace every requirement and ticket to verifiable evidence, distinguish simulator tests from physical hardware, and prevent UI-only success claims.

## 1. Verification levels

| Layer | Primary tools | Required examples | Evidence |
| --- | --- | --- | --- |
| Rust unit | cargo test | XCP CTO encode/decode, endian, bounds, error enum, simulator | Green tests, fixture source |
| Rust integration | cargo test with test fixtures | Connect/read/write/disconnect, concurrency, timeout, malformed ELF and location | Named tests, failure traces |
| Frontend unit | Vitest | Typed API parse, signal selection, CSV escaping, timestamp/quality | Green tests and golden data |
| Frontend component | React test harness | Keyboard interactions, chart no-data/gap state, upload errors | Component tests |
| Wire contract | Shared JSON fixtures across Rust and TS | Known success/error, type/precision/unknown fields | Contract schema fixtures |
| End-to-end | Local simulator + browser/server | Connect→capture→chart→CSV→calibration verify | Reproducible scripted run |
| Stress/fault | Deterministic simulator and mock transport | Slow subscribers, queue overflow, 10k signals metadata, disconnect and disk full | Bounds/metrics report |
| HIL | Separate Windows PCAN/Vector hardware rig | XCP connect/read/disconnect and read-only safety | Device/driver/ECU/OS manifest |

Every automated test needs reproducible input and expected output. Hardware bench tests must never be mislabeled as passing via a simulator.

## 2. Current CI versus target gates

**CI configuration delivered by T-0001 after this PR merges:**
- Rust Windows runner: compare PR-touched `.rs` files to the results of `cargo fmt --all` and **fail if rustfmt changed any touched file**; this closes the false-green gate for newly submitted Rust changes without changing unrelated, previously unformatted main files. Then check the normalized runner with `cargo fmt --all -- --check`, run `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace`. Full-repository baseline rustfmt cleanup remains a separate tracked task.
- Frontend Windows runner: npm ci with a committed lockfile, npm run build and npm test.
- Documentation Windows runner: python scripts/check_docs.py, validating frontmatter, index, requirement mappings, dependencies and links.
- Existing workflow triggers pull_request and push to main. Branch-cleanup maintenance workflow runs on main pushes and removes only verified merged source branches.

**Separate repository administration and later work:**
- Enable required checks for rust/frontend/docs and PR review in GitHub's ruleset for main; [branch-protection.md](branch-protection.md) documents these steps. CI jobs by themselves do not establish that the ruleset is active.
- Add browser/server simulator E2E and hardware bench evidence as later milestone work.
- Formatting policy: CI normalizes its disposable checkout for existing baseline compatibility **but rejects unformatted Rust files changed by a PR**. The local hook checks formatting; a separate baseline normalization is required before a strict workspace-wide source check can replace the scoped PR gate.

Useful local commands, when dependencies are installed:

~~~sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd frontend
npm ci
npm run build
npm test
cd ..
python scripts/check_docs.py
~~~

The versioned frontend/package-lock.json is required for npm ci. Keep the lockfile in sync with package.json and review updates.

## 3. Mandatory fixture set

1. **Simulator memory**: 0x1000 u32=1850, 0x1004 f32=88.5 little-endian; include writable and read-only regions and boundary addresses.
2. **XCP protocol**: connect/disconnect happy path, unrelated CAN ID, negative response, malformed PID, timeout, fragmented reads/writes, wrong command sequencing.
3. **ELF/DWARF**: valid 32/64 bit ELF, stripped/debug, malformed/truncated, signed/float/array/struct/typedef/member, pointer chain with NULL/cycle/overflow.
4. **A2L**: valid measurement/characteristic/COMPU_METHOD, malformed file, incompatible data layout and conflicting address metadata.
5. **Stream messages**: versioned valid sample, missing field, wrong type, nonfinite values, loss/sequence gap and unknown event.
6. **Recording/CSV**: quoted/comma/newline signal names, missing samples, raw/physical units, chronological timestamps, interrupted write and truncated file.
7. **Project**: current/previous/newer schema versions, corrupt file, atomic save interruption, stale ECU metadata hash.
8. **Calibration**: baseline-read, valid write/readback, mismatch, resource access denied, timeout after send, stale confirmation token, out-of-range.
9. **Hardware**: mock PCAN and Vector error codes; separate real driver/adapter/ECU bench manifest.

Never embed copyrighted ECU firmware, proprietary A2L files, credentials or SDK redistributables in fixtures; use synthetic licensed inputs.

## 4. Target simulator end-to-end acceptance

- Start backend and frontend on clean Windows checkout; verify health.
- Connect simulator and query status/capabilities.
- Import a synthetic ELF with known ECU variable metadata (or explicitly configure validated known simulator addresses until typed metadata is delivered).
- Configure two signals (engine speed, coolant temperature) and start **one backend acquisition**.
- Subscribe with two clients; assert acquisition count remains one and both receive samples.
- Verify sample values/timebase and quality; render chart/table without synthetic data.
- Export/record; compare CSV and source batches including timestamp, units, sequence gaps and missing values.
- Stop acquisition and confirm bounded queues/clean WebSocket shutdown.
- Preview a calibration update, confirm and verify readback; run timeout and mismatch failure tests.
- Disconnect, assert UI and backend state agree, preserve diagnostics.
- Re-run after browser reload and after invalid/missing ECU metadata to verify safe failure.

This is the target release test, not a report that it already passes.

## 5. Performance and resource evidence

Record OS, CPU, Rust/Node versions, transport, ECU/simulator, number of signals, sample mode, requested/actual rates, duration, loss and percentiles. Prefer monotonic elapsed timestamps. Measure jitter (p50/p95/p99), CPU, resident memory, queue max, bytes written, WebSocket subscriber count and reconnect count.

The 1 kHz rate is a goal only when ECU/transport/memory bandwidth permits. The current synchronous XCP-over-CAN polling implementation cannot be assumed to achieve 1 kHz for arbitrary signals.

## 6. PR acceptance gates

- Ticket has requirement IDs and verifiable acceptance conditions.
- Happy path + at least one negative/fault path are covered by tests.
- New public DTO fields are reflected in [API contract](api-contract.md) and shared fixtures.
- No unbounded allocations, silent conversion failures or guessed runtime ECU addresses.
- Security and calibration writes reviewed when relevant; no hardware claims without HIL.
- Current head SHA passes required checks; prior green commits do not count.
- Ticket/index/docs updated with evidence after merge, not preemptively.

## 7. Evidence template

For each ticket record:
- PR URL + merged SHA and CI run URL/head SHA.
- Named unit/integration/E2E tests and fixtures.
- Windows/version and any device-specific bench manifest.
- Exact performance claims and limits, if relevant.
- Known failures, unsupported cases and follow-up tickets.

See [agent workflow](agent-workflow.md) and [ticket index](tickets/INDEX.md).
