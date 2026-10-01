/** Wie ein Datum in der Mail-Liste erscheint: heute Uhrzeit, gestern „Gestern“, letzte Woche Wochentag, sonst Datum. */
export type ListDateStyle = "time" | "yesterday" | "weekday" | "date";

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function listDateStyle(date: Date, now: Date): ListDateStyle {
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diffDays === 0) return "time";
  if (diffDays === 1) return "yesterday";
  if (diffDays > 1 && diffDays <= 6 && date < now) return "weekday";
  return "date";
}
