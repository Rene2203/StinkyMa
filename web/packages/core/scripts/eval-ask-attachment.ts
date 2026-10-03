// Messlauf „Frag den Anhang“ (W9.2): erfundene mehrseitige Dokumente, Fragen mit erwarteter Seite und Antwort, Fallen.
// Aufruf: npx tsx packages/core/scripts/eval-ask-attachment.ts <Modellordner> <modell-id> [--threads N]
import { join } from "node:path";
import { AIRouter, askAttachment, GrantPolicy, modelCatalog, notInDocument } from "../src/index.js";
import { fileNameFromUrl, LlamaCppProvider } from "../src/llm/index.js";

const filler = (topic: string, n: number) => Array.from({ length: n }, (_, i) => `${topic}, Absatz ${i + 1}: Die Parteien beachten die allgemeinen Regelungen dieses Abschnitts.`).join(" ");
const lease = [
  `Mietvertrag für Wohnraum. Vermieter: Hausverwaltung Klein GmbH. Mieterin: Anna Beispiel. Mietobjekt: Gartenweg 12, 2. OG links. ${filler("Mietobjekt", 12)}`,
  `§ 3 Miete. Die monatliche Grundmiete beträgt 850,00 €. Die Vorauszahlung auf die Betriebskosten beträgt 210,00 €. Die Miete ist bis zum dritten Werktag eines Monats zu zahlen. ${filler("Miete", 12)}`,
  `§ 4 Kaution. Die Mieterin leistet eine Kaution in Höhe von 2.550,00 €, zahlbar in drei Raten. ${filler("Kaution", 12)}`,
  `§ 9 Kündigung. Die Kündigungsfrist für die Mieterin beträgt drei Monate. Die Kündigung bedarf der Schriftform. ${filler("Kündigung", 12)}`,
  `§ 14 Haustiere. Kleintiere sind erlaubt. Hunde und Katzen nur mit schriftlicher Zustimmung des Vermieters. ${filler("Tierhaltung", 12)}`,
].join("\f");
const policy = [
  `Versicherungsschein Nr. VS-777888. Hausratversicherung. Versicherungsnehmerin: Anna Beispiel. Versicherungsbeginn: 01.11.2026. ${filler("Allgemeines", 10)}`,
  `Versicherungssumme: 65.000 €. Jahresbeitrag: 98,40 €, fällig jeweils zum 1. November. Selbstbeteiligung: 150 €. ${filler("Beitrag", 10)}`,
  `Fahrraddiebstahl ist bis 1.500 € mitversichert, sofern das Fahrrad abgeschlossen war. ${filler("Leistungen", 10)}`,
].join("\f");
const cases = [
  { doc: "Mietvertrag.pdf", text: lease, q: "Wie hoch ist die Kaution?", expect: /2\.550/, page: 3 },
  { doc: "Mietvertrag.pdf", text: lease, q: "Welche Kündigungsfrist habe ich?", expect: /drei monate|3 monate/i, page: 4 },
  { doc: "Mietvertrag.pdf", text: lease, q: "Darf ich einen Hund halten?", expect: /zustimmung/i, page: 5 },
  { doc: "Mietvertrag.pdf", text: lease, q: "Wie viel Miete zahle ich insgesamt im Monat?", expect: /1\.060|850.*210|210.*850/, page: 2 },
  { doc: "Mietvertrag.pdf", text: lease, q: "Ist ein Stellplatz in der Miete enthalten?", expect: null, page: null },
  { doc: "Police.pdf", text: policy, q: "Wann ist der Beitrag fällig?", expect: /1\. november/i, page: 2 },
  { doc: "Police.pdf", text: policy, q: "Ist mein Fahrrad versichert?", expect: /1\.500/, page: 3 },
  { doc: "Police.pdf", text: policy, q: "Wie hoch ist die Selbstbeteiligung?", expect: /150/, page: 2 },
  { doc: "Police.pdf", text: policy, q: "Sind Glasschäden mitversichert?", expect: null, page: null },
];

const args = process.argv.slice(2);
const [directory, modelId] = args;
const threads = args.includes("--threads") ? Number(args[args.indexOf("--threads") + 1]) : 0;
const model = modelCatalog.find((m) => m.id === modelId);
if (!directory || !model) throw new Error("Aufruf: eval-ask-attachment.ts <Modellordner> <modell-id>");
const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directory, fileNameFromUrl(model.url)), gpu: false, maxThreads: threads, idleUnloadMs: 0 });
const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
await router.run({ task: "askAttachment", messages: [{ role: "user", content: "Hallo" }], maxTokens: 4 }, { accountIds: ["eval"] });
let right = 0, pageRight = 0, traps = 0, trapRight = 0;
const times: number[] = [];
const lines = [`Modell: ${model.name}`, "", "| Frage | Antwort | Seiten | Zitat geprüft | richtig |", "|---|---|---|---|---|"];
for (const c of cases) {
  const result = await askAttachment(router, { filename: c.doc, text: c.text, question: c.q }, { accountIds: ["eval"], today: "2026-10-03" });
  times.push(result.durationMs);
  let ok: boolean;
  if (c.expect === null) {
    traps++;
    ok = !result.found || result.answer === notInDocument;
    if (ok) trapRight++;
  } else {
    ok = c.expect.test(result.answer);
    if (ok) right++;
    if (c.page !== null && result.pages.includes(c.page)) pageRight++;
  }
  lines.push(`| ${c.q} | ${result.answer.replace(/\|/g, "/")} | ${result.pages.join(", ") || "–"} | ${result.quote ? "ja" : "–"} | ${ok ? "✓" : "✗"} |`);
  process.stderr.write(".");
}
times.sort((a, b) => a - b);
const answerable = cases.length - traps;
lines.push("", `Antwort richtig: ${right}/${answerable}; richtige Seite genannt: ${pageRight}/${answerable}; Fallen erkannt: ${trapRight}/${traps}; Zeit je Frage: Median ${((times[Math.floor(times.length / 2)] ?? 0) / 1000).toFixed(1)} s`);
console.log(lines.join("\n"));
await provider.dispose();
