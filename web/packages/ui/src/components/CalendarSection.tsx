import { CalendarDays, RefreshCw, X } from "lucide-react";
import type { MeetingPreferences } from "@stinkyma/core";
import { useEffect, useState } from "react";
import { useBrowserState, useUi } from "../context.js";

const weekdayKeys = ["meeting.mo", "meeting.tu", "meeting.we", "meeting.th", "meeting.fr", "meeting.sa", "meeting.su"] as const;

/** Optionen → Kalender (W9.4): Kalender-Abo-Links (ICS) und Arbeitszeiten für den Terminfinder. */
export function CalendarSection() {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    void store.loadCalendar();
  }, [store]);
  if (!store.canMeetings) return null;
  const calendar = state.calendar;
  const prefs = calendar?.preferences;
  const update = (patch: Partial<MeetingPreferences>) => prefs && void store.setMeetingPreferences({ ...prefs, ...patch });
  const add = () => {
    void store.addCalendarFeed(name, url).then((ok) => {
      if (ok) {
        setName("");
        setUrl("");
      }
    });
  };
  const when = (iso: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  return (
    <section className="options-section" aria-labelledby="options-calendar-heading" data-testid="calendar-section">
      <h3 id="options-calendar-heading">
        <CalendarDays size={16} aria-hidden="true" /> {t("calendar.title")}
      </h3>
      <p className="hint">{t("calendar.text")}</p>
      {(calendar?.feeds ?? []).length > 0 && (
        <ul role="list" className="personal-list">
          {calendar?.feeds.map((f) => (
            <li key={f.id} data-testid="calendar-feed">
              <span className="ellipsis">{f.name}</span>
              <span className={`small ${f.error ? "error-text" : "muted"}`}>
                {f.error ?? (f.lastSync ? t("calendar.synced", { when: when(f.lastSync), count: f.events }) : t("calendar.never"))}
              </span>
              <button type="button" className="icon-button" aria-label={t("calendar.remove", { name: f.name })} title={t("calendar.remove", { name: f.name })} onClick={() => void store.removeCalendarFeed(f.id)}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Kein <form>: Die Optionen sind selbst ein Formular (verschachtelte Formulare lösen beide aus) */}
      <div className="calendar-add">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("calendar.name")} aria-label={t("calendar.name")} data-testid="calendar-name" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("calendar.url")}
          aria-label={t("calendar.url")}
          data-testid="calendar-url"
          autoComplete="off"
        />
        <button type="button" disabled={!url.trim() || calendar?.busy} data-testid="calendar-add" onClick={add}>{t("calendar.add")}</button>
        <button type="button" className="icon-button" title={t("calendar.refresh")} aria-label={t("calendar.refresh")} disabled={calendar?.busy} onClick={() => void store.refreshCalendar()}>
          <RefreshCw size={14} className={calendar?.busy ? "spinning" : undefined} />
        </button>
      </div>
      <p className="hint">{t("calendar.urlHint")}</p>
      {calendar?.error && <p className="dialog-error" role="alert">{calendar.error}</p>}
      {prefs && (
        <div className="calendar-prefs">
          <strong className="small">{t("calendar.prefs")}</strong>
          <div className="calendar-days">
            {weekdayKeys.map((key, i) => (
              <label key={key} className="checkbox small">
                <input
                  type="checkbox"
                  checked={prefs.workdays.includes(i + 1)}
                  onChange={(e) => update({ workdays: e.target.checked ? [...prefs.workdays, i + 1] : prefs.workdays.filter((d) => d !== i + 1) })}
                />
                <span>{t(key)}</span>
              </label>
            ))}
          </div>
          <label className="small">
            {t("calendar.from")} <input type="time" value={prefs.dayStart} onChange={(e) => update({ dayStart: e.target.value })} data-testid="calendar-start" />
          </label>{" "}
          <label className="small">
            {t("calendar.to")} <input type="time" value={prefs.dayEnd} onChange={(e) => update({ dayEnd: e.target.value })} />
          </label>{" "}
          <label className="small">
            {t("calendar.duration")} <input type="number" min={15} max={480} step={15} value={prefs.durationMinutes} onChange={(e) => update({ durationMinutes: Number(e.target.value) })} />
          </label>{" "}
          <label className="small">
            {t("calendar.buffer")} <input type="number" min={0} max={120} step={5} value={prefs.bufferMinutes} onChange={(e) => update({ bufferMinutes: Number(e.target.value) })} />
          </label>
        </div>
      )}
    </section>
  );
}
