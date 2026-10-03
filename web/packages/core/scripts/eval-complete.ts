// Messlauf Autovervollständigung (W8.5): erfundene angefangene Entwürfe → Vorschlag des Modells nach der Code-Prüfung.
// Aufruf: npx tsx packages/core/scripts/eval-complete.ts <Modellordner> <modell-id> [--threads N]
// Es gibt keine „richtige“ Fortsetzung – ausgegeben werden alle Vorschläge zum Ansehen, dazu Anteil und Dauer.
import { join } from "node:path";
import { AIRouter, completionRequest, GrantPolicy, modelCatalog, parseCompletion, type CompletionInput } from "../src/index.js";
import { fileNameFromUrl, LlamaCppProvider } from "../src/llm/index.js";

const cases: (CompletionInput & { id: string; form?: "du" | "Sie" })[] = [
  { id: "c01", form: "du", subject: "Re: Grillabend am Samstag", before: "Hallo Tom,\nvielen Dank für die Einladung! Ich komme ", after: "> Hi Anna, wir grillen am Samstag ab 18 Uhr. Kommst du? Bring gern jemanden mit." },
  { id: "c02", form: "Sie", subject: "Re: Angebot Website-Relaunch", before: "Guten Tag Frau Schulz,\nvielen Dank für Ihre Nachricht. Ein Start im November ", after: "> Wäre ein Start im November realistisch? Dann könnten wir das Budget noch dieses Jahr einplanen." },
  { id: "c03", form: "Sie", subject: "Re: Ihre Abschlagsrechnung Oktober", before: "Sehr geehrte Damen und Herren,\nich habe eine Frage zu meiner ", after: "> anbei erhalten Sie Ihre Abschlagsrechnung für Oktober. Der Betrag von 84,20 € wird am 15.10. abgebucht." },
  { id: "c04", form: "du", subject: "Re: Protokoll Teammeeting", before: "Hi Tim,\ndanke fürs Protokoll. Ich kümmere mich ", after: "> Deine To-dos stehen unter Punkt 3: Präsentation überarbeiten, Kunden anrufen." },
  { id: "c05", subject: "Termin", before: "Hallo Herr Weber,\nkönnten wir unseren Termin ", after: "" },
  { id: "c06", form: "du", subject: "Re: Umzug", before: "Hey Lena,\nklar helfe ich dir beim Umzug. Soll ich ", after: "> Kannst du mir am Wochenende beim Umzug helfen? Ich hab einen Transporter gemietet." },
  { id: "c07", subject: "Bewerbung als Werkstudentin", before: "Sehr geehrte Frau Kaiser,\nhiermit bewerbe ich mich ", after: "" },
  { id: "c08", form: "Sie", subject: "Re: Terminerinnerung", before: "Guten Tag,\nleider kann ich den Termin am Dienstag nicht wahrnehmen. ", after: "> Wir erinnern Sie an Ihren Termin am Dienstag um 9:30 Uhr." },
  { id: "c09", subject: "Re: Lieferung", before: "Hallo,\ndie Lieferung ist heute angekommen, ", after: "> Ihre Bestellung wurde versandt und kommt voraussichtlich morgen." },
  { id: "c10", form: "du", subject: "Re: Wochenende?", before: "Hi Sara,\nam Samstag kann ich leider nicht, aber ", after: "> Hast du am Wochenende Zeit für einen Kaffee?" },
  { id: "c11", subject: "Re: Meeting tomorrow", before: "Hi John,\nthanks for the update. I will ", after: "> Can you send me the slides before the meeting tomorrow?" },
  { id: "c12", form: "Sie", subject: "Kündigung", before: "Sehr geehrte Damen und Herren,\nhiermit kündige ich ", after: "" },
  { id: "c13", form: "du", subject: "Re: Grillabend", before: "Hallo Tom,\nich komme um ", after: "> Wir grillen am Samstag. Kommst du?" },
  { id: "c14", subject: "Rückfrage", before: "Hallo Frau Brandt,\nkurze Rückfrage zu ", after: "" },
  { id: "c15", form: "Sie", subject: "Re: Reparatur", before: "Guten Tag Herr Klein,\nvielen Dank für den schnellen Einsatz. ", after: "> Unser Monteur war heute bei Ihnen und hat die Heizung repariert." },
  { id: "c16", form: "du", subject: "Geburtstag", before: "Liebe Oma,\nalles Gute zum ", after: "" },
];

// Kontrollsatz: geschrieben nach der Abstimmung von Prompt und Prüfung, danach nicht angepasst
const control: typeof cases = [
  { id: "k01", form: "Sie", subject: "Re: Ihre Bestellung 4711", before: "Guten Tag,\nleider ist die Ware beschädigt angekommen. Könnten Sie mir ", after: "> Ihre Bestellung wurde am Montag versandt." },
  { id: "k02", form: "du", subject: "Re: Kino?", before: "Hey Max,\nKino klingt super, welchen Film ", after: "> Lust auf Kino diese Woche?" },
  { id: "k03", form: "Sie", subject: "Re: Mietvertrag", before: "Sehr geehrter Herr Hoffmann,\nvielen Dank für die Zusendung des Mietvertrags. Ich werde ihn ", after: "> anbei der Mietvertrag zur Unterschrift." },
  { id: "k04", subject: "Krankmeldung", before: "Hallo Frau Becker,\nich bin leider krank und kann heute ", after: "" },
  { id: "k05", form: "du", subject: "Re: Fotos vom Urlaub", before: "Hi Jana,\ndie Fotos sind wunderschön! Besonders das ", after: "> Hier ein paar Fotos vom Urlaub am See." },
  { id: "k06", subject: "Re: Invoice", before: "Hello,\nplease find attached the ", after: "> Could you send me the invoice for September?" },
  { id: "k07", form: "Sie", subject: "Re: Vorstellungsgespräch", before: "Sehr geehrte Frau Lange,\nvielen Dank für die Einladung zum Vorstellungsgespräch. Den vorgeschlagenen Termin ", after: "> Wir laden Sie am Donnerstag, 9. Oktober, um 10 Uhr ein." },
  { id: "k08", form: "du", subject: "Re: Schlüssel", before: "Hallo Paul,\nden Schlüssel kannst du einfach ", after: "> Wo soll ich den Schlüssel lassen, wenn ihr weg seid?" },
  { id: "k09", subject: "Rückruf", before: "Guten Tag,\nich bitte um einen kurzen Rückruf, da ", after: "" },
  { id: "k10", form: "Sie", subject: "Re: Kostenvoranschlag", before: "Guten Tag Herr Yilmaz,\nder Kostenvoranschlag passt für uns. Wann ", after: "> Der Kostenvoranschlag für die Badsanierung liegt bei 8.400 €." },
  { id: "k11", form: "du", subject: "Re: Hausaufgaben", before: "Hi Lisa,\nich hab die Aufgabe auch nicht verstanden. Vielleicht ", after: "> Weißt du, wie Aufgabe 3 geht?" },
  { id: "k12", subject: "Re: Newsletter abbestellen", before: "Sehr geehrte Damen und Herren,\nbitte nehmen Sie mich aus ", after: "" },
];

const args = process.argv.slice(2);
const [directory, modelId] = args;
const threadsIndex = args.indexOf("--threads");
const threads = threadsIndex >= 0 ? Number(args[threadsIndex + 1]) : 0;
const model = modelCatalog.find((m) => m.id === modelId);
if (!directory || !model) throw new Error("Aufruf: eval-complete.ts <Modellordner> <modell-id>");
const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directory, fileNameFromUrl(model.url)), gpu: false, maxThreads: threads, idleUnloadMs: 0 });
const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
await router.run({ task: "complete", messages: [{ role: "user", content: "Hallo" }], maxTokens: 4 }, { accountIds: ["eval"] }); // Laden/Aufwärmen
const lines = [`Modell: ${model.name}`, "", "| Fall | Entwurf (Ende) | Modell (roh) | Vorschlag nach Prüfung | Zeit |", "|---|---|---|---|---|"];
const useControl = args.includes("--kontrolle");
const times: number[] = [];
let shown = 0;
for (const c of useControl ? control : cases) {
  const response = await router.run(completionRequest(c, c.form ?? null), { accountIds: ["eval"] });
  const text = parseCompletion(response.text, c);
  times.push(response.durationMs);
  if (text) shown++;
  const tail = c.before.split("\n").at(-1) ?? "";
  lines.push(`| ${c.id} | …${tail} | ${response.text.replace(/\n/g, " ⏎ ").slice(0, 80)} | ${text ? `**${text.trim()}**` : "–"} | ${(response.durationMs / 1000).toFixed(1)} s |`);
  process.stderr.write(".");
}
times.sort((a, b) => a - b);
lines.push("", `${useControl ? "Kontrollsatz" : "Testsatz"} – Vorschlag gezeigt: ${shown}/${(useControl ? control : cases).length}; Zeit je Vorschlag: Median ${((times[Math.floor(times.length / 2)] ?? 0) / 1000).toFixed(1)} s, max ${((times.at(-1) ?? 0) / 1000).toFixed(1)} s`);
console.log(lines.join("\n"));
await provider.dispose();
