# GitHub branch protection and CI policy

Applies to `main` of XCP Studio. The checks below are recommended repository settings and **are not automatically enabled by this document**. Repository administrators must configure rules under Settings → Rules → Rulesets (or Branch protection rules), then verify the settings.

## Required checks

Set the `main` ruleset to:
- Require a pull request before merging. Require at least one independent approving review for all changes, with explicit security/owner sign-off for XCP session handling, hardware operations, calibration, CI, and public schemas.
- Require passing GitHub Actions jobs **rust**, **frontend**, **docs**, and **live-view-e2e** from the current PR integration candidate.
- Require branches to be up to date before merging if needed to protect against integration conflicts.
- Prevent force pushes and branch deletion on `main`.
- Dismiss stale approvals when the PR changes after review; resolve review comments.
- Do not require the branch-pruning maintenance workflow as a PR check: it runs on `main` and does not validate changes.

An intentionally failing unit test or malformed ticket should make its corresponding CI job red and prevent merge if the required-check settings are active. Job naming is part of the ruleset contract: when renaming CI jobs, update the ruleset as well.

## Current workflow commands

```sh
# Rust CI (Windows; formatting changes remain inside the disposable runner)
cargo fmt --all
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend CI (Windows; requires a committed package-lock.json)
cd frontend
npm ci
npm run build
npm test

# Documentation CI (Windows)
python scripts/check_docs.py
```

The CI autoformat step changes only the runner workspace; it never commits or pushes Rust format changes. Locally `cargo fmt --all -- --check` and the provided pre-commit hook detect unformatted files. Clippy runs on the already formatted CI tree.

## Branch lifecycle and cleanup

Source branches may remain visible after squash merges. `.github/workflows/prune-merged-branches.yml` runs after pushes to `main` and may also be dispatched manually.

The cleanup job may delete a branch only when **all** these conditions hold:
1. The associated pull request was merged.
2. The PR's source repository is this repository, not a fork.
3. The name starts with `feat/`, `fix/`, `docs/`, or `chore/`.
4. The source branch is not `main`, is not protected, and has no open PR.
5. The branch's current head SHA matches the exact SHA that the merged PR used.

Changed/unmerged/protected branches are retained. No force push is performed. This is repository maintenance and requires the GitHub Actions token to have `contents: write` plus `pull-requests: read`. If a ruleset blocks branch deletion, adjust policy deliberately rather than bypassing protection.

## Reproducing a failed PR

1. Open the latest CI run from the PR's **current head SHA**.
2. Determine whether Rust, frontend, or docs failed; inspect the individual job logs.
3. Reproduce commands locally with matching Rust/Node versions and clean installed dependencies.
4. Commit the actual source fix, then wait for the new CI run. Prior green runs do not apply to the new commit.
5. Record the CI run ID and test evidence on the owning Markdown ticket.

Do not claim branch protection has been configured unless the ruleset is confirmed through settings or administrative API access. Do not merge PRs while checks are pending or failing.


## Verified active ruleset snapshot — 2026-11-01 (partially remediated)

[GitHub repository ruleset Main (ID 26324325)](https://github.com/JannisRln/xcp-studio/rules/26324325) is **active** on \`refs/heads/main\`. It enforces \`deletion\`, \`non_fast_forward\` and \`pull_request\`; no bypass actors are configured.

**Important update:** The API first showed 0 required reviews, no stale-review dismissal, unresolved threads allowed and no required CI checks. The ruleset was changed concurrently and re-verified with \`updated_at = 2026-11-01T21:09:40.766+01:00\`. Its **current** values are:

| Setting | Current verified GitHub state | Required final state |
| --- | --- | --- |
| PR before merge | enabled | keep enabled |
| Independent approving reviews | \`required_approving_review_count: 1\` | at least 1; ensure reviewer is not the author |
| Stale approval dismissal | \`dismiss_stale_reviews_on_push: true\` | keep enabled |
| Unresolved review threads | \`required_review_thread_resolution: true\` | keep enabled |
| Required GitHub Actions checks | \`rust\`, \`frontend\`, \`live-view-e2e\` (integration ID 15368) | **add \`docs\`** from GitHub Actions (same app) |
| Require branch up to date | \`strict_required_status_checks_policy: false\` | **set true**, or use an explicitly validated equivalent merge queue |
| Branch deletion / force-push | \`deletion\` and \`non_fast_forward\` rules | keep enabled |
| Direct \`main\` changes / bypass | PR required, bypass list empty | keep mandatory PR and no direct-write bypass |

**Remaining repository administrator actions (manual):**

1. Open **Settings → Rules → Rulesets → Main**. Under required status checks add exactly \`docs\` from GitHub Actions alongside the existing \`rust\`, \`frontend\`, and \`live-view-e2e\` job names. Do not add the branch-pruning maintenance workflow as a PR check.
2. Enable **Require branches to be up to date before merging** (\`strict_required_status_checks_policy: true\`) or an equivalent merge-queue policy that actually runs on the current merge candidate.
3. Save and verify the live \`GET /repos/JannisRln/xcp-studio/rulesets/26324325\` JSON, including all **four** required check names and freshness policy. Perform a non-bypassed test PR with a failing \`docs\` job, missing independent approval, or unresolved security thread and verify GitHub rejects merging.

The connected GitHub App can READ this ruleset but does not expose an administrative mutation action; **this documentation change has not altered enforcement**. Current checks/approval enforcement is now partially improved, but the release gate remains blocked by missing \`docs\`, merge-candidate freshness, and independent approvals on the six feature PRs. Keep [issue #4](https://github.com/JannisRln/xcp-studio/issues/4) open until these gaps and their negative tests are verified. [PR #56](https://github.com/JannisRln/xcp-studio/pull/56) also requires an independent security review and follow-up #49 CI.
