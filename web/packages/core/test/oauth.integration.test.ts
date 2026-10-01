import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockData, InMemorySecretStore, OAuthError, parseStoredOAuth, SecretKeys, type OAuthProviderId, type OAuthTokens } from "../src/index.js";
import { MailService, type OAuthBroker } from "../src/mail/index.js";
import { MailWriter, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";

// OAuth-Konten gegen GreenMail (versteht XOAUTH2). Die Anmeldung beim Anbieter spielt ein Test-Broker nach.
// Ohne GREENMAIL_IMAP_PORT übersprungen. Alles erfunden.
const port = Number(process.env.GREENMAIL_IMAP_PORT ?? 0);
const host = process.env.GREENMAIL_HOST ?? "127.0.0.1";
const now = new Date("2026-10-01T12:00:00Z");

class TestBroker implements OAuthBroker {
  signIns: { provider: OAuthProviderId; hint?: string }[] = [];
  refreshes = 0;
  refreshFails: "no" | "revoked" | "offline" = "no";
  email: string;
  constructor(email: string) {
    this.email = email;
  }
  configured(): OAuthProviderId[] {
    return ["google"];
  }
  async signIn(provider: OAuthProviderId, hint?: string) {
    this.signIns.push({ provider, hint });
    return { accessToken: `zugriff-${this.signIns.length}`, refreshToken: "dauer-1", expiresAt: new Date(now.getTime() + 3600_000).toISOString(), email: this.email };
  }
  async refresh(_provider: OAuthProviderId, refreshToken: string): Promise<OAuthTokens> {
    this.refreshes++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.refreshFails === "revoked") throw new OAuthError("Die Anmeldung bei Google (Gmail) ist abgelaufen oder wurde widerrufen. Bitte erneut anmelden.", true);
    if (this.refreshFails === "offline") throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    return { accessToken: `neu-${this.refreshes}`, refreshToken, expiresAt: new Date(now.getTime() + 3600_000).toISOString() };
  }
}

describe.skipIf(!port)("OAuth-Konten gegen GreenMail", () => {
  let user: string;
  let broker: TestBroker;
  let service: MailService;
  let secrets: InMemorySecretStore;
  let repository: SqliteMailRepository;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    user = `oauth-${randomUUID().slice(0, 8)}@example.test`;
    const admin = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user, pass: "x" }, logger: false });
    await admin.connect();
    await admin.append("INBOX", ["From: Tom <tom@example.test>", `To: ${user}`, "Subject: Hallo per OAuth", `Date: ${now.toUTCString()}`, "Message-ID: <o1@example.test>", "", "Text", ""].join("\r\n"), [], now);
    await admin.logout();
    db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(now));
    repository = new SqliteMailRepository(db);
    secrets = new InMemorySecretStore();
    broker = new TestBroker(user);
    service = new MailService(repository, new MailWriter(db), secrets, {
      now: () => now,
      oauth: broker,
      oauthServers: { imap: { host, port, security: "none" }, smtp: { host, port: 3025, security: "none" } },
    });
  });

  afterEach(() => service?.dispose());

  it("Konto per Browser-Anmeldung: kein Passwort gespeichert, Mails kommen per XOAUTH2", async () => {
    expect(await service.oauthProviders()).toEqual(["google"]);
    const account = await service.addOAuthAccount("google", { removeDemoAccounts: true });
    expect(account).toMatchObject({ email: user, authType: "oauth2", provider: "gmail" });
    expect(await secrets.get(SecretKeys.accountPassword(account.id))).toBeNull();
    expect(parseStoredOAuth(await secrets.get(SecretKeys.oauthRefreshToken(account.id)))).toMatchObject({ provider: "google", refreshToken: "dauer-1" });
    await service.syncNow();
    const inbox = (await repository.mailboxes(account.id)).find((m) => m.role === "inbox");
    expect((await repository.messages({ kind: "mailbox", mailboxId: inbox?.id ?? "" }, 10)).map((m) => m.subject)).toContain("Hallo per OAuth");
  });

  it("nicht eingerichteter Anbieter wird abgelehnt", async () => {
    await expect(service.addOAuthAccount("microsoft", { removeDemoAccounts: true })).rejects.toThrow(/noch nicht eingerichtet/);
  });

  it("abgelaufenes Token wird einmal erneuert – auch bei gleichzeitigen Zugriffen", async () => {
    const account = await service.addOAuthAccount("google", { removeDemoAccounts: true });
    const stored = parseStoredOAuth(await secrets.get(SecretKeys.oauthRefreshToken(account.id)));
    await secrets.set(SecretKeys.oauthRefreshToken(account.id), JSON.stringify({ ...stored, expiresAt: new Date(now.getTime() - 1000).toISOString() }));
    // Neustart, dann zwei Verbindungen gleichzeitig: Abgleich und Wächter (IDLE)
    service.dispose();
    service = new MailService(repository, new MailWriter(db), secrets, { now: () => now, oauth: broker });
    service.startWatching();
    await service.syncNow();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(broker.refreshes).toBe(1);
    expect(parseStoredOAuth(await secrets.get(SecretKeys.oauthRefreshToken(account.id)))?.accessToken).toBe("neu-1");
  });

  it("widerrufen: Konto zeigt „erneut anmelden“; Neu-Anmeldung nur mit derselben Adresse", async () => {
    const account = await service.addOAuthAccount("google", { removeDemoAccounts: true });
    await service.syncNow();
    const stored = parseStoredOAuth(await secrets.get(SecretKeys.oauthRefreshToken(account.id)));
    await secrets.set(SecretKeys.oauthRefreshToken(account.id), JSON.stringify({ ...stored, expiresAt: new Date(now.getTime() - 1000).toISOString() }));
    broker.refreshFails = "revoked";
    service.dispose();
    // Neuer Dienst (wie nach einem App-Neustart) – keine offene Verbindung mehr
    service = new MailService(repository, new MailWriter(db), secrets, { now: () => now, oauth: broker });
    await service.syncNow();
    expect((await repository.accounts()).find((a) => a.id === account.id)?.syncError).toMatch(/erneut anmelden/);

    broker.email = "jemand.anderes@example.test";
    await expect(service.reauthorize(account.id)).rejects.toThrow(/erwartet/);
    broker.email = user;
    broker.refreshFails = "no";
    await service.reauthorize(account.id);
    expect(broker.signIns.at(-1)).toEqual({ provider: "google", hint: user });
    expect((await repository.accounts()).find((a) => a.id === account.id)?.syncError).toBeNull();
  });

  it("Senden per SMTP mit Token", async () => {
    const account = await service.addOAuthAccount("google", { removeDemoAccounts: true });
    await service.send({ accountId: account.id, to: [{ address: "empfaenger@example.test" }], cc: [], bcc: [], subject: "Gesendet mit OAuth", bodyText: "Hallo" });
    await service.flushNow(account.id);
    expect((await service.overview()).outbox).toEqual([]);
    const receiver = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: "empfaenger@example.test", pass: "x" }, logger: false });
    await receiver.connect();
    const lock = await receiver.getMailboxLock("INBOX");
    try {
      const subjects: string[] = [];
      for await (const message of receiver.fetch("1:*", { envelope: true })) subjects.push(message.envelope?.subject ?? "");
      expect(subjects).toContain("Gesendet mit OAuth");
    } finally {
      lock.release();
      await receiver.logout();
    }
  });
});
