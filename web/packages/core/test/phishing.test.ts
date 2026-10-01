import { describe, expect, it } from "vitest";
import { assessPhishing, evalHoldoutMails, evalMailToMessage, evalMails, linksFromHtml } from "../src/index.js";

// Testdaten erfunden.

const mail = (overrides: Partial<Parameters<typeof assessPhishing>[0]>) => ({
  from: { name: "Stadtwerke Musterstadt", address: "rechnung@stadtwerke.example" },
  subject: "Ihre Rechnung",
  bodyText: "Anbei Ihre Rechnung.",
  bodyHtml: null,
  snippet: "",
  category: null,
  ...overrides,
});

describe("Phishing-Check", () => {
  it("normale Mail: keine Warnung", () => {
    expect(assessPhishing(mail({}))).toEqual({ level: "none", score: 0, reasons: [] });
  });

  it("Link zeigt eine Adresse an und führt woandershin; IP-Adressen; Kurzlinks", () => {
    const html = '<p>Bitte prüfen: <a href="https://sparkasse-login.example/x">https://www.sparkasse.de/login</a> oder <a href="http://203.0.113.7/a">hier</a></p>';
    const result = assessPhishing(mail({ bodyHtml: html }));
    expect(result.reasons).toEqual([
      { code: "linkMismatch", shown: "www.sparkasse.de", target: "sparkasse-login.example" },
      { code: "ipLink", target: "203.0.113.7" },
    ]);
    expect(result.level).toBe("danger");
    expect(assessPhishing(mail({ bodyHtml: '<a href="https://bit.ly/abc">Angebot</a>' })).level).toBe("none"); // Kurzlink allein: nur Hinweis-Gewicht
    expect(linksFromHtml('<a class="x" href="https://a.example">Text <b>fett</b></a>')).toEqual([{ text: "Text fett", href: "https://a.example" }]);
  });

  it("gleiche Domain im Text und Link ist kein Problem", () => {
    expect(assessPhishing(mail({ bodyHtml: '<a href="https://www.stadtwerke.example/konto?x=1">www.stadtwerke.example</a>' })).level).toBe("none");
  });

  it("Bank-Nachahmung mit Druck und Datenabfrage", () => {
    const result = assessPhishing(mail({
      from: { name: "Sparkasse Kundenservice", address: "sicherheit@sparkasse-kundenservice.example" },
      subject: "Ihr Konto wurde vorübergehend gesperrt",
      bodyText: "Verifizieren Sie sich innerhalb von 24 Stunden über den folgenden Link, sonst wird Ihr Konto geschlossen.",
    }));
    expect(result.level).toBe("danger");
    expect(result.reasons.map((r) => r.code)).toEqual(["brandMismatch", "pressure"]);
  });

  it("„Chef“ von Freemail mit Gutscheinkarten", () => {
    const result = assessPhishing(mail({
      from: { name: "Geschäftsführung", address: "chef.firma@gmail.com" },
      subject: "Kurze Bitte",
      bodyText: "Kannst du 5 Gutscheinkarten kaufen und mir die Codes schicken? Bitte vertraulich.",
    }));
    expect(result.reasons.map((r) => r.code)).toEqual(["freemailOfficial", "giftCards"]);
    expect(result.level).toBe("danger");
  });

  it("riskanter Anhang zählt; bekannter Absender senkt etwas; KI-Einschätzung zählt mit", () => {
    expect(assessPhishing(mail({}), { attachmentNames: ["Rechnung.zip"] }).score).toBe(2);
    expect(assessPhishing(mail({}), { attachmentNames: ["Rechnung.zip"], knownSender: true }).score).toBe(0);
    const ai = assessPhishing(mail({ category: "spam_suspect", bodyText: "Bestätigen Sie Ihre Daten." }));
    expect(ai.reasons.map((r) => r.code)).toContain("aiSuspect");
  });

  it("Testsätze: ohne KI erkennt die Regel die meisten Betrugsmails – und gibt keinen Fehlalarm", () => {
    let detected = 0;
    const falseAlarms: string[] = [];
    const all = [...evalMails, ...evalHoldoutMails];
    for (const m of all) {
      const result = assessPhishing({ ...evalMailToMessage(m), category: null }, { attachmentNames: m.attachments });
      if (m.expected === "spam_suspect") detected += result.level === "none" ? 0 : 1;
      else if (result.level !== "none") falseAlarms.push(m.id);
    }
    expect(falseAlarms).toEqual([]);
    expect(detected).toBeGreaterThanOrEqual(10); // von 14 – mit KI-Einschätzung gemessen 13/14 (docs/KI-MESSUNG.md)
  });
});
