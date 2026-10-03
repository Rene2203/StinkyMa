import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectScrollable, removeQuietly } from "./helpers";

// Abnahme Phase W1: App startet, zeigt den Mock-Posteingang, Navigation und Aktionen funktionieren.
// Screenshots landen in test-results/screenshots (CI lädt sie als Artefakt hoch).

const screenshotDir = join(__dirname, "..", "test-results", "screenshots");
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let exportDir: string;

test.beforeAll(async () => {
  mkdirSync(screenshotDir, { recursive: true });
  dataDir = mkdtempSync(join(tmpdir(), "stinkyma-e2e-"));
  exportDir = join(dataDir, "export");
  mkdirSync(exportDir);
  // Deutsche Oberfläche unabhängig von der Sprache des Test-Rechners.
  const args = [join(__dirname, ".."), "--lang=de-DE"];
  // Im Linux-Container läuft alles als root; dort braucht Chromium --no-sandbox. Unter Windows nicht nötig.
  if (process.platform === "linux") args.push("--no-sandbox");
  app = await electron.launch({
    args,
    env: { ...process.env, STINKYMA_DB: join(dataDir, "e2e.sqlite"), STINKYMA_USER_DATA: dataDir, STINKYMA_TEST_SAVE_DIR: exportDir, LANG: "de_DE.UTF-8" },
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

test("Einordnung korrigieren: für den Absender gemerkt, andere Mails folgen", async () => {
  await page.getByRole("searchbox").fill("");
  await page.getByTestId("sidebar-unifiedInbox").click();
  await rows().filter({ hasText: "Super, freut mich!" }).click();
  await page.getByTestId("category-picker").click();
  await expect(page.getByTestId("category-remember")).toBeChecked();
  await page.getByTestId("category-option-work").click();
  await expect(page.getByTestId("category-picker")).toContainText("Arbeit");
  await expect(page.getByTestId("category-note")).toContainText("weitere Mail");
  await shot("27-Einordnung-korrigieren");
  // Die ältere Mail von Jonas folgt
  await expect(rows().filter({ hasText: "Hi Anna, wir grillen am Samstag" }).locator(".chip")).toHaveText("Arbeit");
  // Zurück: wieder „Persönlich“
  await page.getByTestId("category-picker").click();
  await page.getByTestId("category-option-personal").click();
  await expect(rows().filter({ hasText: "Hi Anna, wir grillen am Samstag" }).locator(".chip")).toHaveText("Persönlich");
});

test("Newsletter abbestellen mit einem Klick, danach aufräumen", async () => {
  await page.getByRole("searchbox").fill("");
  await page.getByTestId("sidebar-unifiedInbox").click();
  await rows().filter({ hasText: "Vereinsnachrichten September" }).click();
  const bar = page.getByTestId("unsubscribe-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("ohne Browser");
  await shot("29-Abbestellen");
  await bar.getByTestId("unsubscribe").click();
  const done = page.getByTestId("unsubscribe-done");
  await expect(done).toContainText("Abbestellt am");
  await done.getByTestId("unsubscribe-cleanup").click();
  const dialog = page.getByTestId("cleanup-dialog");
  await expect(dialog.getByTestId("cleanup-detail")).toContainText("news@tsv-musterstadt.example");
  await expect(dialog.getByTestId("unsubscribe-done")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Abmelde-Seite öffnet in einem verschiebbaren Fenster in der App, abgeschottet", async () => {
  await rows().filter({ hasText: "Wochenrückblick" }).click();
  const bar = page.getByTestId("unsubscribe-bar");
  await expect(bar).toContainText("Abmelde-Seite im Browser");
  await bar.getByTestId("unsubscribe").click();
  const panel = page.getByTestId("webpanel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("webpanel-host")).toHaveText("tech-briefing.example");
  const views = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.map((v) => v.getBounds()) ?? []);
  await expect.poll(async () => (await views()).length).toBe(1);
  await expect.poll(async () => (await views())[0]?.width ?? 0).toBeGreaterThan(100);
  const before = (await views())[0]!;
  await shot("30-Abmelde-Seite");
  // Verschieben an der Titelleiste: die Seite wandert mit
  const box = (await panel.getByTestId("webpanel-bar").boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await views())[0]?.x ?? 0).toBeLessThan(before.x);
  await panel.getByTestId("webpanel-close").click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await views()).length).toBe(0);
  await expect(page.getByTestId("unsubscribe-done")).toContainText("Abmelde-Seite geöffnet");
});

test("Aufräumen: größter Absender, Geschütztes bleibt abgewählt, Löschen erst nach Bestätigung", async () => {
  await page.getByTestId("open-cleanup").click();
  const dialog = page.getByTestId("cleanup-dialog");
  await expect(dialog).toBeVisible();
  const groups = dialog.getByTestId("cleanup-group");
  await expect(groups.first()).toBeVisible();
  const before = Number(await groups.first().locator(".cleanup-count").textContent());
  expect(before).toBeGreaterThanOrEqual(2);
  await groups.first().click();
  const mails = dialog.getByTestId("cleanup-mail");
  await expect(mails).toHaveCount(before);
  // Ungeschützte sind vorausgewählt, geschützte nicht
  const protectedCount = await dialog.getByTestId("cleanup-protect").count();
  for (let i = 0; i < before; i++) {
    const row = mails.nth(i);
    const isProtected = (await row.getByTestId("cleanup-protect").count()) > 0;
    await expect(row.locator("input[type=checkbox]")).toBeChecked({ checked: !isProtected });
  }
  await shot("28-Aufraeumen");
  if (protectedCount === before) await mails.first().locator("input[type=checkbox]").check();
  const selected = await dialog.locator(".cleanup-mail input:checked").count();
  await dialog.getByTestId("cleanup-future").check();
  await dialog.getByTestId("cleanup-trash").click();
  await expect(dialog.getByTestId("cleanup-confirm")).toBeVisible();
  await dialog.getByTestId("cleanup-confirm").click();
  await expect(dialog.getByTestId("cleanup-note")).toContainText(String(selected));
  await expect(dialog.getByTestId("cleanup-note")).toContainText("Regel");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Die Mails liegen jetzt im Papierkorb
  await page.getByRole("searchbox").fill("");
  await page.getByTestId("sidebar-unifiedInbox").click();
});

test("Abos & Verträge: Probe-Abo erkannt, Kündigungstag, Erinnerung, gekündigt, Mail öffnen", async () => {
  await page.getByTestId("sidebar-subscriptions").click();
  const panel = page.getByTestId("subscriptions");
  await expect(panel).toBeVisible();
  const row = panel.getByTestId("subs-row").filter({ hasText: "Streamflix" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Probe-Abo");
  await expect(row.getByTestId("subs-cancel")).toContainText("Kündigen bis");
  await row.click();
  const detail = panel.getByTestId("subs-detail");
  await expect(detail).toContainText("12,99 €");
  await expect(detail.getByTestId("subs-origin")).toHaveText("erkannt ohne KI");
  await detail.getByTestId("subs-remind").click();
  await expect(detail.getByTestId("subs-reminder")).toBeVisible();
  await shot("31-Abos");
  await detail.getByTestId("subs-mark-cancelled").click();
  await expect(panel.getByText("Gekündigt", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("subs-detail").getByTestId("subs-reminder")).toHaveCount(0);
  await panel.getByTestId("subs-detail").getByTestId("subs-open-mail").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("thread-subject")).toContainText("Probeabo");
});

test("Abos: „Das ist ein Abo“ per Rechtsklick, von Hand durchsuchen, zusammenführen mit allen Mails", async () => {
  await page.getByRole("searchbox").fill("");
  await page.getByTestId("sidebar-unifiedInbox").click();
  const other = rows().filter({ hasNotText: "Probeabo" }).first();
  await other.click({ button: "right" });
  await page.getByTestId("menu-subscription").click();
  const panel = page.getByTestId("subscriptions");
  await expect(panel).toBeVisible();
  const detail = panel.getByTestId("subs-detail");
  await expect(detail.getByTestId("subs-origin")).toHaveText("von dir festgelegt");
  const provider = (await detail.locator("h3").textContent()) ?? "";
  expect(provider).not.toBe("Streamflix");
  // Von Hand durchsuchen (auch schon Geprüftes) – der von Hand übernommene Eintrag bleibt
  await panel.getByTestId("subs-rescan").click();
  await expect(panel.getByTestId("subs-rescan")).toBeEnabled();
  await expect(panel.getByTestId("subs-row").filter({ hasText: provider })).toBeVisible();
  // Zusammenführen: Streamflix geht in diesem Eintrag auf, beide Mails stehen im Detail
  await panel.getByTestId("subs-row").filter({ hasText: provider }).click();
  await detail.getByTestId("subs-merge-select").selectOption({ label: (await detail.getByTestId("subs-merge-select").locator("option", { hasText: "Streamflix" }).textContent()) ?? "" });
  await detail.getByTestId("subs-merge").click();
  await expect(panel.getByTestId("subs-row").filter({ hasText: "Streamflix" })).toHaveCount(0);
  await expect(panel.getByTestId("subs-detail").getByTestId("subs-mail")).toHaveCount(2);
  await shot("32-Abos-zusammengefuehrt");
  await panel.getByTestId("subs-detail").getByTestId("subs-mail").filter({ hasText: "Probeabo" }).click();
  await expect(page.getByTestId("thread-subject")).toContainText("Probeabo");
});

test("Eigene Kategorie: anlegen mit Absender, Filter in der Seitenleiste, an der Mail ändern und für den Absender merken", async () => {
  await page.getByTestId("ucat-new").click();
  const dialog = page.getByTestId("category-dialog");
  await dialog.getByTestId("ucat-name").fill("Verein");
  await dialog.getByTestId("ucat-description").fill("Sportverein, Training, Vereinsfeste");
  await dialog.getByTestId("ucat-senders").fill("tsv-musterstadt.example");
  await dialog.getByTestId("ucat-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("list-title")).toHaveText("Verein");
  await expect(rows()).toHaveCount(1);
  await expect(rows().first().getByTestId("ucat-chip")).toHaveText("Verein");
  await shot("33-Eigene-Kategorie");

  // Andere Mail von Hand zuordnen, für den Absender merken
  await page.getByTestId("sidebar-unifiedInbox").click();
  const other = rows().filter({ hasText: "Stadtwerke" }).first();
  await other.click();
  await page.getByTestId("ucat-picker").click();
  await page.getByTestId("ucat-option-Verein").click();
  await expect(page.getByTestId("ucat-note")).toBeVisible();
  await expect(page.getByTestId("ucat-picker")).toContainText("Verein");
  await page.getByTestId("sidebar-ucat-Verein").click();
  await expect(rows()).toHaveCount(2);

  // Bearbeiten: umbenennen; Löschen nimmt nur die Zuordnung weg
  await page.getByTestId("sidebar-ucat-Verein").hover();
  await page.getByRole("button", { name: "„Verein“ bearbeiten" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("ucat-remove").click();
  await expect(page.getByTestId("sidebar-ucat-Verein")).toHaveCount(0);
  await expect(page.getByTestId("list-title")).toHaveText("Alle Posteingänge");
});

test("Belegordner: Rechnung erkannt, korrigieren mit gemerkter Kategorie, „Als Beleg übernehmen“, Export als ZIP mit CSV", async () => {
  await page.getByTestId("sidebar-receipts").click();
  const panel = page.getByTestId("receipts");
  await expect(panel).toBeVisible();
  const row = panel.getByTestId("rcpt-row").filter({ hasText: "Stadtwerke" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("86,00");
  await row.click();
  const detail = panel.getByTestId("rcpt-detail");
  await expect(detail.getByTestId("rcpt-origin")).toHaveText("erkannt ohne KI");
  await detail.locator("summary").click();
  await detail.getByTestId("rcpt-category").selectOption("Haushalt & Einkauf");
  await detail.getByTestId("rcpt-save").click();
  await expect(panel.getByTestId("rcpt-detail").getByTestId("rcpt-origin")).toHaveText("von dir festgelegt");
  await expect(panel.getByTestId("rcpt-total-chip").filter({ hasText: "Haushalt" })).toContainText("86,00");
  await shot("34-Belegordner");

  // Andere Mail von Hand übernehmen (Rechtsklick)
  await panel.getByRole("button", { name: "Zurück zu den Mails" }).click();
  await page.getByTestId("sidebar-unifiedInbox").click();
  const other = rows().filter({ hasNotText: "Stadtwerke" }).first();
  await other.click({ button: "right" });
  await page.getByTestId("menu-receipt").click();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("rcpt-detail").getByTestId("rcpt-origin")).toHaveText("von dir festgelegt");

  // Export: ZIP mit CSV (Beispielkonten haben keine echten PDF-Inhalte → fehlen, Belege stehen trotzdem in der CSV)
  await panel.getByTestId("rcpt-export").click();
  await expect(panel.getByTestId("rcpt-exported")).toContainText("Belege exportiert");
  const zipFile = readdirSync(exportDir).find((f) => f.endsWith(".zip"));
  expect(zipFile).toBeTruthy();
  const zip = readFileSync(join(exportDir, zipFile!));
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.toString("utf8")).toContain("Stadtwerke Musterstadt");
  await panel.getByRole("button", { name: "Zurück zu den Mails" }).click();
});

test("Zusagen: eigene Zusage aus gesendeter Mail mit Frist, Erinnerung, erledigt; „Ich warte auf“", async () => {
  await page.getByTestId("sidebar-promises").click();
  const panel = page.getByTestId("promises");
  await expect(panel).toBeVisible();
  const card = panel.getByTestId("prom-card").filter({ hasText: "Angebot" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("an Petra Schulz");
  await expect(card.getByTestId("prom-due")).not.toBeEmpty();
  await shot("35-Zusagen");
  await card.getByTestId("prom-done").click();
  await expect(panel.getByText("Erledigt (letzte 30 Tage)")).toBeVisible();
  await expect(panel.getByTestId("prom-card").filter({ hasText: "Angebot" })).toContainText("erledigt");
  await panel.getByTestId("prom-tab-theirs").click();
  await expect(panel.getByTestId("prom-tab-theirs")).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("button", { name: "Zurück zu den Mails" }).click();
});

test("Frag dein Postfach: ohne Zusatzmodell und KI – Wortsuche mit Quellen, Klick öffnet die Mail", async () => {
  await page.getByTestId("sidebar-ask").click();
  const panel = page.getByTestId("ask");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("ask-download")).toContainText("334 MB");
  await panel.getByTestId("ask-input").fill("Wann wird der Abschlag abgebucht?");
  await panel.getByTestId("ask-submit").click();
  const source = panel.getByTestId("ask-source").filter({ hasText: "Abschlagsrechnung" });
  await expect(source).toBeVisible();
  await shot("36-Frag-dein-Postfach");
  await source.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("thread-subject")).toContainText("Abschlagsrechnung");
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
