import { AlarmClock, CalendarClock, Euro, ListTodo, MessageCircleQuestion, Mail as MailIcon, Sun, X } from "lucide-react";
import { displayName, type DigestAction, type DigestMail } from "@stinkyma/core";
import { useEffect, useRef } from "react";
import { useBrowserState, useUi } from "../context.js";

const typeIcon = { appointment: CalendarClock, deadline: AlarmClock, todo: ListTodo, payment: Euro } as const;

/** Tagesüberblick (W6.6): Fälliges, „wartet auf dich“, neue wichtige Mails – der Rest nur als Zahl. */
export function DigestDialog() {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const digest = state.digest;
  if (!digest) return null;
  const { view, busy, error } = digest;
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const dayTitle = view ? new Date(`${view.day}T12:00:00`).toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" }) : "";
  const nothing = view && view.due.length === 0 && view.important.length === 0 && view.waitingOnMe.length === 0;
  const others = view
    ? [
        view.counts.newsletter && t("digest.count.newsletter", { count: view.counts.newsletter }),
        view.counts.notification && t("digest.count.notification", { count: view.counts.notification }),
        view.counts.spamSuspect && t("digest.count.spamSuspect", { count: view.counts.spamSuspect }),
        view.counts.flagged && t("digest.count.flagged", { count: view.counts.flagged }),
      ].filter(Boolean)
    : [];

  return (
    <dialog ref={dialog} className="dialog digest-dialog" aria-labelledby="digest-title" data-testid="digest-dialog" onClose={() => store.closeDigest()}>
      <header className="digest-header">
        <Sun size={20} aria-hidden="true" />
        <div>
          <h2 id="digest-title">{t("digest.title")}</h2>
          {view && <span className="muted">{dayTitle}</span>}
        </div>
        <span className="toolbar-gap" aria-hidden="true" />
        <button type="button" className="icon-button" title={t("summary.close")} aria-label={t("summary.close")} onClick={() => store.closeDigest()}>
          <X size={16} />
        </button>
      </header>
      {busy && !view && <p className="muted">{t("digest.busy")}</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {nothing && <p className="digest-empty" data-testid="digest-empty">{t("digest.nothing")}</p>}
      {view && view.due.length > 0 && (
        <section className="digest-section" data-testid="digest-due">
          <h3>{t("digest.due")}</h3>
          <ul role="list">
            {view.due.map((action) => (
              <DueRow key={action.actionId} action={action} today={view.day} />
            ))}
          </ul>
        </section>
      )}
      {view && view.waitingOnMe.length > 0 && (
        <section className="digest-section" data-testid="digest-waiting">
          <h3>{t("digest.waiting")}</h3>
          <ul role="list">
            {view.waitingOnMe.map((mail) => (
              <MailRow key={mail.messageId} mail={mail} icon="waiting" />
            ))}
          </ul>
        </section>
      )}
      {view && view.important.length > 0 && (
        <section className="digest-section" data-testid="digest-important">
          <h3>{t("digest.important")}</h3>
          <ul role="list">
            {view.important.map((mail) => (
              <MailRow key={mail.messageId} mail={mail} icon="mail" />
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && <p className="muted small">{t("digest.others", { list: others.join(" · ") })}</p>}
      <p className="hint">{t("digest.hint")}</p>
    </dialog>
  );
}

function DueRow({ action, today }: { action: DigestAction; today: string }) {
  const { store, t, locale } = useUi();
  const Icon = typeIcon[action.type];
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const when =
    action.date === today
      ? t("digest.today")
      : new Date(`${action.date}T12:00:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
  return (
    <li>
      <button type="button" className="digest-row" data-testid="digest-row" onClick={() => void store.openFromDigest(action.messageId)}>
        <Icon size={16} className={`action-icon action-${action.type}`} aria-hidden="true" />
        <span className="digest-main">
          <span>{action.title}</span>
          <span className="muted small">{displayName(action.from)} – {action.subject}</span>
        </span>
        <span className={`digest-when small${action.overdue ? " overdue" : ""}`}>
          {action.overdue ? t("digest.overdue") : when}
          {action.time ? ` ${action.time}` : ""}
          {action.amount ? ` · ${action.amount}` : ""}
        </span>
      </button>
    </li>
  );
}

function MailRow({ mail, icon }: { mail: DigestMail; icon: "mail" | "waiting" }) {
  const { store } = useUi();
  const Icon = icon === "waiting" ? MessageCircleQuestion : MailIcon;
  return (
    <li>
      <button type="button" className="digest-row" data-testid="digest-row" onClick={() => void store.openFromDigest(mail.messageId)}>
        <Icon size={16} aria-hidden="true" />
        <span className="digest-main">
          <span>{displayName(mail.from)}</span>
          <span className="muted small">{mail.subject}</span>
        </span>
      </button>
    </li>
  );
}
