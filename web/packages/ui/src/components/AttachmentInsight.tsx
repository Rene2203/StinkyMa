import { Cpu, EyeOff, FileSearch, Loader2, Lock, MessageCircleQuestion, Sparkles, Star } from "lucide-react";
import { riskReasons, type Attachment } from "@stinkyma/core";
import { useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { MessageKey } from "../i18n.js";

/** Kleiner Status am Anhang (W9): wichtig, unterstützend, übersprungen, gelesen, gesperrt – Klick öffnet das Feld. */
export function AttachmentStatus({ attachment: a }: { attachment: Attachment }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  if (!store.canAttachmentInsight) return null;
  const open = state.insight?.attachmentId === a.id;
  const [Icon, label] =
    a.analysisStatus === "locked" || a.isEncrypted ? [Lock, t("insight.locked")]
    : a.analysisStatus === "analyzed" ? [Sparkles, t("insight.analyzed")]
    : a.relevance === "irrelevant" ? [EyeOff, t("insight.skipped")]
    : a.relevance === "central" ? [Star, t("insight.central")]
    : a.relevance === "supporting" ? [FileSearch, t("insight.supporting")]
    : [FileSearch, t("insight.unchecked")];
  return (
    <button
      type="button"
      className={`attachment-status${open ? " open" : ""}${a.relevance === "irrelevant" ? " skipped" : ""}`}
      aria-expanded={open}
      title={a.relevanceReason ?? label}
      data-testid="attachment-status"
      data-relevance={a.relevance ?? ""}
      onClick={() => void store.toggleInsight(a.id)}
    >
      <Icon size={12} aria-hidden="true" /> {label}
    </button>
  );
}

/** Feld unter den Anhängen: warum, Entscheidung (mit „merken“), Zusammenfassung, „Frag den Anhang“. */
export function AttachmentInsight({ attachment: a }: { attachment: Attachment }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const insight = state.insight?.attachmentId === a.id ? state.insight : null;
  const [remember, setRemember] = useState(false);
  const [question, setQuestion] = useState("");
  if (!insight) return null;
  const risks = riskReasons(a.riskFlags);
  const view = insight.reading;
  return (
    <section className="attachment-insight" data-testid="attachment-insight" aria-label={t("insight.title", { name: a.filename })}>
      <p className="insight-reason">
        <strong>{a.filename}</strong>
        {a.documentType ? <span className="chip">{a.documentType}</span> : null}
        <span className="muted small">{a.relevanceReason ?? t("insight.noReason")}</span>
      </p>
      {risks.length > 0 && (
        <p className="insight-risk" role="alert">
          {t("insight.risk", { reasons: risks.join(", ") })}
        </p>
      )}
      {a.analysisStatus === "locked" && store.canUnlockAttachments && <UnlockForm attachmentId={a.id} />}
      {insight.unlock && (
        <p className={insight.unlock.unlocked ? "insight-ok" : "hint"} role="status" data-testid="insight-unlock-result">
          {insight.unlock.unlocked
            ? t(`insight.unlocked.${insight.unlock.source ?? "entered"}` as MessageKey)
            : insight.unlock.tried === 0 ? t("insight.unlockNone") : t("insight.unlockFailed", { count: insight.unlock.tried })}
        </p>
      )}
      <div className="insight-actions">
        {a.relevance === "irrelevant" ? (
          <button type="button" data-testid="insight-read" disabled={insight.analyzing} onClick={() => void store.decideAttachment(a.id, "read", remember)}>
            {t("insight.readAnyway")}
          </button>
        ) : (
          <button type="button" data-testid="insight-ignore" onClick={() => void store.decideAttachment(a.id, "ignore", remember)}>
            {t("insight.ignore")}
          </button>
        )}
        <label className="checkbox small">
          <input type="checkbox" checked={remember} data-testid="insight-remember" onChange={(e) => setRemember(e.target.checked)} />
          <span>{t("insight.remember", { type: a.documentType ?? t("insight.thisKind") })}</span>
        </label>
        {store.canReadAttachments && a.relevance !== "irrelevant" && (
          <button type="button" data-testid="insight-summarize" disabled={insight.analyzing} onClick={() => void store.summarizeAttachment(a.id)}>
            {insight.analyzing ? <Loader2 size={14} className="spinning" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />} {view ? t("insight.summarizeAgain") : t("insight.summarize")}
          </button>
        )}
      </div>
      {view && (
        <div className="insight-summary" data-testid="insight-summary">
          <p className="reading-head">
            <span className="chip">{t(`reading.type.${view.documentType}` as MessageKey)}</span> <strong>{view.title}</strong>
          </p>
          <p>{view.summary}</p>
          <p className="muted small">
            <Cpu size={12} aria-hidden="true" /> {t("reading.origin", { model: view.modelName, seconds: Math.round(view.durationMs / 1000) })}
          </p>
        </div>
      )}
      {store.canReadAttachments && (
        <form
          className="insight-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void store.askAttachment(a.id, question);
          }}
        >
          <MessageCircleQuestion size={14} aria-hidden="true" />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("insight.askPlaceholder")}
            aria-label={t("insight.ask")}
            data-testid="insight-question"
          />
          <button type="submit" disabled={insight.asking || !question.trim()} data-testid="insight-ask">
            {insight.asking ? <Loader2 size={14} className="spinning" aria-hidden="true" /> : null} {t("insight.ask")}
          </button>
        </form>
      )}
      {insight.answer && (
        <div className="insight-answer" data-testid="insight-answer">
          <p>{insight.answer.answer}</p>
          {insight.answer.quote && <blockquote>„{insight.answer.quote}“</blockquote>}
          <p className="muted small">
            {insight.answer.pages.length > 0 ? `${t("insight.pages", { pages: insight.answer.pages.join(", ") })} · ` : ""}
            {t("reading.origin", { model: insight.answer.modelName, seconds: Math.round(insight.answer.durationMs / 1000) })}
          </p>
        </div>
      )}
      {insight.error && <p className="dialog-error" role="alert">{insight.error}</p>}
    </section>
  );
}

/** Gesperrtes PDF: Passwort suchen lassen oder eingeben (mit „merken“). Das Passwort bleibt auf diesem Rechner. */
function UnlockForm({ attachmentId }: { attachmentId: string }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const busy = state.insight?.unlocking ?? false;
  return (
    <div className="insight-unlock" data-testid="insight-unlock">
      <p className="hint">{t("insight.lockedHint")}</p>
      <div className="insight-actions">
        <button type="button" disabled={busy} data-testid="insight-find-password" onClick={() => void store.unlockAttachment(attachmentId, undefined, remember)}>
          {busy ? <Loader2 size={14} className="spinning" aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />} {t("insight.findPassword")}
        </button>
        <form
          className="insight-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void store.unlockAttachment(attachmentId, password, remember);
          }}
        >
          <input type="password" value={password} autoComplete="off" placeholder={t("insight.password")} aria-label={t("insight.password")} data-testid="insight-password" onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={busy || !password} data-testid="insight-unlock-submit">{t("insight.unlock")}</button>
        </form>
        <label className="checkbox small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t("insight.rememberPassword")}</span>
        </label>
      </div>
    </div>
  );
}
