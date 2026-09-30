import { scopeKey } from "@stinkyma/core";
import { useBrowserState, useUi } from "../context.js";
import { sidebarIcon } from "../icons.js";
import type { SidebarItem } from "../store.js";
import type { Translate } from "../i18n.js";

export function sidebarTitle(item: SidebarItem, t: Translate): string {
  switch (item.kind.type) {
    case "unifiedInbox":
      return t("sidebar.unifiedInbox");
    case "unread":
      return t("sidebar.unread");
    case "flagged":
      return t("sidebar.flagged");
    case "mailbox":
      return item.kind.mailbox.role === "custom" ? item.kind.mailbox.name : t(`role.${item.kind.mailbox.role}`);
  }
}

export function sidebarTestId(item: SidebarItem): string {
  return item.kind.type === "mailbox" ? `sidebar-mailbox-${item.kind.mailbox.id}` : `sidebar-${item.kind.type}`;
}

export function Sidebar() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const selectedKey = scopeKey(state.selectedScope);

  return (
    <nav className="sidebar" aria-label={t("sidebar.title")}>
      <h1 className="sidebar-title">{t("sidebar.title")}</h1>
      {state.sections.map((section) => (
        <section key={section.id} className="sidebar-section" aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`} className="sidebar-heading" title={section.account?.email}>
            {section.account ? (
              <>
                <span className={`account-dot color-${section.account.color}`} aria-hidden="true" />
                {section.account.displayName}
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
    </nav>
  );
}
