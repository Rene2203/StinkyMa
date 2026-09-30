import { listDateStyle } from "@stinkyma/core";
import type { Locale, Translate } from "./i18n.js";

const intlLocale = (locale: Locale) => (locale === "de" ? "de-DE" : "en-GB");

/** Datum in der Liste: heute Uhrzeit, gestern „Gestern“, diese Woche Wochentag, sonst Datum. */
export function formatListDate(iso: string, locale: Locale, t: Translate, now = new Date()): string {
  const date = new Date(iso);
  switch (listDateStyle(date, now)) {
    case "time":
      return date.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });
    case "yesterday":
      return t("date.yesterday");
    case "weekday":
      return date.toLocaleDateString(intlLocale(locale), { weekday: "long" });
    case "date":
      return date.toLocaleDateString(intlLocale(locale), { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
}

export function formatFullDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatBytes(bytes: number, locale: Locale): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString(intlLocale(locale), { maximumFractionDigits: digits })} ${units[unit]}`;
}

export function formatList(names: string[], locale: Locale): string {
  return new Intl.ListFormat(intlLocale(locale), { type: "conjunction" }).format(names);
}
