import { Broom, MailMinus, ShieldAlert } from "lucide-react";
import { useBrowserState, useUi } from "../context.js";

/**
 * „Abbestellen“ für Mails mit Abmelde-Angabe. Ein Klick: Ein-Klick-Abmeldung beim Anbieter, sonst Abmelde-Mail, sonst
 * Abmelde-Seite im Browser. Bei Spam-Verdacht wird abgeraten. `showCleanup`: danach Link zum Aufräumen des Absenders.
 */
export function UnsubscribeBar({ messageId, showCleanup = true }: { messageId: string; showCleanup?: boolean }) {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const entry = state.unsubscribes[messageId];
  const view = entry?.view;
  if (!view || (!view.info && !view.done)) return null;

  const run = async () => {
    const result = await store.unsubscribe(messageId);
    // Abmelde-Seite: im Fenster innerhalb der App, sonst (z. B. im Browser) in einem neuen Tab
    if (result?.method === "web" && result.url && !(await store.openWebPanel(result.url))) window.open(result.url, "_blank", "noopener,noreferrer");
  };

  if (view.done) {
    const date = new Date(view.done.at).toLocaleDateString(locale === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long" });
    return (
      <div className="unsubscribe-bar done" role="status" data-testid="unsubscribe-done">
        <MailMinus size={15} aria-hidden="true" />
        <span>{t(`unsubscribe.done.${view.done.method}`, { date })}</span>
        {view.done.method === "web" && view.info?.url && (
          <button type="button" className="link" data-testid="unsubscribe-reopen" onClick={() => void (view.info?.url && store.openWebPanel(view.info.url).then((ok) => ok || window.open(view.info?.url ?? "", "_blank", "noopener,noreferrer")))}>
            {t("unsubscribe.reopen")}
          </button>
        )}
        {showCleanup && store.canCleanup && (
          <button type="button" className="link" data-testid="unsubscribe-cleanup" onClick={() => void store.openCleanupFor(view.sender)}>
            <Broom size={13} aria-hidden="true" /> {t("unsubscribe.cleanup")}
          </button>
        )}
      </div>
    );
  }

  const method = view.method ?? "web";
  const how = method === "mail" && view.info?.mailto ? t("unsubscribe.how.mail", { address: view.info.mailto.address }) : t(`unsubscribe.how.${method}`);
  return (
    <div className={`unsubscribe-bar${view.suspicious ? " warning" : ""}`} data-testid="unsubscribe-bar">
      {view.suspicious ? <ShieldAlert size={15} aria-hidden="true" /> : <MailMinus size={15} aria-hidden="true" />}
      <span className="unsubscribe-text">
        {view.suspicious ? t("unsubscribe.suspicious") : t("unsubscribe.offer")}
        <span className="muted small"> {how}</span>
      </span>
      <button type="button" disabled={entry.busy} data-testid="unsubscribe" onClick={() => void run()}>
        {entry.busy ? t("unsubscribe.busy") : view.suspicious ? t("unsubscribe.anyway") : t("unsubscribe.action")}
      </button>
      {entry.error && <span className="error small" role="alert">{entry.error}</span>}
    </div>
  );
}
