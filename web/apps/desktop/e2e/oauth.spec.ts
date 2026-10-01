import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeQuietly } from "./helpers";

// Anmeldung per Browser (OAuth) in der echten App: ein Test-Anbieter spielt Google nach (Anmeldeseite leitet sofort mit
// Code zurück, Token-Endpunkt liefert Tokens), Mails kommen per XOAUTH2 von GreenMail. Nie gegen echte Konten.
const port = Number(process.env.GREENMAIL_IMAP_PORT ?? 0);
const host = "127.0.0.1";
const screenshotDir = join(__dirname, "..", "test-results", "screenshots");

test.skip(!port, "GREENMAIL_IMAP_PORT nicht gesetzt – kein Testserver");

let app: ElectronApplication;
let page: Page;
let dataDir: string;
let provider: Server;
const email = `oauth-${randomUUID().slice(0, 8)}@example.test`;
const tokenRequests: string[] = [];

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "stinkyma-e2e-oauth-"));
  const admin = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: email, pass: "x" }, logger: false });
  await admin.connect();
  await admin.mailboxCreate("Archiv");
  await admin.append("INBOX", ["From: Google-Test <tom@example.test>", `To: ${email}`, "Subject: Willkommen per OAuth", `Date: ${new Date().toUTCString()}`, "Message-ID: <oauth-e2e@example.test>", "", "Hallo!", ""].join("\r\n"), [], new Date());
  await admin.logout();

  provider = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/authorize") {
      // „Nutzer meldet sich an und erlaubt den Zugriff“ → zurück zur App mit Code und state
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.search = new URLSearchParams({ code: "test-code", state: url.searchParams.get("state") ?? "" }).toString();
      res.writeHead(302, { Location: back.toString() }).end();
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const params = new URLSearchParams(body);
        tokenRequests.push(params.get("grant_type") ?? "");
        const idToken = `k.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ access_token: "zugriff", refresh_token: "dauer", expires_in: 3600, id_token: idToken }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

  // App-Registrierung wie vom Nutzer in den Optionen eingetragen
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ oauthClients: { google: { clientId: "test-client.apps.example", clientSecret: "nicht-geheim" }, microsoft: { clientId: "" } } }));
  const args = [join(__dirname, ".."), "--lang=de-DE"];
  if (process.platform === "linux") args.push("--no-sandbox", "--password-store=basic");
  app = await electron.launch({
    args,
    env: {
      ...process.env,
      STINKYMA_DB: join(dataDir, "mail.sqlite"),
      STINKYMA_USER_DATA: dataDir,
      STINKYMA_TEST_PLAINTEXT_SECRETS: "1",
      STINKYMA_TEST_OAUTH: JSON.stringify({ authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token`, imap: { host, port, security: "none" }, smtp: { host, port: 3025, security: "none" } }),
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app) {
    const child = app.process();
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (child && child.exitCode === null) child.kill();
  }
  provider?.close();
  removeQuietly(dataDir);
});

test("Konto per „Mit Google anmelden“ – ohne Passwort, Mails per XOAUTH2", async () => {
  await expect(page.getByTestId("message-row").first()).toBeVisible({ timeout: 15_000 });

  await test.step("Optionen zeigen die hinterlegte App-Registrierung", async () => {
    await page.getByTestId("open-options").click();
    await expect(page.getByTestId("oauth-google-id")).toHaveValue("test-client.apps.example");
    await expect(page.getByTestId("oauth-microsoft-id")).toHaveValue("");
    await page.getByTestId("oauth-microsoft-id").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDir, "19-Optionen-OAuth.png") });
    await page.getByRole("button", { name: "Fertig" }).click();
  });

  await test.step("Dialog: nur Google angeboten (Microsoft nicht eingerichtet), Anmeldung im „Browser“", async () => {
    await page.getByTestId("add-account").click();
    await expect(page.getByTestId("oauth-google")).toBeVisible();
    await expect(page.getByTestId("oauth-microsoft")).toHaveCount(0);
    await page.screenshot({ path: join(screenshotDir, "20-Konto-mit-Google.png") });
    await page.getByTestId("oauth-google").click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText("Willkommen per OAuth")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: email })).toBeVisible();
    expect(tokenRequests).toEqual(["authorization_code"]);
  });

  await test.step("Gespeichert ist nur das Token (verschlüsselt), kein Passwort", async () => {
    const secrets = readFileSync(join(dataDir, "secrets.json"), "utf8");
    expect(secrets).toContain("oauth-refresh-token");
    expect(secrets).not.toContain("account-password");
    expect(secrets).not.toContain("dauer"); // nicht im Klartext
  });
});
