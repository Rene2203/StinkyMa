import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Browser-Vorschau der Oberfläche mit Beispieldaten im Arbeitsspeicher (ohne Electron).
// Vorstufe für die spätere Server-Version.
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react()],
  server: { port: 5199 },
});
