# T-0007 — Simulator calibration core integration gate

**Status:** standalone core phase only. No production ECU-memory write, simulator write route, or hardware write-enable API is provided.

## Implemented boundary

- Rust module: crates/xcp-core/src/calibration/mod.rs. No external dependencies, session ownership changes, or wire DTOs.
- The module operates on validated, **simulator-mapped runtime** addresses only. ELF link-time and unresolved locations fail closed.
- Preview::prepare validates trusted session/ECU/image identity, writable metadata, address span, raw scalar type, endian encoding, raw/physical limits, baseline and proposed value, and trusted token expiry.
- Preview::confirm consumes the preview and checks the supplied token plus a **fresh simulator snapshot** (identity, monotonic memory revision, byte-exact baseline) immediately before any future dispatch.
- Confirmed::finish consumes the confirmed plan and produces an immutable-by-interface audit record from externally supplied dispatch/readback evidence. It does not perform a write or verify that evidence is trustworthy.
- A successful audit requires an observed readback with matching identity, strictly advanced simulator revision and bit-exact desired bytes. Any absent/inconsistent readback cannot be reported as success. Float comparisons are intentionally bit-exact, including signed zero, rather than using an implicit tolerance.
- After a send, timeout or disconnect yields **Unknown**, not failure-with-guaranteed-no-write, and never triggers an automatic retry or rollback. If the send was definitely prevented, the evidence must use NotSent.

## Mock tests

The #[cfg(test)] fixture alone mutates a private in-memory snapshot; there is no CanTransport, SessionHandle, XCP DOWNLOAD, or write trait in production calibration code.

Named cases cover success with preview/baseline/readback/audit, raw and conversion range failures, type mismatch, read-only metadata, link-time/unmapped/overflow addresses, wrong/expired tokens, stale revision/value, ECU-image mismatch, readback mismatch, rejection, unversioned readback, post-send timeout/disconnect (unknown), pre-send disconnect (not sent), float signed zero and byte order, nonfinite values, and unsafe integer-to-float precision conversion.

Verification commands: cargo fmt --all -- --check; cargo clippy --workspace --all-targets -- -D warnings; cargo test --workspace; python scripts/check_docs.py. Local Rust execution is **unverified** until a Rust toolchain is available; attach Windows CI evidence for the actual PR head SHA. No HIL evidence is claimed.

## Required sign-offs before integration

1. **Security owner / PR #42:** the deny-all ECU-memory-write policy remains intact for all targets. A separate reviewed simulator-only enablement design (if ever approved) must prove it cannot reach physical sessions or weaken startup assertions; no direct XcpMaster::download backdoor.
2. **Session owner (T-0004):** trusted identity/profile/ECU-image checks and a serialized, non-interleavable baseline → operation → readback command across XCP MTA; cancellation/timeouts must preserve whether send may have happened. No automatic replay of unknown sends.
3. **Metadata/address owner (T-0003 / T-0014):** validated simulator runtime mapping, type, endianness, access rights, address/page constraints, ECU-image fingerprint; ELF link-time values must never become runtime addresses unchecked. Any change of identity/image invalidates pending intent.
4. **Contract owner (T-0012):** freeze/version the server-owned prepare/preview/confirm/audit DTOs, token lifetime/single-use semantics, error codes, audit persistence and TS fixtures before adding HTTP or frontend consumers. The Rust core token requires trusted cryptographic randomness, server-side one-time consumption, and a **monotonic** expiry source; this phase does not provide these services.
5. **Calibration safety reviewer:** define and test supported raw/physical types and precision policy, safe-state/read-only default, lockout on missing rights or capabilities, audit retention and readback interpretation. The simulator's revision is required by this core; a physical revision strategy must be separately designed.
6. **Release/evidence owner:** current-head Windows Rust/frontend/docs CI, simulator integration/fault tests (including disconnection during operation), operator UI confirmation, and signed review. Physical write authorization requires a *separate* policy, explicit operator enablement, ECU safe-state checks and bench/HIL evidence; not part of T-0007 core.

## Recovery and rollback

An Unknown result forbids declaring success, retrying blindly or claiming that the old value was restored. Reconnect and independently re-identify the ECU, establish a new baseline, then require a new preview and confirmation; use safe-state handling defined by the future integration. Rollback of this core phase only removes the standalone module and its lib.rs export. It does **not** modify server safety policy or ECU memory.
