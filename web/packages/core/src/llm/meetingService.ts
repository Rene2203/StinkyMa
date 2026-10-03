import { addressForm, joinGreeting, replyGreeting } from "../ai/replies.js";
import { toICalendar } from "../calendar.js";
import { acceptedSlot, freeSlots, meetingRequest, normalizeFeedUrl, parseIcsBusy, slotsReplyText, type CalendarFeed, type MeetingPreferences, type MeetingSlot, type MeetingsApi, type MeetingView } from "../meetings.js";
import type { Message } from "../models.js";
import { SecretKeys, type SecretStore } from "../secrets.js";
import type { MeetingStore } from "../sqlite/meetingStore.js";

export interface MeetingServiceOptions {
  store: MeetingStore;
  secrets: SecretStore;
  message: (id: string) => Promise<Message | null>;
  thread: (threadId: string) => Promise<Message[]>;
  /** Eigene Adressen (Mails von mir sind keine Zusage der Gegenseite) */
  ownAddresses: () => Promise<string[]>;
  /** Einleitung/Schluss vom Modell; `null`: kein Modell oder unbrauchbar (dann Vorlage) */
  draft?: (message: Message, form: "du" | "Sie", slots: MeetingSlot[]) => Promise<string | null>;
  openCalendarFile?: (ics: string, filename: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  newId: () => string;
  now?: () => Date;
}

const maxFeedBytes = 5 * 1024 * 1024;
const staleMs = 30 * 60_000;

/** Terminfinder (W9.4): Kalender-Abos abrufen, freie Zeiten rechnen, Antwort entwerfen, Zusage erkennen. Sendet nie selbst. */
export class MeetingService implements MeetingsApi {
  #refreshing: Promise<CalendarFeed[]> | null = null;

  constructor(private readonly options: MeetingServiceOptions) {}

  async feeds(): Promise<CalendarFeed[]> {
    return this.options.store.feeds();
  }

  async addFeed(name: string, url: string): Promise<CalendarFeed[]> {
    const normalized = normalizeFeedUrl(url);
    const id = this.options.newId();
    this.options.store.addFeed(id, name.trim() || "Kalender", this.#now().toISOString());
    await this.options.secrets.set(SecretKeys.calendarFeedUrl(id), normalized);
    return this.refresh();
  }

  async removeFeed(id: string): Promise<CalendarFeed[]> {
    this.options.store.removeFeed(id);
    await this.options.secrets.remove(SecretKeys.calendarFeedUrl(id)).catch(() => undefined);
    return this.options.store.feeds();
  }

  refresh(): Promise<CalendarFeed[]> {
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #refresh(): Promise<CalendarFeed[]> {
    const store = this.options.store;
    const now = this.#now();
    const window = { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 60 * 86_400_000) };
    for (const feed of store.feeds()) {
      const url = await this.options.secrets.get(SecretKeys.calendarFeedUrl(feed.id)).catch(() => null);
      if (!url) {
        store.setError(feed.id, "Die Kalender-Adresse fehlt – bitte neu hinzufügen.");
        continue;
      }
      try {
        const response = await (this.options.fetchImpl ?? fetch)(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`Der Kalender antwortet nicht (HTTP ${response.status}).`);
        const text = await response.text();
        if (text.length > maxFeedBytes) throw new Error("Der Kalender ist zu groß (über 5 MB).");
        if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Unter dieser Adresse liegt kein Kalender (ICS).");
        store.setBusy(feed.id, parseIcsBusy(text, window), now.toISOString());
      } catch (error) {
        // Fehlertext ohne Adresse (die enthält einen geheimen Schlüssel)
        const message = error instanceof Error && !error.message.includes("http") ? error.message : "Der Kalender konnte nicht abgerufen werden.";
        store.setError(feed.id, error instanceof Error && error.name === "TimeoutError" ? "Zeitüberschreitung beim Abruf des Kalenders." : message);
      }
    }
    return store.feeds();
  }

  async preferences(): Promise<MeetingPreferences> {
    return this.options.store.preferences();
  }

  async setPreferences(prefs: MeetingPreferences): Promise<MeetingPreferences> {
    return this.options.store.setPreferences(prefs);
  }

  async forMessage(messageId: string): Promise<MeetingView | null> {
    const message = await this.options.message(messageId);
    if (!message) return null;
    const own = (await this.options.ownAddresses()).map((a) => a.toLowerCase());
    if (own.includes(message.from.address.toLowerCase())) return null;
    const request = meetingRequest(`${message.subject}\n${message.bodyText ?? message.snippet}`, new Date(message.date));
    if (!request) return null;
    const now = this.#now();
    // Vorbei: keine Vorschläge mehr in der Vergangenheit
    if (request.to.getTime() < now.getTime()) {
      request.from = new Date(now);
      request.to = new Date(now.getTime() + 14 * 86_400_000);
    }
    const feeds = this.options.store.feeds();
    if (feeds.some((f) => !f.lastSync || now.getTime() - new Date(f.lastSync).getTime() > staleMs)) await this.refresh().catch(() => undefined);
    const prefs = this.options.store.preferences();
    const durationMinutes = request.durationMinutes ?? prefs.durationMinutes;
    const toEnd = new Date(request.to);
    toEnd.setHours(23, 59, 59);
    const busy = this.options.store.busyBetween(new Date(request.from.getTime() - 86_400_000).toISOString(), new Date(toEnd.getTime() + 86_400_000).toISOString());
    const slots = freeSlots(busy, { ...prefs, durationMinutes }, { from: request.from, to: toEnd }, { now, count: 3, preferredDays: request.preferredDays });
    return {
      messageId,
      request: { durationMinutes, quote: request.quote, from: request.from.toISOString(), to: toEnd.toISOString() },
      slots,
      withoutCalendar: !feeds.some((f) => f.lastSync),
    };
  }

  async draftReply(messageId: string, slots: MeetingSlot[]): Promise<{ text: string; origin: "onDevice" | "rules" }> {
    const message = await this.options.message(messageId);
    if (!message) throw new Error("Die Mail gibt es nicht mehr.");
    const valid = slots.filter((s) => !Number.isNaN(Date.parse(s.start)) && !Number.isNaN(Date.parse(s.end))).slice(0, 5);
    if (valid.length === 0) throw new Error("Bitte mindestens einen Termin auswählen.");
    const body = message.bodyText ?? message.snippet;
    const form = addressForm(body, message.from);
    let text: string | null = null;
    try {
      text = (await this.options.draft?.(message, form, valid)) ?? null;
    } catch {
      text = null;
    }
    const origin = text ? "onDevice" : "rules";
    const core = text ?? slotsReplyText(valid, form);
    this.options.store.saveProposal(message.threadId, messageId, valid, this.#now().toISOString());
    return { text: joinGreeting(replyGreeting(message.from, form), core), origin };
  }

  async acceptance(messageId: string): Promise<MeetingSlot | null> {
    const message = await this.options.message(messageId);
    if (!message) return null;
    const proposal = this.options.store.proposal(message.threadId);
    if (!proposal || message.date <= proposal.createdAt) return null;
    const own = (await this.options.ownAddresses()).map((a) => a.toLowerCase());
    if (own.includes(message.from.address.toLowerCase())) return null;
    return acceptedSlot(message.bodyText ?? message.snippet, proposal.slots);
  }

  async addToCalendar(messageId: string, slot: MeetingSlot): Promise<void> {
    const message = await this.options.message(messageId);
    if (!message || !this.options.openCalendarFile) throw new Error("Kalendereintrag ist hier nicht möglich.");
    const start = new Date(slot.start);
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const minutes = Math.max(15, Math.round((Date.parse(slot.end) - start.getTime()) / 60_000));
    const subject = message.subject.replace(/^(re|aw|wg|fwd?):\s*/gi, "").trim() || "Termin";
    const ics = toICalendar({ uid: `${this.options.newId()}@stinkymail`, title: subject, date, time, durationMinutes: minutes, description: `Mit ${message.from.name ?? message.from.address}`, alarmMinutesBefore: 15 }, this.#now());
    await this.options.openCalendarFile(ics, `${date} ${subject}.ics`);
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
