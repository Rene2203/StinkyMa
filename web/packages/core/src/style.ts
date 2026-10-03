// Stilprofil (W8.4): Wie schreibt der Nutzer? Aus seinen gesendeten Mails, per Code (Anrede, Gruß, Länge, du/Sie je
// Person). Fließt in Antwortvorschläge ein und ist auf der Transparenz-Seite sichtbar. Plattformneutral.

export interface StyleProfile {
  /** Ausgewertete gesendete Mails */
  analyzed: number;
  /** Häufigste Anrede-Art („Hallo“, „Hi“, „Liebe/r“, „Guten Tag“, „Sehr geehrte/r“, „Moin“) */
  greeting: string | null;
  /** Häufigster Gruß am Ende („Viele Grüße“, „LG“ …) */
  closing: string | null;
  /** Typische Länge (Median, Wörter ohne Zitat) */
  medianWords: number | null;
  /** Anteil Mails mit Emoji / mit Ausrufezeichen (0–1) */
  emojiRate: number;
  exclamationRate: number;
}

export interface RecipientStyle {
  address: string;
  /** du/Sie, wie der Nutzer diese Person anspricht (null: unklar) */
  form: "du" | "Sie" | null;
  /** Letzte Anredezeile an diese Person („Liebe Lena,“) */
  greetingLine: string | null;
  mails: number;
}

const greetingKinds: [string, RegExp][] = [
  ["Sehr geehrte/r", /^sehr geehrte/i],
  ["Guten Tag", /^guten (tag|morgen|abend)/i],
  ["Liebe/r", /^liebe[rs]?\b/i],
  ["Hallo", /^hallo\b/i],
  ["Hi", /^(hi|hey)\b/i],
  ["Moin", /^moin\b/i],
  ["Servus", /^servus\b/i],
];

const closingKinds: [string, RegExp][] = [
  ["Mit freundlichen Grüßen", /^mit freundlichen grüßen/i],
  ["Freundliche Grüße", /^freundliche grüße/i],
  ["Viele Grüße", /^viele grüße/i],
  ["Liebe Grüße", /^liebe grüße/i],
  ["Beste Grüße", /^beste grüße/i],
  ["Herzliche Grüße", /^herzliche grüße/i],
  ["LG", /^lg\b/i],
  ["VG", /^vg\b/i],
  ["Gruß", /^(gruß|grüße)\b/i],
  ["Bis dann", /^bis (dann|bald|später)/i],
  ["Danke", /^(danke|vielen dank)\b/i],
];

/** Eigener Text ohne Zitat der vorigen Mail */
export function ownText(body: string): string {
  const lines: string[] = [];
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (t.startsWith(">")) continue;
    if (/^(am .{4,80} schrieb|on .{4,80} wrote|-{2,}\s*(ursprüngliche|original|weitergeleitete)|von:\s.+@)/i.test(t)) break;
    if (t === "--" || t === "-- ") break;
    lines.push(t);
  }
  return lines.join("\n").trim();
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "";
}

function closingOf(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(-3)) {
    const kind = closingKinds.find(([, re]) => re.test(line));
    if (kind) return kind[0];
  }
  return null;
}

/** Stilprofil aus den Texten gesendeter Mails */
export function analyzeStyle(bodies: string[]): StyleProfile {
  const texts = bodies.map(ownText).filter((t) => t.length > 0);
  const words = texts.map((t) => t.split(/\s+/).filter(Boolean).length).sort((a, b) => a - b);
  return {
    analyzed: texts.length,
    greeting: mostCommon(texts.map((t) => greetingKinds.find(([, re]) => re.test(firstLine(t)))?.[0] ?? null)),
    closing: mostCommon(texts.map(closingOf)),
    medianWords: words.length ? (words[Math.floor(words.length / 2)] ?? null) : null,
    emojiRate: texts.length ? texts.filter((t) => /\p{Extended_Pictographic}/u.test(t)).length / texts.length : 0,
    exclamationRate: texts.length ? texts.filter((t) => t.includes("!")).length / texts.length : 0,
  };
}

/** Wie spricht der Nutzer diese Person an? (aus seinen Mails an sie) */
export function analyzeRecipient(address: string, bodies: string[], formOf: (text: string) => "du" | "Sie"): RecipientStyle {
  const texts = bodies.map(ownText).filter(Boolean);
  const forms = texts.map((t) => formOf(t));
  const du = forms.filter((f) => f === "du").length;
  const sie = forms.length - du;
  // Nur die Anrede selbst („Liebe Lena,“), nicht der Rest der Zeile
  const greeting =
    texts
      .map(firstLine)
      .filter((l) => greetingKinds.some(([, re]) => re.test(l)))
      .map((l) => /^[^,!.?\n]{2,40}[,!]/.exec(l)?.[0] ?? (l.length <= 40 ? l : null))
      .find((l): l is string => !!l) ?? null;
  return { address, form: texts.length === 0 ? null : du > sie ? "du" : sie > du ? "Sie" : null, greetingLine: greeting, mails: texts.length };
}
