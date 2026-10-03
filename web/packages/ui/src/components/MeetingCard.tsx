import { CalendarCheck, CalendarClock, CalendarPlus, Loader2 } from "lucide-react";
import { formatSlot } from "@stinkyma/core";
import { useBrowserState, useUi } from "../context.js";
import { composeLabels } from "../composeLabels.js";

/** Terminfinder an der Mail (W9.4): freie Zeiten zur Anfrage, Antwort mit Vorschlägen; Zusage → Kalender. */
export function MeetingCard({ messageId }: { messageId: string }) {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const m = state.meeting?.messageId === messageId ? state.meeting : null;
  if (!m) return null;
  const tag = locale === "en" ? "en-GB" : "de-DE";
  if (m.accepted) {
    return (
      <section className="meeting-card" data-testid="meeting-accepted">
        <p className="meeting-head">
          <CalendarCheck size={16} aria-hidden="true" /> <strong>{t("meeting.accepted")}</strong> {formatSlot(m.accepted, tag)}
        </p>
        <div className="insight-actions">
          <button type="button" data-testid="meeting-add" disabled={m.added} onClick={() => m.accepted && void store.addMeetingToCalendar(m.accepted)}>
            <CalendarPlus size={14} aria-hidden="true" /> {m.added ? t("meeting.added") : t("meeting.addToCalendar")}
          </button>
        </div>
        {m.error && <p className="dialog-error" role="alert">{m.error}</p>}
      </section>
    );
  }
  const view = m.view;
  if (!view) return null;
  return (
    <section className="meeting-card" data-testid="meeting-card" aria-busy={m.busy}>
      <p className="meeting-head">
        <CalendarClock size={16} aria-hidden="true" /> <strong>{t("meeting.title")}</strong>
        <span className="muted small">„{view.request.quote}“ · {t("meeting.duration", { minutes: view.request.durationMinutes })}</span>
      </p>
      {view.slots.length === 0 ? (
        <p className="hint">{t("meeting.none")}</p>
      ) : (
        <ul className="meeting-slots" role="list">
          {view.slots.map((slot) => (
            <li key={slot.start}>
              <label className="checkbox">
                <input type="checkbox" checked={m.selected.includes(slot.start)} onChange={() => store.toggleMeetingSlot(slot.start)} data-testid="meeting-slot" />
                <span>{formatSlot(slot, tag)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {view.withoutCalendar && <p className="hint">{t("meeting.withoutCalendar")}</p>}
      <div className="insight-actions">
        <button type="button" data-testid="meeting-reply" disabled={m.busy || m.selected.length === 0} onClick={() => void store.replyWithSlots(composeLabels(t, locale))}>
          {m.busy ? <Loader2 size={14} className="spinning" aria-hidden="true" /> : null} {t("meeting.reply")}
        </button>
        <span className="hint">{t("meeting.replyHint")}</span>
      </div>
      {m.error && <p className="dialog-error" role="alert">{m.error}</p>}
    </section>
  );
}
