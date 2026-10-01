import type { CleanupApi, CleanupGroup, CleanupGroupBy, CleanupGroupsQuery, CleanupMail } from "../cleanup.js";
import { isDemoAccount } from "../models.js";
import type { CleanupStore } from "../sqlite/cleanupStore.js";
import { parseListUnsubscribe, unsubscribeMethod, type UnsubscribeInfo, type UnsubscribeResult, type UnsubscribeView } from "../unsubscribe.js";
import type { MailService } from "./mailService.js";

export interface CleanupServiceOptions {
  /** Mails vorrangig von der KI einordnen lassen (Windows: AIService.categorizeMessages); fehlt = keine KI. */
  categorize?: (messageIds: string[]) => number;
  /** Ein-Klick-Abmeldung senden (Standard: fetch mit POST). Gibt den HTTP-Status zurück. */
  postOneClick?: (url: string) => Promise<number>;
  now?: () => Date;
}

type CleanupMailApi = Pick<MailService, "move"> & Partial<Pick<MailService, "fetchListUnsubscribe" | "sendUnsubscribeMail">>;

/** Ein-Klick-Abmeldung nach RFC 8058: POST mit festem Inhalt, ohne Cookies, mit Zeitlimit. */
async function defaultPostOneClick(url: string): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
    credentials: "omit",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  return response.status;
}

/** Höchstzahl Mails, die eine Gruppe in der Ansicht zeigt (und die auf einmal gelöscht werden können). */
const groupMailLimit = 20_000;

/** Aufräumen: große Absender/Domains finden und auf Klick in den Papierkorb – geschützte Mails bleiben. */
export class CleanupService implements CleanupApi {
  constructor(
    private readonly store: CleanupStore,
    private readonly mail: CleanupMailApi,
    private readonly options: CleanupServiceOptions = {},
  ) {}

  async groups(query: CleanupGroupsQuery): Promise<CleanupGroup[]> {
    return this.store.groups({ ...query, limit: Math.min(Math.max(1, query.limit), 500) });
  }

  async groupMails(key: string, groupBy: CleanupGroupBy, accountId: string | null, limit: number): Promise<CleanupMail[]> {
    return this.store.groupMails(key, groupBy, accountId, Math.min(Math.max(1, limit), groupMailLimit));
  }

  async trash(messageIds: string[]): Promise<{ moved: number }> {
    const ids = [...new Set(messageIds)];
    if (ids.length) await this.mail.move(ids, "trash");
    return { moved: ids.length };
  }

  async check(key: string, groupBy: CleanupGroupBy, accountId: string | null): Promise<{ queued: number }> {
    if (!this.options.categorize) return { queued: 0 };
    const ids = this.store.groupMails(key, groupBy, accountId, groupMailLimit).filter((m) => !m.category).map((m) => m.id);
    return { queued: this.options.categorize(ids) };
  }

  async unsubscribeInfo(messageId: string): Promise<UnsubscribeView> {
    const source = this.store.unsubscribeSource(messageId);
    if (!source) throw new Error("Die Mail gibt es nicht mehr.");
    let info: UnsubscribeInfo | null = null;
    if (source.raw === null) {
      // Vor dieser Funktion geladen: Kopfzeilen jetzt vom Server holen (nur diese zwei) und merken
      const fetched = await this.mail.fetchListUnsubscribe?.(messageId).catch(() => null);
      if (fetched) {
        info = parseListUnsubscribe(fetched.header, fetched.post);
        this.store.setListUnsubscribe(messageId, info ? JSON.stringify(info) : "");
      }
    } else if (source.raw) {
      try {
        info = JSON.parse(source.raw) as UnsubscribeInfo;
      } catch {
        info = null;
      }
    }
    return {
      messageId,
      sender: source.sender,
      info,
      method: unsubscribeMethod(info),
      done: this.store.unsubscribed(source.sender),
      suspicious: source.category === "spam_suspect",
    };
  }

  async unsubscribe(messageId: string): Promise<UnsubscribeResult> {
    const view = await this.unsubscribeInfo(messageId);
    const source = this.store.unsubscribeSource(messageId);
    if (!view.info || !view.method || !source) throw new Error("Diese Mail bietet keine Abmeldung an.");
    const demo = isDemoAccount({ id: source.accountId });
    let result: UnsubscribeResult;
    if (view.method === "oneClick" && view.info.oneClickUrl) {
      if (!demo) {
        let status: number;
        try {
          status = await (this.options.postOneClick ?? defaultPostOneClick)(view.info.oneClickUrl);
        } catch {
          throw new Error("Der Anbieter war nicht erreichbar. Später noch einmal versuchen" + (view.info.url ? " oder die Abmelde-Seite öffnen." : "."));
        }
        if (status >= 400) throw new Error(`Der Anbieter hat die Abmeldung abgelehnt (Status ${status}).` + (view.info.url ? " Bitte die Abmelde-Seite öffnen." : ""));
      }
      result = { method: "oneClick" };
    } else if (view.method === "mail" && view.info.mailto) {
      if (!demo) {
        if (!this.mail.sendUnsubscribeMail) throw new Error("Abmelde-Mails können hier nicht gesendet werden.");
        await this.mail.sendUnsubscribeMail(source.accountId, view.info.mailto);
      }
      result = { method: "mail" };
    } else {
      result = { method: "web", url: view.info.url ?? "" };
    }
    this.store.markUnsubscribed(source.sender, result.method, (this.options.now?.() ?? new Date()).toISOString());
    return result;
  }
}
