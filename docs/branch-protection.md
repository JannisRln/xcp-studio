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


## Verified active ruleset snapshot — 2026-11-01 (release blocker)

[GitHub repository ruleset Main (ID 26324325)](https://github.com/JannisRln/xcp-studio/rules/26324325) is **active** on \`refs/heads/main\`, and enforces \`deletion\`, \`non_fast_forward\` and \`pull_request\` prohibitions. Despite \`main\` being marked protected, this ruleset currently has:
- \`required_approving_review_count: 0\`;
- \`dismiss_stale_reviews_on_push: false\`;
- \`required_review_thread_resolution: false\`;
- **no required-status-checks rule**.

This is **not** satisfactory release enforcement. The old historical claim that the repository had no active ruleset is obsolete. The connected GitHub integration can read the ruleset but cannot edit repository administration settings; this section is not proof that the correction was applied.

**Repository administrator action (manual):**

1. Open **Settings → Rules → Rulesets → Main** for this repository. Keep scope \`refs/heads/main\`, **active**, require a PR for merging, forbid branch deletion and non-fast-forward pushes, and ensure no bypass allows direct pushes to \`main\`.
2. Under **Require a pull request before merging**, set **required approvals = 1**, enable **dismiss stale approvals on new commits**, and enable **require conversation resolution before merging**. Ensure the approving reviewer is independent of the contributor; a self-review/comment is not approval. Require new approval after substantive changes.
3. Add **Require status checks to pass** with four exact job names: \`rust\`, \`frontend\`, \`docs\`, \`live-view-e2e\` (GitHub Actions; choose the correct check-app provider, not a similarly named external status). Enable **Require branches to be up to date before merging** or an equivalent tested merge-queue policy so old green PR-head checks do not substitute for current integration results.
4. Save; re-fetch \`GET /repos/JannisRln/xcp-studio/rulesets/26324325\` to verify \`required_approving_review_count >= 1\`, \`dismiss_stale_reviews_on_push: true\`, \`required_review_thread_resolution: true\` and a \`required_status_checks\` rule containing exactly the four checks. Verify a PR with an intentionally failing job or unresolved review cannot merge, without bypassing this policy.

**Do not merge** pending feature PRs solely because the existing ruleset is active or their standalone CI is green. Record administrator validation and tested enforcement on [issue #4](https://github.com/JannisRln/xcp-studio/issues/4). Separate pending independent security review for [#56](https://github.com/JannisRln/xcp-studio/pull/56) and unresolved [#49](https://github.com/JannisRln/xcp-studio/pull/49) finding must also close before the pointer feature is integrated.
