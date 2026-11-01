import { defineConfig, loadEnv } from "vite";

// VITE_DEMO is injected by the GitHub Pages build, never in the ECU build.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
  base: env.VITE_DEMO === "1" ? "/xcp-studio/" : "/",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  };
});
