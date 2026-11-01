# GitHub Pages — Interactive Live View Preview

The Pages preview runs the **real React measurement workspace** with an **in-browser synthetic acquisition backend**. It is designed for trying chart tools, zoom/pan, live signal display and cursor measurements without installing Rust, CAN hardware or a server.

## Preview URL

Once Pages is enabled and the deployment job succeeds:

**https://jannisrln.github.io/xcp-studio/**

This URL is not considered published until the GitHub Pages deployment completes. The private repository's Pages settings require administrator access and a plan that supports Pages for private repositories.

## Initial Pages enablement (repository administrator)

1. Open the repository's **Settings → Pages** section.
2. Under **Build and deployment**, choose **Source: GitHub Actions**.
3. Make sure this private repository's GitHub subscription supports GitHub Pages. GitHub Free supports Pages for public repositories; GitHub Pro/Team/Enterprise supports private repository source code.
4. The workflow [Deploy Live View Preview](../.github/workflows/deploy-preview.yml) runs on changes to `main` and can be started from Actions using **Run workflow**.

The workflow uses a dedicated Vite build mode (`vite build --mode pages`) and adds a `/xcp-studio/` asset base. Normal local development and production Rust-connected frontend builds are unchanged.

## Expected workflow

- The preview auto-connects a **browser-only demo ECU** and starts a live stream on load.
- Four locally generated signals change over time: Engine speed (rpm), Coolant temperature (°C), Torque (Nm), Throttle (%).
- The interface shows live delivery rate, newest-sample age, trend charts, signal cards, zoom/pan, and existing cursor tools if merged.
- Stop and restart acquisition, pause/resume the chart, change signal selection, inspect supported demo memory and export a **synthetic** recent-buffer CSV.
- No backend process is running on GitHub Pages. REST requests and WebSocket subscriptions are handled only inside that browser tab using the existing versioned JSON schema. Synthetic samples are **not XCP measurements**.
- A tab reload creates a new isolated demo. No CAN communication, physical ECU writes, long-term recording or persistent data storage occur.

## Build / test locally

From the repository root:

~~~bash
cd frontend
npm ci
npm test
npm run build -- --mode pages
~~~

The static site output is in `frontend/dist/`. For a local test of the built Pages mode, use a static server with the `/xcp-studio/` base path or rely on the GitHub Pages deployment.

## Security and performance boundary

This is a public **UI demonstration**. Do not expose real ECU communication or credentials via the static site. The demo installs the browser adapter only when `import.meta.env.MODE === "pages"`; `npm run dev` continues to proxy the actual Rust server at `127.0.0.1:8080`.

This demo is useful for chart responsiveness and interaction checks, but does **not** establish a measured 10 kHz ECU sample rate, 60 FPS performance certificate or network throughput guarantee. Those require dedicated benchmarks and physical targets.
