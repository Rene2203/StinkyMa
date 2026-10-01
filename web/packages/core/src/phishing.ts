import { isRiskyAttachment } from "./files.js";
import type { Message } from "./models.js";

// Phishing-Check (Spezifikation Phase 7): nachvollziehbare Warnzeichen statt Bauchgefühl. Plattformneutral, ohne KI –
// die KI-Einordnung „verdächtig“ kommt als weiteres Signal dazu. Lieber eine begründete Warnung als ein stilles Urteil.

export type PhishingReason =
  | { code: "brandMismatch"; brand: string; domain: string }
  | { code: "freemailOfficial"; name: string; domain: string }
  | { code: "linkMismatch"; shown: string; target: string }
  | { code: "ipLink"; target: string }
  | { code: "shortLink"; target: string }
  | { code: "pressure"; phrase: string }
  | { code: "credentials"; phrase: string }
  | { code: "giftCards" }
  | { code: "paymentLink"; phrase: string }
  | { code: "tooGood"; phrase: string }
  | { code: "riskyAttachment"; filename: string }
  | { code: "aiSuspect" };

export interface PhishingAssessment {
  level: "none" | "caution" | "danger";
  score: number;
  reasons: PhishingReason[];
}

/** Bekannte Marken/Absender, die gern nachgeahmt werden – mit ihren echten Domains. */
const brands: { name: string; pattern: RegExp; domains: string[] }[] = [
  { name: "Sparkasse", pattern: /sparkasse/i, domains: ["sparkasse.de"] },
  { name: "Volksbank", pattern: /volksbank|raiffeisen/i, domains: ["vr.de", "volksbank.de"] },
  { name: "Deutsche Bank", pattern: /deutsche bank/i, domains: ["db.com", "deutsche-bank.de"] },
  { name: "Commerzbank", pattern: /commerzbank/i, domains: ["commerzbank.de", "commerzbank.com"] },
  { name: "ING", pattern: /\bing\b(?!-)/i, domains: ["ing.de"] },
  { name: "PayPal", pattern: /paypal|payflow/i, domains: ["paypal.com", "paypal.de"] },
  { name: "Amazon", pattern: /amazon|prime/i, domains: ["amazon.de", "amazon.com"] },
  { name: "DHL", pattern: /\bdhl\b|deutsche post/i, domains: ["dhl.de", "dhl.com", "deutschepost.de"] },
  { name: "Microsoft", pattern: /microsoft|outlook|office ?365/i, domains: ["microsoft.com", "outlook.com", "office.com"] },
  { name: "Apple", pattern: /\bapple\b|icloud/i, domains: ["apple.com", "icloud.com"] },
  { name: "Google", pattern: /\bgoogle\b|gmail/i, domains: ["google.com", "gmail.com"] },
  { name: "Telekom", pattern: /telekom|t-online/i, domains: ["telekom.de", "t-online.de"] },
  { name: "Netflix", pattern: /netflix/i, domains: ["netflix.com"] },
  { name: "Finanzamt", pattern: /finanzamt|steuerverwaltung|elster|bundeszentralamt/i, domains: ["elster.de", "bzst.de", "finanzamt.de"] },
];

const freemail = /^(gmail|googlemail|gmx|web|t-online|freenet|yahoo|outlook|hotmail|live|icloud|aol|mail|freemail|posteo|mailbox)\.[a-z.]+$/i;
const officialRoles = /(geschäftsführ|chef|vorstand|ceo|finanzabteilung|buchhaltung|personalabteilung|bank|kundenservice|sicherheit|support|steuer|polizei)/i;
const shorteners = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|cutt\.ly|rebrand\.ly|shorturl\.at)$/i;

const pressurePhrases: RegExp[] = [
  /innerhalb (von )?\d+ (stunden|tagen)/i,
  /(konto|zugang|karte|postfach)[^.\n]{0,40}(gesperrt|gesperrt werden|eingeschränkt|deaktiviert|geschlossen)/i,
  /(letzte mahnung|pfändung|inkasso)[^.\n]{0,40}(sofort|umgehend)|sofort[^.\n]{0,30}(pfändung|überweisen)/i,
  /\b(dringend|umgehend|unverzüglich)\b[^.\n]{0,30}(bestätigen|verifizieren|aktualisieren|anmelden|zahlen)/i,
  /(gewonnen|gewinner|gewinn von)[^.\n]{0,40}(bestätigen|versandkosten|gebühr|daten)/i,
  /nur noch \d+ plätze|jetzt registrieren|nur heute|läuft heute ab/i,
];
const credentialPhrases: RegExp[] = [
  /geben sie[^.\n]{0,40}(kreditkart|iban|passwort|kennwort|pin\b|tan\b|zugangsdaten|kontodaten)/i,
  /(kreditkarten?(daten|nummer)?|iban|pin|tan|passwort|kennwort|zugangsdaten)[^.\n]{0,40}(eingeben|bestätigen|angeben|aktualisieren|verifizieren)/i,
  /(verifizieren|bestätigen|aktualisieren) sie[^.\n]{0,40}(daten|konto|identität|zahlungsmethode)/i,
  /(melden sie sich|anmelden)[^.\n]{0,30}(über|unter) (den|diesen) (folgenden )?link/i,
];

function domainOf(address: string): string {
  return address.split("@")[1]?.toLowerCase() ?? "";
}

/** Zweitletzte+letzte Ebene (example.co.uk vereinfacht ignoriert – genügt für Vergleiche). */
function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.slice(-2).join(".");
}

/** Links aus HTML: sichtbarer Text und Ziel. Nur einfache Auswertung per Muster (keine DOM-Abhängigkeit im Kern). */
export function linksFromHtml(html: string): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = (match[2] ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    links.push({ text, href: match[1] ?? "" });
  }
  return links;
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Sichtbarer Linktext, der wie eine Adresse aussieht („www.sparkasse.de“, „https://…“) → deren Host. */
function shownHost(text: string): string | null {
  const match = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#].*)?$/i.exec(text.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function assessPhishing(
  message: Pick<Message, "from" | "subject" | "bodyText" | "bodyHtml" | "snippet" | "category">,
  options: { attachmentNames?: string[]; knownSender?: boolean } = {},
): PhishingAssessment {
  const reasons: PhishingReason[] = [];
  let score = 0;
  const domain = domainOf(message.from.address);
  const name = message.from.name ?? "";
  const text = `${message.subject}\n${message.bodyText ?? message.snippet}`;

  // Absender: Marke im Namen/Betreff, aber nicht von deren Domain
  const claimed = brands.find((b) => b.pattern.test(name) || b.pattern.test(message.subject));
  if (claimed && !claimed.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    // Nachahmung: Domain mit typischen Zusätzen (sparkasse-kundenservice, paypal-secure-login) oder Freemail.
    // Nicht: Händler, die eine Marke nur erwähnen, oder Behörden/Firmen mit eigener, schlichter Domain.
    const lookalike = /[-.](secure|sicher|sicherheit|login|verify|verifizierung|konto|account|service|kundenservice|support|update|info|center|zustellung|rueckzahlung|erstattung|abo)\b/i.test(domain);
    if (lookalike || freemail.test(domain)) {
      reasons.push({ code: "brandMismatch", brand: claimed.name, domain });
      score += lookalike ? 3 : 2;
    }
  }
  // „Chef“, „Bank“, „Steuer“ von einer Freemail-Adresse
  if (!claimed && freemail.test(domain) && officialRoles.test(name)) {
    reasons.push({ code: "freemailOfficial", name, domain });
    score += 2;
  }

  // Links
  const html = message.bodyHtml ?? "";
  const links = html ? linksFromHtml(html) : [...text.matchAll(/https?:\/\/[^\s<>"')]+/gi)].map((m) => ({ text: m[0], href: m[0] }));
  let linkReasons = 0;
  for (const link of links) {
    if (linkReasons >= 2) break;
    const target = hostOf(link.href);
    if (!target) continue;
    const shown = shownHost(link.text);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(target)) {
      reasons.push({ code: "ipLink", target });
      score += 3;
      linkReasons++;
    } else if (shown && baseDomain(shown) !== baseDomain(target)) {
      reasons.push({ code: "linkMismatch", shown, target });
      score += 3;
      linkReasons++;
    } else if (shorteners.test(target)) {
      reasons.push({ code: "shortLink", target });
      score += 1;
      linkReasons++;
    }
  }

  // Sprache: Druck und Datenabfrage
  const pressure = pressurePhrases.map((re) => re.exec(text)).find(Boolean);
  if (pressure) {
    reasons.push({ code: "pressure", phrase: pressure[0].trim().slice(0, 80) });
    score += 2;
  }
  const credentials = credentialPhrases.map((re) => re.exec(text)).find(Boolean);
  if (credentials) {
    reasons.push({ code: "credentials", phrase: credentials[0].trim().slice(0, 80) });
    score += 2;
  }
  const paymentLink = /(zahlen|bezahlen|überweisen|begleichen) sie[^.\n]{0,60}(über|unter|mit) (den|diesen|dem) (folgenden |unten stehenden )?link/i.exec(text) ?? /(gebühr|nachporto|zollgebühr|versandkosten)[^.\n]{0,60}link/i.exec(text);
  if (paymentLink) {
    reasons.push({ code: "paymentLink", phrase: paymentLink[0].trim().slice(0, 80) });
    score += 2;
  }
  const tooGood = /(erbschaft|erbe eines|millionen (dollar|euro)|sie haben gewonnen|als gewinner|€ pro tag|täglich tausende|handelsroboter|krypto[- ]?profit)/i.exec(text);
  if (tooGood) {
    reasons.push({ code: "tooGood", phrase: tooGood[0].trim().slice(0, 80) });
    score += 2;
  }
  if (/(gutschein|geschenk)karten?|codes? (schicken|senden)|itunes|google play karte/i.test(text) && /(vertraulich|niemandem|dringend|kaufen)/i.test(text)) {
    reasons.push({ code: "giftCards" });
    score += 3;
  }

  // Anhänge, die Programme starten können, oder Archive (verstecken oft solche)
  const risky = (options.attachmentNames ?? []).find((n) => isRiskyAttachment(n) || /\.(zip|rar|7z|iso|img|html?)$/i.test(n));
  if (risky) {
    reasons.push({ code: "riskyAttachment", filename: risky });
    score += options.knownSender ? 1 : 2;
  }

  if (message.category === "spam_suspect") {
    reasons.push({ code: "aiSuspect" });
    score += 2;
  }
  // Bekannte Absender (schon geschrieben/geantwortet) senken das Risiko etwas – Konten können aber gekapert sein
  if (options.knownSender) score -= 1;

  const level = score >= 5 ? "danger" : score >= 3 ? "caution" : "none";
  return { level, score, reasons: level === "none" ? [] : reasons };
}
