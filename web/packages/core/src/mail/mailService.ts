import { randomUUID } from "node:crypto";
import type { ImapFlow } from "imapflow";
import {
  isDemoAccount,

  type Account,
  type AccountColor,
  type Attachment,
  type EmailAddress,
  type Mailbox,
  type MailboxRole,
  type Message,
  type MessageFlagName,
  type MessageScope,
} from "../models.js";
import type { MailOverview, MailRepository } from "../repository.js";
import { SecretKeys, type SecretStore } from "../secrets.js";
import type { SqliteMailRepository } from "../sqlite/repository.js";
import type { MailWriter, PendingAction } from "../sqlite/writer.js";
import { messageIdFor, syncAccount, type SyncResult } from "./accountSync.js";
import { connectImap, describeConnectionError, loginFor, MailConnectionError, testImapLogin } from "./connection.js";
import { imapFlagName } from "./flags.js";
import type { AccountSettings, AccountsApi, AddAccountOptions, SyncStatus } from "../accounts.js";
import type { ComposeDraft, OutgoingMail } from "../compose.js";
import { buildMessage, sendRaw, smtpLoginFor, SmtpRejectedError } from "./smtp.js";
import { extractAttachment } from "./parse.js";

export type { AccountSettings, AccountsApi, AddAccountOptions, SyncStatus };
export { accountsApiMethods } from "../accounts.js";

const accountColors: AccountColor[] = ["blue", "green", "orange", "purple", "pink", "teal", "red", "yellow"];

export interface MailServiceOptions {
  /** Zeitraum für den Abgleich in Tagen (Standard 30). */
  syncDays?: number;
  /** Wird nach jeder Änderung aufgerufen (neue Mails, Flags, Konten) – z. B. um die Oberfläche neu zu laden. */
  onChange?: () => void;
  now?: () => Date;
  /** Wie lange eine ungenutzte Serververbindung offen bleibt (Standard 2 Minuten). */
  idleTimeoutMs?: number;
  /** Schreibpause, nach der ein Entwurf zum Server geht (Standard 8 Sekunden). */
  draftUploadDelayMs?: number;
  /** Neue ungelesene Mails im Posteingang (nicht beim ersten Abgleich eines Kontos) – für Benachrichtigungen. */
  onNewMail?: (accountId: string, messages: Message[]) => void;
  /** Wartezeit vor dem Abgleich, nachdem der Server neue Mails gemeldet hat (bündelt mehrere Meldungen). */
  watchDebounceMs?: number;
}

/** Nach so vielen Fehlversuchen (Server lehnt ab, nicht: offline) wird eine Aktion verworfen. */
const maxActionAttempts = 5;

/**
 * Verbindet lokale Datenbank und Mailserver.
 * - Lesen immer aus der Datenbank (schnell, offline-fähig).
 * - Aktionen (gelesen, markieren, verschieben) wirken **sofort lokal** und landen in einer dauerhaften
 *   Warteschlange (`pendingAction`); ein Hintergrundlauf überträgt sie zum Server – auch nach Neustart
 *   oder wenn das Internet zurück ist (Spezifikation 4.3).
 * - Vor jedem Abgleich wird die Warteschlange geleert, damit der Server lokale Änderungen nicht zurückdreht.
 * - Eine Verbindung pro Konto wird wiederverwendet und nach einer Leerlaufzeit geschlossen.
 * Beispielkonten bleiben rein lokal.
 */
export class MailService implements MailRepository, AccountsApi {
  #running: Promise<void> | null = null;
  #lastRunAt: string | null = null;
  readonly #accountLocks = new Map<string, Promise<unknown>>();
  readonly #clients = new Map<string, ImapFlow>();
  readonly #idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Wächter-Verbindungen (IMAP IDLE auf dem Posteingang), je Konto. */
  readonly #watchers = new Map<string, { client: ImapFlow | null; timer: ReturnType<typeof setTimeout> | null; failures: number }>();
  #watching = false;
  #disposed = false;

  constructor(
    private readonly repository: SqliteMailRepository,
    private readonly writer: MailWriter,
    private readonly secrets: SecretStore,
    private readonly options: MailServiceOptions = {},
  ) {}

  // --- Lesen: direkt aus der Datenbank ---

  accounts(): Promise<Account[]> { return this.repository.accounts(); }
  mailboxes(accountId: string): Promise<Mailbox[]> { return this.repository.mailboxes(accountId); }
  messages(scope: MessageScope, limit: number): Promise<Message[]> { return this.repository.messages(scope, limit); }
  thread(threadId: string): Promise<Message[]> { return this.repository.thread(threadId); }
  message(id: string): Promise<Message | null> { return this.repository.message(id); }
  attachments(messageId: string): Promise<Attachment[]> { return this.repository.attachments(messageId); }
  unreadCount(scope: MessageScope): Promise<number> { return this.repository.unreadCount(scope); }
  overview(): Promise<MailOverview> { return this.repository.overview(); }
  remoteContentExceptions(): Promise<string[]> { return this.repository.remoteContentExceptions(); }
  addRemoteContentException(input: string): Promise<string> { return this.repository.addRemoteContentException(input); }
  removeRemoteContentException(exception: string): Promise<void> { return this.repository.removeRemoteContentException(exception); }

  // --- Senden ---

  /**
   * Nur auf ausdrücklichen Klick des Nutzers. Die fertige Nachricht kommt sofort in den dauerhaften Postausgang
   * (übersteht Neustart und Offline-Phasen) und wird im Hintergrund gesendet, danach in „Gesendet“ abgelegt.
   */
  async send(mail: OutgoingMail): Promise<void> {
    const account = this.writer.account(mail.accountId);
    if (!account) throw new Error("Konto nicht gefunden.");
    if (mail.to.length + mail.cc.length + mail.bcc.length === 0) throw new Error("Bitte mindestens einen Empfänger angeben.");
    if (isDemoAccount(account)) {
      await this.repository.send(mail);
      this.options.onChange?.();
      return;
    }
    // Weiterleiten: Anhänge der Originalmail jetzt vom Server holen und fest anhängen.
    if (mail.forwardAttachments?.length) {
      const loaded = [];
      for (const a of mail.forwardAttachments) {
        try {
          const content = await this.attachmentContent(a.id);
          loaded.push({ filename: content.filename, mimeType: content.mimeType, size: content.content.length, contentBase64: content.content.toString("base64") });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Der Anhang „${a.filename}“ der weitergeleiteten Mail konnte nicht geladen werden (${reason}). Ohne ihn senden: im Mail-Fenster entfernen.`);
        }
      }
      mail = { ...mail, attachments: [...(mail.attachments ?? []), ...loaded], forwardAttachments: [] };
    }
    const now = this.#now();
    const domain = account.email.split("@")[1] ?? "stinkyma.local";
    const built = await buildMessage(mail, {
      from: { name: account.displayName, address: account.email },
      messageId: `<${randomUUID()}@${domain}>`,
      date: now,
    });
    this.writer.enqueueOutgoing({
      id: randomUUID(),
      accountId: account.id,
      mail: JSON.stringify(mail),
      raw: built.raw,
      messageId: built.messageId,
      createdAt: now.toISOString(),
    });
    this.options.onChange?.();
    if (mail.draftId) await this.deleteDraft(mail.draftId);
    this.#scheduleFlush(account.id);
  }

  // --- Entwürfe ---

  /** Lokal sofort; die Server-Kopie folgt nach einer Schreibpause (nicht bei jedem Tastendruck hochladen). */
  async saveDraft(draftId: string | null, draft: ComposeDraft): Promise<string> {
    const id = await this.repository.saveDraft(draftId, draft);
    this.options.onChange?.();
    if (!isDemoAccount({ id: draft.accountId })) this.#scheduleDraftUpload(draft.accountId);
    return id;
  }

  async deleteDraft(draftId: string): Promise<void> {
    const accountId = this.writer.draftAccount(draftId);
    await this.repository.deleteDraft(draftId);
    this.options.onChange?.();
    if (accountId && !isDemoAccount({ id: accountId })) this.#scheduleFlush(accountId);
  }

  async setSignature(accountId: string, html: string | null): Promise<void> {
    await this.repository.setSignature(accountId, html);
    this.options.onChange?.();
  }

  search(query: string, options: { scope?: MessageScope | null; limit: number }): Promise<Message[]> {
    return this.repository.search(query, options);
  }

  suggestAddresses(query: string, limit: number): Promise<EmailAddress[]> {
    return this.repository.suggestAddresses(query, limit);
  }

  openDraft(messageId: string): Promise<ComposeDraft | null> {
    return this.repository.openDraft(messageId);
  }

  #scheduleDraftUpload(accountId: string): void {
    const previous = this.#draftTimers.get(accountId);
    if (previous) clearTimeout(previous);
    if (this.#disposed) return;
    const timer = setTimeout(() => {
      this.#draftTimers.delete(accountId);
      this.#scheduleFlush(accountId);
    }, this.options.draftUploadDelayMs ?? 8_000);
    timer.unref?.();
    this.#draftTimers.set(accountId, timer);
  }

  async reopenOutgoing(id: string): Promise<OutgoingMail | null> {
    const mail = await this.repository.reopenOutgoing(id);
    this.options.onChange?.();
    return mail;
  }

  /**
   * Inhalt eines empfangenen Anhangs – wird bei Bedarf vom Server geholt (nicht vorab gespeichert, spart Platz).
   * Anhang-IDs haben die Form `<Mail-ID>/a<Index>`.
   */
  async attachmentContent(attachmentId: string): Promise<{ filename: string; mimeType: string; content: Buffer }> {
    const match = /^(.*)\/a(\d+)$/.exec(attachmentId);
    const messageId = match?.[1];
    const index = Number(match?.[2]);
    const location = messageId ? this.writer.messageLocation(messageId) : null;
    if (!messageId || !location) throw new Error("Die Mail zu diesem Anhang gibt es nicht mehr.");
    if (isDemoAccount({ id: location.accountId })) throw new Error("Das ist eine Beispielmail – der Anhang hat keinen Inhalt.");
    if (location.uid === null) throw new Error("Die Mail wird gerade verschoben. Bitte gleich noch einmal versuchen.");
    const uid = location.uid;
    return this.#withAccount(location.accountId, async (client) => {
      const lock = await client.getMailboxLock(this.#pathOf(location.accountId, location.mailboxId));
      try {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) throw new Error("Die Mail ist auf dem Server nicht mehr vorhanden.");
        const attachment = await extractAttachment(message.source, index);
        if (!attachment) throw new Error("Anhang nicht gefunden.");
        return attachment;
      } finally {
        lock.release();
      }
    });
  }

  /** Wie viele Mails noch im Postausgang warten (ohne endgültig abgelehnte). */
  outgoingCount(accountId?: string): number {
    return this.writer.outgoingCount(accountId);
  }

  // --- Aktionen ---

  /** Sofort lokal; bei echten Konten zusätzlich in die Warteschlange für den Server. */
  async setFlag(flag: MessageFlagName, enabled: boolean, messageIds: string[]): Promise<void> {
    const createdAt = this.#now().toISOString();
    const accounts = new Set<string>();
    this.writer.transaction(() => {
      for (const id of messageIds) {
        const location = this.writer.messageLocation(id);
        if (!location || isDemoAccount({ id: location.accountId })) continue;
        this.writer.enqueueAction({
          accountId: location.accountId,
          messageId: id,
          kind: "flag",
          payload: { flag, enabled, mailboxId: location.mailboxId, uid: location.uid },
          createdAt,
        });
        accounts.add(location.accountId);
      }
    });
    await this.repository.setFlag(flag, enabled, messageIds);
    this.options.onChange?.();
    for (const accountId of accounts) this.#scheduleFlush(accountId);
  }

  /** Sofort lokal in den Zielordner; der Server folgt über die Warteschlange. */
  async move(messageIds: string[], role: MailboxRole): Promise<void> {
    const createdAt = this.#now().toISOString();
    for (const [accountId, ids] of this.#groupByAccount(messageIds)) {
      if (isDemoAccount({ id: accountId })) {
        await this.repository.move(ids, role);
        continue;
      }
      const target = this.writer.mailboxes(accountId).find((m) => m.role === role);
      if (!target) continue; // Kein passender Ordner auf dem Server – Mail bleibt, wo sie ist.
      this.writer.transaction(() => {
        for (const id of ids) {
          const location = this.writer.messageLocation(id);
          if (!location || location.mailboxId === target.id) continue;
          this.writer.enqueueAction({
            accountId,
            messageId: id,
            kind: "move",
            payload: { fromMailboxId: location.mailboxId, uid: location.uid, toMailboxId: target.id },
            createdAt,
          });
          this.writer.moveLocally(id, target.id);
        }
      });
      this.#scheduleFlush(accountId);
    }
    this.options.onChange?.();
  }

  /** Wie viele Änderungen noch zum Server müssen (für Anzeige und Tests). */
  pendingChanges(accountId?: string): number {
    return this.writer.pendingActionCount(accountId);
  }

  /** Überträgt wartende Aktionen eines Kontos jetzt (wartet auf das Ergebnis). */
  async flushNow(accountId: string): Promise<void> {
    await this.#withAccount(accountId, async (client) => {
      await this.#flushOutbox(client, accountId);
      await this.#flush(client, accountId);
      await this.#flushDrafts(client, accountId);
    });
  }

  // --- Konten ---

  async testConnection(settings: AccountSettings, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await testImapLogin(loginFor(settings, password));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof MailConnectionError ? error.message : describeConnectionError(error) };
    }
  }

  async addAccount(settings: AccountSettings, password: string, options: AddAccountOptions): Promise<Account> {
    const test = await this.testConnection(settings, password);
    if (!test.ok) throw new Error(test.error);

    const existing = (await this.repository.accounts()).find(
      (a) => a.email.toLowerCase() === settings.email.trim().toLowerCase() && !isDemoAccount(a),
    );
    if (existing) throw new Error("Dieses Konto ist bereits eingerichtet.");

    if (options.removeDemoAccounts) {
      for (const demo of (await this.repository.accounts()).filter(isDemoAccount)) this.writer.deleteAccount(demo.id);
    }
    const used = new Set(this.writer.usedColors());
    const account: Account = {
      id: randomUUID(),
      email: settings.email.trim(),
      displayName: settings.displayName.trim() || settings.email.trim(),
      provider: settings.provider,
      username: settings.username.trim() || settings.email.trim(),
      imapHost: settings.imapHost.trim(),
      imapPort: settings.imapPort,
      imapSecurity: settings.imapSecurity,
      smtpHost: settings.smtpHost.trim(),
      smtpPort: settings.smtpPort,
      smtpSecurity: settings.smtpSecurity,
      authType: "password",
      color: accountColors.find((c) => !used.has(c)) ?? "blue",
      aiCloudAllowed: false,
      sortOrder: this.writer.nextSortOrder(),
      lastSyncAt: null,
      syncError: null,
    };
    await this.secrets.set(SecretKeys.accountPassword(account.id), password);
    this.writer.insertAccount(account);
    this.options.onChange?.();
    void this.syncNow();
    this.#watch(account.id);
    return account;
  }

  async removeAccount(accountId: string): Promise<void> {
    this.#stopWatcher(accountId);
    this.#dropClient(accountId);
    this.writer.deleteAccount(accountId);
    await this.secrets.remove(SecretKeys.accountPassword(accountId));
    this.options.onChange?.();
  }

  // --- Abgleich ---

  async syncStatus(): Promise<SyncStatus> {
    return { running: this.#running !== null, lastRunAt: this.#lastRunAt };
  }

  /** Gleicht alle echten Konten ab. Läuft schon ein Abgleich, wird auf ihn gewartet statt doppelt zu starten. */
  syncNow(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#syncAll().finally(() => {
      this.#running = null;
      this.#lastRunAt = this.#now().toISOString();
      this.options.onChange?.();
    });
    return this.#running;
  }

  async syncAccountNow(accountId: string, options: { roles?: MailboxRole[] } = {}): Promise<SyncResult> {
    const account = this.writer.account(accountId);
    if (!account) throw new Error("Konto nicht gefunden");
    const firstSync = !account.lastSyncAt;
    const since = new Date(this.#now().getTime() - (this.options.syncDays ?? 30) * 86_400_000);
    try {
      const result = await this.#withAccount(accountId, async (client) => {
        await this.#flushOutbox(client, accountId);
        await this.#flush(client, accountId);
        await this.#flushDrafts(client, accountId);
        if (this.writer.pendingActionCount(accountId) > 0) {
          // Nicht abgleichen, solange lokale Änderungen fehlen – sonst würde der Server sie zurückdrehen.
          throw new MailConnectionError("Änderungen konnten noch nicht übertragen werden. Neuer Versuch beim nächsten Abruf.");
        }
        return syncAccount(client, this.writer, account, {
          since,
          ...(options.roles ? { roles: options.roles } : {}),
          onMailboxSynced: (counts) => {
            if (counts.added + counts.removed + counts.flagsChanged > 0) this.options.onChange?.();
          },
        });
      });
      this.writer.setSyncStatus(accountId, { lastSyncAt: this.#now().toISOString(), syncError: null });
      if (!firstSync && result.newInInbox.length > 0 && this.options.onNewMail) {
        const messages = (await Promise.all(result.newInInbox.map((id) => this.repository.message(id)))).filter((m): m is Message => m !== null);
        if (messages.length > 0) this.options.onNewMail(accountId, messages);
      }
      return result;
    } catch (error) {
      this.writer.setSyncStatus(accountId, {
        syncError: error instanceof MailConnectionError ? error.message : describeConnectionError(error),
      });
      throw error;
    }
  }

  async #syncAll(): Promise<void> {
    const accounts = (await this.repository.accounts()).filter((a) => !isDemoAccount(a));
    for (const account of accounts) {
      try {
        await this.syncAccountNow(account.id);
      } catch {
        // Fehler steht im Konto (syncError) und wird in der Oberfläche angezeigt.
      }
      this.options.onChange?.();
    }
  }

  // --- Neue Mails sofort (IMAP IDLE) ---

  /**
   * Hält je Konto eine eigene Verbindung zum Posteingang offen. Der Server meldet neue Mails selbst (IDLE);
   * dann wird nur der Posteingang abgeglichen. Bricht die Verbindung ab, wird mit wachsender Pause neu verbunden.
   */
  startWatching(): void {
    this.#watching = true;
    void this.repository.accounts().then((accounts) => {
      for (const account of accounts) if (!isDemoAccount(account)) this.#watch(account.id);
    });
  }

  /** Läuft für dieses Konto gerade eine Wächter-Verbindung? (für Anzeige und Tests) */
  isWatching(accountId: string): boolean {
    const client = this.#watchers.get(accountId)?.client;
    return Boolean(client?.usable && client.idling);
  }

  #watch(accountId: string): void {
    if (this.#disposed || !this.#watching || this.#watchers.get(accountId)?.client) return;
    const entry = this.#watchers.get(accountId) ?? { client: null, timer: null, failures: 0 };
    this.#watchers.set(accountId, entry);
    void this.#connectWatcher(accountId, entry);
  }

  async #connectWatcher(accountId: string, entry: { client: ImapFlow | null; timer: ReturnType<typeof setTimeout> | null; failures: number }): Promise<void> {
    const account = this.writer.account(accountId);
    if (!account || this.#disposed) return;
    try {
      const password = await this.secrets.get(SecretKeys.accountPassword(accountId));
      if (password === null) return;
      const client = await connectImap(loginFor(account, password), { maxIdleTimeMs: 4 * 60_000 });
      entry.client = client;
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const onServerChange = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          void this.syncAccountNow(accountId, { roles: ["inbox"] }).then(() => this.options.onChange?.(), () => undefined);
        }, this.options.watchDebounceMs ?? 1_000);
        debounce.unref?.();
      };
      client.on("exists", onServerChange);
      client.on("expunge", onServerChange);
      client.on("flags", onServerChange);
      client.on("close", () => {
        if (debounce) clearTimeout(debounce);
        if (entry.client === client) entry.client = null;
        this.#scheduleRewatch(accountId, entry);
      });
      await client.mailboxOpen("INBOX", { readOnly: true });
      entry.failures = 0;
      // Was zwischen letztem Abgleich und Start der Wache ankam (z. B. während einer Funkstille), jetzt holen.
      onServerChange();
      // Dauerhaft im IDLE-Modus warten (der Server meldet Änderungen selbst). idle() endet z. B. beim
      // regelmäßigen Erneuern – dann direkt wieder hinein, solange die Verbindung steht.
      void (async () => {
        while (client.usable && entry.client === client && !this.#disposed) {
          try {
            await client.idle();
          } catch {
            break;
          }
        }
      })();
    } catch {
      entry.client = null;
      this.#scheduleRewatch(accountId, entry);
    }
  }

  #scheduleRewatch(accountId: string, entry: { client: ImapFlow | null; timer: ReturnType<typeof setTimeout> | null; failures: number }): void {
    if (this.#disposed || !this.#watching || entry.timer || !this.writer.account(accountId)) return;
    entry.failures += 1;
    const delay = Math.min(300_000, 5_000 * 3 ** Math.min(entry.failures - 1, 4));
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!entry.client) void this.#connectWatcher(accountId, entry);
    }, delay);
    entry.timer.unref?.();
  }

  #stopWatcher(accountId: string): void {
    const entry = this.#watchers.get(accountId);
    if (!entry) return;
    this.#watchers.delete(accountId);
    if (entry.timer) clearTimeout(entry.timer);
    const client = entry.client;
    entry.client = null;
    client?.close();
  }

  /** Beim Beenden: offene Verbindungen sofort schließen, keine neuen mehr öffnen. Die Warteschlange bleibt gespeichert. */
  dispose(): void {
    this.#disposed = true;
    for (const timer of [...this.#idleTimers.values(), ...this.#flushTimers.values(), ...this.#draftTimers.values()]) clearTimeout(timer);
    this.#idleTimers.clear();
    this.#flushTimers.clear();
    this.#draftTimers.clear();
    for (const client of this.#clients.values()) client.close();
    this.#clients.clear();
    for (const accountId of [...this.#watchers.keys()]) this.#stopWatcher(accountId);
  }

  // --- Warteschlange ---

  /** Kurz gesammelt übertragen (mehrere schnelle Klicks → ein Durchlauf). */
  #scheduleFlush(accountId: string): void {
    if (this.#disposed || this.#flushTimers.has(accountId)) return;
    const timer = setTimeout(() => {
      this.#flushTimers.delete(accountId);
      this.flushNow(accountId)
        .then(() => {
          if (this.writer.account(accountId)?.syncError) {
            this.writer.setSyncStatus(accountId, { syncError: null });
            this.options.onChange?.();
          }
        })
        .catch((error) => {
          this.writer.setSyncStatus(accountId, {
            syncError: `Offline – Änderungen werden übertragen, sobald der Server erreichbar ist. (${error instanceof MailConnectionError ? error.message : describeConnectionError(error)})`,
          });
          this.options.onChange?.();
        });
    }, 50);
    timer.unref?.();
    this.#flushTimers.set(accountId, timer);
  }

  async #flush(client: ImapFlow, accountId: string): Promise<void> {
    let changed = false;
    for (const action of this.writer.pendingActions(accountId)) {
      try {
        await this.#apply(client, accountId, action);
        this.writer.completeAction(action.id);
        changed = true;
      } catch (error) {
        // Verbindung weg: abbrechen, alles bleibt in der Warteschlange.
        if (!client.usable || error instanceof MailConnectionError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (action.attempts + 1 >= maxActionAttempts) this.writer.completeAction(action.id);
        else this.writer.failAction(action.id, message);
      }
    }
    if (changed) this.options.onChange?.();
  }

  /**
   * Postausgang: erst per SMTP senden (danach `sentAt` – nie doppelt senden), dann in „Gesendet“ ablegen.
   * SMTP nicht erreichbar → Fehler an der Mail vermerken und später erneut; vom Server abgelehnt → „failed“,
   * der Nutzer muss die Mail bearbeiten. Nichts wird stillschweigend verworfen.
   */
  async #flushOutbox(client: ImapFlow, accountId: string): Promise<void> {
    const rows = this.writer.pendingOutgoing(accountId);
    if (rows.length === 0) return;
    const account = this.writer.account(accountId);
    if (!account) return;
    let changed = false;
    for (const row of rows) {
      if (!row.sentAt) {
        try {
          const password = await this.secrets.get(SecretKeys.accountPassword(accountId));
          if (password === null) throw new MailConnectionError("Kein Passwort gespeichert. Bitte das Konto neu einrichten.");
          const raw = Buffer.from(row.raw);
          await sendRaw(smtpLoginFor(account, password), { raw, envelope: envelopeOf(row.mail, account.email) });
          this.writer.markOutgoingSent(row.id, this.#now().toISOString());
          changed = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.writer.noteOutgoingError(row.id, message, { failed: error instanceof SmtpRejectedError, countAttempt: true });
          changed = true;
          if (error instanceof SmtpRejectedError) continue; // nächste Mail versuchen
          break; // Server nicht erreichbar – später erneut
        }
      }
      // In „Gesendet“ ablegen. Gmail und Outlook legen per SMTP gesendete Mails selbst dort ab.
      const sent = this.writer.mailboxes(accountId).find((m) => m.role === "sent");
      if (sent && account.provider !== "gmail" && account.provider !== "outlook") {
        try {
          await client.append(this.#pathOf(accountId, sent.id), Buffer.from(row.raw), ["\\Seen"]);
        } catch (error) {
          if (!client.usable) throw error;
          if (row.attempts + 1 < maxActionAttempts) {
            this.writer.noteOutgoingError(row.id, error instanceof Error ? error.message : String(error), { countAttempt: true });
            continue;
          }
          // Ablage klappt dauerhaft nicht – die Mail ist aber gesendet, also aus dem Postausgang nehmen.
        }
      }
      this.writer.completeOutgoing(row.id);
      const mail = JSON.parse(row.mail) as OutgoingMail;
      if (mail.answeredMessageId && this.writer.messageLocation(mail.answeredMessageId)) {
        await this.setFlag("answered", true, [mail.answeredMessageId]);
      }
      changed = true;
    }
    if (changed) this.options.onChange?.();
  }

  /**
   * Entwürfe zum Server: neue Fassung in „Entwürfe“ ablegen (\\Draft), alte Server-Kopie löschen, lokale Zeile
   * auf die neue UID umhängen. Gelöschte Entwürfe verschwinden auch vom Server.
   */
  async #flushDrafts(client: ImapFlow, accountId: string): Promise<void> {
    const rows = this.writer.pendingDrafts(accountId);
    if (rows.length === 0) return;
    const account = this.writer.account(accountId);
    if (!account) return;
    const mailboxes = this.writer.mailboxes(accountId);
    const draftsBox = mailboxes.find((m) => m.role === "drafts");
    let changed = false;
    for (const row of rows) {
      const oldBox = row.serverMailboxId ? mailboxes.find((m) => m.id === row.serverMailboxId) : undefined;
      const removeOld = async () => {
        if (row.serverUid === null || !oldBox) return;
        const lock = await client.getMailboxLock(this.#pathOf(accountId, oldBox.id));
        try {
          await client.messageDelete(String(row.serverUid), { uid: true });
        } finally {
          lock.release();
        }
      };
      if (row.deleted) {
        await removeOld();
        this.writer.removeDraftRow(row.id);
        continue;
      }
      const revision = this.writer.draftRevision(row.id);
      if (!draftsBox || !revision) {
        // Kein Entwürfe-Ordner auf dem Server: Entwurf bleibt nur lokal.
        if (revision) this.writer.markDraftUploaded(row.id, revision, { uid: null, mailboxId: "" });
        continue;
      }
      const mail = JSON.parse(row.mail) as ComposeDraft;
      const domain = account.email.split("@")[1] ?? "stinkyma.local";
      const built = await buildMessage(mail, {
        from: { name: account.displayName, address: account.email },
        messageId: `<draft-${randomUUID()}@${domain}>`,
        date: this.#now(),
      });
      const appended = await client.append(this.#pathOf(accountId, draftsBox.id), built.raw, ["\\Draft", "\\Seen"]);
      const uid = appended && typeof appended.uid === "number" ? appended.uid : null;
      await removeOld();
      const validity = draftsBox.uidValidity ?? (appended && typeof appended.uidValidity === "bigint" ? Number(appended.uidValidity) : null);
      if (row.messageId && uid !== null && validity !== null) {
        this.writer.relocateMessage(row.messageId, { newId: messageIdFor(draftsBox.id, validity, uid), mailboxId: draftsBox.id, uid });
      } else if (row.messageId && uid === null) {
        // Server nennt keine UID (kein UIDPLUS): lokale Zeile weg, der nächste Abgleich holt die Server-Kopie.
        this.writer.deleteMessages([row.messageId]);
        this.writer.unlinkDraftMessage(row.id);
      }
      this.writer.markDraftUploaded(row.id, revision, { uid, mailboxId: draftsBox.id });
      changed = true;
    }
    if (changed) this.options.onChange?.();
  }

  async #apply(client: ImapFlow, accountId: string, action: PendingAction): Promise<void> {
    const payload = action.payload as {
      flag?: MessageFlagName; enabled?: boolean; mailboxId?: string; fromMailboxId?: string; toMailboxId?: string; uid?: number | null;
    };
    // Ohne UID (Mail wurde lokal verschoben, bevor der Server geantwortet hat): aktuellen Stand nachschlagen.
    const current = this.writer.messageLocation(action.messageId);
    const sourceMailbox = action.kind === "move" ? payload.fromMailboxId : payload.mailboxId;
    let uid = payload.uid ?? null;
    let mailboxId = sourceMailbox ?? null;
    if (uid === null) {
      if (!current || current.uid === null) return; // nicht (mehr) auffindbar – nichts zu tun
      uid = current.uid;
      mailboxId = current.mailboxId;
    }
    if (!mailboxId) return;

    if (action.kind === "flag") {
      const lock = await client.getMailboxLock(this.#pathOf(accountId, mailboxId));
      try {
        const imapFlag = imapFlagName[payload.flag ?? "seen"];
        if (payload.enabled) await client.messageFlagsAdd(String(uid), [imapFlag], { uid: true });
        else await client.messageFlagsRemove(String(uid), [imapFlag], { uid: true });
      } finally {
        lock.release();
      }
      return;
    }

    const toMailboxId = payload.toMailboxId;
    if (!toMailboxId || toMailboxId === mailboxId) return;
    const lock = await client.getMailboxLock(this.#pathOf(accountId, mailboxId));
    let newUid: number | null = null;
    let moved = false;
    try {
      const result = await client.messageMove(String(uid), this.#pathOf(accountId, toMailboxId), { uid: true });
      moved = Boolean(result);
      newUid = result ? result.uidMap?.get(uid) ?? null : null;
    } finally {
      lock.release();
    }
    const validity = this.writer.mailboxes(accountId).find((m) => m.id === toMailboxId)?.uidValidity ?? null;
    if (moved && newUid !== null && validity !== null && current) {
      this.writer.relocateMessage(action.messageId, { newId: messageIdFor(toMailboxId, validity, newUid), mailboxId: toMailboxId, uid: newUid });
    } else if (current) {
      // Neue UID unbekannt (kein UIDPLUS) oder Mail auf dem Server nicht mehr da:
      // lokale Kopie entfernen, der nächste Abgleich holt die Mail dort, wo sie wirklich liegt.
      this.writer.deleteMessages([action.messageId]);
    }
  }

  // --- Verbindungen ---

  /** Vorgänge pro Konto laufen nacheinander über eine wiederverwendete Verbindung. */
  async #withAccount<T>(accountId: string, work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const previous = this.#accountLocks.get(accountId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      if (this.#disposed) throw new MailConnectionError("Die App wird beendet.");
      const client = await this.#client(accountId);
      try {
        return await work(client);
      } catch (error) {
        if (!client.usable) this.#dropClient(accountId);
        throw error;
      } finally {
        this.#scheduleIdleClose(accountId);
      }
    });
    this.#accountLocks.set(accountId, run);
    return run;
  }

  async #client(accountId: string): Promise<ImapFlow> {
    const existing = this.#clients.get(accountId);
    if (existing?.usable) return existing;
    if (existing) this.#dropClient(accountId);
    const account = this.writer.account(accountId);
    if (!account) throw new Error("Konto nicht gefunden");
    const password = await this.secrets.get(SecretKeys.accountPassword(accountId));
    if (password === null) throw new MailConnectionError("Kein Passwort gespeichert. Bitte das Konto neu einrichten.");
    const client = await connectImap(loginFor(account, password));
    client.on("close", () => {
      if (this.#clients.get(accountId) === client) this.#clients.delete(accountId);
    });
    this.#clients.set(accountId, client);
    return client;
  }

  #scheduleIdleClose(accountId: string): void {
    const previous = this.#idleTimers.get(accountId);
    if (previous) clearTimeout(previous);
    if (this.#disposed) return;
    const timer = setTimeout(() => {
      this.#idleTimers.delete(accountId);
      const client = this.#clients.get(accountId);
      this.#clients.delete(accountId);
      void client?.logout().catch(() => client.close());
    }, this.options.idleTimeoutMs ?? 120_000);
    timer.unref?.();
    this.#idleTimers.set(accountId, timer);
  }

  #dropClient(accountId: string): void {
    const client = this.#clients.get(accountId);
    this.#clients.delete(accountId);
    client?.close();
  }

  #groupByAccount(messageIds: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const id of messageIds) {
      const location = this.writer.messageLocation(id);
      if (!location) continue;
      groups.set(location.accountId, [...(groups.get(location.accountId) ?? []), id]);
    }
    return groups;
  }

  /** Mailbox-IDs sind `<Konto-ID>/<Pfad auf dem Server>`. */
  #pathOf(accountId: string, mailboxId: string): string {
    return mailboxId.slice(accountId.length + 1);
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

/** Umschlag aus den gespeicherten Composer-Eingaben (inkl. Bcc, das nicht in den Kopfzeilen steht). */
function envelopeOf(mailJson: string, from: string): { from: string; to: string[] } {
  const mail = JSON.parse(mailJson) as OutgoingMail;
  return { from, to: [...mail.to, ...mail.cc, ...mail.bcc].map((a) => a.address) };
}
