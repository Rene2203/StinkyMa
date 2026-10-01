import { defaultAppSettings } from "@stinkyma/core";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsFile } from "../src/main/settings";

describe("Einstellungsdatei", () => {
  const dir = mkdtempSync(join(tmpdir(), "stinkyma-settings-"));
  afterEach(() => rmSync(join(dir, "settings.json"), { force: true }));

  it("ohne Datei: Standardwerte; Änderungen und Merker werden gespeichert und wieder gelesen", () => {
    const path = join(dir, "settings.json");
    const first = new SettingsFile(path);
    expect(first.settings.closeToTray).toBe(true);
    first.update({ notifications: "off", launchAtLogin: true });
    first.setFlag("trayHintShown");
    const second = new SettingsFile(path);
    expect(second.settings).toEqual({ ...defaultAppSettings, closeToTray: true, launchAtLogin: true, notifications: "off" });
    expect(second.flag("trayHintShown")).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).notifications).toBe("off");
  });

  it("kaputte Datei: mit Standardwerten weiter, statt abzustürzen", () => {
    const path = join(dir, "settings.json");
    writeFileSync(path, "{ kaputt");
    expect(new SettingsFile(path).settings.notifications).toBe("full");
  });
});
