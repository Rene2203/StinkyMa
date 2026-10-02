// Eigene Kategorien (zusätzlich zur festen Einordnung): was die Oberfläche sieht und tun kann. Plattformneutral.

export const userCategoryColors = ["blue", "green", "orange", "purple", "pink", "teal", "red", "yellow"] as const;
export type UserCategoryColor = (typeof userCategoryColors)[number];

export interface UserCategory {
  id: string;
  name: string;
  /** Wofür die Kategorie gedacht ist – das liest auch die KI („Spiele, Spiele-Shops, Mods“) */
  description: string;
  /** Absender oder Domains, die immer dazugehören (ohne KI): „steampowered.com“, „news@verein.example“ */
  senders: string[];
  color: UserCategoryColor;
  sortOrder: number;
}

export interface UserCategoryInput {
  id?: string;
  name: string;
  description: string;
  senders: string[];
  color: UserCategoryColor;
}

export interface UserCategoriesView {
  categories: UserCategory[];
  /** Ungelesene Mails je Kategorie (Schlüssel wie im Bereich: feste Kategorie oder `u:<id>`) */
  unread: Record<string, number>;
  /** KI prüft vorhandene Mails gegen die eigenen Kategorien */
  checking: { done: number; total: number } | null;
}

export interface UserCategoriesApi {
  list(): Promise<UserCategoriesView>;
  save(input: UserCategoryInput): Promise<UserCategory>;
  /** Löschen: Mails verlieren nur diese Zuordnung, nichts wird gelöscht oder verschoben. */
  remove(id: string): Promise<void>;
  /** Von Hand zuordnen (`null`: entfernen). `remember`: für den Absender merken, seine anderen Mails folgen. */
  assign(messageId: string, categoryId: string | null, remember: boolean): Promise<{ changed: number }>;
}

export const userCategoriesApiMethods = ["list", "save", "remove", "assign"] as const satisfies readonly (keyof UserCategoriesApi)[];

/** Name, Beschreibung und Absender bereinigen; wirft bei leerem Namen. */
export function normalizeUserCategory(input: UserCategoryInput): UserCategoryInput {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) throw new Error("Bitte einen Namen eingeben.");
  const senders = [...new Set(input.senders.map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter((s) => s.length >= 3))].slice(0, 50);
  return {
    ...input,
    name,
    description: input.description.replace(/\s+/g, " ").trim().slice(0, 300),
    senders,
    color: userCategoryColors.includes(input.color) ? input.color : "blue",
  };
}

/** Gehört der Absender laut Liste dazu? Adresse genau, Domain samt Subdomains („mail.steampowered.com“). */
export function senderMatches(address: string, senders: readonly string[]): boolean {
  const lower = address.trim().toLowerCase();
  const domain = lower.split("@")[1] ?? "";
  return senders.some((s) => (s.includes("@") ? lower === s : domain === s || domain.endsWith(`.${s}`)));
}
