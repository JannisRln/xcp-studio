# Requirements (draft)

- Windows-first; no Docker for v0.1.
- Rust backend, React/TypeScript browser UI.
- CAN via PCAN-Basic and Vector XL Driver Library (VN1640A).
- XCP on CAN: read, write, calibration, DAQ.
- ELF/DWARF plus A2L; ARM, TriCore, extensible targets.
- Dynamic pointer-chain resolution; NULL and invalid address detection.
- Target up to 1 kHz where transport and ECU permit.
- Unit, integration, simulator, and hardware tests.
- Portable multi-version deployment; separate project configurations.

No hardware functionality is implemented in the initial scaffold.

## Traceable requirements and acceptance criteria

| ID | Priority | Requirement | Acceptance criterion |
| --- | --- | --- | --- |
| ECU-001 | P0 | Reject invalid ELF files and inspect named ELF symbols. | Automated tests cover valid and invalid inputs. |
| ECU-002 | P0 | Detect DWARF compilation units and absent debug data. | Stripped and debug-enabled fixtures are tested. |
| ECU-003 | P0 | Resolve primitive DWARF variable types and widths. | Signed/unsigned integers and floats are tested. |
| ECU-004 | P0 | Resolve typedefs, arrays, structs, members and pointers. | Nested fixture types resolve deterministically. |
| ECU-005 | P0 | Keep link-time and runtime ECU addresses distinct. | Unresolved addresses cannot trigger XCP reads. |
| ECU-006 | P1 | Report unsupported DWARF location expressions. | No guessed addresses are exposed as valid. |
| ECU-007 | P1 | Apply A2L conversion methods, scaling and units. | Raw and physical values are distinguished. |
| XCP-001 | P0 | Connect and disconnect a simulated XCP slave. | Lifecycle integration test passes. |
| MEAS-001 | P0 | Acquire timestamped typed ECU measurements. | Known simulator values and timestamps are tested. |
| MEAS-002 | P0 | Stream acquired values to the frontend. | Charts display received samples rather than synthetic values. |
| MEAS-003 | P0 | Export acquired samples. | Export matches buffered timestamps and values. |
| CAL-001 | P0 | Write and verify simulated calibration values. | Read-back matches the requested value. |
| CAN-001 | P1 | Configure and connect PCAN hardware. | Windows hardware test documented separately. |

Requirements are **not complete** until their acceptance tests pass. DWARF may be absent or optimized away; ELF symbols alone do not supply complete calibration metadata.
