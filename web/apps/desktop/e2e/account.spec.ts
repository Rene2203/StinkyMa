import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
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
  await admin.mailboxCreate("Drafts");
  await admin.append("INBOX", htmlMail, [], new Date());
  await admin.append(
    "INBOX",
    ["From: Jonas <jonas@example.test>", `To: ${email}`, "Subject: Grillen?", `Date: ${new Date().toUTCString()}`, "Message-ID: <g1@example.test>", "", "Kommst du Samstag?", ""].join("\r\n"),
    [],
    new Date(),
  );
  // Mail mit Anhängen: ein PDF (öffnen/speichern) und eine .exe (nur speichern)
  const boundary = "grenze42";
  await admin.append(
    "INBOX",
    [
      "From: Büro <buero@example.test>", `To: ${email}`, "Subject: Unterlagen", `Date: ${new Date(Date.now() - 60_000).toUTCString()}`,
      "Message-ID: <u1@example.test>", "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
      `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", "Anbei die Unterlagen.",
      `--${boundary}`, 'Content-Type: application/pdf; name="Vertrag.pdf"', 'Content-Disposition: attachment; filename="Vertrag.pdf"',
      "Content-Transfer-Encoding: base64", "", Buffer.from("%PDF-1.4 Vertrag").toString("base64"),
      `--${boundary}`, 'Content-Type: application/octet-stream; name="setup.exe"', 'Content-Disposition: attachment; filename="setup.exe"',
      "Content-Transfer-Encoding: base64", "", Buffer.from("MZ").toString("base64"),
      `--${boundary}--`, "",
    ].join("\r\n"),
    ["\\Seen"],
    new Date(Date.now() - 60_000),
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
  await expect(page.getByTestId("message-row")).toHaveCount(43);
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
    await expect(page.getByTestId("message-row")).toHaveCount(42, { timeout: 1_000 });
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

  await test.step("Anhänge: speichern und öffnen (vom Server geholt), .exe nur speichern", async () => {
    const savePath = join(dataDir, "gespeichert.pdf");
    // Windows-Dialoge im Test durch Attrappen ersetzen
    await app.evaluate(({ dialog, shell }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
      (globalThis as { opened?: string[] }).opened = [];
      shell.openPath = async (path: string) => {
        (globalThis as { opened?: string[] }).opened?.push(path);
        return "";
      };
    }, savePath);
    await page.getByTestId("sidebar-unifiedInbox").click();
    await page.getByText("Unterlagen", { exact: true }).click();
    const items = page.getByTestId("attachment");
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText("nur speichern");
    await expect(items.nth(1).getByRole("button", { name: /Öffnen/ })).toHaveCount(0);

    await items.nth(0).getByTestId("attachment-save").click();
    await expect.poll(() => existsSync(savePath)).toBe(true);
    expect(readFileSync(savePath, "utf8")).toBe("%PDF-1.4 Vertrag");

    await items.nth(0).getByRole("button", { name: /Öffnen/ }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])).toHaveLength(1);
    const [opened] = await app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);
    expect(opened).toMatch(/Vertrag\.pdf$/);
    expect(readFileSync(opened!, "utf8")).toBe("%PDF-1.4 Vertrag");
    await page.screenshot({ path: join(screenshotDir, "11-Anhaenge.png") });
  });

  const serverCount = async (mailbox: string) => {
    const mine = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "geheim" }, logger: false });
    await mine.connect();
    const status = await mine.status(mailbox, { messages: true });
    await mine.logout();
    return status && status.messages;
  };

  await test.step("Neue E-Mail ohne Empfänger: Hinweis; ohne Eingaben schließt Esc ohne Entwurf", async () => {
    await page.getByTestId("compose-new").click();
    const composer = page.getByTestId("composer");
    await expect(composer).toBeVisible();
    await composer.getByTestId("compose-send").click();
    await expect(composer.getByRole("alert")).toContainText("mindestens einen Empfänger");
    await page.keyboard.press("Escape");
    await expect(composer).toHaveCount(0);
  });

  await test.step("Entwurf: speichert automatisch, Schließen behält ihn, weiterschreiben, verwerfen – auch auf dem Server", async () => {
    await page.getByTestId("compose-new").click();
    const composer = page.getByTestId("composer");
    await composer.getByTestId("compose-to").fill("lisa@example.test");
    await composer.getByTestId("compose-subject").fill("Urlaubsplanung");
    await composer.getByTestId("compose-body").click();
    await page.keyboard.type("Erste Ideen");
    await expect(composer.getByTestId("draft-status")).toHaveText("Entwurf gespeichert", { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(composer).toHaveCount(0);

    await page.getByRole("button", { name: /^Entwürfe/ }).click();
    const row = page.getByTestId("message-row").filter({ hasText: "Urlaubsplanung" });
    await expect(row).toHaveCount(1);
    await page.getByTestId("sync-now").click(); // überträgt sofort statt nach der Schreibpause
    await expect.poll(() => serverCount("Drafts"), { timeout: 15_000 }).toBe(1);

    await row.dblclick();
    await expect(composer).toBeVisible();
    await expect(composer.getByTestId("compose-subject")).toHaveValue("Urlaubsplanung");
    await expect(composer.getByTestId("compose-body")).toContainText("Erste Ideen");
    await composer.getByTestId("compose-body").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" und mehr");
    await expect(composer.getByTestId("draft-status")).toHaveText("Entwurf gespeichert", { timeout: 5_000 });
    await page.screenshot({ path: join(screenshotDir, "12-Entwurf.png") });
    await composer.getByTestId("compose-discard").click();
    await composer.getByTestId("compose-confirm-discard").click();
    await expect(composer).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await page.getByTestId("sync-now").click();
    await expect.poll(() => serverCount("Drafts"), { timeout: 15_000 }).toBe(0);
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
    const editor = composer.getByTestId("compose-body");
    await expect(editor).toBeFocused();
    // Formatieren: Fett per Tastatur, Aufzählung per Knopf, Schriftart aus der Auswahl
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Ja");
    await page.keyboard.press("Control+b");
    await page.keyboard.type(", ich komme gern! Ich bringe mit:");
    await page.keyboard.press("Enter");
    await composer.getByTestId("format-bullets").click();
    await page.keyboard.type("Salat");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Brot");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // Liste beenden
    await composer.getByTestId("format-font").selectOption({ label: "Georgia" });
    await page.keyboard.type("Bis Samstag");
    await expect(editor.locator("strong")).toHaveText("Ja");
    await expect(editor.locator("ul li")).toHaveCount(2);
    await composer.getByTestId("compose-file-input").setInputFiles({ name: "Einkaufsliste.txt", mimeType: "text/plain", buffer: Buffer.from("Kohle, Senf") });
    await expect(composer.getByTestId("compose-attachment")).toContainText("Einkaufsliste.txt");
    await page.screenshot({ path: join(screenshotDir, "10-Antworten.png") });
    await page.keyboard.press("Control+Enter");
    await expect(composer).toHaveCount(0, { timeout: 5_000 });

    const jonas = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: "jonas@example.test", pass: "x" }, logger: false });
    await expect.poll(() => serverCount("Sent"), { timeout: 15_000 }).toBe(1);
    await jonas.connect();
    await jonas.mailboxOpen("INBOX");
    let source = "";
    for await (const msg of jonas.fetch("1:*", { envelope: true, source: true })) {
      if (msg.envelope?.subject === "Re: Grillen?") source = msg.source?.toString("utf8") ?? "";
    }
    await jonas.logout();
    expect(source).toMatch(/In-Reply-To: <g1@example.test>/i);
    const parsed = await simpleParser(source);
    expect(parsed.html).toContain("<strong>Ja</strong>, ich komme gern!");
    expect(parsed.html).toMatch(/<li><p[^>]*>Salat<\/p><\/li>/);
    expect(parsed.html).toMatch(/font-family: Georgia[^"]*">Bis Samstag/);
    expect(parsed.html).toContain("<blockquote");
    expect(parsed.text).toContain("Ja, ich komme gern! Ich bringe mit:");
    expect(parsed.text).toContain(" • Salat");
    expect(parsed.text).toContain("> Kommst du Samstag?");
    expect(parsed.attachments.map((a) => [a.filename, a.content.toString("utf8")])).toEqual([["Einkaufsliste.txt", "Kohle, Senf"]]);
    await expect(page.getByTestId("outbox")).toHaveCount(0);
  });

  await test.step("Adressvorschläge: wem man geschrieben hat, steht oben; Esc schließt nur die Liste", async () => {
    await page.getByTestId("compose-new").click();
    const composer = page.getByTestId("composer");
    const to = composer.getByTestId("compose-to");
    await expect(to).toBeFocused();
    await page.keyboard.type("jon");
    const list = composer.getByTestId("address-suggestions");
    await expect(list.getByRole("option").first()).toContainText("jonas@example.test");
    await page.screenshot({ path: join(screenshotDir, "13-Adressvorschlaege.png") });
    await page.keyboard.press("Enter");
    await expect(to).toHaveValue("Jonas <jonas@example.test>, ");
    await expect(composer).toBeVisible(); // Enter hat nicht gesendet
    await page.keyboard.type("jo");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(composer).toBeVisible();
    await composer.getByTestId("compose-discard").click();
    await composer.getByTestId("compose-confirm-discard").click();
    await expect(composer).toHaveCount(0);
  });

  await test.step("Signatur in den Optionen – erscheint in neuen Mails", async () => {
    await page.getByTestId("open-options").click();
    const options = page.getByTestId("options-dialog");
    const signature = options.getByTestId("signature-body");
    await expect(signature).toBeVisible();
    await signature.click();
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Viele Grüße");
    await page.keyboard.press("Control+b");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Anna");
    await options.getByTestId("signature-save").click();
    await expect(options.getByText("Gespeichert")).toBeVisible();
    await page.screenshot({ path: join(screenshotDir, "14-Signatur.png") });
    await options.getByRole("button", { name: "Fertig" }).click();
    await expect(options).toHaveCount(0);

    await page.getByTestId("compose-new").click();
    const composer = page.getByTestId("composer");
    await expect(composer.getByTestId("compose-body").locator("strong")).toHaveText("Viele Grüße");
    await expect(composer.getByTestId("compose-body")).toContainText("Anna");
    await page.keyboard.press("Escape"); // unverändert → kein Entwurf
    await expect(composer).toHaveCount(0);
  });

  const receivedBy = async (address: string, subject: string) => {
    const client = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: address, pass: "x" }, logger: false });
    await client.connect();
    let source: Buffer | undefined;
    await client.mailboxOpen("INBOX");
    for await (const msg of client.fetch("1:*", { envelope: true, source: true })) {
      if (msg.envelope?.subject === subject) source = msg.source;
    }
    await client.logout();
    return source ? simpleParser(source) : null;
  };

  await test.step("Weiterleiten: HTML-Layout bleibt (ohne Skript), Anhänge der Originalmail gehen mit – einzeln abwählbar", async () => {
    await page.locator(".sidebar").getByRole("button", { name: /^Archiv/ }).click(); // wurde weiter oben archiviert
    await page.getByText("Ihre Rechnung als HTML").click();
    await page.getByTestId("action-forward").click();
    const composer = page.getByTestId("composer");
    await composer.getByRole("button", { name: /Weitergeleitete Nachricht/ }).click();
    await expect(composer.frameLocator("iframe[title='E-Mail']").getByRole("heading", { name: "Ihre Rechnung" })).toBeVisible();
    await composer.getByTestId("compose-to").fill("kasse@example.test");
    await page.screenshot({ path: join(screenshotDir, "15-Weiterleiten.png") });
    await composer.getByTestId("compose-send").click();
    await expect(composer).toHaveCount(0, { timeout: 5_000 });
    let html = "";
    await expect.poll(async () => {
      html = String((await receivedBy("kasse@example.test", "Fwd: Ihre Rechnung als HTML"))?.html ?? "");
      return html;
    }, { timeout: 15_000 }).toContain("Ihre Rechnung</h1>");
    expect(html).toContain("Zum Kundenkonto");
    expect(html).not.toMatch(/<script/i);

    await page.getByTestId("sidebar-unifiedInbox").click();
    await page.getByText("Unterlagen", { exact: true }).click();
    await page.keyboard.press("f");
    await expect(composer.getByTestId("compose-attachment")).toHaveCount(2);
    await composer.getByRole("button", { name: "setup.exe entfernen" }).click();
    await expect(composer.getByTestId("compose-attachment")).toHaveCount(1);
    await composer.getByTestId("compose-to").fill("archiv@example.test");
    await composer.getByTestId("compose-send").click();
    await expect(composer).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(async () => (await receivedBy("archiv@example.test", "Fwd: Unterlagen"))?.attachments.map((a) => a.filename) ?? [], { timeout: 15_000 })
      .toEqual(["Vertrag.pdf"]);
    const forwarded = await receivedBy("archiv@example.test", "Fwd: Unterlagen");
    expect(forwarded?.attachments[0]?.content.toString("utf8")).toBe("%PDF-1.4 Vertrag");
    expect(forwarded?.text).toContain("Anbei die Unterlagen.");
  });

  await test.step("Abruf per Knopf", async () => {
    await page.getByTestId("sync-now").click();
    await expect(page.getByTestId("sync-status")).toContainText("Abgerufen um", { timeout: 20_000 });
  });
});
