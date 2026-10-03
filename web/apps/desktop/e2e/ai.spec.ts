import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { removeQuietly } from "./helpers";

// KI in der echten App: Optionen → KI zeigt die Modelle. Mit STINKYMA_E2E_MODEL (Pfad zu einer GGUF-Datei) zusätzlich
// eine echte Zusammenfassung mit llama.cpp im Electron-Hauptprozess. Die Datei wird als „Qwen 3.5 2B“ eingehängt:
// lokal das echte Modell, in der Windows-CI ein winziges Testmodell (prüft den Ablauf, nicht die Qualität).

const screenshotDir = join(__dirname, "..", "test-results", "screenshots");
const modelFile = process.env.STINKYMA_E2E_MODEL;
/** Das winzige CI-Modell schreibt Unsinn und kann am Längenlimit scheitern – dann zählt nur, dass der Ablauf durchläuft. */
const tinyModel = modelFile ? basename(modelFile).startsWith("stories") : false;
let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.beforeAll(async () => {
  mkdirSync(screenshotDir, { recursive: true });
  dataDir = mkdtempSync(join(tmpdir(), "stinkyma-e2e-ai-"));
  if (modelFile) {
    const folder = join(dataDir, "models", "qwen-3.5-2b-q4");
    mkdirSync(folder, { recursive: true });
    const target = join(folder, "Qwen3.5-2B-Q4_K_M.gguf");
    // Unter Windows kopieren (Symlinks brauchen dort besondere Rechte)
    if (process.platform === "win32") copyFileSync(modelFile, target);
    else symlinkSync(modelFile, target);
  }
  const args = [join(__dirname, ".."), "--lang=de-DE"];
  if (process.platform === "linux") args.push("--no-sandbox");
  app = await electron.launch({ args, env: { ...process.env, STINKYMA_DB: join(dataDir, "e2e.sqlite"), STINKYMA_USER_DATA: dataDir, LANG: "de_DE.UTF-8" } });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  removeQuietly(dataDir);
});

test("KI: Modelle in den Optionen, Zusammenfassung auf diesem Gerät", async () => {
  await expect(page.getByTestId("message-row").first()).toBeVisible({ timeout: 15_000 });

  await test.step("Optionen → KI: Modelle mit Größe, ohne Modell kein Zusammenfassen-Knopf", async () => {
    await expect(page.getByTestId("action-summarize")).toHaveCount(0);
    await page.getByTestId("open-options").click();
    const section = page.getByTestId("ai-section");
    await expect(section).toBeVisible();
    await expect(section.getByTestId("ai-model")).toHaveCount(4);
    await expect(section.getByText("Gemma 4 E2B", { exact: false }).first()).toBeVisible();
    await expect(section.getByText("Qwen 3.5 2B", { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId("ai-enabled")).not.toBeChecked();
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDir, "15-Optionen-KI.png") });
  });

  test.skip(!modelFile, "Ohne STINKYMA_E2E_MODEL keine echte Zusammenfassung");

  await test.step("Modell verwenden (schaltet die KI ein)", async () => {
    const row = page.locator('[data-testid="ai-model"][data-model="qwen-3.5-2b-q4"]');
    await row.getByTestId("ai-model-use").click();
    await expect(row.getByText("In Benutzung")).toBeVisible();
    await expect(page.getByTestId("ai-enabled")).toBeChecked();
    await page.getByRole("button", { name: "Fertig" }).click();
  });

  await test.step("Zusammenfassen: Ergebnis mit Herkunft „auf diesem Gerät“", async () => {
    await page.getByTestId("message-row").first().click();
    await page.getByTestId("action-summarize").click();
    const card = page.getByTestId("summary-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-busy", "false", { timeout: 180_000 });
    await page.screenshot({ path: join(screenshotDir, "16-Zusammenfassung.png") });
    if (tinyModel && (await card.getByRole("alert").count()) > 0) return;
    await expect(card.getByTestId("summary-text")).not.toBeEmpty();
    await expect(card.getByText("Auf diesem Gerät berechnet", { exact: false })).toBeVisible();
  });

  await test.step("Antwortvorschläge: nur auf Klick, Übernehmen öffnet die Antwort (nichts wird gesendet)", async () => {
    await page.getByTestId("action-replies").click();
    const card = page.getByTestId("replies-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-busy", "false", { timeout: 180_000 });
    // Das winzige Testmodell schreibt Unsinn – den filtert die Prüfung weg; dann steht ein Hinweis da
    if (tinyModel && (await card.getByTestId("reply-option").count()) === 0) return;
    await expect(card.getByTestId("reply-option").first()).toBeVisible();
    await page.screenshot({ path: join(screenshotDir, "25-Antwortvorschlaege.png") });
    await card.getByTestId("reply-option").first().click();
    await expect(page.getByTestId("compose-send")).toBeVisible();
    await page.getByTestId("compose-discard").click();
    const confirm = page.getByTestId("compose-confirm-discard");
    if (await confirm.isVisible()) await confirm.click();
    await expect(page.getByTestId("compose-send")).toHaveCount(0);
  });

  await test.step("Autovervollständigung: grauer Vorschlag nach Tipppause, Tab übernimmt, Esc verwirft", async () => {
    await page.getByTestId("compose-new").click();
    const body = page.getByTestId("compose-body");
    await body.click();
    await page.keyboard.type("Hallo Tom,");
    await page.keyboard.press("Enter");
    await page.keyboard.type("vielen Dank für deine Einladung zum Grillabend. Ich komme ");
    const ghost = page.getByTestId("ghost-text");
    // Das winzige Testmodell liefert oft nichts Brauchbares – dann gibt es eben keinen Vorschlag
    const shown = await ghost.waitFor({ timeout: 120_000 }).then(() => true, () => false);
    if (!tinyModel) expect(shown).toBe(true);
    if (shown) {
      const suggestion = (await ghost.textContent()) ?? "";
      await page.screenshot({ path: join(screenshotDir, "39-Autovervollstaendigung.png") });
      await page.keyboard.press("Tab");
      await expect(ghost).toHaveCount(0);
      await expect(body).toContainText(`Ich komme ${suggestion.trim()}`);
      // Weitertippen verwirft einen neuen Vorschlag sofort
      await page.keyboard.type(" ");
      await page.keyboard.type("x");
      await expect(ghost).toHaveCount(0);
    }
    await page.getByTestId("compose-discard").click();
    const confirm = page.getByTestId("compose-confirm-discard");
    if (await confirm.isVisible()) await confirm.click();
    await expect(page.getByTestId("compose-send")).toHaveCount(0);
  });

  if (tinyModel) return;
  await test.step("Gespeichert: beim erneuten Öffnen sofort da", async () => {
    await page.getByTestId("message-row").nth(1).click();
    await page.getByTestId("message-row").first().click();
    await expect(page.getByTestId("summary-text")).not.toBeEmpty();
  });
});
