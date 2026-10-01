import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeQuietly } from "./helpers";

// „Mit KI lesen“ mit echtem Gemma 4 E2B + Bild-Baustein + llama-server, gegen den GreenMail-Testserver.
// Nur lokal (Modelle ~4 GB): STINKYMA_E2E_VISION_DIR enthält gemma-4-E2B-it-Q4_K_M.gguf, mmproj-F16.gguf und den
// entpackten llama.cpp-Ordner (llama-b11320). Dazu GREENMAIL_IMAP_PORT. Alle Inhalte erfunden.
const port = Number(process.env.GREENMAIL_IMAP_PORT ?? 0);
const visionDir = process.env.STINKYMA_E2E_VISION_DIR;
const host = "127.0.0.1";
const screenshotDir = join(__dirname, "..", "test-results", "screenshots");

test.skip(!port || !visionDir, "Nur mit GREENMAIL_IMAP_PORT und STINKYMA_E2E_VISION_DIR");

let app: ElectronApplication;
let page: Page;
let dataDir: string;
const email = `vision-${randomUUID().slice(0, 8)}@example.test`;

const invoiceHtml = `<html><body style="font-family:sans-serif;padding:40px;width:700px;background:#fdfdf8">
<h2>Handwerk Müller GmbH</h2><p>Lindenweg 12 · 12345 Musterstadt</p>
<h1>Rechnung Nr. 2026-0412</h1><p>Rechnungsdatum: 22.09.2026</p>
<table border=1 cellpadding=6 style="border-collapse:collapse"><tr><th>Leistung</th><th>Betrag</th></tr>
<tr><td>Badsanierung, Fliesenarbeiten</td><td>2.900,00 €</td></tr><tr><td>Material</td><td>580,00 €</td></tr>
<tr><td><b>Gesamt</b></td><td><b>3.480,00 €</b></td></tr></table>
<p>Zahlbar bis 06.10.2026 ohne Abzug.</p></body></html>`;

const letterHtml = `<html><body style="font-family:serif;padding:50px;width:640px;background:#fff">
<p>Fitnessstudio Kraftwerk · Hauptstraße 3 · 12345 Musterstadt</p>
<h2>Kündigungsbestätigung</h2>
<p>Sehr geehrte Frau Beispiel,</p>
<p>hiermit bestätigen wir die Kündigung Ihrer Mitgliedschaft mit der Vertragsnummer 4711-22.
Der Vertrag endet am 31.12.2026. Bis dahin wird der Monatsbeitrag von 29,90 € weiter abgebucht.</p>
<p>Mit sportlichen Grüßen<br>Ihr Kraftwerk-Team</p></body></html>`;

function mailWithAttachment(subject: string, filename: string, mimeType: string, content: Buffer): string {
  const boundary = `grenze-${randomUUID().slice(0, 6)}`;
  return [
    "From: Büro <buero@example.test>", `To: ${email}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@example.test>`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", "Siehe Anhang.",
    `--${boundary}`, `Content-Type: ${mimeType}; name="${filename}"`, `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64", "", content.toString("base64").replace(/.{76}/g, "$&\r\n"),
    `--${boundary}--`, "",
  ].join("\r\n");
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  mkdirSync(screenshotDir, { recursive: true });
  dataDir = mkdtempSync(join(tmpdir(), "stinkyma-e2e-vision-"));

  // Testbilder: Rechnung als PNG, Brief als „gescanntes“ PDF (nur Bild, keine Textebene)
  // Im Container liegt Chromium vorinstalliert unter /opt/pw-browsers (eigene Playwright-Version passt evtl. nicht)
  const browser = await chromium.launch(process.platform === "linux" ? { executablePath: process.env.STINKYMA_E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" } : {});
  const render = await browser.newPage({ viewport: { width: 780, height: 600 } });
  await render.setContent(invoiceHtml);
  const invoicePng = await render.screenshot();
  await render.setContent(letterHtml);
  const letterPng = await render.screenshot();
  await render.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${letterPng.toString("base64")}" style="width:100%"></body></html>`);
  const scanPdf = await render.pdf({ format: "A4" });
  await browser.close();

  const admin = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "geheim" }, logger: false });
  await admin.connect();
  await admin.mailboxCreate("Archiv");
  await admin.mailboxCreate("Sent");
  await admin.append("INBOX", mailWithAttachment("Rechnung als Foto", "Rechnung.png", "image/png", invoicePng), [], new Date());
  await admin.append("INBOX", mailWithAttachment("Eingescannter Brief", "Scan.pdf", "application/pdf", scanPdf), [], new Date(Date.now() - 60_000));
  await admin.logout();

  // Modelle und Laufzeit so ablegen, wie die App sie nach dem Download hätte (Verknüpfungen statt Kopien)
  const dir = visionDir ?? "";
  const models = join(dataDir, "models", "gemma-4-e2b-q4");
  mkdirSync(models, { recursive: true });
  symlinkSync(join(dir, "gemma-4-E2B-it-Q4_K_M.gguf"), join(models, "gemma-4-E2B-it-Q4_K_M.gguf"));
  symlinkSync(join(dir, "mmproj-F16.gguf"), join(models, "mmproj-F16.gguf"));
  const runtime = join(dataDir, "runtime", "b11320");
  mkdirSync(runtime, { recursive: true });
  const llamaFolder = readdirSync(dir).find((name) => name.startsWith("llama-b"));
  if (!llamaFolder) throw new Error("llama.cpp-Ordner fehlt in STINKYMA_E2E_VISION_DIR");
  symlinkSync(join(dir, llamaFolder), join(runtime, llamaFolder));
  writeFileSync(join(runtime, ".complete"), "b11320");
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ ai: { enabled: true, modelId: "gemma-4-e2b-q4", autoCategorize: false, useGpu: false, vision: true } }));

  const args = [join(__dirname, ".."), "--lang=de-DE"];
  if (process.platform === "linux") args.push("--no-sandbox", "--password-store=basic");
  app = await electron.launch({ args, env: { ...process.env, STINKYMA_DB: join(dataDir, "mail.sqlite"), STINKYMA_USER_DATA: dataDir, STINKYMA_TEST_PLAINTEXT_SECRETS: "1" } });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app) {
    const child = app.process();
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (child && child.exitCode === null) child.kill();
  }
  removeQuietly(dataDir);
});

test("Mit KI lesen: Rechnungsfoto und gescanntes PDF – danach durchsuchbar", async () => {
  test.setTimeout(900_000);
  await expect(page.getByTestId("message-row").first()).toBeVisible({ timeout: 15_000 });

  await test.step("Konto einrichten", async () => {
    await page.getByTestId("add-account").click();
    await page.getByTestId("account-email").fill(email);
    await page.getByTestId("account-password").fill("geheim");
    await page.getByRole("button", { name: "Servereinstellungen" }).click();
    await page.getByTestId("imap-host").fill(host);
    await page.getByTestId("imap-port").fill(String(port));
    await page.getByTestId("imap-security").selectOption("none");
    await page.getByTestId("smtp-host").fill(host);
    await page.getByTestId("smtp-port").fill("3025");
    await page.getByTestId("smtp-security").selectOption("none");
    await page.getByTestId("account-connect").click();
    await expect(page.getByText("Rechnung als Foto")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("Optionen zeigen „Bilder und Scans verstehen“ als eingeschaltet", async () => {
    await page.getByTestId("open-options").click();
    await expect(page.getByTestId("ai-vision-enabled")).toBeChecked();
    await page.getByRole("button", { name: "Fertig" }).click();
  });

  await test.step("Rechnungsfoto lesen", async () => {
    await page.getByTestId("message-row").filter({ hasText: "Rechnung als Foto" }).click();
    await page.getByRole("button", { name: /Rechnung\.png/ }).first().click();
    const viewer = page.getByTestId("attachment-viewer");
    await expect(viewer.getByTestId("viewer-image")).toBeVisible();
    await viewer.getByTestId("viewer-read").click();
    const card = viewer.getByTestId("reading-card");
    await expect(card).toHaveAttribute("aria-busy", "false", { timeout: 400_000 });
    await expect(card.getByTestId("reading-summary")).toContainText("3.480");
    await expect(card.getByText("Rechnung", { exact: true })).toBeVisible();
    await page.screenshot({ path: join(screenshotDir, "17-Mit-KI-lesen-Foto.png") });
    await viewer.getByTestId("viewer-close").click();
  });

  await test.step("Gescanntes PDF lesen (Seite wird in der App gerendert und mitgeschickt)", async () => {
    await page.getByTestId("message-row").filter({ hasText: "Eingescannter Brief" }).click();
    await page.getByRole("button", { name: /Scan\.pdf/ }).first().click();
    const viewer = page.getByTestId("attachment-viewer");
    await expect(viewer.getByTestId("viewer-page").first()).toBeVisible({ timeout: 30_000 });
    await viewer.getByTestId("viewer-read").click();
    const card = viewer.getByTestId("reading-card");
    await expect(card).toHaveAttribute("aria-busy", "false", { timeout: 400_000 });
    await card.getByText("Gelesener Text").click();
    await expect(card.getByTestId("reading-text")).toContainText("4711-22");
    await page.screenshot({ path: join(screenshotDir, "18-Mit-KI-lesen-Scan.png") });
    await viewer.getByTestId("viewer-close").click();
  });

  await test.step("Gelesener Text ist durchsuchbar", async () => {
    await page.getByRole("searchbox").fill("Vertragsnummer");
    await expect(page.getByTestId("message-row").filter({ hasText: "Eingescannter Brief" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("searchbox").fill("Fliesenarbeiten");
    await expect(page.getByTestId("message-row").filter({ hasText: "Rechnung als Foto" })).toBeVisible({ timeout: 10_000 });
  });

  await test.step("Gespeichert: erneut öffnen zeigt das Ergebnis sofort", async () => {
    await page.getByRole("searchbox").fill("");
    await page.getByTestId("message-row").filter({ hasText: "Rechnung als Foto" }).click();
    await page.getByRole("button", { name: /Rechnung\.png/ }).first().click();
    await expect(page.getByTestId("reading-summary")).toContainText("3.480", { timeout: 5_000 });
  });
});
