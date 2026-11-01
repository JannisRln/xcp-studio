# Integration readiness review — PRs #48–#53 (2026-11-01)

**Scope:** feature PRs [#53](https://github.com/JannisRln/xcp-studio/pull/53), [#51](https://github.com/JannisRln/xcp-studio/pull/51), [#52](https://github.com/JannisRln/xcp-studio/pull/52), [#49](https://github.com/JannisRln/xcp-studio/pull/49), [#48](https://github.com/JannisRln/xcp-studio/pull/48), and [#50](https://github.com/JannisRln/xcp-studio/pull/50), in that preferred order. This document records **observed readiness, not a merge or acceptance certificate**. [#55](https://github.com/JannisRln/xcp-studio/pull/55) is explicitly excluded as an experimental native GUI.

## Exact source snapshot

- Verified `main` at review: `8014d82a8ef39c85a3c441a93206b605af0d2c71` ([commit](https://github.com/JannisRln/xcp-studio/commit/8014d82a8ef39c85a3c441a93206b605af0d2c71)); no feature PR from this batch was merged to `main` at the review.
- [#54](https://github.com/JannisRln/xcp-studio/pull/54) merged into the **branch for #53**, not into `main`, via `c6440783c3d9032460b4f1ecc5d4c549afcad6ed`.
- Each PR head below was fetched from GitHub rather than inferred from an earlier PR description.

| Order | PR / ticket | Checked head SHA | Windows CI on checked head | Acceptance boundary |
| --- | --- | --- | --- | --- |
| 1 | #53 / T-0006 | `c6440783c3d9032460b4f1ecc5d4c549afcad6ed` | [41340881302](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302): rust, frontend, docs, live-view-e2e **success** | Draft; no independent approval; T-0006 and release acceptance remain incomplete |
| 2 | #51 / T-0010 | `3c685dd5f553587b452bba4b976538777fb6d1f5` | [41329044049](https://github.com/JannisRln/xcp-studio/actions/runs/41329044049): all four jobs **success** | Isolated versioned format only; durable atomic save, UI hydration, reopen E2E outstanding |
| 3 | #52 / T-0016 | `010bd29474995c0391fe9b15c61c0c726b3764c0` | [41328648735](https://github.com/JannisRln/xcp-studio/actions/runs/41328648735): all four jobs **success** | Backend producer hooks absent; browser export is browser-only |
| 4 | #49 / T-0014 | `25977509dffe7cb4385cdb3a44f8b4355732cd2e` | [41329115548](https://github.com/JannisRln/xcp-studio/actions/runs/41329115548): all four jobs **success**, **but known security regression** | Blocking unresolved review thread: full root-object extent not checked in verified relocation mapping. Follow-up [#56](https://github.com/JannisRln/xcp-studio/pull/56) proposes a bounded fix and no-read regression |
| 5 | #48 / T-0008 | `52685f5867eedb8cac02ed9fa3419d659dfc198e` | [41328663020](https://github.com/JannisRln/xcp-studio/actions/runs/41328663020): all four jobs **success** | Read-only A2L core only; no runtime address authorization / write approval |
| 6 | #50 / T-0007 | `2d62fd58eed50407e0404a2b21ad13670c41148d` | [41328560359](https://github.com/JannisRln/xcp-studio/actions/runs/41328560359): all four jobs **success** | Mock-only calibration intent; no public write interface, real dispatch, or safety authorization |

Each listed green run is for an **individual feature head**. Their success alone was not combined evidence. A separate combined QA preview has subsequently passed (see below). The original PR descriptions may cite older heads; always refresh before merging.

## Browser E2E and benchmark evidence

- On #53's current head, [CI run 41340881302](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302), job `live-view-e2e`, passed the existing simulator/Vite/React browser E2E **and** the extended pause/reconnect/CSV/cursor E2E introduced through #54. The synthetic 20,000-frame rendering benchmark step and artifact upload also passed.
- [Benchmark artifact](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302/artifacts/13097084012): `xcp-uplot-20k-benchmark-windows`, artifact ID `13097084012`, SHA-256 digest `717d1c2129861b0f48f299c1acbc8e5a2da3f03f64f2d8a427a02115f7ee647e`, expires 2027-01-30 under current GitHub retention.
- [Browser screenshot artifact](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302/artifacts/13097465848): `xcp-live-view-windows`, artifact ID `13097465848`. Earlier stacked-PR #54 baseline artifacts are retained in [CI run 41337943929](https://github.com/JannisRln/xcp-studio/actions/runs/41337943929).
- These are browser/simulator and synthetic rendering results, **not** ECU DAQ rate, physical CAN throughput, hardware latency, or complete release/calibration E2E.

## Subsequent combined QA result — not a main merge

- [Draft QA PR #59](https://github.com/JannisRln/xcp-studio/pull/59) stages all six source feature heads, plus the **unmerged** blocking-review fix from #56, on current-main base `8014d82a8ef39c85a3c441a93206b605af0d2c71`. Combined QA commit: `e6851c02e544548059932289e6baa817705efacf`.
- [Windows CI 41342166969](https://github.com/JannisRln/xcp-studio/actions/runs/41342166969) completed **success** on that exact combined QA head: `rust` (format, Clippy, workspace tests), `frontend` (npm ci, build, Vitest), `docs` (validator), `live-view-e2e` (existing simulator/Vite/WS/React plus extended pause/reconnect/CSV/cursor browser scenarios, synthetic 20k benchmark).
- [Combined QA benchmark JSON](https://github.com/JannisRln/xcp-studio/actions/runs/41342166969/artifacts/13097781270): `xcp-uplot-20k-benchmark-windows`, ID `13097781270`, SHA-256 `f81fb07263fba509e2f5fb1a61b468f90b8df3f6ca3879436c122a8f69ca25e7`.
- [Combined QA screenshot](https://github.com/JannisRln/xcp-studio/actions/runs/41342166969/artifacts/13098185789): `xcp-live-view-windows`, ID `13098185789`, SHA-256 `f45b85ce09d65ff6bec068a1a4d483d461f7b8dfea2581fa05783df64817b031`. Artifacts are available until **2027-01-30** under current retention.
- The combined test proves the staged modules compile and the existing Windows automated simulator/browser suites pass together. It **does not** prove end-to-end backend diagnostic producer wiring, authenticated pointer-session reads, A2L/project hydration, durable save, physical ECU behavior or calibration write/readback. Those remain separately blocked.
- QA #59 remains **draft and must not be merged**: #49's independent review is unresolved and #56 is not merged back, while all six feature PRs lack documented independent approval. No PR in this batch has been merged into `main`.

## Review and merge blockers

1. GitHub review lists for #53/#51/#52/#48/#50 contained no submitted reviews; #49 had one **COMMENTED** author review and an unresolved blocking inline thread. There are **zero independent approvals** recorded for these six PRs at the snapshot. The author's review is not independent approval. #53 remains draft.
2. #49: `MemoryRegion::contains(link_address, 1)` only validates the root's first byte. A multi-byte pointer straddling the verified link/runtime mapping could be read from a wider approved region. Require full known nonzero root size within both mapping regions, checked arithmetic, negative no-read test, independently reviewed fix, then fresh green #49 CI. See [#56](https://github.com/JannisRln/xcp-studio/pull/56).
3. `crates/xcp-core/src/lib.rs` is edited by #49 (ecu), #48 (a2l), and #50 (calibration). The eventual integrated file **must retain all three exports and existing main content**; never replace it with one branch's copy.
4. `docs/tickets/INDEX.md` is edited by #51, #52, #49, #48, and #50. Carry forward each *narrow implementation phase* but do not mark overall BLOCKED requirements or ticket acceptance DONE. Avoid copying stale T-0004/T-0012/T-0013 context from older PR bases. The ticket files and index must agree following reviewed merges.
5. #53 includes a shared `.github/workflows/ci.yml` change (from #54). It must retain existing Windows jobs and upload measured benchmark evidence, not silently replace workflow settings.
6. GitHub's checked PR mergeability flags are not proof of up-to-date review or branch-protection compliance. Main governance/required-check enforcement and independent ownership decisions need verification. No calibration write policy may be relaxed to make tests pass.

## Authorized safe integration sequence (pending approvals)

For **each** PR, starting with #53 then #51, #52, #49, #48, #50:

1. Re-fetch `main`, PR head SHA, review threads, reviews and checks; confirm independent approval and safety signoff. Resolve #49's blocking finding first, via separately reviewed #56 or an equivalent verified fix.
2. Merge or rebase **main into a dedicated integration branch without force pushing**; preserve each developer's source branch and unrelated changes. Resolve `lib.rs` and `INDEX.md` additively; review the resulting diff. Do not rewrite public DTO/WS/session APIs as conflict fixes.
3. Run Windows Rust format/Clippy/tests, frontend build/tests, docs validator and the **existing plus extended** Live View E2E against the **new combined integration head**. Keep the 20k benchmark JSON/screenshot artifacts and precise CI run/head references.
4. Merge only with review and all required **current-head** checks successful; record final merge SHA and actual acceptance scope in the owning ticket and index.
5. After all six pass individual gates, run an additional **combined** simulator integration test matrix for versioned project import, diagnostic privacy, typed metadata/A2L, runtime-pointer rejection, acquisition/browser reconnect and mock-only calibration intents. Keep session single-owner and all ECU write gates closed.

## Unfinished functionality

- **T-0006:** browser chart/CSV enhancements do not deliver full backend recording/replay, ECU DAQ, hardware FPS, or release-wide T-0011 acceptance.
- **T-0010:** format validation/migration core does not implement atomic disk save or workspace reopen.
- **T-0016:** bounded event model without backend producers is not full structured end-to-end diagnostics.
- **T-0014:** safe isolated resolver is not an authenticated real ECU mapping, actor/reader or public signal mapping integration. The root-range security finding currently blocks #49.
- **T-0008:** isolated A2L metadata/conversion core is not a verified live runtime mapping.
- **T-0007:** mock-only planner is not a safe calibration write API or end-to-end readback.
- **T-0011/T-0012/T-0013:** release acceptance, explicit contract owner signoff and hardware safety gates remain separate requirements.

**Non-negotiable invariants:** never promote unverified ELF link-time addresses to ECU runtime; never add a second XCP session; never grant ECU write access or weaken `hardware_policy`; require documented owner agreement before any public REST/WS/schema or shared session change.

**No merge action is authorized by this note.** Merge commit IDs for the six feature PRs are *not available*, because none was merged at this snapshot.


## Release-owner verification and hard NO-GO — 2026-11-01

This section is a **fresh GitHub verification, not an integration merge**. As observed on 2026-11-01:
- Current \`main\` is still \`8014d82a8ef39c85a3c441a93206b605af0d2c71\`; its four Windows jobs passed in [run 41328558606](https://github.com/JannisRln/xcp-studio/actions/runs/41328558606). **Zero** of #53/#51/#52/#49/#48/#50 were merged. Therefore there are **no merge commit SHAs** for this batch and no post-feature-merge \`main\` CI evidence.
- **Active repository branch ruleset**: [Main, ID 26324325](https://github.com/JannisRln/xcp-studio/rules/26324325) targets \`refs/heads/main\` and contains \`deletion\`, \`non_fast_forward\`, and \`pull_request\`. It has \`required_approving_review_count: 0\`, \`dismiss_stale_reviews_on_push: false\`, \`required_review_thread_resolution: false\`, and **no \`required_status_checks\` rule**. \`main\` is marked protected by this ruleset; the older statement that there was no ruleset is superseded. The connected GitHub App can READ this ruleset but does not expose an administrator ruleset-update action. **An administrator must change it manually** via Settings → Rules → Rulesets → Main: require at least **one independent approving review**, dismiss stale reviews on push, require review-thread resolution, and require successful GitHub Actions checks **rust, frontend, docs, live-view-e2e** on a current/up-to-date merge candidate. Keep pull requests mandatory, deletion/non-fast-forward forbidden, and no bypass/direct pushes. Verify the saved JSON and a failing-check merge rejection before treating T-0001/#4 as accepted.
- Fresh GitHub review queries: **no approving reviews** on any of the six feature PRs, #56, #57, #58, #59 or #55. #49 has one AUTHOR \`COMMENTED\` review and the unresolved root-mapping security thread (thread ID \`PRRT_kwDOVeAIDM6ydgti\`). #53/#55/#58/#59 are still draft. GitHub mergeable=true is not authorization.
- #56 \`7def788547a5802ebf14bc158f943dbca93af42e\` passed [Windows CI 41341647935](https://github.com/JannisRln/xcp-studio/actions/runs/41341647935) on all four jobs. Its patch validates known nonzero complete root size in **both** relocation regions, checked 32-/64-bit arithmetic, and asserts \`InvalidMapping\` plus exactly zero memory reads for a root pointer that straddles the verified mapping despite a wider approved read region. **The security owner has not independently approved #56.** Do not merge #56 into #49 or resolve the #49 finding before that sign-off; then rerun all four Windows jobs on the NEW #49 head.
- The earlier current-head feature checks remain green: #53 [41340881302](https://github.com/JannisRln/xcp-studio/actions/runs/41340881302), #51 [41329044049](https://github.com/JannisRln/xcp-studio/actions/runs/41329044049), #52 [41328648735](https://github.com/JannisRln/xcp-studio/actions/runs/41328648735), #49 [41329115548](https://github.com/JannisRln/xcp-studio/actions/runs/41329115548), #48 [41328663020](https://github.com/JannisRln/xcp-studio/actions/runs/41328663020), #50 [41328560359](https://github.com/JannisRln/xcp-studio/actions/runs/41328560359). **All four jobs** on #59 combined QA-only snapshot \`e6851c02e544548059932289e6baa817705efacf\` also passed [41342166969](https://github.com/JannisRln/xcp-studio/actions/runs/41342166969). #59 must remain an unmerged QA reference, not a substitute for separately reviewed feature merges.
- Safety invariants and release holes remain: no public DTO/WS or shared session ownership changes without explicit owner sign-off; no second ECU session; never infer a runtime ECU address from ELF link-time addresses; keep hardware write policy deny; no hardware write or real ECU calibration claims. Unit tests and combined automated simulator/browser CI do not provide the still-missing integrated A2L → runtime identity → live conversion, project disk restore, producer-side diagnostics, pointer actor reader, or simulated write/readback release E2E.

### Actual native Windows artifact re-evaluation (PR #55 remains excluded)

Current native head \`f9a93c134e12a4778192bcf7d108539e36bbb3b9\`: [workflow 41343590307](https://github.com/JannisRln/xcp-studio/actions/runs/41343590307), [artifact 13098871096](https://github.com/JannisRln/xcp-studio/actions/runs/41343590307/artifacts/13098871096), ZIP SHA-256 \`7f256cb40c1d2733891dc143bc544a2a5ed89f33f538328d36e070092cfb0fb1\`. The actual artifact ZIP was inspected, not just the PR description. It contains \`xcp-native-benchmark-2000.json\`, \`xcp-native-benchmark-20000.json\`, \`react-uplot-2000.json\`, \`react-uplot-20000.json\`, \`windows-environment.json\`, both native Windows screenshots, and \`native-readonly-subscriber-e2e.json\`.

Both UIs were measured in this same Windows workflow (Windows Server 2025, AMD EPYC 7763, 4 logical CPUs) with 2 synthetic channels, 80 updates, identical 2,000/20,000 frame fixture and 1,400 visible points/lane:

| Dataset | React completed updates/s | Native completed updates/s | React observed animation FPS | Native observed callback pacing FPS |
| --- | ---: | ---: | ---: | ---: |
| 2,000 frames | 26.54 | 3.87 | 53.07 | 3.83 |
| 20,000 frames | 4.21 | 2.08 | 8.42 | 2.07 |

The native callback/pacing and browser rAF boundaries are not equivalent and process RSS cannot be compared to JS heap. Neither GPU-present timings nor real input-to-photon/usability metrics were collected. The native-only synthetic experiment is **not** a better-performance release justification. The actual read-only native subscriber artifact observed an existing \`acq-1\`, 1 subscriber, and \`singleSessionRemainedConnected: true\`; this is a simulator smoke test, not hardware or DAQ acceptance. **Decision: retain React/uPlot; keep #55 Draft, no migration.** The older native Intel-runner values and older QA #58 assertions about absence of native measurements are historical snapshots; this fresh artifact supersedes those statements where evidence differs.

### Release phase and status discipline

**NO-GO** for batch merges until independent approvals and enforceable repository gates exist. Preferred order stays #53 → #51 → #52 → #49 (only after reviewed #56 and new-head CI) → #48 → #50. After EACH authorized merge, refetch main and exact PR head and verify new-main Windows rust/frontend/docs/live-view-e2e. Resolve additive \`lib.rs\` exports (\`ecu\`, \`a2l\`, \`calibration\`) and \`docs/tickets/INDEX.md\` entries without clobbering; do not mark narrow core phases as full DONE. **Next development phase**, only after governance: independent reviews → #56 safety incorporation and #49 retest → sequenced integrations → real integrated simulator QA and T-0011/contract/identity/calibration acceptance. No feature development or hardware write enablement is authorized by this report.
