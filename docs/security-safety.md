# Security and Operational Safety

**Status:** Policy and target controls. Not a claim that the prototype has implemented every control. This application can change ECU memory; simulator tests do not establish physical ECU safety.

## 1. Trust boundaries

- Local browser and Rust API share a workstation trust boundary only while the server is bound to 127.0.0.1.
- Uploaded ELF, A2L, project and JSON/WS messages are **untrusted input** even when selected by a local user.
- Vendor DLLs and connected adapters are privileged external components, not a reason to bypass typed validation.
- The ECU is the authoritative target for memory access; an ELF symbol address is not evidence of runtime reachability.
- Project files may contain private paths and sensitive ECU identifiers; diagnostic bundles are explicitly opt-in.

## 2. Default protections and current gaps

| Surface | Minimum target control | Prototype note |
| --- | --- | --- |
| HTTP API | Loopback bind; bounded bodies, rate, concurrency and timeouts | 127.0.0.1:8080 only; Host/Origin guard, 16 KiB non-ELF body, 32 MiB ELF body, 256 accepted requests/second process-wide, at most 32 concurrent HTTP handlers; 15-second HTTP deadline (30 seconds for ELF) |
| ELF/DWARF/A2L | Size, concurrency, recursion, section offset and expression limits | At most two concurrent ELF parser workers with lifetime permits and a 32 MiB request cap; deeper parser structure/complexity limits still require T-0003 hardening |
| WebSocket | Origin policy, message/connection caps, bounded queues, send deadlines and safe close | Both WS paths cap incoming frames/messages at 16 KiB and sends at 5 seconds; legacy stream max 8 active clients, 5-second configuration deadline and periodic Ping; shared acquisition max 16 subscribers and 128 buffered events |
| XCP session | Resource/capability checks, serialized commands, positive outcome verification | Prototype session is mutex-based and simulator-first |
| Hardware | Explicit physical target selection, read-only default, no simulation fallback | UI hardware selection not production-ready |
| Calibration | Preview, confirmation, range validation, readback, audit and unknown-result state | No guarded public write API yet |
| Storage | Atomic project saves, disk caps, redaction and no secrets | Versioned storage pending |
| Remote access | Authentication, authorization, TLS, CSRF/WS origin protection, threat review | **Do not expose remotely** before milestone |

### Browser origin and local Host policy (T-0013)

All API routes, including WebSocket upgrades, reject multiple/ambiguous Host or Origin headers and non-loopback Host headers and browser Origin values other than `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:8080`, `http://127.0.0.1:8080` (plus HTTPS on local port 5173 for TLS dev proxies). `Sec-Fetch-Site: cross-site` requests are denied. This reduces risks from malicious websites controlling a workstation's localhost API and DNS rebinding. CLI requests without an Origin are allowed only with a loopback Host header.

**Important:** Host/Origin policy is not authentication. If remote access, multi-user operation, non-default Vite ports, or a desktop WebView origin is needed, design a new, reviewed security profile rather than relaxing checks or binding to all interfaces. Protected physical ECU writes still require explicit user enablement and separate tests.

### Resource exhaustion controls (T-0013)

Limits are compile-time, process-wide defaults rather than user-supplied configuration: a one-second fixed window admits up to 256 guarded HTTP requests, 32 requests may execute concurrently, and at most two ELF uploads may be actively parsed. Other HTTP requests use 16 KiB extractor limits; ELF uploads retain the existing 32 MiB maximum. Oversized Content-Length values are rejected before parsing; unknown-length/chunked uploads remain bounded by Axum body extractors. The ELF parse is moved off the async runtime, and its semaphore permit stays held in the blocking worker even when the waiting HTTP request reaches its 30-second deadline. The deadline does **not** terminate an already-running blocking worker or XCP actor command; callers must not infer a cancelled ECU operation from an HTTP timeout.

The legacy polling WebSocket allows at most eight active streams, with the admission permit retained until closure. Both streaming routes use a 16 KiB incoming message and frame maximum and a five-second outbound send timeout. Legacy streams must receive valid configuration within five seconds, reject overflowed ECU address ranges and unexpected subsequent application messages, and periodically send a Ping. Shared acquisition maintains a separate 16-subscriber limit and 128-event broadcast queue; slow subscribers are subject to the send timeout, but the shared route does not yet require a Pong/heartbeat deadline. The 16 KiB limit is on **incoming** messages; outgoing snapshot size is bounded by 64 validated signals/names. The HTTP rate limit does not meter each sample; it limits admission of requests and upgrades.

These limits reduce accidental load and simple browser-driven exhaustion; they do **not** provide per-user fairness, OS socket limits, strong authentication, guaranteed parse deadlines, or protection from arbitrary local processes. To serve other users, use a separately reviewed authenticated deployment profile rather than increasing these constants.

### Hardware memory-access boundary (T-0013)

The local backend constructs only the deterministic simulator; production PCAN/Vector session selection is not connected to its HTTP API. The standalone Rust `hardware_policy` module defaults to **memory reads only**: all ECU-memory write requests are denied for simulator, unknown and verified physical targets, with no runtime flag, stored project setting, or HTTP command to enable writing. Physical reads require independently verified identity; an ELF link-time address or browser claim does not count. Startup self-check and negative unit tests assert the default denial. This is a **pre-integration policy guard**: a future adapter/session factory and each write entry point must actually call the policy under an agreed interface; existing core CAN frame transmissions required for XCP *reads* are not ECU-memory calibration writes.

To introduce a physical ECU-memory write capability in a future ticket, require a reviewed session/transaction interface, verified adapter and ECU identity/capabilities, valid typed runtime address and writable resource state, explicit short-lived operator authorization for the exact change, interlocked safe operating state, a serialized write, readback verification and audit. Reconnecting/importing/reloading must always reset any authorization. Until all these controls, simulator fault tests and independent hardware-bench evidence exist, the policy deliberately has **no write-enable transition** and no production calibration commit endpoint.

A missing reply after a potentially transmitted write means **outcome unknown**. Neither connection loss, a timeout nor successful API rollback requests prove the original ECU value persisted. Do not retry or restore automatically without a verified fresh read and explicit transaction handling.

### Error disclosure and diagnostic exports

The legacy session routes now map session failure variants to fixed client-facing messages; ELF parse errors also return a constant validation message. The security middleware's errors use allowlisted generic messages and do not echo Host/Origin contents, local file paths, symbols, driver DLL messages, ECU memory or secrets. No automatic diagnostic export is implemented. Any future bugreport must use a strict *allowlist* (event code, time window and aggregate counters) rather than regex redaction of raw logs; exclude absolute paths, usernames, ECU identifiers, binary data, tokens, unredacted HTTP headers and adapter error text. Diagnostics export must require an explicit operator action and synthetic negative fixtures before release.

**Known gap:** the existing versioned simulator-read API still formats some core XCP failures in `crates/xcp-server/src/api/v1.rs`. That API/DTO owner must coordinate a safe error mapping before physical transports are introduced. This PR does not modify the versioned DTO owner or claim diagnostic bundle acceptance.

## 3. Calibration safety policy

1. On connect, import or workspace reopen, do not write ECU memory.
2. Default all real hardware connections to read-only, regardless of past project state.
3. A write requires verified hardware identity, variable type/location, permission, value range, explicit operator confirmation and a current session.
4. Serialize write with other XCP commands; read baseline, write, read back and compare using documented type semantics.
5. If a timeout happens after a write may have been transmitted, report **outcome unknown** until a fresh verified read; never assume rollback.
6. Any optional rollback is an explicit transaction with its own verified outcome and error handling.
7. Simulator write testing is mandatory but not sufficient for hardware write enablement.

## 4. Networking

- Do not bind on all interfaces to enable another browser or remote agent.
- Versioned remote deployment (later milestone) must have authenticated sessions, scoped access (read-only vs calibrate), per-session authorization, TLS or equivalent secure channel, allowed origins and audit logs.
- Avoid exposing files, absolute paths or device driver details in API errors.
- Disable unnecessary endpoints and rate-limit expensive file parses/memory requests.
- Avoid secrets in URL parameters or project file contents.

## 5. Fault-injection and validation

Required tests: malformed ELF/A2L, oversized request and WS config, repeated connection attempts, concurrent conflicting reads/writes, disconnected ECU during calibration, stale runtime pointer, negative XCP response, slow streaming client and disk full. T-0013 includes negative unit tests for Host/Origin/fetch metadata duplicates, HTTP length limits and quotas, WS config/address overflow, and denied hardware memory writes; existing shared-acquisition tests cover bounded broadcast lag. Actual streamed-upload stress, a full HTTP/WS integration load test, diagnostic bundle fixtures and hardware fault injection are **still pending**. Redact operator/ECU identity when exporting diagnostics.

Requirements: SEC-001..005, CAL-006..007. Tickets: T-0013, T-0007, T-0009. See [test strategy](test-strategy.md).
