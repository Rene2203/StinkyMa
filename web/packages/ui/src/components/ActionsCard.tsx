import { AlarmClock, BellRing, CalendarClock, CalendarPlus, Check, Cpu, Euro, ListTodo, Wand2, X } from "lucide-react";
import type { ActionView, MessageActionsView } from "@stinkyma/core";
import { useState } from "react";
import { useUi } from "../context.js";
import type { MessageKey } from "../i18n.js";

const typeIcon = { appointment: CalendarClock, deadline: AlarmClock, todo: ListTodo, payment: Euro } as const;

/** Lokales Datum (Ortszeit) aus YYYY-MM-DD und HH:MM. */
function localDate(date: string, time: string | null): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = (time ?? "09:00").split(":").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, h ?? 9, min ?? 0);
}

/** Erinnerungs-Vorschläge: Termin → 1 Stunde vorher; Frist/Zahlung → am Vortag 9 Uhr; immer: morgen 9 Uhr. */
export function reminderOptions(action: Pick<ActionView, "type" | "date" | "time">, now: Date): { key: MessageKey; at: Date }[] {
  const options: { key: MessageKey; at: Date }[] = [];
  if (action.date) {
    if (action.type === "appointment" && action.time) {
      options.push({ key: "reminder.hourBefore", at: new Date(localDate(action.date, action.time).getTime() - 3_600_000) });
    }
    const dayBefore = localDate(action.date, "09:00");
    dayBefore.setDate(dayBefore.getDate() - 1);
    options.push({ key: "reminder.dayBefore", at: dayBefore });
    options.push({ key: "reminder.onDay", at: localDate(action.date, "08:00") });
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  options.push({ key: "reminder.tomorrow", at: tomorrow });
  return options.filter((o) => o.at.getTime() > now.getTime());
}

export function ActionsCard({ view }: { view: MessageActionsView }) {
  const { t } = useUi();
  if (view.actions.length === 0) return null;
  return (
    <section className="actions-card" aria-label={t("actions.title")} data-testid="actions-card">
      <header className="actions-header">
        <Wand2 size={14} aria-hidden="true" />
        <strong>{t("actions.title")}</strong>
        <span className="muted small actions-origin" title={view.origin === "rules" ? t("actions.origin.rules") : t("actions.origin.onDevice")}>
          {view.origin === "rules" ? t("actions.origin.rules") : <><Cpu size={11} aria-hidden="true" /> {t("actions.origin.onDevice")}</>}
        </span>
      </header>
      <ul role="list">
        {view.actions.map((action) => (
          <ActionRow key={action.id} action={action} />
        ))}
      </ul>
    </section>
  );
}

function ActionRow({ action }: { action: ActionView }) {
  const { store, t, locale } = useUi();
  const [choosing, setChoosing] = useState(false);
  const Icon = typeIcon[action.type];
  const done = action.status === "done";
  const when = action.date
    ? localDate(action.date, action.time).toLocaleString(locale === "de" ? "de-DE" : "en-GB", {
        weekday: "short", day: "numeric", month: "short", ...(action.date.slice(0, 4) !== String(new Date().getFullYear()) ? { year: "numeric" } : {}),
        ...(action.time ? { hour: "2-digit", minute: "2-digit" } : {}),
      })
    : null;
  const options = reminderOptions(action, new Date());
  return (
    <li className={`action-row${done ? " done" : ""}`} data-testid="action-row" title={action.quote}>
      <Icon size={16} className={`action-icon action-${action.type}`} aria-hidden="true" />
      <span className="action-main">
        <span className="action-title">{action.title}</span>
        <span className="muted small">
          {[t(`actions.type.${action.type}`), when, action.amount].filter(Boolean).join(" · ")}
        </span>
        {action.reminder && (
          <span className="small action-reminder">
            <BellRing size={12} aria-hidden="true" />{" "}
            {t("reminder.set", { when: new Date(action.reminder.dueDate).toLocaleString(locale === "de" ? "de-DE" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
            <button type="button" className="link-button" onClick={() => void store.cancelReminder(action.reminder!.id)}>{t("reminder.cancel")}</button>
          </span>
        )}
      </span>
      {!done && (
        <span className="action-buttons">
          {!action.reminder && options.length > 0 && (
            <span className="reminder-menu">
              <button type="button" className="icon-button" title={t("reminder.add")} aria-label={t("reminder.add")} aria-expanded={choosing} data-testid="action-remind" onClick={() => setChoosing(!choosing)}>
                <BellRing size={15} />
              </button>
              {choosing && (
                <span className="reminder-options" role="menu">
                  {options.map((option) => (
                    <button key={option.key} type="button" role="menuitem" data-testid="reminder-option" onClick={() => { setChoosing(false); void store.remind(action.id, option.at); }}>
                      {t(option.key)} <span className="muted small">{option.at.toLocaleString(locale === "de" ? "de-DE" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
          {action.date && (
            <button type="button" className="icon-button" title={t("actions.calendar")} aria-label={t("actions.calendar")} data-testid="action-calendar" onClick={() => void store.addToCalendar(action.id)}>
              <CalendarPlus size={15} />
            </button>
          )}
          <button type="button" className="icon-button" title={t("actions.done")} aria-label={t("actions.done")} data-testid="action-done" onClick={() => void store.setActionStatus(action.id, "done")}>
            <Check size={15} />
          </button>
          <button type="button" className="icon-button" title={t("actions.dismiss")} aria-label={t("actions.dismiss")} onClick={() => void store.setActionStatus(action.id, "dismissed")}>
            <X size={15} />
          </button>
        </span>
      )}
      {done && (
        <button type="button" className="link-button small" onClick={() => void store.setActionStatus(action.id, "open")}>{t("actions.reopen")}</button>
      )}
    </li>
  );
}
