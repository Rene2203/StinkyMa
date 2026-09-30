import { randomUUID } from "node:crypto";
import type { ImapFlow } from "imapflow";
import {
  isDemoAccount,

  type Account,
  type AccountColor,
  type Attachment,
  type ConnectionSecurity,
  type Mailbox,
  type MailboxRole,
  type Message,
  type MessageFlagName,
  type MessageScope,
} from "../models.js";
import type { MailRepository } from "../repository.js";
import { SecretKeys, type SecretStore } from "../secrets.js";
import type { SqliteMailRepository } from "../sqlite/repository.js";
import type { MailWriter } from "../sqlite/writer.js";
import { messageIdFor, syncAccount, type SyncResult } from "./accountSync.js";
import { connectImap, describeConnectionError, loginFor, MailConnectionError, testImapLogin } from "./connection.js";
import { imapFlagName } from "./flags.js";

/** Eingaben aus dem Dialog „Konto hinzufügen“. */
export interface AccountSettings {
  email: string;
  displayName: string;
  provider: Account["provider"];
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: ConnectionSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: ConnectionSecurity;
}

export interface AddAccountOptions {
  /** Beispielkonten beim ersten echten Konto entfernen. */
  removeDemoAccounts: boolean;
}

export interface SyncStatus {
  running: boolean;
  lastRunAt: string | null;
}

/** Verwaltung von Konten und Abgleich – die Oberfläche ruft das über eine Brücke (IPC/HTTP) auf. */
export interface AccountsApi {
  addAccount(settings: AccountSettings, password: string, options: AddAccountOptions): Promise<Account>;
  testConnection(settings: AccountSettings, password: string): Promise<{ ok: true } | { ok: false; error: string }>;
  removeAccount(accountId: string): Promise<void>;
  syncNow(): Promise<void>;
  syncStatus(): Promise<SyncStatus>;
}

export const accountsApiMethods = ["addAccount", "testConnection", "removeAccount", "syncNow", "syncStatus"] as const satisfies readonly (keyof AccountsApi)[];

const accountColors: AccountColor[] = ["blue", "green", "orange", "purple", "pink", "teal", "red", "yellow"];

export interface MailServiceOptions {
  /** Zeitraum für den Abgleich in Tagen (Standard 30). */
  syncDays?: number;
  /** Wird nach jeder Änderung aufgerufen (neue Mails, Flags, Konten) – z. B. um die Oberfläche neu zu laden. */
  onChange?: () => void;
  now?: () => Date;
}

/**
 * Verbindet lokale Datenbank und Mailserver. Lesen immer aus der Datenbank (schnell, offline-fähig);
 * Aktionen bei echten Konten erst auf dem Server, dann lokal. Beispielkonten bleiben rein lokal.
 * Offline-Warteschlange für Aktionen folgt in Phase W3.
 */
export class MailService implements MailRepository, AccountsApi {
  #running: Promise<void> | null = null;
  #lastRunAt: string | null = null;
  readonly #accountLocks = new Map<string, Promise<unknown>>();

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

  // --- Aktionen ---

  async setFlag(flag: MessageFlagName, enabled: boolean, messageIds: string[]): Promise<void> {
    for (const [accountId, ids] of this.#groupByAccount(messageIds)) {
      if (isDemoAccount({ id: accountId })) {
        await this.repository.setFlag(flag, enabled, ids);
        continue;
      }
      await this.#withAccount(accountId, async (client) => {
        for (const [mailboxId, entries] of this.#groupByMailbox(ids)) {
          const path = this.#pathOf(accountId, mailboxId);
          const uids = entries.map((e) => e.uid).filter((u): u is number => u !== null);
          if (uids.length === 0) continue;
          const lock = await client.getMailboxLock(path);
          try {
            if (enabled) await client.messageFlagsAdd(uids.join(","), [imapFlagName[flag]], { uid: true });
            else await client.messageFlagsRemove(uids.join(","), [imapFlagName[flag]], { uid: true });
          } finally {
            lock.release();
          }
        }
      });
      await this.repository.setFlag(flag, enabled, ids);
    }
    this.options.onChange?.();
  }

  async move(messageIds: string[], role: MailboxRole): Promise<void> {
    for (const [accountId, ids] of this.#groupByAccount(messageIds)) {
      if (isDemoAccount({ id: accountId })) {
        await this.repository.move(ids, role);
        continue;
      }
      const target = this.writer.mailboxes(accountId).find((m) => m.role === role);
      if (!target) continue; // Kein passender Ordner auf dem Server – Mail bleibt, wo sie ist.
      await this.#withAccount(accountId, async (client) => {
        for (const [mailboxId, entries] of this.#groupByMailbox(ids)) {
          if (mailboxId === target.id) continue;
          const path = this.#pathOf(accountId, mailboxId);
          const withUid = entries.filter((e): e is typeof e & { uid: number } => e.uid !== null);
          if (withUid.length === 0) continue;
          const lock = await client.getMailboxLock(path);
          let uidMap: Map<number, number> | undefined;
          try {
            const result = await client.messageMove(withUid.map((e) => e.uid).join(","), this.#pathOf(accountId, target.id), { uid: true });
            uidMap = result ? result.uidMap : undefined;
          } finally {
            lock.release();
          }
          const targetValidity = this.writer.mailboxes(accountId).find((m) => m.id === target.id)?.uidValidity ?? null;
          for (const entry of withUid) {
            const newUid = uidMap?.get(entry.uid) ?? null;
            if (newUid !== null && targetValidity !== null) {
              this.writer.relocateMessage(entry.id, { newId: messageIdFor(target.id, targetValidity, newUid), mailboxId: target.id, uid: newUid });
            } else {
              // Server meldet keine neue UID (kein UIDPLUS): lokal entfernen, der nächste Abgleich holt sie im Zielordner.
              this.writer.deleteMessages([entry.id]);
            }
          }
        }
      });
    }
    this.options.onChange?.();
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
      const result = await this.#withAccount(accountId, (client) => syncAccount(client, this.writer, account, { since }));
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

  // --- Hilfen ---

  /** Eine Verbindung pro Vorgang, Vorgänge pro Konto nacheinander. Ein Verbindungs-Pool folgt mit IDLE in W4. */
  async #withAccount<T>(accountId: string, work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const previous = this.#accountLocks.get(accountId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const account = this.writer.account(accountId);
      if (!account) throw new Error("Konto nicht gefunden");
      const password = await this.secrets.get(SecretKeys.accountPassword(accountId));
      if (password === null) throw new MailConnectionError("Kein Passwort gespeichert. Bitte das Konto neu einrichten.");
      const client = await connectImap(loginFor(account, password));
      try {
        return await work(client);
      } finally {
        await client.logout().catch(() => client.close());
      }
    });
    this.#accountLocks.set(accountId, run);
    return run;
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

  #groupByMailbox(ids: string[]): Map<string, { id: string; uid: number | null }[]> {
    const groups = new Map<string, { id: string; uid: number | null }[]>();
    for (const id of ids) {
      const location = this.writer.messageLocation(id);
      if (!location) continue;
      groups.set(location.mailboxId, [...(groups.get(location.mailboxId) ?? []), { id, uid: location.uid }]);
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

