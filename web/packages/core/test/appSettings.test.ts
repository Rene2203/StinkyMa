import { describe, expect, it } from "vitest";
import { defaultAppSettings, normalizeAppSettings } from "../src/index.js";

describe("App-Einstellungen", () => {
  it("Standard: Infobereich an, Autostart aus, Benachrichtigung mit Absender/Betreff", () => {
    expect(normalizeAppSettings(undefined)).toEqual(defaultAppSettings);
    expect(defaultAppSettings).toEqual({
      closeToTray: true,
      launchAtLogin: false,
      notifications: "full",
      oauthClients: { google: { clientId: "", clientSecret: "" }, microsoft: { clientId: "" } },
      digestTime: "",
    });
  });

  it("übernimmt Gültiges, ersetzt Kaputtes durch den Standard", () => {
    expect(normalizeAppSettings({ closeToTray: false, launchAtLogin: "ja", notifications: "laut", unbekannt: 1 })).toEqual({
      closeToTray: false,
      launchAtLogin: false,
      notifications: "full",
      oauthClients: defaultAppSettings.oauthClients,
      digestTime: "",
    });
    expect(normalizeAppSettings({ notifications: "minimal" }).notifications).toBe("minimal");
    // Tagesüberblick: nur gültige Uhrzeiten
    expect(normalizeAppSettings({ digestTime: "07:30" }).digestTime).toBe("07:30");
    expect(normalizeAppSettings({ digestTime: "25:00" }).digestTime).toBe("");
    expect(normalizeAppSettings({ digestTime: "7 Uhr" }).digestTime).toBe("");
  });

  it("App-Registrierung für die Anmeldung per Browser: getrimmt, Kaputtes wird leer", () => {
    expect(normalizeAppSettings({ oauthClients: { google: { clientId: " 123.apps.example ", clientSecret: 7 }, microsoft: "kaputt" } }).oauthClients).toEqual({
      google: { clientId: "123.apps.example", clientSecret: "" },
      microsoft: { clientId: "" },
    });
  });
});
