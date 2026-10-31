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
