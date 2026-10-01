import type { OAuthProviderId } from "./oauth.js";
import type { Account, ConnectionSecurity } from "./models.js";

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
  /** Türsteher für dieses Konto gleich einschalten (Standard: aus). */
  screener?: boolean;
}

export interface SyncStatus {
  running: boolean;
  lastRunAt: string | null;
  /** Beim Holen vieler Mails (z. B. nach „alle Mails laden“): Konto, Ordner, geholt / fehlend. Sonst `null`. */
  progress?: { accountId: string; mailbox: string; done: number; total: number } | null;
}

/** Verwaltung von Konten und Abgleich – die Oberfläche ruft das über eine Brücke (IPC/HTTP) auf. */
export interface AccountsApi {
  addAccount(settings: AccountSettings, password: string, options: AddAccountOptions): Promise<Account>;
  /** Konto per Anmeldung im Browser (OAuth) hinzufügen – Gmail, Outlook. */
  addOAuthAccount(provider: OAuthProviderId, options: AddAccountOptions): Promise<Account>;
  /** Abgelaufene/widerrufene OAuth-Anmeldung erneuern. */
  reauthorize(accountId: string): Promise<void>;
  /** Für welche Anbieter eine App-Registrierung (Client-ID) eingerichtet ist. */
  oauthProviders(): Promise<OAuthProviderId[]>;
  testConnection(settings: AccountSettings, password: string): Promise<{ ok: true } | { ok: false; error: string }>;
  removeAccount(accountId: string): Promise<void>;
  syncNow(): Promise<void>;
  syncStatus(): Promise<SyncStatus>;
}

export const accountsApiMethods = ["addAccount", "addOAuthAccount", "reauthorize", "oauthProviders", "testConnection", "removeAccount", "syncNow", "syncStatus"] as const satisfies readonly (keyof AccountsApi)[];

