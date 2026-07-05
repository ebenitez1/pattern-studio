import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // relative base so the same build works at / (local) and /pattern-studio/ (GitHub Pages)
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
  },
});
