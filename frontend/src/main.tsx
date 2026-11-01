import { installBrowserDemo } from "./demo/browserDemo";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./dashboard.css";

// Only the GitHub Pages build provides synthetic, browser-local API/WS responses.
if (import.meta.env.MODE === "pages") installBrowserDemo();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
createRoot(container).render(<React.StrictMode><App /></React.StrictMode>);
