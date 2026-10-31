# XCP Studio

Windows-first Rust XCP measurement and calibration tool with React/TypeScript web UI.

Initial milestone: XCP simulator, CAN abstraction, ELF/DWARF pointer resolution, then PCAN and Vector VN1640A integration.

Status: early scaffold; hardware communication is not implemented yet.

## Developer setup and formatting

Install Rust via [rustup](https://rustup.rs/); `rust-toolchain.toml` installs the stable toolchain with `rustfmt` and `clippy`.

Enable the repository's pre-commit formatting check once per local clone:

```sh
chmod +x .githooks/pre-commit  # Git Bash, macOS or Linux; needed if the file is not executable
git config core.hooksPath .githooks
```

Before committing Rust changes, run:

```sh
cargo fmt --all
cargo fmt --all -- --check
cargo test --workspace
```

The pre-commit hook checks formatting and rejects unformatted commits; it deliberately does not modify files. CI runs `cargo fmt --all` in its temporary runner before tests. This does not commit formatted files back to GitHub. The local pre-commit hook still checks committed source formatting. GitHub API-created commits bypass local hooks, so their CI results must be verified before merging.
