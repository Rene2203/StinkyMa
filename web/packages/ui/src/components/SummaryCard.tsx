import { Cpu, Loader2, RefreshCw, Server, Cloud, Sparkles, X } from "lucide-react";
import type { SummaryState } from "../store.js";
import { useUi } from "../context.js";

const originIcon = { onDevice: Cpu, ownServer: Server, cloud: Cloud } as const;

/** Zusammenfassung über der Konversation – mit Herkunft (wo berechnet, welches Modell). */
export function SummaryCard({ summary }: { summary: SummaryState }) {
  const { store, t } = useUi();
  const { view, busy, error } = summary;
  const Origin = view ? originIcon[view.origin] : Cpu;

  return (
    <section className="summary-card" aria-labelledby="summary-title" aria-busy={busy} data-testid="summary-card">
      <header className="summary-header">
        <Sparkles size={15} aria-hidden="true" />
        <strong id="summary-title">{t("summary.title")}</strong>
        {view?.waitingOn === "me" && <span className="chip summary-waiting">{t("summary.waiting.me")}</span>}
        {view?.waitingOn === "others" && <span className="chip">{t("summary.waiting.others")}</span>}
        <span className="toolbar-gap" aria-hidden="true" />
        {view && !busy && (
          <button type="button" className="icon-button" title={t("summary.refresh")} aria-label={t("summary.refresh")} onClick={() => void store.summarize()}>
            <RefreshCw size={14} />
          </button>
        )}
        <button type="button" className="icon-button" title={t("summary.close")} aria-label={t("summary.close")} onClick={() => store.closeSummary()}>
          <X size={14} />
        </button>
      </header>
      {busy && (
        <p className="muted small" role="status">
          <Loader2 size={14} className="spinning" aria-hidden="true" /> {t("summary.busy")} <span className="hint">{t("summary.busyHint")}</span>
        </p>
      )}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {view && (
        <div className={busy ? "summary-body dimmed" : "summary-body"}>
          <p data-testid="summary-text">{view.summary}</p>
          {view.openPoints.length > 0 && (
            <>
              <span className="summary-label">{t("summary.openPoints")}</span>
              <ul>
                {view.openPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </>
          )}
          {view.stale && !busy && <p className="hint">{t("summary.stale")}</p>}
          <p className="summary-origin muted small">
            <Origin size={12} aria-hidden="true" /> {t(`summary.origin.${view.origin}`, { model: view.modelName })}
          </p>
        </div>
      )}
    </section>
  );
}
