import { AlarmClock, CalendarClock, Handshake, MessageCircleQuestion, ReceiptText, Repeat, UserRound, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { MessageKey } from "../i18n.js";

/** Absender-Steckbrief (W8.2) neben der Mail: Gespräche, Antwortverhalten, offene Punkte, Zusagen, Belege, Schnellfrage. */
export function ContactPanel() {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const contact = state.contact;
  const [question, setQuestion] = useState("");
  if (!contact) return null;
  const p = contact.profile;
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
  const hours = (h: number | null) => (h === null ? null : h < 1 ? t("contact.underHour") : h < 24 ? t("contact.hours", { count: Math.round(h) }) : t("contact.days", { count: Math.round(h / 24) }));
  const money = (cents: number) => (cents / 100).toLocaleString(lang, { style: "currency", currency: "EUR" });
  const ask = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim().length >= 3) void store.openAsk(question, contact.address);
  };

  return (
    <aside className="contact-panel" aria-label={t("contact.title")} data-testid="contact-panel">
      <header className="contact-head">
        <UserRound size={18} aria-hidden="true" />
        <div className="contact-name">
          <strong>{p?.name ?? contact.address}</strong>
          <span className="muted small">{contact.address}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t("summary.close")} onClick={() => store.closeContact()}>
          <X size={15} />
        </button>
      </header>
      {contact.busy && <p className="muted small">{t("subs.busy")}</p>}
      {contact.error && <p className="dialog-error">{contact.error}</p>}
      {p && (
        <div className="contact-body">
          <dl className="contact-facts">
            <div><dt>{t("contact.mails")}</dt><dd data-testid="contact-counts">{t("contact.counts", { received: p.received, sent: p.sent })}</dd></div>
            {p.firstContact && <div><dt>{t("contact.since")}</dt><dd>{date(p.firstContact)}</dd></div>}
            {p.lastContact && <div><dt>{t("contact.last")}</dt><dd>{date(p.lastContact)}</dd></div>}
            {hours(p.theyReplyHours) && <div><dt>{t("contact.theyReply")}</dt><dd>{hours(p.theyReplyHours)}</dd></div>}
            {hours(p.iReplyHours) && <div><dt>{t("contact.iReply")}</dt><dd>{hours(p.iReplyHours)}</dd></div>}
            {p.usualCategory && <div><dt>{t("contact.usually")}</dt><dd>{t(`category.${p.usualCategory}` as MessageKey)}{p.ownCategory ? ` · ${p.ownCategory}` : ""}</dd></div>}
          </dl>

          {p.promises.length > 0 && (
            <section>
              <h4><Handshake size={13} aria-hidden="true" /> {t("contact.promises")}</h4>
              <ul>
                {p.promises.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="link" onClick={() => void store.openPromises(x.direction)}>
                      {x.direction === "mine" ? t("contact.iPromised") : t("contact.theyPromised")}: {x.text}
                    </button>
                    <span className="muted small"> · {date(x.dueDate)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p.actions.length > 0 && (
            <section>
              <h4><CalendarClock size={13} aria-hidden="true" /> {t("contact.openPoints")}</h4>
              <ul>
                {p.actions.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="link" onClick={() => void store.openMessage(a.messageId)}>{a.title}</button>
                    {a.date && <span className="muted small"> · {date(a.date)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(p.receipts.count > 0 || p.subscription) && (
            <section>
              <h4><ReceiptText size={13} aria-hidden="true" /> {t("contact.money")}</h4>
              <ul>
                {p.subscription && (
                  <li>
                    <button type="button" className="link" onClick={() => void store.openSubscriptions()}>
                      <Repeat size={12} aria-hidden="true" /> {[p.subscription.provider, p.subscription.amount].filter(Boolean).join(" · ")}
                    </button>
                  </li>
                )}
                {p.receipts.count > 0 && (
                  <li>
                    <button type="button" className="link" onClick={() => void store.openReceipts()}>
                      {t("contact.receipts", { count: p.receipts.count, sum: money(p.receipts.totalCents) })}
                    </button>
                  </li>
                )}
              </ul>
            </section>
          )}

          {p.recent.length > 0 && (
            <section>
              <h4><AlarmClock size={13} aria-hidden="true" /> {t("contact.recent")}</h4>
              <ul>
                {p.recent.map((r) => (
                  <li key={r.threadId}>
                    <button type="button" className="link" onClick={() => void store.openMessage(r.messageId)}>{r.subject || t("ask.noSubject")}</button>
                    <span className="muted small"> · {date(r.date)}{r.fromMe ? ` · ${t("contact.fromMe")}` : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {store.canAsk && (
            <form className="contact-ask" onSubmit={ask}>
              <label className="small muted" htmlFor="contact-ask-input"><MessageCircleQuestion size={13} aria-hidden="true" /> {t("contact.askLabel")}</label>
              <div>
                <input id="contact-ask-input" value={question} placeholder={t("contact.askPlaceholder")} data-testid="contact-ask" onChange={(e) => setQuestion(e.target.value)} />
                <button type="submit" disabled={question.trim().length < 3}>{t("ask.submit")}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </aside>
  );
}
