import { AlarmClock, Check, Cpu, ExternalLink, Handshake, MailCheck, RefreshCw, Reply, X } from "lucide-react";
import type { StoredPromise } from "@stinkyma/core";
import { useState } from "react";
import { composeLabels } from "../composeLabels.js";
import { useBrowserState, useUi } from "../context.js";

/** Tage bis zu einem Datum (YYYY-MM-DD), Ortszeit */
function daysUntil(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const now = new Date();
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}

/** Versprechen-Tracker (W7.3): „Meine Zusagen“ und „Ich warte auf“. Sendet nie etwas – Nachhaken öffnet nur einen Entwurf. */
export function PromisesPanel() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const data = state.promises;
  const view = data?.view;
  const tab = data?.tab ?? "mine";
  const items = (tab === "mine" ? view?.mine : view?.theirs) ?? [];
  const open = items.filter((p) => p.status === "open");
  const done = items.filter((p) => p.status === "done");

  return (
    <section className="subs-panel" aria-labelledby="prom-title" data-testid="promises">
      <header className="subs-header">
        <Handshake size={20} aria-hidden="true" />
        <div>
          <h2 id="prom-title">{t("prom.title")}</h2>
          <span className="muted small">{t("prom.subtitle")}</span>
        </div>
        <span className="toolbar-gap" aria-hidden="true" />
        {view?.scanning && (
          <span className="muted small subs-scanning">
            <Cpu size={13} aria-hidden="true" /> {t("subs.scanning", { done: view.scanning.done, total: view.scanning.total })}
          </span>
        )}
        <button type="button" disabled={data?.busy} data-testid="prom-scan" title={t("prom.scanHint")} onClick={() => void store.scanPromises(false)}>
          <RefreshCw size={14} aria-hidden="true" /> {t("subs.scan")}
        </button>
        <button type="button" disabled={data?.busy} title={view?.modelReady ? t("subs.rescanHint") : t("subs.rescanHintRules")} onClick={() => void store.scanPromises(true)}>
          {t("subs.rescan")}
        </button>
        <button type="button" className="icon-button" title={t("subs.close")} aria-label={t("subs.close")} onClick={() => store.closePromises()}>
          <X size={16} />
        </button>
      </header>
      {data?.error && <p className="dialog-error" role="alert">{data.error}</p>}
      {view && !view.modelReady && <p className="muted small subs-hint">{t("prom.noAi")}</p>}
      <div className="segmented prom-tabs" role="tablist" aria-label={t("prom.title")}>
        {(["mine", "theirs"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "selected" : ""} data-testid={`prom-tab-${key}`} onClick={() => store.selectPromiseTab(key)}>
            {t(key === "mine" ? "prom.mine" : "prom.theirs")}
            {view && view.overdue[key] > 0 && <span className="badge prom-overdue-badge">{view.overdue[key]}</span>}
          </button>
        ))}
      </div>
      <div className="prom-list">
        {!view && <p className="muted">{t("subs.busy")}</p>}
        {view && open.length === 0 && done.length === 0 && (
          <p className="muted" data-testid="prom-empty">{data?.busy ? t("subs.busy") : t(tab === "mine" ? "prom.emptyMine" : "prom.emptyTheirs", { days: view.defaultDays })}</p>
        )}
        <ul>
          {open.map((p) => (
            <PromiseCard key={p.id + p.dueDate + String(p.reminder?.id)} promise={p} />
          ))}
        </ul>
        {done.length > 0 && (
          <>
            <h3 className="prom-done-heading">{t("prom.done")}</h3>
            <ul>
              {done.map((p) => (
                <PromiseCard key={p.id} promise={p} />
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="muted small subs-legal">{t("prom.legal")}</p>
    </section>
  );
}

function PromiseCard({ promise }: { promise: StoredPromise }) {
  const { store, t, locale } = useUi();
  const [editingDue, setEditingDue] = useState(false);
  const [due, setDue] = useState(promise.dueDate);
  const days = daysUntil(promise.dueDate);
  const level = promise.status !== "open" ? "done" : days < 0 ? "past" : days <= 1 ? "soon" : "later";
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const dueLabel = new Date(`${promise.dueDate}T12:00:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
  const who = promise.counterpart.name ?? promise.counterpart.address;
  const when =
    days < 0 ? t("prom.overdue", { date: dueLabel, days: -days }) : days === 0 ? t("prom.today") : days === 1 ? t("prom.tomorrow") : t("prom.dueIn", { date: dueLabel, days });

  return (
    <li className={`prom-card ${level}`} data-testid="prom-card">
      <div className="prom-main">
        <span className="prom-who">{promise.direction === "mine" ? t("prom.toWhom", { who }) : t("prom.fromWhom", { who })}</span>
        <strong className="prom-text">{promise.text}</strong>
        {promise.quote.trim() !== promise.text.trim() && <blockquote className="prom-quote">„{promise.quote}“</blockquote>}
        <span className={`prom-due ${level}`} data-testid="prom-due">
          {promise.status === "done" ? t("prom.isDone") : when}
          {promise.status === "open" && !promise.dueStated && <span className="muted"> · {t("prom.defaultDue")}</span>}
        </span>
        {promise.status === "open" && promise.followUp && (
          <span className="prom-followup" data-testid="prom-followup">
            <MailCheck size={13} aria-hidden="true" /> {t(promise.direction === "mine" ? "prom.followUpMine" : "prom.followUpTheirs", { subject: promise.followUp.subject })}
          </span>
        )}
      </div>
      {promise.status === "open" ? (
        <div className="prom-actions">
          <button type="button" className={promise.followUp ? "primary" : ""} data-testid="prom-done" onClick={() => void store.setPromiseStatus(promise.id, "done")}>
            <Check size={14} aria-hidden="true" /> {t("prom.markDone")}
          </button>
          {promise.direction === "theirs" && promise.messageId && (
            <button type="button" data-testid="prom-nudge" title={t("prom.nudgeHint")} onClick={() => void store.followUpPromise(promise, composeLabels(t, locale))}>
              <Reply size={14} aria-hidden="true" /> {t("prom.nudge")}
            </button>
          )}
          {editingDue ? (
            <span className="prom-due-edit">
              <input type="date" value={due} aria-label={t("prom.changeDue")} onChange={(e) => setDue(e.target.value)} />
              <button type="button" disabled={!due} onClick={() => { setEditingDue(false); void store.setPromiseDueDate(promise.id, due); }}>{t("subs.save")}</button>
            </span>
          ) : (
            <button type="button" className="link" onClick={() => setEditingDue(true)}>{t("prom.changeDue")}</button>
          )}
          {promise.reminder ? (
            <button type="button" className="link" title={new Date(promise.reminder.dueDate).toLocaleString(lang)} onClick={() => void store.cancelPromiseReminder(promise.id)}>
              <AlarmClock size={13} aria-hidden="true" /> {t("prom.reminderOff")}
            </button>
          ) : (
            <button type="button" className="link" onClick={() => void store.remindPromise(promise.id, 1)}>
              <AlarmClock size={13} aria-hidden="true" /> {t("prom.reminderOn")}
            </button>
          )}
          {promise.messageId && (
            <button type="button" className="link" onClick={() => void store.openPromiseMail(promise)}>
              <ExternalLink size={13} aria-hidden="true" /> {t("subs.openMail")}
            </button>
          )}
          <button type="button" className="link muted" data-testid="prom-dismiss" onClick={() => void store.setPromiseStatus(promise.id, "dismissed")}>{t("prom.dismiss")}</button>
        </div>
      ) : (
        <div className="prom-actions">
          <button type="button" className="link" onClick={() => void store.setPromiseStatus(promise.id, "open")}>{t("prom.reopen")}</button>
        </div>
      )}
    </li>
  );
}
