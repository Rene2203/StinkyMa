import { AlarmClock, AlertTriangle, Cpu, Download, ExternalLink, FileText, Plus, ReceiptText, RefreshCw, X } from "lucide-react";
import { centsFromInput, formatCents, type StoredReceipt } from "@stinkyma/core";
import { useState } from "react";
import { useBrowserState, useUi } from "../context.js";

function useFormat() {
  const { locale } = useUi();
  const lang = locale === "de" ? "de-DE" : "en-GB";
  return {
    money: (cents: number | null) => (cents === null ? "–" : (cents / 100).toLocaleString(lang, { style: "currency", currency: "EUR" })),
    date: (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" }),
  };
}

/** Belegordner (W7.2): Rechnungen, Quittungen, Bestellungen aus Mails und PDFs – mit Summen je Kategorie und Export. */
export function ReceiptsPanel() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const format = useFormat();
  const data = state.receipts;
  const view = data?.view;
  const filter = data?.category ?? null;
  const items = (view?.items ?? []).filter((r) => filter === null || (r.category ?? "") === filter);
  const active = items.filter((r) => r.status === "active");
  const hidden = items.filter((r) => r.status !== "active");
  const selected = (view?.items ?? []).find((r) => r.id === data?.selectedId) ?? null;
  const year = data?.year ?? null;
  const years = [...new Set([...(view?.years ?? []), new Date().getFullYear()])].sort((a, b) => b - a);
  const total = (view?.totals ?? []).reduce((sum, x) => sum + x.cents, 0);
  const count = (view?.totals ?? []).reduce((sum, x) => sum + x.count, 0);

  return (
    <section className="subs-panel" aria-labelledby="rcpt-title" data-testid="receipts">
      <header className="subs-header">
        <ReceiptText size={20} aria-hidden="true" />
        <div>
          <h2 id="rcpt-title">{t("rcpt.title")}</h2>
          {view && <span className="muted small" data-testid="rcpt-total">{t("rcpt.total", { sum: format.money(total), count })}</span>}
        </div>
        <label className="rcpt-year">
          <span className="visually-hidden">{t("rcpt.year")}</span>
          <select value={year ?? ""} data-testid="rcpt-year" onChange={(e) => void store.selectReceiptYear(e.target.value ? Number(e.target.value) : null)}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
            <option value="">{t("rcpt.allYears")}</option>
          </select>
        </label>
        <span className="toolbar-gap" aria-hidden="true" />
        {view?.scanning && (
          <span className="muted small subs-scanning" data-testid="rcpt-scanning">
            <Cpu size={13} aria-hidden="true" /> {t("subs.scanning", { done: view.scanning.done, total: view.scanning.total })}
          </span>
        )}
        <button type="button" disabled={data?.busy} data-testid="rcpt-scan" title={t("rcpt.scanHint")} onClick={() => void store.scanReceipts(false)}>
          <RefreshCw size={14} aria-hidden="true" /> {t("subs.scan")}
        </button>
        <button type="button" disabled={data?.busy} data-testid="rcpt-rescan" title={view?.modelReady ? t("subs.rescanHint") : t("subs.rescanHintRules")} onClick={() => void store.scanReceipts(true)}>
          {t("subs.rescan")}
        </button>
        <button type="button" className="primary" disabled={data?.busy || count === 0} data-testid="rcpt-export" title={t("rcpt.exportHint")} onClick={() => void store.exportReceipts()}>
          <Download size={14} aria-hidden="true" /> {t("rcpt.export")}
        </button>
        <button type="button" className="icon-button" title={t("subs.close")} aria-label={t("subs.close")} onClick={() => store.closeReceipts()}>
          <X size={16} />
        </button>
      </header>
      {data?.error && <p className="dialog-error" role="alert">{data.error}</p>}
      {data?.exported && (
        <p className="rcpt-exported" role="status" data-testid="rcpt-exported">
          {t("rcpt.exported", { count: data.exported.count })}
          {data.exported.missingFiles > 0 && ` ${t("rcpt.exportedMissing", { count: data.exported.missingFiles })}`}
        </p>
      )}
      {view && !view.modelReady && <p className="muted small subs-hint">{t("rcpt.noAi")}</p>}
      {view && view.totals.length > 0 && (
        <div className="rcpt-totals" role="group" aria-label={t("rcpt.byCategory")}>
          <button type="button" className={`rcpt-total-chip${filter === null ? " selected" : ""}`} onClick={() => store.selectReceiptCategory(null)}>
            {t("rcpt.all")} <strong>{format.money(total)}</strong>
          </button>
          {view.totals.map((x) => (
            <button
              key={x.category}
              type="button"
              className={`rcpt-total-chip${filter === x.category ? " selected" : ""}`}
              data-testid="rcpt-total-chip"
              onClick={() => store.selectReceiptCategory(x.category)}
            >
              {x.category || t("rcpt.noCategory")} <strong>{format.money(x.cents)}</strong>
            </button>
          ))}
        </div>
      )}
      <div className="subs-body">
        <div className="subs-list">
          {!view && <p className="muted">{t("subs.busy")}</p>}
          {view && items.length === 0 && <p className="muted" data-testid="rcpt-empty">{data?.busy ? t("subs.busy") : t("rcpt.empty")}</p>}
          {[["rcpt.group.active", active], ["rcpt.group.hidden", hidden]].map(([label, list]) =>
            (list as StoredReceipt[]).length === 0 ? null : (
              <div key={label as string} className="subs-group">
                <h3>{t(label as "rcpt.group.active")}</h3>
                <ul role="listbox" aria-label={t(label as "rcpt.group.active")}>
                  {(list as StoredReceipt[]).map((r) => (
                    <li key={r.id}>
                      <button type="button" role="option" aria-selected={r.id === selected?.id} className="subs-row" data-testid="rcpt-row" onClick={() => store.selectReceipt(r.id)}>
                        <span className="subs-row-main">
                          <strong>{r.merchant}</strong>
                          <span className="muted small">{[format.date(r.date), r.category ?? ""].filter(Boolean).join(" · ")}</span>
                        </span>
                        {r.review.length > 0 && <AlertTriangle className="rcpt-review-icon" size={14} aria-label={t("rcpt.review")} />}
                        <span className="rcpt-amount">{format.money(r.grossCents)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
        {selected ? <ReceiptDetail key={selected.id + selected.date + String(selected.grossCents) + String(selected.category)} receipt={selected} categories={view?.categories ?? []} /> : <div className="subs-detail muted">{items.length ? t("subs.pick") : ""}</div>}
      </div>
      <p className="muted small subs-legal">{t("rcpt.legal")}</p>
    </section>
  );
}

function ReceiptDetail({ receipt, categories }: { receipt: StoredReceipt; categories: string[] }) {
  const { store, t } = useUi();
  const format = useFormat();
  const [merchant, setMerchant] = useState(receipt.merchant);
  const [date, setDate] = useState(receipt.date);
  const [gross, setGross] = useState(formatCents(receipt.grossCents));
  const [net, setNet] = useState(formatCents(receipt.netCents));
  const [vat, setVat] = useState(formatCents(receipt.vatCents));
  const [number, setNumber] = useState(receipt.invoiceNumber ?? "");
  const [due, setDue] = useState(receipt.dueDate ?? "");
  const [category, setCategory] = useState(receipt.category ?? "");
  const [remember, setRemember] = useState(true);
  const [newCategory, setNewCategory] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const dirty =
    merchant !== receipt.merchant || date !== receipt.date || gross !== formatCents(receipt.grossCents) || net !== formatCents(receipt.netCents) ||
    vat !== formatCents(receipt.vatCents) || number !== (receipt.invoiceNumber ?? "") || due !== (receipt.dueDate ?? "") || category !== (receipt.category ?? "");
  const facts: [string, string | null][] = [
    [t("rcpt.field.date"), format.date(receipt.date)],
    [t("rcpt.field.gross"), receipt.grossCents !== null ? format.money(receipt.grossCents) : null],
    [t("rcpt.field.net"), receipt.netCents !== null ? format.money(receipt.netCents) : null],
    [t("rcpt.field.vat"), receipt.vatCents !== null ? format.money(receipt.vatCents) : null],
    [t("rcpt.field.number"), receipt.invoiceNumber],
    [t("rcpt.field.due"), receipt.dueDate && format.date(receipt.dueDate)],
    [t("rcpt.field.category"), receipt.category],
  ];
  const origin = receipt.origin === "user" ? t("subs.origin.user") : receipt.origin === "rules" ? t("subs.origin.rules") : t("subs.origin.ai");
  const save = () => {
    try {
      setInputError(null);
      void store.updateReceipt(receipt.id, {
        merchant, date, grossCents: centsFromInput(gross), netCents: centsFromInput(net), vatCents: centsFromInput(vat),
        invoiceNumber: number.trim() || null, dueDate: due || null, category: category || null, rememberCategory: remember && category !== (receipt.category ?? ""),
      });
    } catch (e) {
      setInputError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="subs-detail" data-testid="rcpt-detail">
      <div className="subs-detail-head">
        <h3>{receipt.merchant}</h3>
        <span className="muted small" data-testid="rcpt-origin">{origin}</span>
      </div>
      {receipt.review.length > 0 && (
        <p className="rcpt-review" data-testid="rcpt-review">
          <AlertTriangle size={14} aria-hidden="true" /> {t("rcpt.reviewText", { reasons: receipt.review.join(" · ") })}
        </p>
      )}
      <dl className="subs-facts">
        {facts.filter(([, value]) => value).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {receipt.quote && <blockquote className="subs-quote">„{receipt.quote}“</blockquote>}
      <div className="rcpt-links">
        {receipt.messageId ? (
          <button type="button" className="link" data-testid="rcpt-open-mail" onClick={() => void store.openReceiptMail(receipt)}>
            <ExternalLink size={13} aria-hidden="true" /> {t("subs.openMail")}
          </button>
        ) : (
          <span className="muted small">{t("rcpt.mailGone", { subject: receipt.mailSubject })}</span>
        )}
        {receipt.attachments.map((a) => (
          <button key={a.id} type="button" className="link" data-testid="rcpt-open-file" onClick={() => void store.openAttachment(a.id)}>
            <FileText size={13} aria-hidden="true" /> {a.filename}
          </button>
        ))}
      </div>

      {receipt.status === "active" && receipt.dueDate && (
        <div className="subs-reminder">
          {receipt.reminder ? (
            <>
              <span data-testid="rcpt-reminder">
                <AlarmClock size={14} aria-hidden="true" /> {t("subs.reminderSet", { date: new Date(receipt.reminder.dueDate).toLocaleDateString() })}
              </span>
              <button type="button" className="link" onClick={() => void store.cancelReceiptReminder(receipt.id)}>{t("subs.reminderCancel")}</button>
            </>
          ) : (
            <button type="button" data-testid="rcpt-remind" onClick={() => void store.remindReceipt(receipt.id, 2)}>
              <AlarmClock size={14} aria-hidden="true" /> {t("rcpt.remind")}
            </button>
          )}
        </div>
      )}

      <details className="subs-edit" open={receipt.review.length > 0}>
        <summary>{t("subs.edit")}</summary>
        <div className="subs-form">
          <label>
            <span>{t("rcpt.field.merchant")}</span>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} data-testid="rcpt-merchant" />
          </label>
          <label>
            <span>{t("rcpt.field.date")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span>{t("rcpt.field.gross")}</span>
            <input value={gross} placeholder="12,99" inputMode="decimal" onChange={(e) => setGross(e.target.value)} data-testid="rcpt-gross" />
          </label>
          <label>
            <span>{t("rcpt.field.net")}</span>
            <input value={net} inputMode="decimal" onChange={(e) => setNet(e.target.value)} />
          </label>
          <label>
            <span>{t("rcpt.field.vat")}</span>
            <input value={vat} inputMode="decimal" onChange={(e) => setVat(e.target.value)} />
          </label>
          <label>
            <span>{t("rcpt.field.number")}</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} />
          </label>
          <label>
            <span>{t("rcpt.field.due")}</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label>
            <span>{t("rcpt.field.category")}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="rcpt-category">
              <option value="">–</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="checkbox small rcpt-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>{t("rcpt.rememberCategory", { merchant })}</span>
          </label>
          <button type="button" className="primary" disabled={!dirty} data-testid="rcpt-save" onClick={save}>
            {t("subs.save")}
          </button>
        </div>
        {inputError && <p className="dialog-error" role="alert">{inputError}</p>}
        <div className="rcpt-new-category">
          <input value={newCategory} placeholder={t("rcpt.newCategory")} aria-label={t("rcpt.newCategory")} onChange={(e) => setNewCategory(e.target.value)} />
          <button type="button" disabled={!newCategory.trim()} onClick={() => { void store.addReceiptCategory(newCategory); setNewCategory(""); }}>
            <Plus size={13} aria-hidden="true" /> {t("rcpt.addCategory")}
          </button>
        </div>
      </details>

      <div className="subs-status">
        {receipt.status === "active" ? (
          <button type="button" data-testid="rcpt-dismiss" onClick={() => void store.setReceiptStatus(receipt.id, "dismissed")}>{t("rcpt.dismiss")}</button>
        ) : (
          <button type="button" data-testid="rcpt-reactivate" onClick={() => void store.setReceiptStatus(receipt.id, "active")}>{t("rcpt.reactivate")}</button>
        )}
      </div>
    </div>
  );
}
