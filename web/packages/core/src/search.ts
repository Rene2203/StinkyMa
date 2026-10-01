// Suche: Eingabe des Nutzers → Begriffe. Plattformneutral; die Speicher übersetzen das in ihre Abfrage
// (SQLite: FTS5, Arbeitsspeicher: einfacher Textvergleich).

export interface SearchQuery {
  /** Begriffe, die irgendwo vorkommen müssen (Betreff, Absender, Text) – alle, Wortanfang genügt. */
  terms: string[];
  /** Begriffe, die im Absender (Name oder Adresse) vorkommen müssen – aus „von:“ / „from:“. */
  from: string[];
}

/** „anna rechnung von:stadtwerke "neue adresse"“ → Begriffe; Anführungszeichen halten Wörter zusammen. */
export function parseSearchQuery(input: string): SearchQuery {
  const query: SearchQuery = { terms: [], from: [] };
  const pattern = /(von:|from:)?(?:"([^"]*)"|(\S+))/gi;
  for (const match of input.matchAll(pattern)) {
    const value = (match[2] ?? match[3] ?? "").trim();
    if (!value) continue;
    if (match[1]) query.from.push(value);
    else query.terms.push(value);
  }
  return query;
}

export function isEmptySearch(query: SearchQuery): boolean {
  return query.terms.length === 0 && query.from.length === 0;
}

/** Für Vergleiche ohne Groß/klein und Akzente (wie FTS5 mit remove_diacritics). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * FTS5-Ausdruck. Jeder Begriff wird als Phrase in Anführungszeichen gesetzt (Sonderzeichen und Operatoren
 * des Nutzers werden so nie als FTS-Syntax gelesen) und mit * am Ende als Wortanfang gesucht.
 */
export function ftsExpression(query: SearchQuery): string {
  const phrase = (value: string) => `"${value.replace(/"/g, '""')}"*`;
  const parts = [
    ...query.terms.map(phrase),
    ...query.from.map((value) => `{fromName fromAddress} : ${phrase(value)}`),
  ];
  return parts.join(" AND ");
}
