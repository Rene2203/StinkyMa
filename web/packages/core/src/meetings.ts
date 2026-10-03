// Terminfinder (W9.4, Spezifikation 7.3): belegte Zeiten aus einem Kalender-Abo (ICS-Link aus Google/iCloud), freie
// Zeitfenster rechnet der Code (Arbeitszeiten, Puffer, Dauer), die KI formuliert höchstens die Antwort. Plattformneutral.
// Aus dem Kalender werden nur Zeiten gespeichert, keine Titel oder Orte.

export interface BusyInterval {
  /** ISO (UTC) */
  start: string;
  end: string;
  allDay: boolean;
}

export interface CalendarFeed {
  id: string;
  name: string;
  /** Letzter erfolgreicher Abruf (ISO) */
  lastSync: string | null;
  error: string | null;
  /** Belegte Zeiten im Zeitraum (Anzahl) */
  events: number;
}

export interface MeetingPreferences {
  /** Arbeitstage 1 = Montag … 7 = Sonntag */
  workdays: number[];
  /** HH:MM Ortszeit */
  dayStart: string;
  dayEnd: string;
  durationMinutes: number;
  bufferMinutes: number;
}

export const defaultMeetingPreferences: MeetingPreferences = { workdays: [1, 2, 3, 4, 5], dayStart: "09:00", dayEnd: "17:00", durationMinutes: 60, bufferMinutes: 15 };

export interface MeetingSlot {
  /** ISO (UTC) */
  start: string;
  end: string;
}

// --- Zeitzonen ohne Bibliothek (Intl) ---

/** Versatz einer Zeitzone zu UTC (Minuten) für einen Zeitpunkt */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return -at.getTimezoneOffset(); // unbekannte Zone: Ortszeit des Rechners
  }
}

/** Wanduhrzeit in einer Zeitzone → UTC */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string | null): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!timeZone) return new Date(y, mo - 1, d, h, mi, s); // „floating“: Ortszeit
  const first = guess - zoneOffsetMinutes(timeZone, new Date(guess)) * 60_000;
  // Zweiter Durchgang für Tage mit Zeitumstellung
  return new Date(guess - zoneOffsetMinutes(timeZone, new Date(first)) * 60_000);
}

// --- ICS lesen (RFC 5545, das Nötige) ---

interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]|\n[ \t]/g, "").split(/\r?\n/);
}

function parseLine(line: string): IcsProp | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [head = "", ...paramParts] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const [k, v] = p.split("=");
    if (k) params[k.toUpperCase()] = (v ?? "").replace(/^"|"$/g, "");
  }
  return { name: head.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** DTSTART/DTEND → Zeitpunkt; ganztägig bei VALUE=DATE */
function icsTime(prop: IcsProp): { date: Date; allDay: boolean } | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || prop.params.VALUE === "DATE") {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (m[7] === "Z") return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  return { date: zonedToUtc(y, mo, d, h, mi, s, prop.params.TZID ?? null), allDay: false };
}

function durationMs(value: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return 0;
  const n = (i: number) => Number(m[i] ?? 0);
  return ((n(2) * 7 + n(3)) * 86_400 + n(4) * 3600 + n(5) * 60 + n(6)) * 1000;
}

const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Wiederholungen (FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY bei WEEKLY) im Zeitraum */
function occurrences(start: Date, rrule: string | null, window: { from: Date; to: Date }, exdates: Set<number>): Date[] {
  if (!rrule) return [start];
  const rule = Object.fromEntries(rrule.split(";").map((p) => p.split("=") as [string, string]));
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1));
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const until = rule.UNTIL ? icsTime({ name: "UNTIL", params: {}, value: rule.UNTIL })?.date ?? null : null;
  const byDay = rule.BYDAY ? rule.BYDAY.split(",").map((d) => weekdayCodes.indexOf(d.replace(/^[+-]?\d+/, ""))).filter((d) => d >= 0) : null;
  const out: Date[] = [];
  let produced = 0;
  const limit = window.to.getTime();
  const push = (d: Date) => {
    produced++;
    if (!exdates.has(d.getTime()) && d.getTime() >= window.from.getTime() - 7 * 86_400_000 && d.getTime() <= limit) out.push(d);
  };
  for (let i = 0, guard = 0; guard < 5000; i++, guard++) {
    const base = new Date(start);
    if (freq === "DAILY") base.setDate(start.getDate() + i * interval);
    else if (freq === "WEEKLY") base.setDate(start.getDate() + i * 7 * interval);
    else if (freq === "MONTHLY") base.setMonth(start.getMonth() + i * interval);
    else if (freq === "YEARLY") base.setFullYear(start.getFullYear() + i * interval);
    else return [start];
    if (base.getTime() > limit || (until && base > until) || produced >= count) break;
    if (freq === "WEEKLY" && byDay) {
      // Woche ab Montag der Startwoche
      const monday = new Date(base);
      monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
      for (const day of [...byDay].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + ((day + 6) % 7));
        d.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (d < start || (until && d > until) || produced >= count || d.getTime() > limit) continue;
        push(d);
      }
    } else push(base);
  }
  return out;
}

/** Belegte Zeiten aus einer ICS-Datei im Zeitraum. Abgesagte und als „frei“ markierte Termine zählen nicht. */
export function parseIcsBusy(text: string, window: { from: Date; to: Date }): BusyInterval[] {
  const lines = unfold(text);
  const busy: BusyInterval[] = [];
  const overrides = new Map<string, Set<number>>(); // UID → RECURRENCE-ID (verschobene Einzeltermine)
  const events: Record<string, IcsProp[]>[] = [];
  let current: Record<string, IcsProp[]> | null = null;
  let depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      depth = 1;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("BEGIN:")) depth++;
    else if (line.startsWith("END:")) {
      depth--;
      if (line === "END:VEVENT" && depth === 0) {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (depth !== 1) continue; // VALARM u. ä. überspringen
    const prop = parseLine(line);
    if (prop) (current[prop.name] ??= []).push(prop);
  }
  for (const e of events) {
    const uid = e.UID?.[0]?.value ?? "";
    const rid = e["RECURRENCE-ID"]?.[0];
    if (uid && rid) {
      const t = icsTime(rid);
      if (t) (overrides.get(uid) ?? overrides.set(uid, new Set()).get(uid))?.add(t.date.getTime());
    }
  }
  for (const e of events) {
    if ((e.STATUS?.[0]?.value ?? "").toUpperCase() === "CANCELLED") continue;
    if ((e.TRANSP?.[0]?.value ?? "").toUpperCase() === "TRANSPARENT") continue;
    const startProp = e.DTSTART?.[0];
    const start = startProp ? icsTime(startProp) : null;
    if (!start) continue;
    const endProp = e.DTEND?.[0];
    const end = endProp ? icsTime(endProp) : null;
    const length = end ? end.date.getTime() - start.date.getTime() : e.DURATION?.[0] ? durationMs(e.DURATION[0].value) : start.allDay ? 86_400_000 : 0;
    if (length <= 0) continue;
    const uid = e.UID?.[0]?.value ?? "";
    const exdates = new Set<number>();
    for (const ex of e.EXDATE ?? []) for (const v of ex.value.split(",")) {
      const t = icsTime({ ...ex, value: v });
      if (t) exdates.add(t.date.getTime());
    }
    const isOverride = Boolean(e["RECURRENCE-ID"]);
    if (!isOverride) for (const t of overrides.get(uid) ?? []) exdates.add(t);
    const rrule = isOverride ? null : e.RRULE?.[0]?.value ?? null;
    for (const s of occurrences(start.date, rrule, window, exdates)) {
      const endAt = new Date(s.getTime() + length);
      if (endAt <= window.from || s >= window.to) continue;
      busy.push({ start: s.toISOString(), end: endAt.toISOString(), allDay: start.allDay });
    }
  }
  return busy.sort((a, b) => a.start.localeCompare(b.start));
}

/** webcal:// → https://; nur https erlaubt (der Link enthält einen geheimen Schlüssel) */
export function normalizeFeedUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Das ist keine gültige Adresse.");
  }
  if (url.protocol !== "https:") throw new Error("Bitte einen https- oder webcal-Link verwenden.");
  return url.toString();
}

// --- Freie Zeitfenster ---

function atLocal(day: Date, hhmm: string): Date {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Freie Zeitfenster: an Arbeitstagen zwischen Beginn und Ende, mit Puffer um belegte Zeiten, nicht in der Vergangenheit
 * (frühestens in 2 Stunden). Höchstens `count` Vorschläge, verteilt auf verschiedene Tage, vormittags/nachmittags gemischt.
 */
export function freeSlots(busy: BusyInterval[], prefs: MeetingPreferences, window: { from: Date; to: Date }, options: { now: Date; count?: number; preferredDays?: number[] }): MeetingSlot[] {
  // Genannte Wochentage zuerst; ist dort nichts frei, die übrigen Arbeitstage
  const preferred = (options.preferredDays ?? []).filter((d) => prefs.workdays.includes(d));
  if (preferred.length) {
    const first = freeSlots(busy, { ...prefs, workdays: preferred }, window, { ...options, preferredDays: [] });
    if (first.length >= (options.count ?? 3) || first.length >= preferred.length) return first;
    const rest = freeSlots(busy, prefs, window, { ...options, preferredDays: [] }).filter((s) => !first.some((f) => f.start === s.start));
    return [...first, ...rest].slice(0, options.count ?? 3).sort((a, b) => a.start.localeCompare(b.start));
  }
  const count = options.count ?? 3;
  const duration = prefs.durationMinutes * 60_000;
  const buffer = prefs.bufferMinutes * 60_000;
  const earliest = Math.max(window.from.getTime(), options.now.getTime() + 2 * 3_600_000);
  const intervals = busy.map((b) => ({ start: new Date(b.start).getTime() - buffer, end: new Date(b.end).getTime() + buffer }));
  const candidates: { start: number; day: string; afternoon: boolean }[] = [];
  const day = new Date(window.from);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; i < 60 && day <= window.to; i++, day.setDate(day.getDate() + 1)) {
    const weekday = ((day.getDay() + 6) % 7) + 1;
    if (!prefs.workdays.includes(weekday)) continue;
    const open = atLocal(day, prefs.dayStart).getTime();
    const close = atLocal(day, prefs.dayEnd).getTime();
    // Raster: volle und halbe Stunden
    for (let t = open; t + duration <= close; t += 30 * 60_000) {
      if (t < earliest) continue;
      if (intervals.some((b) => t < b.end && t + duration > b.start)) continue;
      candidates.push({ start: t, day: day.toDateString(), afternoon: new Date(t).getHours() >= 12 });
    }
  }
  const picked: typeof candidates = [];
  // Erst ein Vorschlag je Tag (abwechselnd vormittags/nachmittags), dann auffüllen
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => p.day === c.day)) continue;
    const wantAfternoon = picked.length % 2 === 1;
    if (c.afternoon !== wantAfternoon && candidates.some((o) => o.day === c.day && o.afternoon === wantAfternoon)) continue;
    picked.push(c);
  }
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start).map((c) => ({ start: new Date(c.start).toISOString(), end: new Date(c.start + duration).toISOString() }));
}

// --- Terminanfrage erkennen (Code) ---

export interface MeetingRequest {
  durationMinutes: number | null;
  /** Gewünschter Zeitraum (Ortszeit, Tage einschließlich) */
  from: Date;
  to: Date;
  /** Stelle in der Mail */
  quote: string;
  /** Genannte Wochentage (1 = Montag … 7 = Sonntag), „Dienstag oder Donnerstag wären ideal“ */
  preferredDays: number[];
}

const askPatterns = [
  /wann (passt|hättest|hast|hätten|haben|könnte|kannst|können|würde|wäre)[^.?!\n]{0,60}\?/i,
  /(terminvorschl[äa]ge?|termin (vereinbaren|finden|ausmachen|abstimmen)|einen termin)/i,
  /(hast|hättest|haben sie|hätten sie|habt ihr) [^.?!\n]{0,40}zeit[^.?!\n]{0,40}\?/i,
  /(können|könnten|wollen) wir (uns )?[^.?!\n]{0,40}(treffen|telefonieren|sprechen|zusammensetzen)/i,
  /\b(when (are|would) you (be )?(available|free)|find a time|schedule a (call|meeting))\b/i,
];

/** Bittet die Mail um einen Termin? Mit Dauer („30 Minuten“, „zweistündig“) und Zeitraum („nächste Woche“). */
export function meetingRequest(text: string, mailDate: Date): MeetingRequest | null {
  const body = text.replace(/\n>.*$/gm, "");
  const hit = askPatterns.map((re) => re.exec(body)).find((m) => m);
  if (!hit) return null;
  const words: Record<string, number> = { ein: 1, eine: 1, einer: 1, halb: 0.5, zwei: 2, drei: 3 };
  let durationMinutes: number | null = null;
  const minutes = /(\d{2,3})\s*(min|minuten|minutes)\b/i.exec(body);
  const hours = /\b(\d|ein|eine|einer|zwei|drei)[\s-]*(stündig\w*|stunden?\b|hours?\b|h\b)/i.exec(body);
  if (minutes) durationMinutes = Number(minutes[1]);
  else if (hours) durationMinutes = Math.round((Number(hours[1]) || words[(hours[1] ?? "").toLowerCase()] || 1) * 60);
  else if (/halbe stunde|half an hour/i.test(body)) durationMinutes = 30;
  const start = new Date(mailDate);
  start.setHours(0, 0, 0, 0);
  const from = new Date(start);
  const to = new Date(start);
  const mondayNext = new Date(start);
  mondayNext.setDate(start.getDate() + (8 - (((start.getDay() + 6) % 7) + 1)));
  if (/nächste[nr]? woche|next week/i.test(body)) {
    from.setTime(mondayNext.getTime());
    to.setTime(mondayNext.getTime());
    to.setDate(mondayNext.getDate() + 4);
  } else if (/diese[rn]? woche|this week/i.test(body)) {
    from.setDate(start.getDate() + 1);
    to.setTime(mondayNext.getTime());
    to.setDate(mondayNext.getDate() - 1);
  } else {
    from.setDate(start.getDate() + 1);
    to.setDate(start.getDate() + 14);
  }
  const dayNames: [number, RegExp][] = [
    [1, /\bmontags?\b|\bmonday\b/i], [2, /\bdienstags?\b|\btuesday\b/i], [3, /\bmittwochs?\b|\bwednesday\b/i], [4, /\bdonnerstags?\b|\bthursday\b/i],
    [5, /\bfreitags?\b|\bfriday\b/i], [6, /\bsamstags?\b|\bsaturday\b/i], [7, /\bsonntags?\b|\bsunday\b/i],
  ];
  // Nur Tage, die nicht ausgeschlossen werden („nur nicht am Montag“, „Freitag geht nicht“)
  const preferredDays = dayNames
    .filter(([, re]) => re.test(body))
    .filter(([, re]) => !new RegExp(`(nicht|außer|kein)[^.!?\\n]{0,20}(${re.source})|(${re.source})[^.!?\\n]{0,20}(geht nicht|nicht möglich|bin ich nicht|kann ich nicht)`, "i").test(body))
    .map(([d]) => d);
  return { durationMinutes, from, to, quote: hit[0].trim(), preferredDays };
}

/** „Di., 7. Okt., 10:00–11:00“ (Ortszeit) */
export function formatSlot(slot: MeetingSlot, locale = "de-DE"): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, ${time(start)}–${time(end)}`;
}

/** Antwort ohne KI: freundlich, mit den Vorschlägen als Liste */
export function slotsReplyText(slots: MeetingSlot[], form: "du" | "Sie"): string {
  const list = slots.map((s) => `- ${formatSlot(s)}`).join("\n");
  return form === "du"
    ? `gern – folgende Termine würden bei mir passen:\n${list}\nSag mir einfach, was dir am besten passt.`
    : `gern – folgende Termine würden bei mir passen:\n${list}\nGeben Sie mir gern Bescheid, welcher Ihnen am besten passt.`;
}

/** Hat die Antwort einen der Vorschläge angenommen? Gibt den passenden Vorschlag zurück. */
export function acceptedSlot(text: string, slots: MeetingSlot[]): MeetingSlot | null {
  const body = text.replace(/\n>.*$/gm, "").toLowerCase();
  if (!/(passt|gerne?|einverstanden|nehme|klingt gut|machen wir|bestätig|works|sounds good|perfekt|super)/.test(body)) return null;
  const weekdayNames = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
  const short = ["so", "mo", "di", "mi", "do", "fr", "sa"];
  const matches = slots.filter((s) => {
    const d = new Date(s.start);
    const hour = d.getHours();
    const minute = d.getMinutes();
    const time = new RegExp(`\\b${hour}(:${String(minute).padStart(2, "0")}|\\.${String(minute).padStart(2, "0")}${minute === 0 ? "|\\s*uhr" : ""})`);
    const dayMentioned = new RegExp(`\\b(${weekdayNames[d.getDay()]}|${short[d.getDay()]}\\.?)\\b`).test(body) || body.includes(`${d.getDate()}.${d.getMonth() + 1}.`) || body.includes(`${d.getDate()}. `);
    return dayMentioned && (time.test(body) || slots.filter((o) => new Date(o.start).getDay() === d.getDay()).length === 1);
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export interface MeetingView {
  messageId: string;
  request: { durationMinutes: number; quote: string; from: string; to: string };
  slots: MeetingSlot[];
  /** Kein Kalender verbunden – Vorschläge nur aus Arbeitszeiten und bekannten Terminen */
  withoutCalendar: boolean;
}

export interface MeetingsApi {
  feeds(): Promise<CalendarFeed[]>;
  addFeed(name: string, url: string): Promise<CalendarFeed[]>;
  removeFeed(id: string): Promise<CalendarFeed[]>;
  refresh(): Promise<CalendarFeed[]>;
  preferences(): Promise<MeetingPreferences>;
  setPreferences(prefs: MeetingPreferences): Promise<MeetingPreferences>;
  /** Terminanfrage in der Mail? Dann freie Zeitfenster; `null`, wenn die Mail keine Anfrage ist */
  forMessage(messageId: string): Promise<MeetingView | null>;
  /** Antworttext mit den gewählten Vorschlägen (KI formuliert, Code prüft; sonst Vorlage). Merkt die Vorschläge für den Verlauf. */
  draftReply(messageId: string, slots: MeetingSlot[]): Promise<{ text: string; origin: "onDevice" | "rules" }>;
  /** Zusage in einer späteren Mail des Verlaufs erkannt? */
  acceptance(messageId: string): Promise<MeetingSlot | null>;
  /** Termin als Kalenderdatei öffnen (Standardprogramm) */
  addToCalendar(messageId: string, slot: MeetingSlot): Promise<void>;
}

export const meetingsApiMethods = ["feeds", "addFeed", "removeFeed", "refresh", "preferences", "setPreferences", "forMessage", "draftReply", "acceptance", "addToCalendar"] as const satisfies readonly (keyof MeetingsApi)[];
