import { randomUUID } from "node:crypto";
import type { ImapFlow } from "imapflow";
import {
  isDemoAccount,

  type Account,
  type AccountColor,
  type Attachment,
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
    await this.#withAccount(accountId, (client) => this.#flush(client, accountId));
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
    return account;
  }

  async removeAccount(accountId: string): Promise<void> {
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

  async syncAccountNow(accountId: string): Promise<SyncResult> {
    const account = this.writer.account(accountId);
    if (!account) throw new Error("Konto nicht gefunden");
    const since = new Date(this.#now().getTime() - (this.options.syncDays ?? 30) * 86_400_000);
    try {
      const result = await this.#withAccount(accountId, async (client) => {
        await this.#flush(client, accountId);
        if (this.writer.pendingActionCount(accountId) > 0) {
          // Nicht abgleichen, solange lokale Änderungen fehlen – sonst würde der Server sie zurückdrehen.
          throw new MailConnectionError("Änderungen konnten noch nicht übertragen werden. Neuer Versuch beim nächsten Abruf.");
        }
        return syncAccount(client, this.writer, account, {
          since,
          onMailboxSynced: (counts) => {
            if (counts.added + counts.removed + counts.flagsChanged > 0) this.options.onChange?.();
          },
        });
      });
      this.writer.setSyncStatus(accountId, { lastSyncAt: this.#now().toISOString(), syncError: null });
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

  /** Beim Beenden: offene Verbindungen sofort schließen, keine neuen mehr öffnen. Die Warteschlange bleibt gespeichert. */
  dispose(): void {
    this.#disposed = true;
    for (const timer of [...this.#idleTimers.values(), ...this.#flushTimers.values()]) clearTimeout(timer);
    this.#idleTimers.clear();
    this.#flushTimers.clear();
    for (const client of this.#clients.values()) client.close();
    this.#clients.clear();
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

