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

