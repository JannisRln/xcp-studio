# T-0008 — Isolated A2L core phase

## Parser and license evaluation (2026-11-01)

- [a2lfile](https://github.com/DanielT/a2lfile) 3.5.x: MIT OR Apache-2.0, active 3.5.0 release, ASAP2 up to 1.71, comprehensive MEASUREMENT, CHARACTERISTIC, COMPU_METHOD, RECORD_LAYOUT and A2ML/IF_DATA. **Selected** instead of inventing another ASAP2 grammar. Dependency is limited to xcp-core; Cargo.lock is not tracked in this repository.
- [a2l-parse](https://docs.rs/a2l-parse/0.1.0/a2l_parse/) 0.1.0 (2026-10): MIT OR Apache-2.0, zero-runtime-dependency core parser; early release and deliberately skips IF_DATA vendor extensions. Not selected for this phase.
- The parser is not an ECU memory accessor or authoritative runtime address provider. A2ML/IF_DATA generic trees are retained with validity flags; invalid vendor structures are not interpreted as XCP settings.

## Isolated phase (PR-only until reviewed)

Rust-only module: crates/xcp-core/src/a2l.rs. Entry points: parse_a2l, A2lModule::raw_to_physical, decode_raw, compare_to_dwarf.

- Bounded input (8 MiB) and objects (20,000); malformed syntax yields typed errors; reject /include rather than accessing arbitrary files.
- Preserve per-module methods, record-layout FNC_VALUES type/position, measurements and characteristics, declared byte order and address extension; decode scalar VALUE characteristics only.
- Support IDENTICAL/NO_COMPU_METHOD, LINEAR scaling/offset and invertible linear RAT_FUNC. RAT_FUNC coefficients map physical to internal; its inverse is used for raw-to-physical.
- Unsupported nonlinear rational, formula/table/text conversions report errors. Check physical bounds; no display-format rounding, no 64-bit integer approximation and no float16 guessing.
- Compare A2L and DWARF type kind/width and ELF link-time addresses, returning diagnostics without mutation. Matching values do not establish runtime ECU address safety.
- No XCP I/O, calibration writes, REST/WS DTOs, frontend, actor, hardware test or runtime address promotion.

## Follow-up and blockers

The full T-0008 stays dependent on T-0003. Canonical metadata mapping must be coordinated with T-0003 and public contracts with T-0012 before integration. UI import, trustworthy XCP IF_DATA extraction with vendor A2ML fixtures, tables, formulae, axes/maps, exact 64-bit integer numeric semantics and runtime-location validation remain outside this PR. A2L addresses stay non-actionable until independently verified.

Expected evidence on the PR head: Windows cargo fmt/check/clippy/test, frontend build/tests and docs validator. No Rust toolchain or physical ECU bench was available locally during authoring.
