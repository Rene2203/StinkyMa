import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Konto einrichten gegen einen lokalen GreenMail-Testserver (nie gegen echte Konten).
// Start: java -Dgreenmail.setup.test.all -Dgreenmail.auth.disabled -jar greenmail-standalone.jar
// Ohne GREENMAIL_IMAP_PORT wird der Test übersprungen.
const port = Number(process.env.GREENMAIL_IMAP_PORT ?? 0);
const host = process.env.GREENMAIL_HOST ?? "127.0.0.1";
const screenshotDir = join(__dirname, "..", "test-results", "screenshots");

test.skip(!port, "GREENMAIL_IMAP_PORT nicht gesetzt – kein Testserver");

let app: ElectronApplication;
let page: Page;
let dataDir: string;
const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;

const htmlMail = [
  "From: Stadtwerke Musterstadt <rechnung@stadtwerke.example>",
  `To: ${email}`,
  "Subject: Ihre Rechnung als HTML",
  `Date: ${new Date().toUTCString()}`,
  "Message-ID: <html-1@stadtwerke.example>",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<h1 style="color:#0a7">Ihre Rechnung</h1><p>Betrag: <b>86,00&nbsp;€</b></p><script>document.title="gehackt"</script><img src="https://tracker.example/pixel.gif" width="1" height="1"><p><a href="https://stadtwerke.example/konto">Zum Kundenkonto</a></p>',
  "",
].join("\r\n");

test.beforeAll(async () => {
  mkdirSync(screenshotDir, { recursive: true });
  dataDir = mkdtempSync(join(tmpdir(), "stinkyma-e2e-account-"));
  const admin = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "geheim" }, logger: false });
  await admin.connect();
  await admin.mailboxCreate("Archiv");
  await admin.append("INBOX", htmlMail, [], new Date());
  await admin.append(
    "INBOX",
    ["From: Jonas <jonas@example.test>", `To: ${email}`, "Subject: Grillen?", `Date: ${new Date().toUTCString()}`, "Message-ID: <g1@example.test>", "", "Kommst du Samstag?", ""].join("\r\n"),
    [],
    new Date(),
  );
  await admin.logout();

  const args = [join(__dirname, ".."), "--lang=de-DE"];
  // Linux-Container ohne Schlüsselbund: Electrons Test-Speicher verwenden. Unter Windows immer DPAPI.
  if (process.platform === "linux") args.push("--no-sandbox", "--password-store=basic");
  app = await electron.launch({
    args,
    env: { ...process.env, STINKYMA_DB: join(dataDir, "mail.sqlite"), STINKYMA_USER_DATA: dataDir, STINKYMA_TEST_PLAINTEXT_SECRETS: "1" },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("Konto einrichten, Mails abrufen, HTML sicher anzeigen", async () => {
  await expect(page.getByTestId("message-row").first()).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("add-account").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("account-email").fill(email);
  await page.getByTestId("account-password").fill("geheim");
  await page.getByRole("button", { name: "Servereinstellungen" }).click();
  await page.getByTestId("imap-host").fill(host);
  await page.getByTestId("imap-port").fill(String(port));
  await page.getByTestId("imap-security").selectOption("none");
  await page.screenshot({ path: join(screenshotDir, "07-Konto-hinzufuegen.png") });
  await page.getByTestId("account-connect").click();

  // Dialog schließt, Beispielkonten sind weg, die Mails vom Server erscheinen.
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("Ihre Rechnung als HTML")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("message-row")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Privat" })).toHaveCount(0);

  // HTML-Mail: Inhalt da, Skript nicht ausgeführt, Tracker blockiert
  await page.getByText("Ihre Rechnung als HTML").click();
  const frame = page.frameLocator("iframe[title='E-Mail']");
  await expect(frame.getByRole("heading", { name: "Ihre Rechnung" })).toBeVisible();
  await expect(page.getByText("Externe Inhalte wurden blockiert")).toBeVisible();
  // Geöffnet = gelesen, auch auf dem Server
  await expect(page.getByTestId("sidebar-unifiedInbox").locator(".badge")).toHaveText("1");
  expect(await page.title()).toBe("StinkyMa");
  await expect(frame.locator("script")).toHaveCount(0);
  await expect(frame.locator("img[src*='tracker']")).toHaveCount(0);
  await page.screenshot({ path: join(screenshotDir, "08-HTML-Mail.png") });

  // Passwort liegt nicht im Klartext auf der Platte (unter Windows: DPAPI; im Linux-Test: Electrons Test-Speicher)
  const secrets = readFileSync(join(dataDir, "secrets.json"), "utf8");
  expect(secrets).not.toContain("geheim");

  // Archivieren wirkt auf dem Server
  await page.locator("body").press("e");
  await expect(page.getByTestId("message-row")).toHaveCount(1);
  const admin = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "geheim" }, logger: false });
  await admin.connect();
  const status = await admin.status("Archiv", { messages: true });
  await admin.logout();
  expect(status && status.messages).toBe(1);

  // Abruf per Knopf
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("sync-status")).toContainText("Abgerufen um");
});
