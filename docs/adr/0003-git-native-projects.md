# ADR 0003 — Git-native, migratable XCP Studio projects

**Status:** Proposed — requires T-0010 owner and integration review before schema implementation.  
**Date:** 2026-11-01  
**Related:** T-0010 (PROJ-001..PROJ-010, UI-006), T-0012, T-0008, T-0014, T-0006, issue #13.

## Context

Project files are a primary engineering artifact, not an opaque application cache. Engineers must be able to keep ECU workspace configuration in ordinary Git repositories, review precise changes in pull requests, resolve independent edits, revert a single change, and reopen the same project with future versions of XCP Studio. Git must remain optional: the application should read/write files without a Git installation or account.

PR #51 provides an isolated, strictly validated, deterministically serialized JSON v2 document and a non-destructive v1-to-v2 in-memory migration. This is a useful compatibility baseline, **not** a completed Git-native workspace: it lacks persistent atomic saving, UI reopening, fine-grained change isolation, migration previews of persistent files, and multi-author conflict tests. No public project format has yet been released.

## Decision proposed

1. **Plain-text, repository-friendly canonical storage.** Prefer a directory workspace with a small versioned manifest and individually addressable, UTF-8, canonical JSON files for independently edited entities (signals, charts/windows, acquisition presets). Example *illustration*, **not a frozen layout or wire contract**:

   ```text
   engine.xcpstudio/
     project.json
     signals/
       rpm.json
       coolant-temperature.json
     views/
       live-engine.json
     presets/
       dyno-run.json
   ```

   Retain the PR #51 single-file JSON import/export as a supported portable interchange and migration source; do not silently reinterpret its v1/v2 schema as the proposed multi-file layout. Freeze directory names and version fields only after an explicit format design and fixtures are reviewed.

2. **Semantic, stable diffs.** Stable persistent entity IDs, deterministic key order, LF line endings, two-space indentation, trailing newline, normalized value representation, and no volatile runtime state, timestamps, random reordering, absolute device paths, credentials or temporary session IDs in tracked configuration. Sort semantically unordered entities deterministically; preserve meaningful display/signal order in explicit ordered-ID lists. Saving an unchanged project must yield a byte-identical tree. Changing one signal should normally alter only its own entity file; formatting-only rewrites are unacceptable.

3. **Predictable merge behavior.** Two independent changes to disjoint entity files should merge cleanly in Git. Do not claim to automatically resolve concurrent edits to the same semantic field: detect Git conflict markers, duplicate IDs, missing references and semantic conflicts, then fail validation with precise file/field diagnostics. Supply a CLI or offline validation command suitable for CI/pre-commit use, without ECU access.

4. **Versioned migrations as first-class operations.** Explicit schema version(s), published migration chain and golden fixtures for each supported old→current transition; deterministic and idempotent results; clear unsupported-newer-version handling. A migration first parses and validates *all* input, computes a preview with changed/added/removed files and semantic impact, and requires confirmation before writing. Never silently discard unknown fields. Preserve an untouched source/backup or provide an equivalent verifiable rollback mechanism. A failed migration must leave the original workspace usable.

5. **Crash-safe persistence.** Protect against interrupted writes, disk-full, rename failures, partial directory updates, symlinks and path traversal. Per-file rename alone is not a transaction across a directory: choose and test a coherent commit/staging/journal or generation-manifest strategy before claiming multi-file atomicity. Read/validate everything before changing application state; failed save must not destroy the last verified project.

6. **Security, provenance and machine portability.** Persist ELF/A2L references with fingerprints and portable logical identities; avoid environment-dependent absolute paths and embedded large/binary measurement streams. Keep recordings and machine-local adapter preferences outside Git by default, with documented ignore rules. Missing/modified/ambiguous ELF/A2L identities and stale ECU session/mapping IDs must fail closed; loading or migrating a project must never connect, read, resolve link-time addresses to runtime, write ECU memory or authorize calibration.

7. **Separation of concerns.** The project format is a stable portable domain artifact. The React UI, optional native egui UI, and REST/WS DTOs are adapters; no independent or incompatible GUI-owned project schema. Any new common DTO/schema change needs T-0012 coordination. No built-in Git commit, push or user credential handling is required for this milestone.

## Alternatives considered

- **One canonical JSON file only:** simplest storage and already prototyped by PR #51, but shared arrays/layout create noisy diffs and overlapping merge conflicts as a workspace grows. Retain as portable exchange.
- **YAML/TOML:** human-readable, but parsing/round-trip normalization and ambiguous/unsupported constructs complicate strict validation and stable migration. Do not choose merely for aesthetics.
- **SQLite or opaque binary project bundle:** suitable for large live recordings, not as canonical reviewable Git configuration.
- **Automatically rewrite to the newest schema on load:** rejected because it creates surprise diffs, potential data loss and non-reproducible changes.

## Consequences

The format and migration tooling become a **P0 product-quality gate**. The proposed directory layout adds validator, migration, save transaction and portability work. This is intentional: useful Git history, reviewability and long-lived compatibility are differentiating product behavior. Do not delay basic Live View correctness to implement Git remote features; ship a minimal canonical project lifecycle with tested migrations and safe fallback.

Changing the proposed layout must be explicit in a reviewed ADR update. The merged isolated core from PR #51 is **not superseded** by this documentation decision; the proposed canonical multi-file layout is not implemented or accepted.

## Migration strategy

1. Review PR #51 against the Git-native goals; preserve its safe legacy v1/v2 import, strict validation and ECU fingerprint safeguards.
2. Define format v3 (or a separately versioned directory format) with a formal manifest, examples, stable IDs and mapping from the single-file model. Do not reuse version 2 to describe incompatible content.
3. Add a deterministic serializer/loader and read-only `validate` and `migrate --dry-run` operations; test roundtrips and semantic diffs before real writes.
4. Implement confirmed migration and crash-safe directory save with rollback/backup strategy.
5. Integrate safe Save/Open/Migration Preview into the currently selected UI; test both fresh and legacy fixtures.
6. Test two-branch disjoint edits, same-entity conflicts, Git conflict markers, missing references, unsupported future schemas, corrupt/truncated JSON, symlink traversal, disk-full/interrupted save, stale ELF/A2L and secret redaction.

## Tests / acceptance

- Unchanged load→save has **zero Git diff**; repeated migration produces identical bytes.
- Adding/changing a signal has a small, understandable diff; two independent signals can be merged without a whole-workspace rewrite.
- Schema change v1→v2→new format has checked-in golden fixtures, a readable preview and a reversible/non-destructive path; no silent field loss.
- A conflicted/invalid project is rejected without partial restoration or ECU I/O.
- A simulated power-loss/disk-error at every persistence stage preserves the prior verified workspace or a documented recoverable generation.
- The same tracked project opens on another machine after external file relocation, requiring deliberate fingerprint reconciliation rather than an unsafe automatic remap.
- A repository check validates project files offline in Windows CI, including a negative mutation fixture.

**Status note:** These are target requirements, not claims about present implementation or PR #51 passing them.
