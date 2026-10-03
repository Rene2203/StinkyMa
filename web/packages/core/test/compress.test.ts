import { describe, expect, it } from "vitest";
import { AIRouter, condense, GrantPolicy, splitIntoChunks, summarizeThread, type AIProvider, type AIRequest, type Message, type PrivacyClass } from "../src/index.js";

// Testdaten erfunden.
class ScriptedProvider implements AIProvider {
  readonly id = "fake";
  readonly displayName = "Fake";
  readonly contextWindow = 16_384;
  readonly privacyClass: PrivacyClass = "onDevice";
  readonly requests: AIRequest[] = [];
  constructor(private readonly answer: (request: AIRequest) => string) {}
  async generate(request: AIRequest) {
    this.requests.push(request);
    return { text: this.answer(request), providerId: this.id, privacyClass: this.privacyClass, durationMs: 1 };
  }
}

const mail = (i: number, body: string, from = "lena@mailbox.example"): Message => ({
  id: `m${i}`, accountId: "acc", mailboxId: "inbox", threadId: "t", from: { name: from === "anna@example.test" ? "Anna" : "Lena", address: from },
  to: [], cc: [], subject: "Umzug", date: `2026-09-${String(10 + i).padStart(2, "0")}T08:00:00Z`, snippet: body.slice(0, 50), bodyText: body, flags: 0, hasAttachments: false,
});

const summaryAnswer = JSON.stringify({ summary: "Lena plant den Umzug.", openPoints: [], letzteMailFragtOderBittet: false, letzteMailKuendigtMeldungAn: false });

describe("Komprimieren", () => {
  it("teilt an Absatzgrenzen; kurze Texte bleiben, lange werden verdichtet (Map-Reduce)", async () => {
    const text = Array.from({ length: 10 }, (_, i) => `Absatz ${i}: ${"Wort ".repeat(80)}`).join("\n\n");
    const chunks = splitIntoChunks(text, 1000);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(text.replace(/\s+/g, " ").trim());
    const provider = new ScriptedProvider(() => JSON.stringify({ verdichtet: "Kurz: Zahlung 12,50 € bis 05.10." }));
    const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
    expect(await condense(router, "kurz", { accountIds: ["acc"], targetChars: 100 })).toBe("kurz");
    const condensed = await condense(router, text, { accountIds: ["acc"], targetChars: 400, chunkChars: 1000 });
    expect(condensed.length).toBeLessThanOrEqual(400);
    expect(condensed).toContain("12,50 €");
    expect(provider.requests.length).toBeGreaterThan(1);
  });

  it("lange Konversation: neueste Mails im Wortlaut, früherer Verlauf verdichtet statt weggelassen", async () => {
    const thread = Array.from({ length: 12 }, (_, i) => mail(i, `Mail ${i}: ${"Inhalt ".repeat(120)} Betrag ${i},00 €.`));
    const provider = new ScriptedProvider((request) => (request.messages[0]?.content.startsWith("Verdichte") ? JSON.stringify({ verdichtet: "Früher: Kisten bestellt." }) : summaryAnswer));
    const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
    await summarizeThread(router, thread, { ownAddresses: ["anna@example.test"], maxChars: 4000 });
    const final = provider.requests.at(-1)?.messages.at(-1)?.content ?? "";
    expect(final).toContain("[Früherer Verlauf, verdichtet");
    expect(final).toContain("Früher: Kisten bestellt.");
    expect(final).toContain("Mail 11:"); // neueste im Wortlaut
    expect(final).not.toContain("ausgelassen");
  });

  it("laufende Zusammenfassung: nur bisherige Zusammenfassung plus neue Mails", async () => {
    const thread = [mail(1, "Ich ziehe am 20.10. um."), mail(2, "Kannst du helfen?", "anna@example.test"), mail(3, "Super, dann bis Samstag!")];
    const provider = new ScriptedProvider(() => summaryAnswer);
    const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
    await summarizeThread(router, thread, {
      ownAddresses: ["anna@example.test"],
      previous: { summary: "Lena zieht am 20.10. um; Anna soll helfen.", openPoints: ["Helfen?"], lastMessageDate: "2026-09-12T08:00:00Z" },
    });
    const input = provider.requests[0]?.messages.at(-1)?.content ?? "";
    expect(input).toContain("[Bisherige Zusammenfassung bis 2026-09-12]");
    expect(input).toContain("Lena zieht am 20.10. um");
    expect(input).toContain("Super, dann bis Samstag!");
    expect(input).not.toContain("Ich ziehe am 20.10. um."); // alte Mail nicht noch einmal
  });
});
