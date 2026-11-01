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
| HTTP API | Loopback bind; clear max request sizes and timeouts | Server binds 127.0.0.1:8080; ELF upload limit 32 MiB; T-0013 adds loopback Host and local Origin guard |
| ELF/DWARF/A2L | Size, recursion, section offset and location-expression limits | ELF size limit exists; parser must still be hardened |
| WebSocket | Origin policy, max message size, max clients, bounded queues, heartbeat and safe close | T-0013 adds local Origin guard and 16 KiB frame/message limits; shared acquisition has 16 subscriber/128-event limits, legacy connection quotas still pending |
| XCP session | Resource/capability checks, serialized commands, positive outcome verification | Prototype session is mutex-based and simulator-first |
| Hardware | Explicit physical target selection, read-only default, no simulation fallback | UI hardware selection not production-ready |
| Calibration | Preview, confirmation, range validation, readback, audit and unknown-result state | No guarded public write API yet |
| Storage | Atomic project saves, disk caps, redaction and no secrets | Versioned storage pending |
| Remote access | Authentication, authorization, TLS, CSRF/WS origin protection, threat review | **Do not expose remotely** before milestone |

### Browser origin and local Host policy (T-0013)

All API routes, including WebSocket upgrades, reject non-loopback Host headers and browser Origin values other than `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:8080`, `http://127.0.0.1:8080` (plus HTTPS on local port 5173 for TLS dev proxies). `Sec-Fetch-Site: cross-site` requests are denied. This reduces risks from malicious websites controlling a workstation's localhost API and DNS rebinding. CLI requests without an Origin are allowed only with a loopback Host header.

**Important:** Host/Origin policy is not authentication. If remote access, multi-user operation, non-default Vite ports, or a desktop WebView origin is needed, design a new, reviewed security profile rather than relaxing checks or binding to all interfaces. Protected physical ECU writes still require explicit user enablement and separate tests.

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

Required tests: malformed ELF/A2L, oversized request and WS config, repeated connection attempts, concurrent conflicting reads/writes, disconnected ECU during calibration, stale runtime pointer, negative XCP response, slow streaming client and disk full. Redact operator/ECU identity when exporting diagnostics.

Requirements: SEC-001..005, CAL-006..007. Tickets: T-0013, T-0007, T-0009. See [test strategy](test-strategy.md).
