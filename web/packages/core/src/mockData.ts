import type {
  Account,
  Attachment,
  EmailAddress,
  MailThread,
  Mailbox,
  MailboxRole,
  Message,
  MessageCategory,
} from "./models.js";
import { MessageFlag } from "./models.js";

// Erfundene Beispieldaten (gleicher Inhalt wie MockData.swift). Alle Adressen enden auf `.example`.

export const MockIds = {
  iCloud: "mock-icloud",
  gmail: "mock-gmail",
  work: "mock-work",
  mailbox: (accountId: string, role: MailboxRole) => `${accountId}-${role}`,
} as const;

export interface MockDataSet {
  accounts: Account[];
  mailboxes: Mailbox[];
  threads: MailThread[];
  messages: Message[];
  attachments: Attachment[];
}

const me = {
  privat: { name: "Anna Beispiel", address: "anna.beispiel@icloud.example" },
  gmail: { name: "Anna Beispiel", address: "anna.beispiel@gmail.example" },
  work: { name: "Anna Beispiel", address: "anna@beispiel-agentur.example" },
} satisfies Record<string, EmailAddress>;

const { seen, answered, flagged, draft } = MessageFlag;

interface MockAttachment {
  filename: string;
  mimeType: string;
  size: number;
  pageCount?: number;
}

/** Erste Zeilen ohne Umbrüche, gekürzt auf etwa zwei Listenzeilen. */
export function makeSnippet(body: string, maxLength = 140): string {
  const collapsed = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

/** Erzeugt die Beispieldaten relativ zu `now`. */
export function createMockData(now: Date = new Date()): MockDataSet {
  const ago = ({ days = 0, hours = 0, minutes = 0 }) =>
    new Date(now.getTime() - (days * 86_400 + hours * 3_600 + minutes * 60) * 1000).toISOString();

  const accounts: Account[] = [
    {
      id: MockIds.iCloud, email: me.privat.address, displayName: "Privat", provider: "icloud",
      imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587,
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    },
    {
      id: MockIds.gmail, email: me.gmail.address, displayName: "Gmail", provider: "gmail",
      imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 587,
      authType: "oauth2", color: "red", aiCloudAllowed: false, sortOrder: 1,
    },
    {
      id: MockIds.work, email: me.work.address, displayName: "Agentur", provider: "imap",
      imapHost: "imap.beispiel-agentur.example", imapPort: 993, smtpHost: "smtp.beispiel-agentur.example", smtpPort: 587,
      authType: "password", color: "green", aiCloudAllowed: false, sortOrder: 2,
    },
  ];

  const standardFolders: [MailboxRole, string][] = [
    ["inbox", "INBOX"], ["drafts", "Entwürfe"], ["sent", "Gesendet"],
    ["archive", "Archiv"], ["spam", "Spam"], ["trash", "Papierkorb"],
  ];
  const mailboxes: Mailbox[] = accounts.flatMap((account) =>
    standardFolders.map(([role, name]) => ({ id: MockIds.mailbox(account.id, role), accountId: account.id, name, role })),
  );
  mailboxes.push({ id: `${MockIds.iCloud}-finanzen`, accountId: MockIds.iCloud, name: "Finanzen", role: "custom" });

  const threads = new Map<string, MailThread>();
  const messages: Message[] = [];
  const attachments: Attachment[] = [];

  const add = (m: {
    thread: string; account: string; role: MailboxRole; from: EmailAddress; to: EmailAddress[];
    subject: string; date: string; flags: number; category: MessageCategory; body: string; files?: MockAttachment[];
  }) => {
    const index = messages.length + 1;
    const threadId = `mock-thread-${m.thread}`;
    const id = `mock-message-${index}`;
    const participants = [m.from, ...m.to];
    const existing = threads.get(threadId);
    if (existing) {
      if (m.date > existing.lastDate) existing.lastDate = m.date;
      for (const p of participants) {
        if (!existing.participants.some((q) => q.address === p.address && q.name === p.name)) existing.participants.push(p);
      }
    } else {
      threads.set(threadId, {
        id: threadId,
        subject: m.subject.startsWith("Re: ") ? m.subject.slice(4) : m.subject,
        participants: [...participants],
        lastDate: m.date,
      });
    }
    const files = m.files ?? [];
    messages.push({
      id, accountId: m.account, mailboxId: MockIds.mailbox(m.account, m.role), messageId: `<${id}@mock.example>`,
      threadId, from: m.from, to: m.to, cc: [], subject: m.subject, date: m.date, snippet: makeSnippet(m.body),
      bodyText: m.body, flags: m.flags, hasAttachments: files.length > 0, category: m.category,
    });
    files.forEach((file, i) =>
      attachments.push({
        id: `${id}-attachment-${i}`, messageId: id, filename: file.filename, mimeType: file.mimeType, size: file.size,
        pageCount: file.pageCount ?? null, isInline: false, isEncrypted: false, analysisStatus: "pending", riskFlags: 0,
      }),
    );
  };

  // --- Privat (iCloud) ---
  const grill = { name: "Jonas Weber", address: "jonas.weber@post.example" };
  add({ thread: "grillabend", account: MockIds.iCloud, role: "inbox", from: grill, to: [me.privat],
    subject: "Grillabend am Samstag", date: ago({ days: 1, hours: 3 }), flags: seen | answered, category: "personal",
    body: "Hi Anna,\n\nwir grillen am Samstag ab 18 Uhr bei uns im Garten. Kommst du? Bring gern jemanden mit.\nFalls du einen Salat mitbringen könntest, wäre das super.\n\nViele Grüße\nJonas" });
  add({ thread: "grillabend", account: MockIds.iCloud, role: "sent", from: me.privat, to: [grill],
    subject: "Re: Grillabend am Samstag", date: ago({ days: 1, hours: 1 }), flags: seen, category: "personal",
    body: "Hallo Jonas,\n\nich bin dabei! Ich bringe einen Nudelsalat mit und schicke dir bis Freitag noch Bescheid, ob Lea auch kommt.\n\nBis Samstag\nAnna" });
  add({ thread: "grillabend", account: MockIds.iCloud, role: "inbox", from: grill, to: [me.privat],
    subject: "Re: Grillabend am Samstag", date: ago({ hours: 2 }), flags: 0, category: "personal",
    body: "Super, freut mich! Nudelsalat klingt perfekt.\n\nJonas" });

  add({ thread: "abschlag", account: MockIds.iCloud, role: "inbox",
    from: { name: "Stadtwerke Musterstadt", address: "rechnung@stadtwerke-musterstadt.example" }, to: [me.privat],
    subject: "Ihre Abschlagsrechnung Oktober", date: ago({ hours: 5 }), flags: flagged, category: "invoice",
    body: "Sehr geehrte Frau Beispiel,\n\nanbei erhalten Sie Ihre Abschlagsrechnung für Oktober. Der Betrag von 86,00 € wird am 15.10. von Ihrem Konto abgebucht.\n\nMit freundlichen Grüßen\nIhre Stadtwerke Musterstadt",
    files: [
      { filename: "Rechnung_2026-10.pdf", mimeType: "application/pdf", size: 84_213, pageCount: 2 },
      { filename: "AGB.pdf", mimeType: "application/pdf", size: 212_004, pageCount: 6 },
    ] });

  add({ thread: "probeabo", account: MockIds.iCloud, role: "inbox",
    from: { name: "Streamflix", address: "no-reply@streamflix.example" }, to: [me.privat],
    subject: "Dein Probeabo endet in 3 Tagen", date: ago({ days: 2 }), flags: 0, category: "notification",
    body: "Hallo Anna,\n\ndein kostenloses Probeabo endet in 3 Tagen. Danach kostet dein Abo 12,99 € im Monat.\nDu kannst jederzeit in deinem Konto kündigen.\n\nDein Streamflix-Team" });

  add({ thread: "briefing", account: MockIds.iCloud, role: "inbox",
    from: { name: "Tech-Briefing", address: "briefing@tech-briefing.example" }, to: [me.privat],
    subject: "Wochenrückblick: KI auf dem Gerät und Datenschutz", date: ago({ days: 3 }), flags: seen, category: "newsletter",
    body: "Die Themen der Woche: Warum lokale Sprachmodelle auf Tablets immer besser werden, was neue Datenschutzregeln für Apps bedeuten und drei Tipps für ein aufgeräumtes Postfach." });

  add({ thread: "paket", account: MockIds.iCloud, role: "inbox",
    from: { name: "Paketblitz", address: "info@paketblitz.example" }, to: [me.privat],
    subject: "Deine Sendung ist unterwegs", date: ago({ days: 1, hours: 8 }), flags: seen, category: "notification",
    body: "Deine Sendung PB 4711 0815 42 ist unterwegs und wird voraussichtlich morgen zwischen 10 und 14 Uhr zugestellt." });

  add({ thread: "phishing", account: MockIds.iCloud, role: "inbox",
    from: { name: "Sicherheitsteam", address: "service@konto-sicherung.example" }, to: [me.privat],
    subject: "Dringend: Ihr Konto wurde gesperrt", date: ago({ days: 4 }), flags: 0, category: "spam_suspect",
    body: "Sehr geehrter Kunde,\n\nwir haben ungewöhnliche Aktivitäten festgestellt. Bestätigen Sie innerhalb von 24 Stunden Ihre Daten, sonst wird Ihr Konto endgültig gelöscht." });

  add({ thread: "steuer", account: MockIds.iCloud, role: "archive",
    from: { name: "Steuerbüro Klar", address: "kanzlei@steuerbuero-klar.example" }, to: [me.privat],
    subject: "Unterlagen für die Steuererklärung 2025", date: ago({ days: 40 }), flags: seen, category: "personal",
    body: "Liebe Frau Beispiel,\n\nbitte senden Sie uns bis Ende des Monats Ihre Belege für Arbeitsmittel und Handwerkerleistungen.\n\nFreundliche Grüße\nSteuerbüro Klar" });

  // --- Gmail ---
  add({ thread: "fotos", account: MockIds.gmail, role: "inbox",
    from: { name: "Mama", address: "gabi.beispiel@post.example" }, to: [me.gmail],
    subject: "Fotos vom Wochenende", date: ago({ minutes: 45 }), flags: 0, category: "personal",
    body: "Hallo mein Schatz,\n\nhier die Fotos vom Wochenende am See. Das Wetter war herrlich!\n\nLiebe Grüße, Mama",
    files: [
      { filename: "IMG_2041.heic", mimeType: "image/heic", size: 2_431_120 },
      { filename: "IMG_2044.heic", mimeType: "image/heic", size: 2_118_502 },
    ] });

  add({ thread: "arzt", account: MockIds.gmail, role: "inbox",
    from: { name: "Praxis Dr. Sonnenschein", address: "termine@praxis-sonnenschein.example" }, to: [me.gmail],
    subject: "Terminerinnerung: Dienstag, 9:30 Uhr", date: ago({ hours: 20 }), flags: seen, category: "appointment",
    body: "Wir erinnern Sie an Ihren Termin am Dienstag um 9:30 Uhr. Bitte bringen Sie Ihre Versichertenkarte mit." });

  add({ thread: "nebenkosten", account: MockIds.gmail, role: "inbox",
    from: { name: "Hausverwaltung Nord", address: "abrechnung@hv-nord.example" }, to: [me.gmail],
    subject: "Nebenkostenabrechnung 2025", date: ago({ days: 2, hours: 4 }), flags: 0, category: "invoice",
    body: "Sehr geehrte Frau Beispiel,\n\nanbei die Nebenkostenabrechnung für 2025. Es ergibt sich eine Nachzahlung von 142,37 €, fällig bis zum 31.10.\n\nMit freundlichen Grüßen\nHausverwaltung Nord",
    files: [{ filename: "Nebenkosten_2025.pdf", mimeType: "application/pdf", size: 156_880, pageCount: 4 }] });

  add({ thread: "verein", account: MockIds.gmail, role: "inbox",
    from: { name: "TSV Musterstadt", address: "news@tsv-musterstadt.example" }, to: [me.gmail],
    subject: "Vereinsnachrichten September", date: ago({ days: 5 }), flags: seen, category: "newsletter",
    body: "Neue Kurszeiten, das Sommerfest im Rückblick und die Termine für die Hallensaison." });

  // --- Arbeit ---
  const kundin = { name: "Petra Schulz", address: "p.schulz@moebelhaus-schulz.example" };
  add({ thread: "relaunch", account: MockIds.work, role: "inbox", from: kundin, to: [me.work],
    subject: "Angebot Website-Relaunch", date: ago({ days: 3, hours: 2 }), flags: seen | answered, category: "work",
    body: "Hallo Frau Beispiel,\n\nwie besprochen würden wir gern unsere Website neu aufsetzen. Können Sie uns ein Angebot schicken?\n\nViele Grüße\nPetra Schulz" });
  add({ thread: "relaunch", account: MockIds.work, role: "sent", from: me.work, to: [kundin],
    subject: "Re: Angebot Website-Relaunch", date: ago({ days: 2, hours: 22 }), flags: seen, category: "work",
    body: "Hallo Frau Schulz,\n\nsehr gern. Ich schicke Ihnen das Angebot bis Freitag.\n\nBeste Grüße\nAnna Beispiel" });
  add({ thread: "relaunch", account: MockIds.work, role: "inbox", from: kundin, to: [me.work],
    subject: "Re: Angebot Website-Relaunch", date: ago({ hours: 1 }), flags: 0, category: "work",
    body: "Hallo Frau Beispiel,\n\nkurze Frage vorab: Wäre ein Start im November realistisch? Dann könnten wir das Budget noch dieses Jahr einplanen.\n\nViele Grüße\nPetra Schulz" });

  add({ thread: "protokoll", account: MockIds.work, role: "inbox",
    from: { name: "Tim Kaiser", address: "tim@beispiel-agentur.example" }, to: [me.work],
    subject: "Protokoll Teammeeting", date: ago({ days: 1, hours: 5 }), flags: seen, category: "work",
    body: "Hi Anna,\n\nanbei das Protokoll vom Montag. Deine To-dos stehen unter Punkt 3.\n\nTim",
    files: [{ filename: "Protokoll_Teammeeting.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 38_450 }] });

  add({ thread: "workshop", account: MockIds.work, role: "inbox",
    from: { name: "Lukas Brandt", address: "l.brandt@kreativwerk.example" }, to: [me.work],
    subject: "Terminanfrage: Workshop nächste Woche", date: ago({ hours: 3 }), flags: flagged, category: "appointment",
    body: "Hallo Anna,\n\nwann passt es dir nächste Woche für einen zweistündigen Workshop? Dienstag oder Donnerstag wären ideal.\n\nGruß\nLukas" });

  add({ thread: "login", account: MockIds.work, role: "inbox",
    from: { name: "Projektportal", address: "noreply@projektportal.example" }, to: [me.work],
    subject: "Neue Anmeldung in deinem Konto", date: ago({ days: 6 }), flags: seen, category: "notification",
    body: "Es gab eine neue Anmeldung in deinem Konto von einem Laptop in Musterstadt." });

  add({ thread: "entwurf", account: MockIds.work, role: "drafts", from: me.work, to: [kundin],
    subject: "Angebot Website-Relaunch (Entwurf)", date: ago({ hours: 6 }), flags: seen | draft, category: "work",
    body: "Hallo Frau Schulz,\n\nanbei unser Angebot für den Relaunch …" });

  return { accounts, mailboxes, threads: [...threads.values()], messages, attachments };
}
