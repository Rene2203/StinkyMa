import type Database from "better-sqlite3";
import { defaultMeetingPreferences, type BusyInterval, type CalendarFeed, type MeetingPreferences, type MeetingSlot } from "../meetings.js";

type Row = Record<string, unknown>;

/** Terminfinder (W9.4): Kalender-Abos, belegte Zeiten, Einstellungen, gemachte Vorschläge je Verlauf. */
export class MeetingStore {
  constructor(private readonly db: Database.Database) {}

  feeds(): CalendarFeed[] {
    return (
      this.db
        .prepare("SELECT calendarFeed.*, (SELECT COUNT(*) FROM calendarBusy WHERE calendarBusy.feedId = calendarFeed.id) AS n FROM calendarFeed ORDER BY createdAt")
        .all() as Row[]
    ).map((r) => ({ id: String(r.id), name: String(r.name), lastSync: r.lastSync ? String(r.lastSync) : null, error: r.error ? String(r.error) : null, events: Number(r.n) }));
  }

  addFeed(id: string, name: string, now: string): void {
    this.db.prepare("INSERT INTO calendarFeed (id, name, createdAt) VALUES (?, ?, ?)").run(id, name, now);
  }

  removeFeed(id: string): void {
    this.db.prepare("DELETE FROM calendarFeed WHERE id = ?").run(id);
  }

  setBusy(feedId: string, busy: BusyInterval[], now: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM calendarBusy WHERE feedId = ?").run(feedId);
      const insert = this.db.prepare('INSERT INTO calendarBusy (feedId, start, "end", allDay) VALUES (?, ?, ?, ?)');
      for (const b of busy) insert.run(feedId, b.start, b.end, b.allDay ? 1 : 0);
      this.db.prepare("UPDATE calendarFeed SET lastSync = ?, error = NULL WHERE id = ?").run(now, feedId);
    })();
  }

  setError(feedId: string, error: string): void {
    this.db.prepare("UPDATE calendarFeed SET error = ? WHERE id = ?").run(error, feedId);
  }

  /** Belegt im Zeitraum: Kalender-Abos und offene Termine, die StinkyMail aus Mails kennt (Dauer 1 Stunde) */
  busyBetween(from: string, to: string): BusyInterval[] {
    const feed = (this.db.prepare('SELECT start, "end", allDay FROM calendarBusy WHERE "end" > ? AND start < ?').all(from, to) as Row[]).map((r) => ({
      start: String(r.start), end: String(r.end), allDay: Number(r.allDay) === 1,
    }));
    const known = (
      this.db
        .prepare("SELECT date, time FROM messageAction WHERE type = 'appointment' AND status = 'open' AND date IS NOT NULL AND time IS NOT NULL AND date BETWEEN ? AND ?")
        .all(from.slice(0, 10), to.slice(0, 10)) as Row[]
    ).map((r) => {
      const [y = 0, m = 1, d = 1] = String(r.date).split("-").map(Number);
      const [h = 0, mi = 0] = String(r.time).split(":").map(Number);
      const start = new Date(y, m - 1, d, h, mi);
      return { start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), allDay: false };
    });
    return [...feed, ...known];
  }

  preferences(): MeetingPreferences {
    const row = this.db.prepare("SELECT json FROM meetingSettings WHERE id = 1").get() as Row | undefined;
    if (!row) return { ...defaultMeetingPreferences };
    try {
      return normalizePreferences(JSON.parse(String(row.json)));
    } catch {
      return { ...defaultMeetingPreferences };
    }
  }

  setPreferences(prefs: MeetingPreferences): MeetingPreferences {
    const next = normalizePreferences(prefs);
    this.db.prepare("INSERT INTO meetingSettings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(JSON.stringify(next));
    return next;
  }

  saveProposal(threadId: string, messageId: string, slots: MeetingSlot[], now: string): void {
    this.db
      .prepare("INSERT INTO meetingProposal (threadId, messageId, slots, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(threadId) DO UPDATE SET messageId = excluded.messageId, slots = excluded.slots, createdAt = excluded.createdAt")
      .run(threadId, messageId, JSON.stringify(slots), now);
  }

  proposal(threadId: string): { messageId: string; slots: MeetingSlot[]; createdAt: string } | null {
    const row = this.db.prepare("SELECT * FROM meetingProposal WHERE threadId = ?").get(threadId) as Row | undefined;
    if (!row) return null;
    try {
      return { messageId: String(row.messageId), slots: JSON.parse(String(row.slots)) as MeetingSlot[], createdAt: String(row.createdAt) };
    } catch {
      return null;
    }
  }
}

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizePreferences(raw: unknown): MeetingPreferences {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = defaultMeetingPreferences;
  const workdays = Array.isArray(v.workdays) ? [...new Set(v.workdays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort() : d.workdays;
  const dayStart = typeof v.dayStart === "string" && hhmm.test(v.dayStart) ? v.dayStart : d.dayStart;
  const dayEnd = typeof v.dayEnd === "string" && hhmm.test(v.dayEnd) && v.dayEnd > dayStart ? v.dayEnd : d.dayEnd;
  const num = (x: unknown, min: number, max: number, fallback: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : fallback);
  return {
    workdays: workdays.length ? workdays : d.workdays,
    dayStart,
    dayEnd,
    durationMinutes: num(v.durationMinutes, 15, 480, d.durationMinutes),
    bufferMinutes: num(v.bufferMinutes, 0, 120, d.bufferMinutes),
  };
}
