import { describe, expect, it } from "vitest";
import { addressForm, evalMails, joinGreeting, parseReplies, replyGreeting, stripClosing } from "../src/index.js";

const mail = (id: string) => evalMails.find((m) => m.id === id)!;

describe("Antwortvorschläge: Regeln", () => {
  it("erkennt du/Sie wie in der Mail", () => {
    for (const id of ["p01", "p03", "p04", "p07", "p09", "w02", "w03"]) expect(addressForm(mail(id).body), id).toBe("du");
    // nur mit Vornamen unterschrieben – unter Bekannten
    expect(addressForm(mail("p06").body, mail("p06").from)).toBe("du");
    for (const id of ["w01", "w04", "w05"]) expect(addressForm(mail(id).body), id).toBe("Sie");
    expect(addressForm("Können Sie mir bitte die Unterlagen schicken?")).toBe("Sie");
    expect(addressForm("Kurze Info zum Termin.")).toBe("Sie"); // im Zweifel höflich
  });

  it("Anrede: Vorname beim Duzen, voller Name beim Siezen, Firmen neutral", () => {
    expect(replyGreeting({ name: "Tom Wagner", address: "tom@x.example" }, "du")).toBe("Hallo Tom,");
    expect(replyGreeting({ name: "Dr. Michael Braun", address: "m.braun@x.example" }, "Sie")).toBe("Guten Tag Dr. Michael Braun,");
    expect(replyGreeting({ name: "Personalabteilung", address: "personal@firma.example" }, "Sie")).toBe("Guten Tag,");
    expect(replyGreeting({ name: "Stadtwerke Musterstadt", address: "rechnung@stadtwerke.example" }, "du")).toBe("Hallo,");
    expect(replyGreeting({ name: null, address: "x@y.example" }, "du")).toBe("Hallo,");
  });

  it("Grußformel am Ende weg – ein Satz, der mit „Ihre“ beginnt, bleibt", () => {
    expect(stripClosing("Gern, ich komme.\n\nViele Grüße\nAnna")).toBe("Gern, ich komme.");
    expect(stripClosing("Klingt gut!\nLG")).toBe("Klingt gut!");
    expect(stripClosing("Danke für die Info.\nIhre Frage beantworte ich morgen.")).toBe("Danke für die Info.\nIhre Frage beantworte ich morgen.");
  });

  it("verwirft Platzhalter, falsche Anrede, erfundene Zahlen und Doppelte; Anrede/Gruß werden abgeschnitten", () => {
    const source = "Hast du am 28. Zeit? Pizza geht auf mich.";
    const parse = (agree: string, decline: string, ask: string, form: "du" | "Sie" = "du") => parseReplies(JSON.stringify({ agree, decline, ask }), source, form);
    expect(parse("Hallo Jonas,\nklar, am 28. bin ich dabei!\nViele Grüße", "Am 28. kann ich leider nicht, sorry.", "Um wie viel Uhr soll ich um 10 da sein?")).toEqual([
      { kind: "agree", label: "Zusagen / Danke", text: "klar, am 28. bin ich dabei!" },
      { kind: "decline", label: "Absagen / Später", text: "Am 28. kann ich leider nicht, sorry." },
    ]);
    expect(parse("Ich komme gern, [Name].", "Gerne helfe ich Ihnen beim Umzug.", "")).toBeNull();
    expect(parse("Klar!", "Gleich wie oben, gleich wie oben.", "Gleich wie oben, gleich wie oben.")).toEqual([{ kind: "decline", label: "Absagen / Später", text: "Gleich wie oben, gleich wie oben." }]);
    expect(parse("Hast du Zeit?", "", "", "Sie")).toBeNull();
    expect(parseReplies("kein json", source, "du")).toBeNull();
  });

  it("Anrede und Text: Funktionswörter klein weiter, Substantive groß", () => {
    expect(joinGreeting("Hallo Tom,", "Ja, ich komme gern.")).toBe("Hallo Tom,\nja, ich komme gern.");
    expect(joinGreeting("Hallo Tom,", "Ich bin dabei.")).toBe("Hallo Tom,\nich bin dabei.");
    expect(joinGreeting("Guten Tag,", "Vielen Dank für Ihr Angebot.")).toBe("Guten Tag,\nvielen Dank für Ihr Angebot.");
    expect(joinGreeting("Hallo Max,", "Samstag passt mir gut.")).toBe("Hallo Max,\nSamstag passt mir gut.");
    expect(joinGreeting("Hallo Lena,", "Welches Rezept meinst du?")).toBe("Hallo Lena,\nwelches Rezept meinst du?");
  });
});
