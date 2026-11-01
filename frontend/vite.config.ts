import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  // GitHub Pages hosts project sites below /<repository>/, unlike local Vite.
  base: mode === "pages" ? "/xcp-studio/" : "/",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
