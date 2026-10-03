/** Schlüssel für ein Geheimnis im sicheren Speicher (Windows: DPAPI über Electron safeStorage). */
export interface SecretKey {
  service: string;
  account: string;
}

export const SecretKeys = {
  accountPassword: (accountId: string): SecretKey => ({ service: "account-password", account: accountId }),
  oauthRefreshToken: (accountId: string): SecretKey => ({ service: "oauth-refresh-token", account: accountId }),
  aiApiKey: (providerId: string): SecretKey => ({ service: "ai-api-key", account: providerId }),
  attachmentPassword: (sender: string): SecretKey => ({ service: "attachment-password", account: sender.toLowerCase() }),
  /** Private ICS-Adresse eines Kalender-Abos (enthält einen geheimen Schlüssel) */
  calendarFeedUrl: (feedId: string): SecretKey => ({ service: "calendar-feed-url", account: feedId }),
};

/** Sicherer Speicher für Passwörter, Tokens und API-Keys. Inhalte werden nie geloggt. */
export interface SecretStore {
  set(key: SecretKey, value: string): Promise<void>;
  get(key: SecretKey): Promise<string | null>;
  remove(key: SecretKey): Promise<void>;
}

export function secretKeyId(key: SecretKey): string {
  return `${key.service}/${key.account}`;
}

/** Flüchtiger Speicher – für Tests und den Mock-Modus. */
export class InMemorySecretStore implements SecretStore {
  readonly #values = new Map<string, string>();

  async set(key: SecretKey, value: string): Promise<void> {
    this.#values.set(secretKeyId(key), value);
  }

  async get(key: SecretKey): Promise<string | null> {
    return this.#values.get(secretKeyId(key)) ?? null;
  }

  async remove(key: SecretKey): Promise<void> {
    this.#values.delete(secretKeyId(key));
  }
}
