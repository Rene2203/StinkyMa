import type { CleanupApi, CleanupGroup, CleanupGroupBy, CleanupGroupsQuery, CleanupMail } from "../cleanup.js";
import type { CleanupStore } from "../sqlite/cleanupStore.js";
import type { MailService } from "./mailService.js";

export interface CleanupServiceOptions {
  /** Mails vorrangig von der KI einordnen lassen (Windows: AIService.categorizeMessages); fehlt = keine KI. */
  categorize?: (messageIds: string[]) => number;
}

/** Höchstzahl Mails, die eine Gruppe in der Ansicht zeigt (und die auf einmal gelöscht werden können). */
const groupMailLimit = 20_000;

/** Aufräumen: große Absender/Domains finden und auf Klick in den Papierkorb – geschützte Mails bleiben. */
export class CleanupService implements CleanupApi {
  constructor(
    private readonly store: CleanupStore,
    private readonly mail: Pick<MailService, "move">,
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
}
