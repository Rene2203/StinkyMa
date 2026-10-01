import { describe, expect, it } from "vitest";
import { categorizeWindow, normalizeAISettings } from "../src/index.js";

describe("Zeitraum für die Einordnung", () => {
  const now = new Date(2026, 9, 1, 12, 0); // 1. Oktober 2026, Ortszeit

  it("neue Mails immer; dazu der gewählte Zeitraum", () => {
    const recent = categorizeWindow({ kind: "recent" }, now);
    expect(recent.from).toBeNull();
    expect(new Date(recent.since).getTime()).toBe(now.getTime() - 14 * 86_400_000);
    expect(categorizeWindow({ kind: "all" }, now)).toMatchObject({ from: "", to: null });
    expect(new Date(categorizeWindow({ kind: "days", days: 90 }, now).from ?? "").getTime()).toBe(now.getTime() - 90 * 86_400_000);
    const custom = categorizeWindow({ kind: "custom", from: "2026-03-01", to: "2026-03-31" }, now);
    expect(custom.from).toBe(new Date(2026, 2, 1).toISOString());
    expect(custom.to).toBe(new Date(2026, 3, 1).toISOString()); // Enddatum einschließlich
  });

  it("liest gespeicherte Einstellungen tolerant; frühere „auch ältere“ wird „alle“", () => {
    expect(normalizeAISettings({}).categorizeRange).toEqual({ kind: "recent" });
    expect(normalizeAISettings({ categorizeOlder: true }).categorizeRange).toEqual({ kind: "all" });
    expect(normalizeAISettings({ categorizeRange: { kind: "custom", from: "2026-05-10", to: "2026-02-01" } }).categorizeRange).toEqual({ kind: "custom", from: "2026-02-01", to: "2026-05-10" });
    expect(normalizeAISettings({ categorizeRange: { kind: "custom", from: "gestern", to: "2026-02-01" } }).categorizeRange).toEqual({ kind: "recent" });
    expect(normalizeAISettings({ categorizeRange: { kind: "days", days: 90 } }).categorizeRange).toEqual({ kind: "days", days: 90 });
    expect(normalizeAISettings({ categorizeRange: { kind: "days", days: -3 } }).categorizeRange).toEqual({ kind: "recent" });
  });
});
