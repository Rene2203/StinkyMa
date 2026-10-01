import type { ResultOrigin } from "./ai/tasks.js";
import type { EmailAddress, Message, MessageCategory } from "./models.js";

// Regeln in normaler Sprache (W6.4): Der Nutzer schreibt „Newsletter von zeitung.example ins Archiv“; daraus wird eine
// feste, nachvollziehbare Regel. Plattformneutral, ohne KI – die KI liefert nur einen Vorschlag, der hier geprüft wird.
// Grundsatz: Nichts erfinden. Absender und Betreff-Wörter müssen im Text des Nutzers vorkommen, Ordner müssen existieren.

export const ruleMoves = ["archive", "trash", "spam"] as const;
export type RuleMove = (typeof ruleMoves)[number];

export const ruleCategories: readonly MessageCategory[] = ["personal", "work", "newsletter", "notification", "invoice", "appointment", "spam_suspect"];

export interface RuleDefinition {
  /** Absender enthält eines davon (Adresse, Domain oder Name) – leer = egal. */
  from: string[];
  /** Betreff enthält eines davon – leer = egal. */
  subject: string[];
  /** Einordnung der KI – null = egal. */
  category: MessageCategory | null;
  /** Nur Mails mit Anhang. */
  hasAttachment: boolean;
  /** In einen festen Ordner verschieben … */
  move: RuleMove | null;
  /** … oder in einen eigenen Ordner (Name wie auf dem Server). Höchstens eins von beiden. */
  folder: string | null;
  markRead: boolean;
  flag: boolean;
}

export interface MailRule {
  id: string;
  /** Was der Nutzer geschrieben hat. */
  text: string;
  /** null = alle Konten */
  accountId: string | null;
  definition: RuleDefinition;
  enabled: boolean;
  createdAt: string;
}

export const emptyRule: RuleDefinition = { from: [], subject: [], category: null, hasAttachment: false, move: null, folder: null, markRead: false, flag: false };

export type RuleProblem = "noCondition" | "noAction" | "unknownFolder" | "notInText";

const fold = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** Bereinigt eine Regel und nennt, was fehlt. `text` gesetzt: Absender/Betreff müssen darin vorkommen (gegen Erfundenes). */
export function checkRule(input: RuleDefinition, context: { folders: readonly string[]; text?: string }): { definition: RuleDefinition; problems: RuleProblem[] } {
  const problems = new Set<RuleProblem>();
  const text = context.text === undefined ? null : fold(context.text);
  const keep = (values: string[]) => {
    const unique = [...new Map(values.map((v) => v.trim().replace(/^@/, "")).filter((v) => v.length >= 2).map((v) => [v.toLowerCase(), v])).values()].slice(0, 5);
    if (text === null) return unique;
    const found = unique.filter((v) => text.includes(fold(v)));
    if (found.length < unique.length) problems.add("notInText");
    return found;
  };
  const definition: RuleDefinition = {
    from: keep(input.from),
    subject: keep(input.subject),
    category: input.category && ruleCategories.includes(input.category) ? input.category : null,
    hasAttachment: input.hasAttachment,
    move: input.move && ruleMoves.includes(input.move) ? input.move : null,
    folder: null,
    markRead: input.markRead,
    flag: input.flag,
  };
  if (input.folder?.trim()) {
    const wanted = fold(input.folder);
    const folder = context.folders.find((f) => fold(f) === wanted) ?? context.folders.find((f) => fold(leafName(f)) === wanted);
    if (folder) definition.folder = folder;
    else problems.add("unknownFolder");
  }
  if (definition.folder) definition.move = null; // eigener Ordner geht vor
  if (definition.move === "trash" || definition.move === "spam") definition.flag = false;
  if (!definition.from.length && !definition.subject.length && !definition.category && !definition.hasAttachment) problems.add("noCondition");
  if (!definition.move && !definition.folder && !definition.markRead && !definition.flag) problems.add("noAction");
  return { definition, problems: [...problems] };
}

/** Trifft die Regel auf die Mail zu? „waiting“: hängt von der Einordnung ab, die noch fehlt. */
export function ruleMatches(definition: RuleDefinition, message: Pick<Message, "from" | "subject" | "category" | "hasAttachments">): boolean | "waiting" {
  const sender = fold(`${message.from.name ?? ""} <${message.from.address}>`);
  if (definition.from.length && !definition.from.some((f) => sender.includes(fold(f)))) return false;
  const subject = fold(message.subject);
  if (definition.subject.length && !definition.subject.some((s) => subject.includes(fold(s)))) return false;
  if (definition.hasAttachment && !message.hasAttachments) return false;
  if (definition.category) {
    if (!message.category) return "waiting";
    if (message.category !== definition.category) return false;
  }
  return true;
}

// --- Regeln aus Text ohne KI (Rückfall und Grundlage für die Prüfung) ---

const categoryWords: [RegExp, MessageCategory][] = [
  [/\bnewsletter?n?\b|\bwerbung\b|\bwerbemails?\b|\bangebote\b/, "newsletter"],
  [/\brechnungen\b|\brechnung\b(?! von)/, "invoice"],
  [/\bbenachrichtigungen\b|\bbenachrichtigung\b|\bmitteilungen\b|\bautomatische(n)? mails?\b/, "notification"],
  [/\btermine\b|\beinladungen\b/, "appointment"],
  [/\bverdächtige(n)? mails?\b|\bbetrugsmails?\b/, "spam_suspect"],
];

const stopAfterName = /\s+[–—-]\s|\s+(?:nie|niemals|nicht|in|ins|im|nach|als|automatisch|sofort|direkt|immer|bitte|archivieren|löschen|verschieben|markieren|mit|und|oder|landen|kommen|sollen|soll|gleich|zum|zur|an|auf|aus|einfach)\b|[,.;:!?]|$/i;
const articles = /^(?:der|die|das|dem|den|des|meinem|meiner|meinen|mein|meine|unserem|unserer|unser|unsere|einem|einer|einen)\s+/i;

/** Liest eine einfache Regel aus deutschem Text. Ergebnis immer über `checkRule` prüfen. */
export function parseRuleText(text: string, folders: readonly string[]): RuleDefinition {
  const definition: RuleDefinition = { ...emptyRule, from: [], subject: [] };
  const lower = text.toLowerCase();
  const quoted = [...text.matchAll(/[„"“'‚]([^"“”'‘]{2,60})["“”'‘]/g)].map((m) => ({ value: (m[1] ?? "").trim(), index: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));

  // Betreff: Wörter in Anführungszeichen nahe „Betreff“
  for (const q of quoted) {
    const around = lower.slice(Math.max(0, q.index - 40), Math.min(lower.length, q.end + 15));
    if (/betreff|titel/.test(around)) definition.subject.push(q.value);
  }
  if (!definition.subject.length) {
    const plain = /betreff\s+(?:enthält\s+|mit\s+)?([\wäöüß-]{3,30})/i.exec(text);
    if (plain?.[1] && !/^(enthält|steht|ist|hat)$/i.test(plain[1])) definition.subject.push(plain[1]);
  }

  // Absender: Adressen, Domains, „von X“
  const addresses = [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]);
  definition.from.push(...addresses);
  for (const m of text.matchAll(/(?:^|[\s(])@?((?:[a-z0-9-]+\.)+(?:de|com|net|org|eu|info|example|test|at|ch|io|shop))\b/gi)) {
    const domain = m[1] ?? "";
    if (!addresses.some((a) => a.toLowerCase().endsWith(domain.toLowerCase()))) definition.from.push(domain);
  }
  if (!definition.from.length) {
    // „von X …“, „Absender X“ oder „was X schickt/schreibt“
    const sends = /\bwas\s+(.{2,60}?)\s+(?:schickt|sendet|schreibt|verschickt)\b/i.exec(text);
    const von = sends ?? /\b(?:von|vom|absender)\s+(.+)/i.exec(text);
    if (von?.[1]) {
      const rest = sends ? `${von[1]},` : von[1];
      const quotedName = /^[„"“'‚]([^"“”'‘]{2,60})["“”'‘]/.exec(rest);
      let name = quotedName?.[1] ?? rest.slice(0, rest.search(stopAfterName)).trim();
      name = name.replace(articles, "").trim();
      const isCategory = categoryWords.some(([re]) => re.test(name.toLowerCase()));
      if (name.length >= 2 && name.split(/\s+/).length <= 4 && !isCategory && !/^(allen|jedem|jemand|unbekannten?|mir)$/i.test(name)) definition.from.push(name);
    }
  }

  // Einordnung (nicht, wenn das Wort nur im Betreff-Zitat steht)
  const outsideQuotes = [...quoted.map((q) => q.value), ...definition.from].reduce((acc, value) => acc.replace(value.toLowerCase(), " "), lower);
  definition.category = categoryWords.find(([re]) => re.test(outsideQuotes))?.[1] ?? null;
  definition.hasAttachment = /\bmit anh(a|ä)ng(en)?\b/.test(lower);

  // Aktionen
  // Ordner per vollem Namen oder letztem Teil („INBOX/Verein“ → „Verein“), längere Namen zuerst
  const mentions = (name: string) =>
    name.trim().length >= 2 && new RegExp(`(?:in|ins|nach|zu|unter|ordner)\\s+(?:den |die |das |dem |meinen |meine |ordner )?[„"“']?${escapeRegExp(name.toLowerCase())}(?![\\wäöüß])`).test(lower);
  const byLength = [...folders].sort((a, b) => b.length - a.length);
  const folder = byLength.find(mentions) ?? byLength.find((f) => leafName(f) !== f && mentions(leafName(f)));
  if (folder) definition.folder = folder;
  else if (/\barchiv/.test(lower)) definition.move = "archive";
  else if (/papierkorb|\blösch|\bentfern|\bwegwerfen/.test(lower)) definition.move = "trash";
  else if (/\bspam|\bjunk/.test(lower)) definition.move = "spam";
  definition.markRead = /als gelesen|gelesen markieren|auf gelesen|\bgelesen setzen/.test(lower);
  definition.flag = /fähnchen|markier(?!.{0,12}gelesen)|wichtig|\bmerken\b|kennzeichnen/.test(lower.replace(/als gelesen markieren|gelesen markieren/g, ""));
  return definition;
}

/** Letzter Teil eines Ordnerpfads („INBOX/Vereine/TSV“ → „TSV“; Trennzeichen „/“ oder „.“). */
export function leafName(path: string): string {
  return path.split(/[/.]/).filter(Boolean).at(-1) ?? path;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Stimmt eine Regel mit der Erwartung überein? Nicht genannte Felder müssen leer/aus sein. Für Tests und Messlauf. */
export function ruleEquals(actual: RuleDefinition, expected: Partial<RuleDefinition>): boolean {
  const want: RuleDefinition = { ...emptyRule, ...expected };
  const set = (values: string[]) => [...new Set(values.map(fold))].sort().join("|");
  return (
    set(actual.from) === set(want.from) &&
    set(actual.subject) === set(want.subject) &&
    actual.category === want.category &&
    actual.hasAttachment === want.hasAttachment &&
    actual.move === want.move &&
    (actual.folder ?? null) === (want.folder ?? null) &&
    actual.markRead === want.markRead &&
    actual.flag === want.flag
  );
}

// --- Schnittstelle für die Oberfläche (Windows: per IPC, Server: per HTTP) ---

export interface RulePreview {
  definition: RuleDefinition;
  problems: RuleProblem[];
  /** Wer die Regel gelesen hat: Modell auf dem Gerät oder einfache Regeln; null = von Hand bearbeitet. */
  origin: ResultOrigin | null;
  /** Wie viele Mails im Posteingang jetzt schon passen würden. */
  matchCount: number;
  samples: { id: string; from: EmailAddress; subject: string; date: string }[];
}

export interface RuleInput {
  id?: string;
  text: string;
  accountId: string | null;
  definition: RuleDefinition;
}

export interface RulesApi {
  list(): Promise<MailRule[]>;
  folders(accountId: string | null): Promise<string[]>;
  /** Text → Regel mit Vorschau. Speichert nichts. */
  interpret(text: string, accountId: string | null): Promise<RulePreview>;
  /** Vorschau nach Änderungen von Hand. */
  preview(definition: RuleDefinition, accountId: string | null): Promise<RulePreview>;
  /** Speichert (neu oder geändert). `applyToExisting`: auch auf passende Mails im Posteingang anwenden. */
  save(input: RuleInput, applyToExisting: boolean): Promise<MailRule>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

export const rulesApiMethods = ["list", "folders", "interpret", "preview", "save", "setEnabled", "remove"] as const satisfies readonly (keyof RulesApi)[];
