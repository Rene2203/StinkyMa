import { AlertTriangle, Cpu } from "lucide-react";
import type { AITask } from "@stinkyma/core";
import { useEffect, useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { MessageKey } from "../i18n.js";

const taskKey: Record<AITask, MessageKey> = {
  categorize: "aiActivity.categorize",
  summarize: "aiActivity.summarize",
  readImage: "aiActivity.readImage",
  extractActions: "aiActivity.extractActions",
  parseRule: "aiActivity.parseRule",
  draftReply: "aiActivity.draftReply",
  extractSubscription: "aiActivity.extractSubscription",
  userCategory: "aiActivity.userCategory",
  extractReceipt: "aiActivity.extractReceipt",
  extractPromises: "aiActivity.extractPromises",
};

/** Sekunden seit `iso`, jede Sekunde neu – damit man sieht, dass sich etwas tut. */
function useElapsed(iso: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)) : 0;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Immer sichtbare Anzeige unten in der Seitenleiste: Was rechnet die KI gerade, wie weit ist die Einordnung, und ob
 * sie wegen eines Fehlers steht (mit „Weiter einordnen“). Im Leerlauf unsichtbar.
 */
export function AIActivity() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const ai = state.ai;
  const elapsed = useElapsed(ai?.activity?.startedAt ?? null);
  if (!ai?.settings.enabled) return null;
  const { activity, categorizing, error, backlog } = ai;

  // Leerlauf: trotzdem sichtbar, damit man weiß, woran man ist
  if (!activity && !categorizing && !error) {
    if (!ai.ready) {
      return (
        <button type="button" className="ai-activity idle" data-testid="ai-activity" onClick={() => store.openOptions()}>
          <Cpu size={14} aria-hidden="true" />
          <span className="ai-activity-text">
            <span>{t("aiActivity.notReady")}</span>
          </span>
        </button>
      );
    }
    const waiting = ai.settings.autoCategorize ? backlog.recent : 0;
    return (
      <div className="ai-activity idle" role="status" data-testid="ai-activity">
        <Cpu size={14} aria-hidden="true" />
        <span className="ai-activity-text">
          <span>{t("aiActivity.ready")}</span>
          <span className="small muted">
            {!ai.settings.autoCategorize
              ? t("aiActivity.autoOff")
              : waiting > 0
                ? t("aiActivity.waiting", { count: waiting })
                : backlog.older > 0
                  ? t("aiActivity.older", { count: backlog.older })
                  : t("aiActivity.allDone")}
          </span>
        </span>
        {ai.settings.autoCategorize && waiting > 0 && (
          <button type="button" className="link-button small" data-testid="ai-resume" onClick={() => void store.resumeAI()}>
            {t("aiActivity.start")}
          </button>
        )}
        {ai.settings.autoCategorize && waiting === 0 && backlog.older > 0 && (
          <button type="button" className="link-button small" data-testid="ai-older" onClick={() => store.openOptions()}>
            {t("aiActivity.categorizeOlder")}
          </button>
        )}
      </div>
    );
  }

  if (error && !activity && !categorizing) {
    return (
      <div className="ai-activity error" role="status" data-testid="ai-activity">
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="ai-activity-text">
          <span>{t("aiActivity.stopped")}</span>
          <span className="small muted" title={error}>{error}</span>
        </span>
        <button type="button" className="link-button small" data-testid="ai-resume" onClick={() => void store.resumeAI()}>
          {t("aiActivity.resume")}
        </button>
      </div>
    );
  }

  const percent = categorizing && categorizing.total > 0 ? Math.round((categorizing.done / categorizing.total) * 100) : null;
  const label = activity ? t(taskKey[activity.task]) : t("aiActivity.categorize");
  return (
    <button type="button" className="ai-activity" role="status" data-testid="ai-activity" title={t("aiActivity.open")} onClick={() => store.openOptions()}>
      <Cpu size={14} className="pulsing" aria-hidden="true" />
      <span className="ai-activity-text">
        <span>
          {label}
          {categorizing && (!activity || activity.task === "categorize") ? ` · ${t("aiActivity.progress", { done: categorizing.done, total: categorizing.total })}` : ""}
        </span>
        <span className="small muted">
          {activity ? clock(elapsed) : t("aiActivity.waitingForModel")}
          {activity && activity.waiting > 0 ? ` · ${t("aiActivity.queued", { count: activity.waiting })}` : ""}
          {activity && elapsed >= 60 ? ` · ${t("aiActivity.slow")}` : ""}
        </span>
        <span
          className={`ai-progress${percent === null || (activity && activity.task !== "categorize") ? " indeterminate" : ""}`}
          role="progressbar"
          aria-label={label}
          {...(percent !== null ? { "aria-valuenow": percent, "aria-valuemin": 0, "aria-valuemax": 100 } : {})}
        >
          <span style={percent !== null && (!activity || activity.task === "categorize") ? { width: `${percent}%` } : undefined} />
        </span>
      </span>
    </button>
  );
}
