# GitHub Pages — XCP Studio Browser Demo

This is a **public-facing synthetic demo**, not an XCP ECU or CAN transport.

## What the preview does

The same React application, uPlot charts, moveable measurement windows and cursor tools run in a browser. A browser-only transport adapter implements the existing REST v1 and shared acquisition WebSocket contracts. It generates visibly changing demo signals (Engine speed and Coolant temperature), enforces one active acquisition per tab, and supports connect, start, stop and subscriber fanout.

The demo build is activated **only** by the explicit environment variable VITE_DEMO=1. Standard local development/builds continue to talk to the Rust backend through Vite. A prominent banner identifies synthetic values; there is no CAN access or ECU write.

Limitations:
- Browser tab reload resets the demo backend and its current acquisition.
- The demo is not ECU DAQ and does not establish hardware latency, sample reliability or real CPU benchmarks.
- ELF/DWARF processing requires the Rust backend and is unavailable in the Pages build.
- Chart rendering has bounded sample previews and does not record the complete stream.
- A static Pages website cannot run the Rust simulator process or server-side WebSocket.

## Build locally

From the repository root, with Node.js 22:

~~~sh
cd frontend
npm ci
VITE_DEMO=1 npm run build
npm run dev
~~~

The dev command does not inherit the demo flag on a new terminal. To run the demo locally, use VITE_DEMO=1 with the Vite dev command too (on PowerShell, set $env:VITE_DEMO='1'). For the deployed static bundle, Vite uses the /xcp-studio/ base path.

## Deployment

GitHub Actions workflow [live-demo-pages.yml](../.github/workflows/live-demo-pages.yml) builds the same app with VITE_DEMO=1, runs tests, and commits only frontend/dist files to the gh-pages branch. It runs on frontend changes merged into main, or via workflow_dispatch.

**Repository administration required:** at the time this work began, GitHub reported the private repository had has_pages=false. GitHub Pages does not become public merely by committing this workflow.

To activate, a repository administrator must open:
1. Repository **Settings → Pages**.
2. Under Build and deployment, choose **Deploy from a branch**, branch **gh-pages**, folder **/(root)**.
3. Save, and confirm the Pages deployment and resulting URL in GitHub's UI.
4. Only then share the verified URL. Pages may publish a public site even though the source repository is private; do not include secrets, ECU credentials, user data or private device logs in the demo.

Expected default GitHub Pages URL *after activation and successful deployment*: https://jannisrln.github.io/xcp-studio/ . Do not represent this expected URL as already live until an HTTP check confirms it.

## QA

- npm ci, TypeScript and frontend Vitest suite
- VITE_DEMO=1 production build and /xcp-studio/ asset-path check
- Demo backend API tests for connection, bounded memory reads, shared fanout and changing synthetic values
- uPlot array alignment, spike-preserving decimation and two-window layout bounds
- Existing Windows Rust CI remains separate; no Rust backend binaries are deployed to Pages
