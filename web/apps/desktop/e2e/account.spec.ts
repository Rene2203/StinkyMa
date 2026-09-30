import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectScrollable, removeQuietly } from "./helpers";

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
  await admin.mailboxCreate("Sent");
  await admin.append("INBOX", htmlMail, [], new Date());
  await admin.append(
    "INBOX",
    ["From: Jonas <jonas@example.test>", `To: ${email}`, "Subject: Grillen?", `Date: ${new Date().toUTCString()}`, "Message-ID: <g1@example.test>", "", "Kommst du Samstag?", ""].join("\r\n"),
    [],
    new Date(),
  );
  // Genug Mails, dass die Liste scrollen muss
  for (let i = 1; i <= 40; i++) {
    await admin.append(
      "INBOX",
      [`From: Shop ${i} <shop${i}@example.test>`, `To: ${email}`, `Subject: Angebot Nummer ${i}`, `Date: ${new Date(Date.now() - i * 3_600_000).toUTCString()}`, `Message-ID: <a${i}@example.test>`, "", `Text ${i}`, ""].join("\r\n"),
      ["\\Seen"],
      new Date(Date.now() - i * 3_600_000),
    );
  }
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
  // Schließen darf den Testlauf nie blockieren (sonst verdeckt ein Timeout den eigentlichen Fehler).
  if (app) {
    const child = app.process();
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (child && child.exitCode === null) child.kill();
  }
  removeQuietly(dataDir);
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
  await page.getByTestId("smtp-host").fill(host);
  await page.getByTestId("smtp-port").fill("3025");
  await page.getByTestId("smtp-security").selectOption("none");
  await page.screenshot({ path: join(screenshotDir, "07-Konto-hinzufuegen.png") });
  await page.getByTestId("account-connect").click();

  // Dialog schließt, Beispielkonten sind weg, die Mails vom Server erscheinen.
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("Ihre Rechnung als HTML")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("message-row")).toHaveCount(42);
  await expectScrollable(page, ".rows");
  await expect(page.getByRole("heading", { name: "Privat" })).toHaveCount(0);

  // HTML-Mail: Inhalt da, Skript nicht ausgeführt, Tracker blockiert
  await page.getByText("Ihre Rechnung als HTML").click();
  const frame = page.frameLocator("iframe[title='E-Mail']");
  await expect(frame.getByRole("heading", { name: "Ihre Rechnung" })).toBeVisible();
  await expect(page.getByText("Externe Inhalte wurden blockiert")).toBeVisible();
  // Geöffnet = gelesen, auch auf dem Server
  await expect(page.getByTestId("sidebar-unifiedInbox").locator(".badge")).toHaveText("1", { timeout: 1_000 });
  expect(await page.title()).toBe("StinkyMa");
  await expect(frame.locator("script")).toHaveCount(0);
  await expect(frame.locator("img[src*='tracker']")).toHaveCount(0);
  await page.screenshot({ path: join(screenshotDir, "08-HTML-Mail.png") });

  await test.step("Ausnahme über Optionen: Absender lädt externe Inhalte sofort", async () => {
    await page.getByTestId("remote-always").click();
    const dialog = page.getByTestId("options-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("remote-exception-input")).toHaveValue("stadtwerke.example");
    await dialog.getByTestId("remote-exception-add").click();
    await expect(dialog.getByTestId("remote-exception")).toHaveText([/stadtwerke\.example/]);
    await dialog.getByTestId("remote-exception-input").fill("kein eintrag");
    await dialog.getByTestId("remote-exception-add").click();
    await expect(dialog.getByRole("alert")).toContainText("E-Mail-Adresse oder Domain");
    await page.screenshot({ path: join(screenshotDir, "09-Optionen-Ausnahmen.png") });
    await dialog.getByRole("button", { name: "Fertig" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(frame.locator("img[src*='tracker']")).toHaveCount(1);
    await expect(frame.locator("script")).toHaveCount(0);
    await expect(page.getByText("Ausnahme für stadtwerke.example")).toBeVisible();
  });

  await test.step("Ausnahme entfernen (Zahnrad), dann nur auf Klick", async () => {
    await page.getByTestId("open-options").click();
    const dialog = page.getByTestId("options-dialog");
    await dialog.getByRole("button", { name: "stadtwerke.example entfernen" }).click();
    await expect(dialog.getByTestId("remote-exception")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(frame.locator("img[src*='tracker']")).toHaveCount(0);
    await page.getByRole("button", { name: "Externe Inhalte laden" }).click();
    await expect(frame.locator("img[src*='tracker']")).toHaveCount(1);
    await expect(page.getByText("Externe Inhalte wurden blockiert")).toHaveCount(0);
  });

  await test.step("Passwort liegt nicht im Klartext auf der Platte", async () => {
    // Unter Windows: DPAPI; im Linux-Test: Electrons Test-Speicher
    const secrets = readFileSync(join(dataDir, "secrets.json"), "utf8");
    expect(secrets).not.toContain("geheim");
  });

  await test.step("Archivieren per Taste E wirkt auf dem Server", async () => {
    await page.getByTestId("thread-subject").click(); // Fokus in die App (nicht in den Mail-Frame)
    await page.keyboard.press("e");
    // Sofort weg aus der Liste – ohne auf den Server zu warten
    await expect(page.getByTestId("message-row")).toHaveCount(41, { timeout: 1_000 });
    // Kurz danach auch auf dem Server (Warteschlange im Hintergrund)
    await expect
      .poll(async () => {
        const admin = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "geheim" }, logger: false });
        await admin.connect();
        const status = await admin.status("Archiv", { messages: true });
        await admin.logout();
        return status && status.messages;
      }, { timeout: 10_000 })
      .toBe(1);
  });

  await test.step("„Ungelesen“: geöffnete Mail bleibt sichtbar", async () => {
    await page.getByTestId("sidebar-unread").click();
    const rows = page.getByTestId("message-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    await rows.first().click();
    await expect(page.getByTestId("thread-subject")).toBeVisible();
    // Das Gelesen-Setzen löst im Hauptprozess „mail:changed“ aus – danach muss die Mail noch offen sein.
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId("thread-subject")).toBeVisible();
    await expect(rows).toHaveCount(count);
  });

  await test.step("Neue E-Mail ohne Empfänger: Hinweis, Verwerfen fragt nach", async () => {
    await page.getByTestId("compose-new").click();
    const composer = page.getByTestId("composer");
    await expect(composer).toBeVisible();
    await composer.getByTestId("compose-subject").fill("Test");
    await composer.getByTestId("compose-send").click();
    await expect(composer.getByRole("alert")).toContainText("mindestens einen Empfänger");
    await page.keyboard.press("Escape");
    await composer.getByTestId("compose-confirm-discard").click();
    await expect(composer).toHaveCount(0);
  });

  await test.step("Antworten per Taste R, Senden mit Strg+Enter – kommt beim Empfänger an und liegt in „Gesendet“", async () => {
    await page.getByTestId("sidebar-unifiedInbox").click();
    await page.getByText("Grillen?").click();
    await expect(page.getByTestId("thread-subject")).toHaveText("Grillen?");
    await page.keyboard.press("r");
    const composer = page.getByTestId("composer");
    await expect(composer).toBeVisible();
    await expect(composer.getByTestId("compose-to")).toHaveValue("Jonas <jonas@example.test>");
    await expect(composer.getByTestId("compose-subject")).toHaveValue("Re: Grillen?");
    await expect(composer.getByTestId("compose-body")).toBeFocused();
    await page.keyboard.type("Ja, ich komme gern!");
    await page.screenshot({ path: join(screenshotDir, "10-Antworten.png") });
    await page.keyboard.press("Control+Enter");
    await expect(composer).toHaveCount(0, { timeout: 5_000 });

    const jonas = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: "jonas@example.test", pass: "x" }, logger: false });
    await expect
      .poll(async () => {
        const mine = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "geheim" }, logger: false });
        await mine.connect();
        const status = await mine.status("Sent", { messages: true });
        await mine.logout();
        return status && status.messages;
      }, { timeout: 15_000 })
      .toBe(1);
    await jonas.connect();
    await jonas.mailboxOpen("INBOX");
    let source = "";
    for await (const msg of jonas.fetch("1:*", { envelope: true, source: true })) {
      if (msg.envelope?.subject === "Re: Grillen?") source = msg.source?.toString("utf8") ?? "";
    }
    await jonas.logout();
    expect(source).toContain("Ja, ich komme gern!");
    expect(source).toContain("> Kommst du Samstag?");
    expect(source).toMatch(/In-Reply-To: <g1@example.test>/i);
    await expect(page.getByTestId("outbox")).toHaveCount(0);
  });

  await test.step("Abruf per Knopf", async () => {
    await page.getByTestId("sync-now").click();
    await expect(page.getByTestId("sync-status")).toContainText("Abgerufen um", { timeout: 20_000 });
  });
});
