import { defineConfig } from "@playwright/test";

// Startet die gebaute Windows-App (Electron) und klickt sich durch. Vorher: `npm run build`.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { trace: "retain-on-failure" },
  outputDir: "test-results",
});
