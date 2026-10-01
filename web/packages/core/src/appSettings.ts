// Einstellungen der App selbst (nicht der Mails): Verhalten des Fensters, Autostart, Benachrichtigungen.
// Plattformabhängig umgesetzt – die Windows-App speichert sie in einer Datei im Benutzerordner; andere
// Plattformen (Server, iPad) können Teile davon weglassen. Die Oberfläche kennt nur diese Schnittstelle.

export type NotificationMode = "full" | "minimal" | "off";

export interface AppSettings {
  /** Fenster schließen = im Infobereich weiterlaufen (Mails kommen weiter an). */
  closeToTray: boolean;
  /** Mit dem Betriebssystem starten (im Infobereich, ohne Fenster). */
  launchAtLogin: boolean;
  /** Benachrichtigungen: mit Absender und Betreff, nur „Neue Mail“ oder aus. */
  notifications: NotificationMode;
  /**
   * Eigene App-Registrierung für die Anmeldung per Browser (OAuth). Leer = nicht eingerichtet. Das „Secret“ einer
   * Google-Desktop-App ist laut Google nicht geheim; Microsoft braucht keins.
   */
  oauthClients: { google: { clientId: string; clientSecret: string }; microsoft: { clientId: string } };
  /** Tagesüberblick als Benachrichtigung um diese Uhrzeit (HH:MM); leer = aus. */
  digestTime: string;
}

export const defaultAppSettings: AppSettings = {
  closeToTray: true,
  launchAtLogin: false,
  notifications: "full",
  oauthClients: { google: { clientId: "", clientSecret: "" }, microsoft: { clientId: "" } },
  digestTime: "",
};

export interface AppSettingsApi {
  get(): Promise<AppSettings>;
  /** Ändert einzelne Einstellungen und gibt den neuen Stand zurück. */
  update(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** Welche Einstellungen es auf dieser Plattform gibt (z. B. Autostart nur unter Windows/macOS). */
  available(): Promise<Record<keyof AppSettings, boolean>>;
}

export const appSettingsMethods = ["get", "update", "available"] as const satisfies readonly (keyof AppSettingsApi)[];

/** Liest gespeicherte Einstellungen tolerant: Unbekanntes oder Kaputtes fällt auf den Standard zurück. */
export function normalizeAppSettings(raw: unknown): AppSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notifications = value.notifications;
  return {
    closeToTray: typeof value.closeToTray === "boolean" ? value.closeToTray : defaultAppSettings.closeToTray,
    launchAtLogin: typeof value.launchAtLogin === "boolean" ? value.launchAtLogin : defaultAppSettings.launchAtLogin,
    notifications: notifications === "full" || notifications === "minimal" || notifications === "off" ? notifications : defaultAppSettings.notifications,
    oauthClients: normalizeOAuthClients(value.oauthClients),
    digestTime: typeof value.digestTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.digestTime) ? value.digestTime : "",
  };
}

function normalizeOAuthClients(raw: unknown): AppSettings["oauthClients"] {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
  return {
    google: { clientId: text(value.google?.clientId), clientSecret: text(value.google?.clientSecret) },
    microsoft: { clientId: text(value.microsoft?.clientId) },
  };
}
