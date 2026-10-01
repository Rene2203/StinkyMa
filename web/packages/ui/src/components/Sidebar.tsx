import { AlertTriangle, LogIn, Plus, RefreshCw, Send, Settings, Sun, X } from "lucide-react";
import { isDemoAccount, scopeKey } from "@stinkyma/core";
import { useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import { AIActivity } from "./AIActivity.js";
import { sidebarIcon } from "../icons.js";
import type { SidebarItem } from "../store.js";
import type { Translate } from "../i18n.js";
import { AccountDialog } from "./AccountDialog.js";

export function sidebarTitle(item: SidebarItem, t: Translate): string {
  switch (item.kind.type) {
    case "unifiedInbox":
      return t("sidebar.unifiedInbox");
    case "unread":
      return t("sidebar.unread");
    case "flagged":
      return t("sidebar.flagged");
    case "screener":
      return t("sidebar.screener");
    case "mailbox":
      return item.kind.mailbox.role === "custom" ? item.kind.mailbox.name : t(`role.${item.kind.mailbox.role}`);
  }
}

export function sidebarTestId(item: SidebarItem): string {
  return item.kind.type === "mailbox" ? `sidebar-mailbox-${item.kind.mailbox.id}` : `sidebar-${item.kind.type}`;
}

export function Sidebar() {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const selectedKey = scopeKey(state.selectedScope);
  const [dialogOpen, setDialogOpen] = useState(false);
  const accounts = Object.values(state.accountsById);
  const onlyDemo = accounts.length > 0 && accounts.every(isDemoAccount);

  const removeAccount = (id: string, name: string) => {
    if (window.confirm(t("account.removeConfirm", { name }))) void store.removeAccount(id);
  };

  return (
    <nav className="sidebar" aria-label={t("sidebar.title")}>
      <h1 className="sidebar-title">{t("sidebar.title")}</h1>
      {state.sections.map((section) => (
        <section key={section.id} className="sidebar-section" aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`} className="sidebar-heading" title={section.account?.email}>
            {section.account ? (
              <>
                <span className={`account-dot color-${section.account.color}`} aria-hidden="true" />
                <span className="sidebar-heading-label">{section.account.displayName}</span>
                {section.account.syncError && (
                  <AlertTriangle
                    className="sync-warning"
                    size={14}
                    aria-label={t("sync.accountError", { error: section.account.syncError })}
                    data-testid="account-sync-error"
                  >
                    <title>{t("sync.accountError", { error: section.account.syncError })}</title>
                  </AlertTriangle>
                )}
                {store.canManageAccounts && section.account.authType === "oauth2" && section.account.syncError && (
                  <button
                    type="button"
                    className="icon-button heading-action"
                    title={t("oauth.reauth")}
                    aria-label={`${t("oauth.reauth")}: ${section.account.displayName}`}
                    data-testid="account-reauth"
                    onClick={() => void store.reauthorize(section.account!.id)}
                  >
                    <LogIn size={13} />
                  </button>
                )}
                {store.canManageAccounts && !isDemoAccount(section.account) && (
                  <button
                    type="button"
                    className="icon-button heading-action"
                    title={t("account.remove")}
                    aria-label={`${t("account.remove")}: ${section.account.displayName}`}
                    onClick={() => removeAccount(section.account!.id, section.account!.displayName)}
                  >
                    <X size={13} />
                  </button>
                )}
              </>
            ) : (
              t("sidebar.overview")
            )}
          </h2>
          <ul role="list">
            {section.items.map((item) => {
              const Icon = sidebarIcon(item.kind);
              const key = scopeKey(item.scope);
              const selected = key === selectedKey;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`sidebar-item${selected ? " selected" : ""}`}
                    aria-current={selected ? "page" : undefined}
                    data-testid={sidebarTestId(item)}
                    onClick={() => void store.selectScope(item.scope)}
                  >
                    <Icon className="sidebar-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span className="sidebar-label">{sidebarTitle(item, t)}</span>
                    {item.unreadCount > 0 && <span className="badge">{item.unreadCount}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <footer className="sidebar-footer">
        {store.canManageAccounts && onlyDemo && <p className="demo-hint">{t("account.demoHint")}</p>}
        {store.canManageAccounts && (
          <button type="button" className="sidebar-button" data-testid="add-account" onClick={() => setDialogOpen(true)}>
            <Plus size={16} aria-hidden="true" /> {t("account.add")}
          </button>
        )}
        {state.outbox.length > 0 && (
          <div className="outbox" data-testid="outbox">
            {state.outbox.some((o) => o.status === "queued") && (
              <p className="outbox-line" title={state.outbox.find((o) => o.status === "queued" && o.error)?.error ?? undefined}>
                <Send size={14} aria-hidden="true" />
                <span>{t("outbox.queued", { count: state.outbox.filter((o) => o.status === "queued").length })}</span>
              </p>
            )}
            {state.outbox
              .filter((o) => o.status === "failed")
              .map((o) => (
                <p key={o.id} className="outbox-line failed" title={o.error ?? undefined}>
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span className="ellipsis">{t("outbox.failed", { subject: o.subject || "–" })}</span>
                  <button type="button" className="link-button" onClick={() => void store.reopenOutgoing(o.id)}>
                    {t("outbox.edit")}
                  </button>
                </p>
              ))}
          </div>
        )}
        <AIActivity />
        <div className="sync-row">
          <span className="muted small" data-testid="sync-status">
            {!store.canManageAccounts
              ? ""
              : state.syncProgress
                ? t("sync.progress", { done: state.syncProgress.done.toLocaleString(locale === "de" ? "de-DE" : "en-GB"), total: state.syncProgress.total.toLocaleString(locale === "de" ? "de-DE" : "en-GB") })
              : state.syncing
                ? t("sync.running")
                : state.lastSyncAt
                  ? t("sync.last", { time: new Date(state.lastSyncAt).toLocaleTimeString(locale === "de" ? "de-DE" : "en-GB", { hour: "2-digit", minute: "2-digit" }) })
                  : t("sync.never")}
          </span>
          <span className="footer-actions">
            <button
              type="button"
              className="icon-button"
              title={t("options.title")}
              aria-label={t("options.title")}
              data-testid="open-options"
              onClick={() => store.openOptions()}
            >
              <Settings size={15} />
            </button>
            {store.canShowDigest && (
              <button type="button" className="icon-button" title={t("digest.title")} aria-label={t("digest.title")} data-testid="open-digest" onClick={() => void store.openDigest()}>
                <Sun size={15} />
              </button>
            )}
            {store.canManageAccounts && (
              <button
                type="button"
                className={`icon-button${state.syncing ? " spinning" : ""}`}
                title={`${t("sync.now")} (F5)`}
                aria-label={t("sync.now")}
                data-testid="sync-now"
                disabled={state.syncing}
                onClick={() => void store.syncNow()}
              >
                <RefreshCw size={15} />
              </button>
            )}
          </span>
        </div>
      </footer>
      {dialogOpen && <AccountDialog onClose={() => setDialogOpen(false)} />}
    </nav>
  );
}
