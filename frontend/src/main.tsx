import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  const [health, setHealth] = React.useState("not checked");
  async function checkHealth() {
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setHealth(data.status + " (" + data.mode + ")");
    } catch (error) {
      setHealth("unavailable: " + String(error));
    }
  }
  return <main><h1>XCP Studio</h1><p>Windows-first development scaffold</p><button onClick={checkHealth}>Check backend</button><p>Backend: {health}</p></main>;
}
createRoot(document.getElementById("root")!).render(<App />);
