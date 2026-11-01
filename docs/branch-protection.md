# GitHub branch protection and CI policy

Applies to `main` of XCP Studio. The checks below are recommended repository settings and **are not automatically enabled by this document**. Repository administrators must configure rules under Settings → Rules → Rulesets (or Branch protection rules), then verify the settings.

## Required checks

Set the `main` ruleset to:
- Require a pull request before merging. Prefer one independent approving review for changes to XCP session handling, hardware operations, calibration, CI, and public schemas.
- Require passing GitHub Actions jobs **rust**, **frontend**, and **docs** from the latest PR head commit.
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
