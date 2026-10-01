import { describe, expect, it } from "vitest";
import { createMockData, displayName, fileExtension, initials, listDateStyle, makeSnippet, SecretKeys, InMemorySecretStore } from "../src/index.js";

describe("Modelle", () => {
  it("Anzeigename fällt auf die Adresse zurück", () => {
    expect(displayName({ name: "Anna", address: "a@example.org" })).toBe("Anna");
    expect(displayName({ name: "  ", address: "a@example.org" })).toBe("a@example.org");
    expect(displayName({ address: "a@example.org" })).toBe("a@example.org");
  });

  it.each([
    [{ name: "Anna Beispiel", address: "a@x" }, "AB"],
    [{ name: "Praxis Dr. Sonnenschein", address: "p@x" }, "PS"],
    [{ name: "Mama", address: "m@x" }, "M"],
    [{ address: "tim.kaiser@x" }, "TK"],
    [{ name: "123", address: "4@x" }, "?"],
  ])("Initialen %o → %s", (address, expected) => {
    expect(initials(address)).toBe(expected);
  });

  it.each([
    ["Rechnung.pdf", "pdf"],
    ["Rechnung.PDF.exe", "exe"],
    ["ohne_endung", ""],
    [".profile", ""],
  ])("Endung von %s", (name, ext) => {
    expect(fileExtension(name)).toBe(ext);
  });

  it("Snippet fasst Zeilen zusammen und kürzt", () => {
    expect(makeSnippet("Hallo\n\n  Welt  \n")).toBe("Hallo Welt");
    expect(makeSnippet("a".repeat(200), 10)).toBe("aaaaaaaaaa…");
  });

  it("Datumsdarstellung relativ zu jetzt", () => {
    const now = new Date(2026, 8, 29, 10);
    expect(listDateStyle(new Date(2026, 8, 29, 1), now)).toBe("time");
    expect(listDateStyle(new Date(2026, 8, 28, 23), now)).toBe("yesterday");
    expect(listDateStyle(new Date(2026, 8, 24, 12), now)).toBe("weekday");
    expect(listDateStyle(new Date(2026, 8, 23, 0), now)).toBe("weekday");
    expect(listDateStyle(new Date(2026, 8, 22, 23), now)).toBe("date");
    expect(listDateStyle(new Date(2026, 8, 30, 9), now)).toBe("date");
  });

  it("Threads fassen ihre Mails zusammen", () => {
    const data = createMockData();
    const thread = data.threads.find((t) => t.id === "mock-thread-grillabend")!;
    const dates = data.messages.filter((m) => m.threadId === thread.id).map((m) => m.date).sort();
    expect(thread.subject).toBe("Grillabend am Samstag");
    expect(thread.lastDate).toBe(dates.at(-1));
    expect(thread.participants).toHaveLength(2);
  });
});

describe("Sicherer Speicher (Arbeitsspeicher)", () => {
  it("speichert, liest, überschreibt und löscht", async () => {
    const store = new InMemorySecretStore();
    const key = SecretKeys.accountPassword("icloud");
    expect(await store.get(key)).toBeNull();
    await store.set(key, "abcd-efgh");
    expect(await store.get(key)).toBe("abcd-efgh");
    await store.set(key, "neu");
    expect(await store.get(key)).toBe("neu");
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
    await store.remove(key);
  });

  it("Schlüssel kollidieren nicht", async () => {
    const store = new InMemorySecretStore();
    await store.set(SecretKeys.accountPassword("a"), "pw");
    await store.set(SecretKeys.oauthRefreshToken("a"), "token");
    expect(await store.get(SecretKeys.accountPassword("a"))).toBe("pw");
    expect(await store.get(SecretKeys.oauthRefreshToken("a"))).toBe("token");
    expect(SecretKeys.attachmentPassword("Bank@Example.org").account).toBe("bank@example.org");
  });
});
