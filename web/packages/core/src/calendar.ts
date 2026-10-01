// Kalendereintrag als iCalendar-Datei (RFC 5545) – öffnet sich in Outlook, Windows-Kalender, Google Kalender, Apple
// Kalender. Kein Zugriff auf fremde Kalender nötig: der Nutzer übernimmt den Eintrag selbst.

export interface CalendarEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (Ortszeit) – ohne Uhrzeit wird es ein ganztägiger Eintrag */
  time: string | null;
  durationMinutes?: number;
  description?: string;
  /** Erinnerung so viele Minuten vorher (nur mit Uhrzeit sinnvoll; ganztägig: 9 Uhr am Vortag) */
  alarmMinutesBefore?: number;
}

/** Text nach RFC 5545 maskieren. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Zeilen über 75 Zeichen falten (RFC 5545, 3.1). */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

const compactDate = (date: string) => date.replace(/-/g, "");

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [h, m] = time.split(":").map(Number);
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCMinutes((h ?? 0) * 60 + (m ?? 0) + minutes);
  return { date: base.toISOString().slice(0, 10), time: base.toISOString().slice(11, 16) };
}

export function toICalendar(event: CalendarEvent, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StinkyMa//DE", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${stamp}`];
  if (event.time) {
    // „Schwebende“ Ortszeit: der Kalender nimmt die Zeitzone des Rechners
    const end = addMinutes(event.date, event.time, event.durationMinutes ?? 60);
    lines.push(`DTSTART:${compactDate(event.date)}T${event.time.replace(":", "")}00`, `DTEND:${compactDate(end.date)}T${end.time.replace(":", "")}00`);
  } else {
    const next = addMinutes(event.date, "00:00", 24 * 60).date;
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.date)}`, `DTEND;VALUE=DATE:${compactDate(next)}`);
  }
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.alarmMinutesBefore !== undefined) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(event.title)}`, `TRIGGER:-PT${Math.max(0, Math.round(event.alarmMinutesBefore))}M`, "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Sicherer Dateiname für den Kalendereintrag. */
export function calendarFileName(title: string, date: string): string {
  const base = title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 40) || "Termin";
  return `${date} ${base}.ics`;
}
