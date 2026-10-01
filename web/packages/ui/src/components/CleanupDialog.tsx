import { Broom, Cpu, ShieldCheck, Trash2, X } from "lucide-react";
import { displayName, isDemoAccount, type CleanupGroup, type CleanupMail } from "@stinkyma/core";
import { useEffect, useRef, useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { MessageKey } from "../i18n.js";
import { cleanupSelected, type CleanupState } from "../store.js";

/** So viele Mails einer Gruppe werden angezeigt (ausgewählt und gelöscht werden trotzdem alle). */
const shownMails = 300;
/** Geschätzte Dauer der KI-Einordnung pro Mail auf schwacher Hardware (siehe KI-Messung). */
const secondsPerMail = 5;

/** Aufräumen: Wer schickt am meisten? Alles davon in den Papierkorb – außer dem, was bleiben sollte. */
export function CleanupDialog() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const cleanup = state.cleanup;
  if (!cleanup) return null;
  const accounts = Object.values(state.accountsById).filter((a) => !isDemoAccount(a) || Object.keys(state.accountsById).every((id) => isDemoAccount({ id })));

  return (
    <dialog ref={dialog} className="dialog cleanup-dialog" aria-labelledby="cleanup-title" data-testid="cleanup-dialog" onClose={() => store.closeCleanup()}>
      <header className="cleanup-header">
        <Broom size={20} aria-hidden="true" />
        <div>
          <h2 id="cleanup-title">{t("cleanup.title")}</h2>
          <span className="muted small">{t("cleanup.text")}</span>
        </div>
        <button type="button" className="icon-button" title={t("cleanup.close")} aria-label={t("cleanup.close")} onClick={() => store.closeCleanup()}>
          <X size={16} />
        </button>
      </header>
      <div className="cleanup-controls">
        <div className="segmented" role="group" aria-label={t("cleanup.groupBy")}>
          <button type="button" aria-pressed={cleanup.groupBy === "address"} data-testid="cleanup-by-address" onClick={() => void store.setCleanupView({ groupBy: "address" })}>
            {t("cleanup.byAddress")}
          </button>
          <button type="button" aria-pressed={cleanup.groupBy === "domain"} data-testid="cleanup-by-domain" onClick={() => void store.setCleanupView({ groupBy: "domain" })}>
            {t("cleanup.byDomain")}
          </button>
        </div>
        {accounts.length > 1 && (
          <select value={cleanup.accountId ?? ""} aria-label={t("rules.account")} onChange={(e) => void store.setCleanupView({ accountId: e.target.value || null })}>
            <option value="">{t("rules.allAccounts")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName || a.email}</option>
            ))}
          </select>
        )}
      </div>
      {cleanup.error && <p className="dialog-error" role="alert">{cleanup.error}</p>}
      {cleanup.note?.kind === "trashed" && (
        <p className="cleanup-note" role="status" data-testid="cleanup-note">
          {t(cleanup.note.count === 1 ? "cleanup.trashedOne" : "cleanup.trashed", { count: cleanup.note.count, key: cleanup.note.key })}
          {cleanup.note.rule ? ` ${t("cleanup.ruleCreated")}` : ""}
        </p>
      )}
      <div className="cleanup-body">
        <GroupList cleanup={cleanup} />
        <GroupDetail cleanup={cleanup} />
      </div>
    </dialog>
  );
}

function GroupList({ cleanup }: { cleanup: CleanupState }) {
  const { store, t } = useUi();
  if (cleanup.busy && !cleanup.groups) return <p className="muted cleanup-groups">{t("cleanup.busy")}</p>;
  if (!cleanup.groups?.length) return <p className="muted cleanup-groups" data-testid="cleanup-empty">{t("cleanup.empty")}</p>;
  return (
    <ul className="cleanup-groups" role="listbox" aria-label={t("cleanup.groups")} data-testid="cleanup-groups">
      {cleanup.groups.map((group) => (
        <li key={group.key}>
          <button
            type="button"
            role="option"
            aria-selected={cleanup.group?.key === group.key}
            className="cleanup-group"
            data-testid="cleanup-group"
            onClick={() => void store.selectCleanupGroup(group.key)}
          >
            <span className="cleanup-group-name">
              <strong>{group.name && cleanup.groupBy === "address" ? group.name : group.key}</strong>
              <span className="muted small">{groupSubtitle(group, t)}</span>
            </span>
            <span className="cleanup-count" title={t("cleanup.countTitle")}>{group.count.toLocaleString()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function groupSubtitle(group: CleanupGroup, t: ReturnType<typeof useUi>["t"]): string {
  const parts = [group.groupBy === "address" ? (group.name ? group.key : "") : t("cleanup.addresses", { count: group.addresses })];
  if (group.unread) parts.push(t("cleanup.unread", { count: group.unread }));
  if (group.protectedCount) parts.push(t("cleanup.protectedCount", { count: group.protectedCount }));
  return parts.filter(Boolean).join(" · ");
}

function GroupDetail({ cleanup }: { cleanup: CleanupState }) {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const [confirm, setConfirm] = useState(false);
  const [alsoFuture, setAlsoFuture] = useState(false);
  const key = cleanup.group?.key ?? null;
  useEffect(() => {
    setConfirm(false);
    setAlsoFuture(false);
  }, [key]);
  if (!cleanup.group) return <div className="cleanup-detail muted">{t("cleanup.pick")}</div>;
  const { mails, busy } = cleanup.group;
  if (!mails) return <div className="cleanup-detail muted">{busy ? t("cleanup.busy") : ""}</div>;
  const selected = mails.filter((m) => cleanupSelected(cleanup, m));
  const protectedMails = mails.filter((m) => m.protect);
  const uncategorized = mails.filter((m) => !m.category).length;
  const aiReady = Boolean(state.ai?.ready);
  const minutes = Math.max(1, Math.round((uncategorized * secondsPerMail) / 60));
  const lang = locale === "de" ? "de-DE" : "en-GB";

  return (
    <div className="cleanup-detail" data-testid="cleanup-detail">
      <div className="cleanup-detail-head">
        <strong>{cleanup.group.key}</strong>
        <span className="muted small">
          {t("cleanup.summary", { count: mails.length, protected: protectedMails.length })}
        </span>
      </div>
      {protectedMails.length > 0 && (
        <p className="hint small">
          <ShieldCheck size={13} aria-hidden="true" /> {t("cleanup.protectHint")}
        </p>
      )}
      {aiReady && uncategorized > 0 && (
        <p className="cleanup-ai small">
          <button type="button" data-testid="cleanup-check" onClick={() => void store.checkCleanupGroup()}>
            <Cpu size={13} aria-hidden="true" /> {t("cleanup.check", { count: uncategorized })}
          </button>
          <span className="muted">
            {cleanup.note?.kind === "checking" ? t("cleanup.checking", { count: cleanup.note.count }) : t("cleanup.checkTime", { minutes })}
          </span>
        </p>
      )}
      <div className="cleanup-select small">
        <button type="button" className="link" onClick={() => store.setCleanupAll(true)}>{t("cleanup.selectAll")}</button>
        <button type="button" className="link" onClick={() => store.setCleanupAll(false)}>{t("cleanup.selectNone")}</button>
        <button type="button" className="link" onClick={() => store.setCleanupAll(null)}>{t("cleanup.selectSuggested")}</button>
      </div>
      <ul className="cleanup-mails" role="list" data-testid="cleanup-mails">
        {mails.slice(0, shownMails).map((mail) => (
          <MailRow key={mail.id} mail={mail} selected={cleanupSelected(cleanup, mail)} lang={lang} />
        ))}
      </ul>
      {mails.length > shownMails && <p className="muted small">{t("cleanup.more", { count: mails.length - shownMails })}</p>}
      <footer className="cleanup-footer">
        {store.canUseRules && (
          <label className="checkbox small">
            <input type="checkbox" checked={alsoFuture} data-testid="cleanup-future" onChange={(e) => setAlsoFuture(e.target.checked)} />
            <span>{t("cleanup.future", { key: cleanup.group.key })}</span>
          </label>
        )}
        {confirm ? (
          <span className="cleanup-confirm">
            <span>{t("cleanup.confirm", { count: selected.length })}</span>
            <button type="button" onClick={() => setConfirm(false)}>{t("cleanup.cancel")}</button>
            <button type="button" className="danger" data-testid="cleanup-confirm" onClick={() => void store.trashCleanupSelection(alsoFuture)}>
              <Trash2 size={14} aria-hidden="true" /> {t("cleanup.confirmYes")}
            </button>
          </span>
        ) : (
          <button type="button" className="danger" disabled={selected.length === 0} data-testid="cleanup-trash" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" /> {t(selected.length === 1 ? "cleanup.trashOne" : "cleanup.trash", { count: selected.length })}
          </button>
        )}
      </footer>
      <p className="muted small">{t("cleanup.trashHint")}</p>
    </div>
  );
}

function MailRow({ mail, selected, lang }: { mail: CleanupMail; selected: boolean; lang: string }) {
  const { store, t } = useUi();
  return (
    <li className={`cleanup-mail${mail.protect ? " protected" : ""}`} data-testid="cleanup-mail">
      <label>
        <input type="checkbox" checked={selected} aria-label={mail.subject || t("cleanup.noSubject")} onChange={(e) => store.toggleCleanupMail(mail.id, e.target.checked)} />
        <span className="cleanup-mail-main">
          <span className={mail.unread ? "unread" : ""}>{mail.subject || "–"}</span>
          <span className="muted small">
            {displayName(mail.from)} · {new Date(mail.date).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </span>
        {mail.protect && (
          <span className="cleanup-protect small" data-testid="cleanup-protect" title={t("cleanup.protectHint")}>
            <ShieldCheck size={12} aria-hidden="true" /> {t(`cleanup.reason.${mail.protect}` as MessageKey)}
          </span>
        )}
      </label>
    </li>
  );
}
