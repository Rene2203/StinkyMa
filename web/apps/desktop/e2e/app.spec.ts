import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectScrollable, removeQuietly } from "./helpers";

// Abnahme Phase W1: App startet, zeigt den Mock-Posteingang, Navigation und Aktionen funktionieren.
// Screenshots landen in test-results/screenshots (CI lädt sie als Artefakt hoch).

const screenshotDir = join(__dirname, "..", "test-results", "screenshots");
let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.beforeAll(async () => {
  mkdirSync(screenshotDir, { recursive: true });
  dataDir = mkdtempSync(join(tmpdir(), "stinkyma-e2e-"));
  // Deutsche Oberfläche unabhängig von der Sprache des Test-Rechners.
  const args = [join(__dirname, ".."), "--lang=de-DE"];
  // Im Linux-Container läuft alles als root; dort braucht Chromium --no-sandbox. Unter Windows nicht nötig.
  if (process.platform === "linux") args.push("--no-sandbox");
  app = await electron.launch({
    args,
    env: { ...process.env, STINKYMA_DB: join(dataDir, "e2e.sqlite"), STINKYMA_USER_DATA: dataDir, LANG: "de_DE.UTF-8" },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  removeQuietly(dataDir);
});

const shot = (name: string) => page.screenshot({ path: join(screenshotDir, `${name}.png`) });
const rows = () => page.getByTestId("message-row");

test("Mock-Posteingang, Navigation und Aktionen", async () => {
  // 1. Gemeinsamer Posteingang
  await expect(rows().first()).toBeVisible({ timeout: 15_000 });
  expect(await rows().count()).toBeGreaterThan(10);
  await expect(page.getByRole("heading", { name: "Alle Posteingänge" })).toBeVisible();
  await shot("01-Posteingang");
  await expectScrollable(page, ".rows");

  // 2. Mail öffnen → Konversation, Ungelesen-Zähler sinkt
  const unifiedBadge = page.getByTestId("sidebar-unifiedInbox").locator(".badge");
  const before = Number(await unifiedBadge.textContent());
  const firstUnread = page.locator('[data-testid="message-row"].unread').first();
  const subject = (await firstUnread.locator(".row-subject").textContent()) ?? "";
  await firstUnread.click();
  await expect(page.getByTestId("thread-subject")).toHaveText(subject);
  await expect(unifiedBadge).toHaveText(String(before - 1));
  await shot("02-Konversation");

  // 3. Seitenleiste: „Markiert“
  await page.getByTestId("sidebar-flagged").click();
  await expect(page.getByRole("heading", { name: "Markiert", level: 2 })).toBeVisible();
  await expect(rows()).toHaveCount(2);
  await shot("03-Markiert");

  // 4. Ordner eines Kontos
  await page.getByTestId("sidebar-mailbox-mock-gmail-inbox").click();
  await expect(rows()).toHaveCount(4);
  await shot("04-Gmail-Posteingang");

  // 5. Tastatur: ↓ wählt die erste Mail, E archiviert sie
  await page.getByTestId("sidebar-unifiedInbox").click();
  const countBefore = await rows().count();
  await page.locator("body").press("ArrowDown");
  await expect(page.getByTestId("thread-subject")).toBeVisible();
  await page.locator("body").press("e");
  await expect(rows()).toHaveCount(countBefore - 1);

  // 6. Rechtsklick-Menü
  await rows().first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await shot("05-Kontextmenue");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // 7. Suche
  await page.getByRole("searchbox").fill("nebenkosten");
  await expect(rows()).toHaveCount(1);
  await shot("06-Suche");
});

test("Phishing-Warnung mit Gründen; Kennzeichen in der Liste", async () => {
  await page.getByRole("searchbox").fill("");
  await page.getByTestId("sidebar-unifiedInbox").click();
  const row = rows().filter({ hasText: "Dringend: Ihr Konto wurde gesperrt" });
  await expect(row.getByTestId("row-phishing")).toBeVisible();
  await row.click();
  const banner = page.getByTestId("phishing-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Betrugsmail");
  await expect(banner).toContainText("innerhalb von 24 Stunden");
  await shot("22-Phishing-Warnung");
  // Harmlose Mail: keine Warnung
  await rows().filter({ hasText: "Ihre Abschlagsrechnung Oktober" }).click();
  await expect(page.getByTestId("phishing-banner")).toHaveCount(0);
});

test("Zu tun: Zahlung erkannt (ohne KI-Modell), Erinnerung setzen, erledigt", async () => {
  await page.getByRole("searchbox").fill("");
  await page.getByTestId("sidebar-unifiedInbox").click();
  await rows().filter({ hasText: "Ihre Abschlagsrechnung Oktober" }).click();
  const card = page.getByTestId("actions-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("86,00 €");
  await expect(card).toContainText("einfach erkannt");
  await card.getByTestId("action-remind").click();
  await card.getByTestId("reminder-option").first().click();
  await expect(card.getByText(/Erinnerung/)).toBeVisible();
  await shot("21-Zu-tun");
  await card.getByTestId("action-done").click();
  await expect(card.locator(".action-row.done")).toHaveCount(1);
});

test("Tagesüberblick ohne KI: wichtige neue Mails, Klick öffnet die Mail", async () => {
  await page.getByTestId("open-digest").click();
  const dialog = page.getByTestId("digest-dialog");
  await expect(dialog).toBeVisible();
  const important = dialog.getByTestId("digest-important");
  await expect(important.getByTestId("digest-row").first()).toBeVisible();
  await page.screenshot({ path: join(screenshotDir, "26-Tagesueberblick.png") });
  const subject = (await important.getByTestId("digest-row").first().locator(".digest-main .small").textContent()) ?? "";
  await important.getByTestId("digest-row").first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("thread-subject")).toHaveText(subject);
});

test("Änderungen bleiben nach Neustart erhalten (SQLite-Datei)", async () => {
  await page.getByRole("searchbox").fill("");
  await page.getByTestId("sidebar-unifiedInbox").click();
  const inboxCount = await rows().count();
  const unread = await page.getByTestId("sidebar-unifiedInbox").locator(".badge").textContent();

  await app.close();
  const args = [join(__dirname, ".."), "--lang=de-DE"];
  if (process.platform === "linux") args.push("--no-sandbox");
  app = await electron.launch({ args, env: { ...process.env, STINKYMA_DB: join(dataDir, "e2e.sqlite"), STINKYMA_USER_DATA: dataDir } });
  page = await app.firstWindow();

  await expect(rows().first()).toBeVisible({ timeout: 15_000 });
  await expect(rows()).toHaveCount(inboxCount);
  await expect(page.getByTestId("sidebar-unifiedInbox").locator(".badge")).toHaveText(unread ?? "");
});
