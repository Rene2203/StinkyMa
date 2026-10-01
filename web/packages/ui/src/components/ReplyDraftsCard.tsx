import { Cpu, Loader2, MessageSquareReply, RefreshCw, X } from "lucide-react";
import { joinGreeting } from "@stinkyma/core";
import { useUi } from "../context.js";
import { composeLabels } from "../composeLabels.js";
import type { RepliesState } from "../store.js";

/** Antwortvorschläge (W6.5): 2–3 kurze Varianten. Übernehmen öffnet „Antworten“ – gesendet wird nur vom Nutzer. */
export function ReplyDraftsCard({ replies }: { replies: RepliesState }) {
  const { store, t, locale } = useUi();
  const { view, busy, error } = replies;
  return (
    <section className="replies-card" aria-labelledby="replies-title" aria-busy={busy} data-testid="replies-card">
      <header className="summary-header">
        <MessageSquareReply size={15} aria-hidden="true" />
        <strong id="replies-title">{t("replies.title")}</strong>
        {view && (
          <span className="muted small actions-origin">
            <Cpu size={11} aria-hidden="true" /> {t("replies.origin", { model: view.modelName })}
          </span>
        )}
        <span className="toolbar-gap" aria-hidden="true" />
        {view && !busy && (
          <button type="button" className="icon-button" title={t("replies.refresh")} aria-label={t("replies.refresh")} onClick={() => void store.loadReplyDrafts()}>
            <RefreshCw size={14} />
          </button>
        )}
        <button type="button" className="icon-button" title={t("summary.close")} aria-label={t("summary.close")} onClick={() => store.closeReplyDrafts()}>
          <X size={14} />
        </button>
      </header>
      {busy && (
        <p className="muted small" role="status">
          <Loader2 size={14} className="spinning" aria-hidden="true" /> {t("replies.busy")}
        </p>
      )}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {view && view.replies.length === 0 && <p className="muted small">{t("replies.none")}</p>}
      {view && view.replies.length > 0 && (
        <ul className="reply-options" role="list">
          {view.replies.map((reply, index) => (
            <li key={index}>
              <button type="button" className="reply-option" data-testid="reply-option" onClick={() => store.useReplyDraft(index, composeLabels(t, locale))}>
                <strong>{t(`replies.kind.${reply.kind}`)}</strong>
                <span className="reply-text">{joinGreeting(view.greeting, reply.text)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {view && view.replies.length > 0 && <p className="hint">{t("replies.hint")}</p>}
    </section>
  );
}
