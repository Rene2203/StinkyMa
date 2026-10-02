import { AlarmClock, Cpu, ExternalLink, Repeat, X } from "lucide-react";
import { billingIntervals, countsTowardsCosts, monthlyCents, subscriptionKinds, type BillingInterval, type StoredSubscription, type SubscriptionKind } from "@stinkyma/core";
import { useEffect, useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { MessageKey } from "../i18n.js";

/** Tage bis zu einem Datum (YYYY-MM-DD), Ortszeit. */
function daysUntil(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

function useFormat() {
  const { locale } = useUi();
  const lang = locale === "de" ? "de-DE" : "en-GB";
  return {
    money: (cents: number) => (cents / 100).toLocaleString(lang, { style: "currency", currency: "EUR" }),
    date: (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" }),
  };
}

/** „Abos & Verträge“ (W7.1): Übersicht mit Kosten, Kündigungstagen und Erinnerungen. Kündigt nie selbst. */
export function SubscriptionsPanel() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const format = useFormat();
  const data = state.subscriptions;
  const view = data?.view;
  const items = view?.items ?? [];
  const selected = items.find((s) => s.id === data?.selectedId) ?? null;
  const groups: [MessageKey, StoredSubscription[]][] = [
    ["subs.group.active", items.filter((s) => s.status === "active" && s.kind !== "trial")],
    ["subs.group.trial", items.filter((s) => s.status === "active" && s.kind === "trial")],
    ["subs.group.cancelled", items.filter((s) => s.status === "cancelled")],
    ["subs.group.dismissed", items.filter((s) => s.status === "dismissed")],
  ];

  return (
    <section className="subs-panel" aria-labelledby="subs-title" data-testid="subscriptions">
      <header className="subs-header">
        <Repeat size={20} aria-hidden="true" />
        <div>
          <h2 id="subs-title">{t("subs.title")}</h2>
          {view && (
            <span className="muted small" data-testid="subs-costs">
              {t("subs.costs", { month: format.money(view.monthlyCents), year: format.money(view.yearlyCents) })}
            </span>
          )}
        </div>
        <span className="toolbar-gap" aria-hidden="true" />
        {view?.scanning && (
          <span className="muted small subs-scanning" data-testid="subs-scanning">
            <Cpu size={13} aria-hidden="true" /> {t("subs.scanning", { done: view.scanning.done, total: view.scanning.total })}
          </span>
        )}
        <button type="button" className="icon-button" title={t("subs.close")} aria-label={t("subs.close")} onClick={() => store.closeSubscriptions()}>
          <X size={16} />
        </button>
      </header>
      {data?.error && <p className="dialog-error" role="alert">{data.error}</p>}
      <div className="subs-body">
        <div className="subs-list">
          {!view && <p className="muted">{t("subs.busy")}</p>}
          {view && items.length === 0 && <p className="muted" data-testid="subs-empty">{data?.busy ? t("subs.busy") : t("subs.empty")}</p>}
          {groups.map(([label, list]) =>
            list.length === 0 ? null : (
              <div key={label} className="subs-group">
                <h3>{t(label)}</h3>
                <ul role="listbox" aria-label={t(label)}>
                  {list.map((sub) => (
                    <SubscriptionRow key={sub.id} sub={sub} selected={sub.id === selected?.id} />
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
        {selected ? <SubscriptionDetail key={selected.id + selected.updatedAt} sub={selected} /> : <div className="subs-detail muted">{items.length ? t("subs.pick") : ""}</div>}
      </div>
      <p className="muted small subs-legal">{t("subs.legal")}</p>
    </section>
  );
}

function amountLabel(sub: StoredSubscription, t: ReturnType<typeof useUi>["t"]): string {
  if (!sub.amount) return "";
  return sub.interval ? `${sub.amount} ${t(`subs.per.${sub.interval}` as MessageKey)}` : sub.amount;
}

function CancelHint({ sub }: { sub: StoredSubscription }) {
  const { t } = useUi();
  const format = useFormat();
  if (sub.status !== "active" || !sub.lastCancelDay) return null;
  const days = daysUntil(sub.lastCancelDay);
  const level = days < 0 ? "past" : days <= 14 ? "soon" : "later";
  return (
    <span className={`subs-cancel ${level}`} data-testid="subs-cancel">
      {days < 0
        ? t("subs.cancelPassed", { date: format.date(sub.lastCancelDay) })
        : days === 0
          ? t("subs.cancelToday", { date: format.date(sub.lastCancelDay) })
          : days === 1
            ? t("subs.cancelTomorrow", { date: format.date(sub.lastCancelDay) })
            : t("subs.cancelBy", { date: format.date(sub.lastCancelDay), days })}
    </span>
  );
}

function SubscriptionRow({ sub, selected }: { sub: StoredSubscription; selected: boolean }) {
  const { store, t } = useUi();
  return (
    <li>
      <button type="button" role="option" aria-selected={selected} className="subs-row" data-testid="subs-row" onClick={() => store.selectSubscription(sub.id)}>
        <span className="subs-row-main">
          <strong>{sub.provider}</strong>
          <span className="muted small">{[t(`subs.kind.${sub.kind}` as MessageKey), amountLabel(sub, t)].filter(Boolean).join(" · ")}</span>
          <CancelHint sub={sub} />
        </span>
        {sub.reminder && <AlarmClock size={14} aria-label={t("subs.hasReminder")} />}
      </button>
    </li>
  );
}

function SubscriptionDetail({ sub }: { sub: StoredSubscription }) {
  const { store, t } = useUi();
  const format = useFormat();
  const [provider, setProvider] = useState(sub.provider);
  const [kind, setKind] = useState<SubscriptionKind>(sub.kind);
  const [amount, setAmount] = useState(sub.amount ?? "");
  const [interval, setInterval] = useState<BillingInterval | "">(sub.interval ?? "");
  const [cancelDay, setCancelDay] = useState(sub.lastCancelDay ?? "");
  const [days, setDays] = useState(3);
  useEffect(() => setDays(3), [sub.id]);
  const dirty = provider !== sub.provider || kind !== sub.kind || amount !== (sub.amount ?? "") || interval !== (sub.interval ?? "") || cancelDay !== (sub.lastCancelDay ?? "");
  const perMonth = monthlyCents(sub);
  const facts: [MessageKey, string | null][] = [
    ["subs.fact.amount", amountLabel(sub, t) || null],
    ["subs.fact.start", sub.startDate && format.date(sub.startDate)],
    ["subs.fact.trialEnd", sub.trialEnd && format.date(sub.trialEnd)],
    ["subs.fact.termEnd", sub.termEnd && format.date(sub.termEnd)],
    ["subs.fact.minTerm", sub.minTermMonths ? t("subs.months", { count: sub.minTermMonths }) : null],
    ["subs.fact.renewal", sub.renewalDate && format.date(sub.renewalDate)],
    ["subs.fact.notice", sub.notice ? t(`subs.notice.${sub.notice.unit}` as MessageKey, { count: sub.notice.amount }) : null],
    ["subs.fact.cancelBy", sub.cancelBy && format.date(sub.cancelBy)],
    ["subs.fact.perMonth", perMonth !== null && countsTowardsCosts(sub) && sub.interval !== "monthly" ? format.money(perMonth) : null],
  ];
  const origin = sub.origin === "user" ? t("subs.origin.user") : sub.origin === "rules" ? t("subs.origin.rules") : t("subs.origin.ai");

  return (
    <div className="subs-detail" data-testid="subs-detail">
      <div className="subs-detail-head">
        <h3>{sub.provider}</h3>
        <span className="muted small" data-testid="subs-origin">{origin}</span>
      </div>
      <CancelHint sub={sub} />
      <dl className="subs-facts">
        {facts.filter(([, value]) => value).map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {sub.quote && <blockquote className="subs-quote">„{sub.quote}“</blockquote>}
      {sub.sourceMessageId && (
        <button type="button" className="link" data-testid="subs-open-mail" onClick={() => void store.openSubscriptionMail(sub)}>
          <ExternalLink size={13} aria-hidden="true" /> {t("subs.openMail")}
        </button>
      )}

      {sub.status === "active" && (
        <div className="subs-reminder">
          {sub.reminder ? (
            <>
              <span data-testid="subs-reminder">
                <AlarmClock size={14} aria-hidden="true" /> {t("subs.reminderSet", { date: new Date(sub.reminder.dueDate).toLocaleDateString() })}
              </span>
              <button type="button" className="link" onClick={() => void store.cancelSubscriptionReminder(sub.id)}>{t("subs.reminderCancel")}</button>
            </>
          ) : (
            <>
              <label>
                <span className="visually-hidden">{t("subs.reminderDays")}</span>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("subs.reminderDays")}>
                  {[1, 3, 7, 14, 30].map((n) => (
                    <option key={n} value={n}>{n === 1 ? t("subs.dayBefore") : t("subs.daysBefore", { count: n })}</option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={!sub.lastCancelDay} data-testid="subs-remind" onClick={() => void store.remindSubscription(sub.id, days)}>
                <AlarmClock size={14} aria-hidden="true" /> {t("subs.remind")}
              </button>
            </>
          )}
        </div>
      )}

      <details className="subs-edit">
        <summary>{t("subs.edit")}</summary>
        <div className="subs-form">
          <label>
            <span>{t("subs.field.provider")}</span>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} data-testid="subs-provider" />
          </label>
          <label>
            <span>{t("subs.field.kind")}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as SubscriptionKind)}>
              {subscriptionKinds.map((k) => (
                <option key={k} value={k}>{t(`subs.kind.${k}` as MessageKey)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("subs.field.amount")}</span>
            <input value={amount} placeholder="12,99 €" onChange={(e) => setAmount(e.target.value)} data-testid="subs-amount" />
          </label>
          <label>
            <span>{t("subs.field.interval")}</span>
            <select value={interval} onChange={(e) => setInterval(e.target.value as BillingInterval | "")}>
              <option value="">–</option>
              {billingIntervals.map((i) => (
                <option key={i} value={i}>{t(`subs.interval.${i}` as MessageKey)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("subs.field.cancelDay")}</span>
            <input type="date" value={cancelDay} onChange={(e) => setCancelDay(e.target.value)} data-testid="subs-cancel-day" />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!dirty}
            data-testid="subs-save"
            onClick={() => void store.updateSubscription(sub.id, { provider, kind, amount: amount.trim() || null, interval: interval || null, lastCancelDay: cancelDay || null })}
          >
            {t("subs.save")}
          </button>
        </div>
      </details>

      <div className="subs-status">
        {sub.status === "active" ? (
          <>
            <button type="button" data-testid="subs-mark-cancelled" onClick={() => void store.setSubscriptionStatus(sub.id, "cancelled")}>{t("subs.markCancelled")}</button>
            <button type="button" data-testid="subs-dismiss" onClick={() => void store.setSubscriptionStatus(sub.id, "dismissed")}>{t("subs.dismiss")}</button>
          </>
        ) : (
          <button type="button" data-testid="subs-reactivate" onClick={() => void store.setSubscriptionStatus(sub.id, "active")}>{t("subs.reactivate")}</button>
        )}
      </div>
    </div>
  );
}
