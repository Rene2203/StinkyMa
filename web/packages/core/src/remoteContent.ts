// Ausnahmen für externe Inhalte (Spezifikation 7.2: externe Bilder nur auf Wunsch).
// Eine Ausnahme ist entweder eine vollständige Adresse ("news@shop.example") oder eine Domain ("shop.example").
// Eine Domain gilt auch für ihre Subdomains ("mail.shop.example"), nicht aber für ähnlich klingende Domains.

const domainPattern = /^(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}$/u;
const localPattern = /^[^\s@<>()"',;:]+$/;

/**
 * Macht aus einer Eingabe eine Ausnahme oder `null`, wenn sie ungültig ist.
 * Versteht auch "Name <a@b.example>", "@b.example", "*.b.example" und "https://www.b.example/pfad".
 */
export function normalizeRemoteContentException(input: string): string | null {
  let value = input.trim().toLowerCase();
  const angle = /<([^>]+)>/.exec(value);
  if (angle?.[1]) value = angle[1].trim();
  value = value.replace(/^mailto:/, "");
  if (/^https?:\/\//.test(value)) {
    try {
      value = new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  value = value.replace(/^\*\./, "").replace(/^@/, "").replace(/\.$/, "");
  const at = value.lastIndexOf("@");
  if (at === -1) return domainPattern.test(value) ? value : null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return localPattern.test(local) && domainPattern.test(domain) ? `${local}@${domain}` : null;
}

/** Welche Ausnahme erlaubt externe Inhalte für diesen Absender? `null`, wenn keine. */
export function matchRemoteContentException(exceptions: readonly string[], senderAddress: string): string | null {
  const address = senderAddress.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at === -1) return null;
  const domain = address.slice(at + 1);
  for (const exception of exceptions) {
    if (exception.includes("@")) {
      if (exception === address) return exception;
    } else if (domain === exception || domain.endsWith(`.${exception}`)) {
      return exception;
    }
  }
  return null;
}

/** Domain einer Absenderadresse – Vorschlag für eine neue Ausnahme. */
export function senderDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}

/** Wie `normalizeRemoteContentException`, wirft aber bei ungültiger Eingabe (für Repository-Implementierungen). */
export function requireRemoteContentException(input: string): string {
  const exception = normalizeRemoteContentException(input);
  if (!exception) throw new Error("Bitte eine E-Mail-Adresse oder Domain eingeben, z. B. news@shop.example oder shop.example.");
  return exception;
}
