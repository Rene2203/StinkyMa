import { describe, expect, it } from "vitest";
import { defaultAppSettings, normalizeAppSettings } from "../src/index.js";

describe("App-Einstellungen", () => {
  it("Standard: Infobereich an, Autostart aus, Benachrichtigung mit Absender/Betreff", () => {
    expect(normalizeAppSettings(undefined)).toEqual(defaultAppSettings);
    expect(defaultAppSettings).toEqual({ closeToTray: true, launchAtLogin: false, notifications: "full" });
  });

  it("übernimmt Gültiges, ersetzt Kaputtes durch den Standard", () => {
    expect(normalizeAppSettings({ closeToTray: false, launchAtLogin: "ja", notifications: "laut", unbekannt: 1 })).toEqual({
      closeToTray: false,
      launchAtLogin: false,
      notifications: "full",
    });
    expect(normalizeAppSettings({ notifications: "minimal" }).notifications).toBe("minimal");
  });
});
