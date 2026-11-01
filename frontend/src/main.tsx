import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./dashboard.css";
import "uplot/dist/uPlot.min.css";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

async function bootstrap() {
  // GitHub Pages runs the real React UI against an explicitly isolated browser simulator.
  if (import.meta.env.VITE_DEMO === "1") {
    const { installBrowserDemo } = await import("./demo/browserBackend");
    installBrowserDemo();
  }
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing #root element");
  createRoot(container).render(<React.StrictMode><App /></React.StrictMode>);
}

void bootstrap();
