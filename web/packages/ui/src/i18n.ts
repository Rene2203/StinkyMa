// UI-Texte: Deutsch ist die Ausgangssprache, Englisch die zweite Sprache (Spezifikation, Abschnitt 10).
// Platzhalter: {name}

const de = {
  "app.title": "StinkyMa",
  "sidebar.title": "Postfächer",
  "sidebar.overview": "Übersicht",
  "sidebar.unifiedInbox": "Alle Posteingänge",
  "sidebar.unread": "Ungelesen",
  "sidebar.flagged": "Markiert",
  "role.inbox": "Posteingang",
  "role.sent": "Gesendet",
  "role.drafts": "Entwürfe",
  "role.trash": "Papierkorb",
  "role.archive": "Archiv",
  "role.spam": "Spam",
  "role.custom": "Ordner",
  "category.personal": "Persönlich",
  "category.work": "Arbeit",
  "category.newsletter": "Newsletter",
  "category.notification": "Benachrichtigung",
  "category.invoice": "Rechnung",
  "category.appointment": "Termin",
  "category.spam_suspect": "Spam-Verdacht",
  "list.search": "Suchen",
  "list.empty.title": "Keine Mails",
  "list.empty.text": "Hier ist gerade nichts.",
  "list.noResults.title": "Keine Treffer",
  "list.noResults.text": "Für „{query}“ wurde nichts gefunden.",
  "list.unread": "Ungelesen",
  "list.flagged": "Markiert",
  "list.hasAttachment": "Mit Anhang",
  "list.account": "Konto {name}",
  "date.yesterday": "Gestern",
  "detail.empty.title": "Keine Mail ausgewählt",
  "detail.empty.text": "Wähle links eine Mail aus.",
  "detail.to": "An: {names}",
  "detail.pages": "{count} Seiten",
  "detail.expand": "Aufklappen",
  "detail.collapse": "Einklappen",
  "action.reply": "Antworten",
  "action.replyLater": "Antworten ist ab Phase 3 verfügbar",
  "action.markRead": "Als gelesen markieren",
  "action.markUnread": "Als ungelesen markieren",
  "action.flag": "Markieren",
  "action.unflag": "Markierung entfernen",
  "action.archive": "Archivieren",
  "action.trash": "In den Papierkorb",
  "error.title": "Etwas ist schiefgelaufen",
  "error.dismiss": "OK",
  "shortcuts.hint": "Tastatur: ↑/↓ oder J/K wechseln · E archivieren · Entf Papierkorb · S markieren · U gelesen/ungelesen",
} as const;

export type MessageKey = keyof typeof de;

const en: Record<MessageKey, string> = {
  "app.title": "StinkyMa",
  "sidebar.title": "Mailboxes",
  "sidebar.overview": "Overview",
  "sidebar.unifiedInbox": "All Inboxes",
  "sidebar.unread": "Unread",
  "sidebar.flagged": "Flagged",
  "role.inbox": "Inbox",
  "role.sent": "Sent",
  "role.drafts": "Drafts",
  "role.trash": "Trash",
  "role.archive": "Archive",
  "role.spam": "Junk",
  "role.custom": "Folder",
  "category.personal": "Personal",
  "category.work": "Work",
  "category.newsletter": "Newsletter",
  "category.notification": "Notification",
  "category.invoice": "Invoice",
  "category.appointment": "Appointment",
  "category.spam_suspect": "Suspected spam",
  "list.search": "Search",
  "list.empty.title": "No Mail",
  "list.empty.text": "Nothing here right now.",
  "list.noResults.title": "No Results",
  "list.noResults.text": "Nothing found for “{query}”.",
  "list.unread": "Unread",
  "list.flagged": "Flagged",
  "list.hasAttachment": "Has attachment",
  "list.account": "Account {name}",
  "date.yesterday": "Yesterday",
  "detail.empty.title": "No Message Selected",
  "detail.empty.text": "Select a message on the left.",
  "detail.to": "To: {names}",
  "detail.pages": "{count} pages",
  "detail.expand": "Expand",
  "detail.collapse": "Collapse",
  "action.reply": "Reply",
  "action.replyLater": "Replying becomes available in phase 3",
  "action.markRead": "Mark as Read",
  "action.markUnread": "Mark as Unread",
  "action.flag": "Flag",
  "action.unflag": "Unflag",
  "action.archive": "Archive",
  "action.trash": "Move to Trash",
  "error.title": "Something went wrong",
  "error.dismiss": "OK",
  "shortcuts.hint": "Keyboard: ↑/↓ or J/K to move · E archive · Del trash · S flag · U read/unread",
};

export type Locale = "de" | "en";
const dictionaries: Record<Locale, Record<MessageKey, string>> = { de, en };

export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "de" || base === "en") return base;
  }
  return "de";
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const dictionary = dictionaries[locale];
  return (key, params) =>
    dictionary[key].replace(/\{(\w+)\}/g, (match, name: string) => (params && name in params ? String(params[name]) : match));
}
