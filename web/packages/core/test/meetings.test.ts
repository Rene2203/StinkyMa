import { describe, expect, it } from "vitest";
import {
  acceptedSlot, defaultMeetingPreferences, formatSlot, freeSlots, InMemorySecretStore, meetingRequest, normalizeFeedUrl, parseIcsBusy, SecretKeys, zonedToUtc, type Account,
} from "../src/index.js";
import { MeetingService } from "../src/llm/index.js";
import { MailWriter, MeetingStore, openDatabase, SqliteMailRepository } from "../src/sqlite/index.js";

// Testdaten erfunden.
const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Europe/Berlin
END:VTIMEZONE
BEGIN:VEVENT
UID:a@example.test
DTSTART;TZID=Europe/Berlin:20261006T100000
DTEND;TZID=Europe/Berlin:20261006T113000
SUMMARY:Zahnarzt
BEGIN:VALARM
TRIGGER:-PT15M
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:b@example.test
DTSTART:20261005T070000Z
DTEND:20261005T080000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4
EXDATE:20261007T070000Z
SUMMARY:Team
END:VEVENT
BEGIN:VEVENT
UID:c@example.test
DTSTART;VALUE=DATE:20261009
DTEND;VALUE=DATE:20261010
SUMMARY:Urlaub
END:VEVENT
BEGIN:VEVENT
UID:d@example.test
DTSTART:20261008T120000Z
DTEND:20261008T130000Z
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:e@example.test
DTSTART:20261008T140000Z
DURATION:PT1H
TRANSP:TRANSPARENT
END:VEVENT
END:VCALENDAR`;

describe("Terminfinder (W9.4)", () => {
  it("liest belegte Zeiten aus ICS: Zeitzone, Wiederholung mit Ausnahme, ganztägig; Abgesagtes und „frei“ zählen nicht", () => {
    const busy = parseIcsBusy(ics.replace(/\n/g, "\r\n"), { from: new Date("2026-10-05T00:00:00Z"), to: new Date("2026-10-20T00:00:00Z") });
    // 10:00 Berlin (Sommerzeit) = 08:00 UTC
    expect(busy).toContainEqual({ start: "2026-10-06T08:00:00.000Z", end: "2026-10-06T09:30:00.000Z", allDay: false });
    const team = busy.filter((b) => !b.allDay && b.start.endsWith("T07:00:00.000Z")).map((b) => b.start.slice(0, 10));
    expect(team).toEqual(["2026-10-05", "2026-10-12", "2026-10-14"]); // 7.10. ausgenommen, COUNT=4 zählt ihn mit
    expect(busy.filter((b) => b.allDay)).toHaveLength(1);
    expect(busy.some((b) => b.start.startsWith("2026-10-08"))).toBe(false);
    expect(zonedToUtc(2026, 1, 15, 9, 0, 0, "Europe/Berlin").toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("rechnet freie Zeitfenster mit Puffer, an Arbeitstagen, über mehrere Tage verteilt", () => {
    const monday = new Date(2026, 9, 5, 0, 0, 0); // Ortszeit
    const busyLocal = (h1: number, h2: number, day = 5) => ({ start: new Date(2026, 9, day, h1).toISOString(), end: new Date(2026, 9, day, h2).toISOString(), allDay: false });
    const slots = freeSlots([busyLocal(9, 12), busyLocal(13, 17)], defaultMeetingPreferences, { from: monday, to: new Date(2026, 9, 9) }, { now: new Date(2026, 9, 1), count: 3 });
    expect(slots).toHaveLength(3);
    // Montag ist voll (Puffer 15 Min. lässt 12–13 Uhr nicht zu); Vorschläge an verschiedenen Tagen
    expect(slots.every((s) => new Date(s.start).getDate() !== 5)).toBe(true);
    expect(new Set(slots.map((s) => new Date(s.start).getDate())).size).toBe(3);
    expect(slots.every((s) => new Date(s.end).getTime() - new Date(s.start).getTime() === 3_600_000)).toBe(true);
    // Wochenende nie
    expect(freeSlots([], defaultMeetingPreferences, { from: new Date(2026, 9, 10), to: new Date(2026, 9, 11, 23) }, { now: new Date(2026, 9, 1) })).toEqual([]);
  });

  it("erkennt Terminanfragen mit Dauer und Zeitraum und eine Zusage in der Antwort", () => {
    const req = meetingRequest("Hallo Anna, wann passt es dir nächste Woche für einen zweistündigen Workshop?", new Date(2026, 9, 3));
    expect(req?.durationMinutes).toBe(120);
    expect(req?.from.getDate()).toBe(5);
    expect(req?.to.getDate()).toBe(9);
    expect(meetingRequest("Anbei die Rechnung.", new Date())).toBeNull();
    expect(meetingRequest("Wann passt es dir? Dienstag oder Donnerstag wären ideal, nur nicht am Freitag.", new Date(2026, 9, 3))?.preferredDays).toEqual([2, 4]);
    const preferred = freeSlots([], defaultMeetingPreferences, { from: new Date(2026, 9, 5), to: new Date(2026, 9, 9, 23) }, { now: new Date(2026, 9, 1), preferredDays: [2, 4] });
    expect(preferred).toHaveLength(3);
    expect(new Set(preferred.map((p) => new Date(p.start).getDay()))).toEqual(new Set([2, 4]));
    expect(meetingRequest("Können wir kurz telefonieren? 30 Minuten reichen.", new Date(2026, 9, 3))?.durationMinutes).toBe(30);
    const slots = [
      { start: new Date(2026, 9, 6, 10).toISOString(), end: new Date(2026, 9, 6, 11).toISOString() },
      { start: new Date(2026, 9, 7, 14).toISOString(), end: new Date(2026, 9, 7, 15).toISOString() },
    ];
    expect(acceptedSlot("Dienstag um 10 Uhr passt mir gut!", slots)).toEqual(slots[0]);
    expect(acceptedSlot("Mittwoch passt.\n> Dienstag 10 Uhr", slots)).toEqual(slots[1]);
    expect(acceptedSlot("Leider kann ich an beiden Tagen nicht.", slots)).toBeNull();
    expect(formatSlot(slots[0]!)).toMatch(/Di\.?, 6\. Okt\.?, 10:00–11:00/);
  });

  it("nimmt nur https/webcal-Links", () => {
    expect(normalizeFeedUrl("webcal://p01-caldav.icloud.example/published/2/abc")).toBe("https://p01-caldav.icloud.example/published/2/abc");
    expect(() => normalizeFeedUrl("http://calendar.example/basic.ics")).toThrow();
  });
});


describe("Terminfinder-Dienst (W9.4)", () => {
  it("ruft das Kalender-Abo ab, schlägt freie Zeiten vor, merkt die Vorschläge und erkennt die Zusage", async () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    const account: Account = {
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    };
    writer.insertAccount(account);
    writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
    const lukas = { name: "Lukas Brandt", address: "l.brandt@kreativwerk.example" };
    const add = (uid: number, body: string, date: Date) =>
      writer.insertMessage({
        id: `acc/inbox#1:${uid}`, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<w${uid}@example.test>`, threadId: "t-workshop", threadSubject: "Workshop",
        from: lukas, to: [{ name: "Anna", address: "anna@example.test" }], cc: [], subject: uid === 1 ? "Terminanfrage: Workshop" : "Re: Terminanfrage: Workshop", date: date.toISOString(), snippet: "", bodyText: body, bodyHtml: null, flags: 0, attachments: [],
      });
    add(1, "Hallo Anna, wann passt es dir nächste Woche für einen zweistündigen Workshop?\nLukas", new Date(2026, 9, 2, 10));
    const repo = new SqliteMailRepository(db);
    const secrets = new InMemorySecretStore();
    // Montag der Folgewoche ganztägig belegt (Urlaub) – Vorschläge ab Dienstag
    const feed = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u@example.test\r\nDTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    const fetched: string[] = [];
    let now = new Date(2026, 9, 2, 12);
    const service = new MeetingService({
      store: new MeetingStore(db),
      secrets,
      message: (id) => repo.message(id),
      thread: (id) => repo.thread(id),
      ownAddresses: async () => ["anna@example.test"],
      fetchImpl: (async (url: string) => {
        fetched.push(String(url));
        return new Response(feed, { status: 200 });
      }) as unknown as typeof fetch,
      newId: () => "feed1",
      now: () => now,
    });
    await expect(service.addFeed("Privat", "http://unsicher.example/cal.ics")).rejects.toThrow();
    const feeds = await service.addFeed("Privat", "webcal://kalender.example/private/geheim.ics");
    expect(feeds).toMatchObject([{ name: "Privat", error: null, events: 1 }]);
    expect(fetched).toEqual(["https://kalender.example/private/geheim.ics"]);
    expect(await secrets.get(SecretKeys.calendarFeedUrl("feed1"))).toBe("https://kalender.example/private/geheim.ics");
    // Adresse steht nicht in der Datenbank
    expect(JSON.stringify(db.prepare("SELECT * FROM calendarFeed").all())).not.toContain("geheim");

    const view = await service.forMessage("acc/inbox#1:1");
    expect(view?.request.durationMinutes).toBe(120);
    expect(view?.withoutCalendar).toBe(false);
    expect(view?.slots).toHaveLength(3);
    expect(view?.slots.every((s) => new Date(s.start).getDate() >= 6 && new Date(s.start).getDate() <= 9)).toBe(true);

    const draft = await service.draftReply("acc/inbox#1:1", view?.slots.slice(0, 2) ?? []);
    expect(draft.origin).toBe("rules");
    expect(draft.text.startsWith("Hallo Lukas,\n")).toBe(true);
    expect(draft.text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2);

    // Lukas antwortet und nimmt den ersten Vorschlag
    const first = new Date(view?.slots[0]?.start ?? "");
    const weekday = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][first.getDay()];
    now = new Date(2026, 9, 3, 9);
    add(2, `Super, ${weekday} um ${first.getHours()} Uhr passt mir!`, new Date(2026, 9, 3, 8));
    expect(await service.acceptance("acc/inbox#1:2")).toEqual(view?.slots[0]);
    expect(await service.forMessage("acc/inbox#1:2")).toBeNull();
  });
});
