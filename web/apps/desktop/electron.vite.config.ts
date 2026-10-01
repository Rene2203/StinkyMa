import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

// Main- und Preload-Prozess: Abhängigkeiten aus "dependencies" (better-sqlite3) bleiben extern,
// die eigenen Pakete (@stinkyma/*, TypeScript-Quellen) werden eingebündelt.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/preload/index.ts") } },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") } },
  },
});
