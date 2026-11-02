# Project file core (T-0010, isolated phase)

This folder defines a portable, versioned JSON document for XCP Studio. It is a **pure
import/export and validation module**. It does not integrate with AppShell, Live View,
backend sessions or the shared API DTOs. Loading has no connection, read, write,
recording, filesystem or acquisition side effects.

## Version 2 (current)

The document has the literal `format: "xcp-studio-project"` and
`schemaVersion: 2`. Required properties:

- `name`: project title.
- `ecuFiles`: ELF/A2L records, each with a project-local ID, kind, **basename**,
  lowercase SHA-256 and byte count; optional build ID. A basename is a display
  hint, not a trusted search path or identity.
- `signals`: stable IDs, display names, source provenance, file ID and variable
  path for ELF/A2L, typed raw value and endianness, unit and enabled flag.
  Explicit manual signals may contain `manualAddressHex`, an **unverified
  operator-provided** address; ELF/A2L signals may not contain saved runtime
  addresses or link-time addresses.
- `charts`: chart IDs, labels, signal IDs, time ranges and legend visibility.
- `measurementWindows`: window IDs, labels, chart IDs and visibility state.
- `chartLayout`: column count and explicit window positions/sizes.
- `acquisitionPresets`: named signal sets, sampling strategy, interval and a
  bounded recording preference. This is configuration, not recorded samples.
- `connectionProfiles`: simulator/PCAN/Vector names, optional adapter/channel
  hints, bitrate and CAN IDs. Credential, password, token, certificate, private
  key, arbitrary opaque options and embedded secrets are not supported.

All fields are validated at import **and export**; extra keys are rejected rather
than silently discarded. Identifiers and references are unique/consistent.
Project text is limited to **2 MiB UTF-8**, with independent array, length and
integer bounds. File imports enforce the size limit before and after reading.
No external schema library or shared runtime DTO dependency is introduced.

## Compatibility and migration

- **v2**: validated and returned as-is, with stable canonical JSON formatting.
  Export always uses fixed field order, two-space indentation and a final newline.
- **v1**: supported as an explicitly defined compatibility fixture. It has the
  same fields except `measurementWindows` and `chartLayout`; instead it uses
  `columns` plus `windows` with each window's `x/y/w/h`. Import validates
  every old field and safely splits window content and position into v2.
  The returned `migration: { from: 1, to: 2 }` and `MIGRATED` warning allow
  UI preview; migration does **not** rewrite the source file automatically.
  This is a testable initial compatibility contract, not a claim that production
  versions of XCP Studio previously shipped a v1 project format.
- **v0, v3+ and unknown versions**: `UNSUPPORTED_VERSION` without conversion.
- Invalid JSON, unexpected fields, references, secret-shaped fields and out-of-
  bound values: explicit `ProjectFileError`; never silently coerce/repair.

Use `importProject(json, observedFiles?)`, `importProjectFile(file, observedFiles?)`,
`exportProject(document)` and `reconcileEcuFiles(document, observedFiles)`.
The result includes structured warnings and `blockedSignalIds`. If a referenced
ELF/A2L is missing or its kind/SHA-256/size differs, **every dependent signal
is blocked pending manual reconciliation**; a matching basename is insufficient.
Passing no observed files emits **UNVERIFIED_ECU_FILE** warnings and blocks all
file-backed signals. It does not authorize reads until identity checks succeed. The integration layer
must treat all imported file-backed runtime locations as unresolved until
verified by the authoritative backend/session. Never use project import as
permission to issue ECU reads or calibration writes.

## Scope still open before T-0010 acceptance

- An atomic **durable** project save needs a backend or another explicitly
  negotiated atomic writer with temp-file, fsync and rename semantics. Browser
  Blob downloads do **not** guarantee atomic writes; this core exports JSON
  only. Disk-write fault-injection tests remain pending.
- No AppShell project picker, unsaved-edit tracking, Live View restoration,
  window render/hydration or browser E2E reopen test is part of this phase.
- The actual file picker must provide validated fingerprint observations and
  gate reads. No automatic remapping of ELF/DWARF source locations.
- Shared API/DTO integration needs coordination with T-0012 and ownership review.
- The phase's Vitest tests cover roundtrip, migration, bounds, invalid formats,
  cross-references, secret keys, corrupt files and stale/missing fingerprints.
