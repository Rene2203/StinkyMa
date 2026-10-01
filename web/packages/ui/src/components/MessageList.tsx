import { Archive, Flag, FlagOff, Mail, MailOpen, Paperclip, Search, ShieldAlert, SquarePen, Trash2 } from "lucide-react";
import { assessPhishing, displayName, isFlagged, isRead, type Message } from "@stinkyma/core";
import { useState, type MouseEvent } from "react";
import { useBrowserState, useUi } from "../context.js";
import { formatListDate } from "../format.js";
import { isSearching, showsAccountIndicator, sidebarItem, visibleMessages } from "../store.js";
import { CategoryChip } from "./CategoryChip.js";
import { ContextMenu, type ContextMenuState } from "./ContextMenu.js";
import { composeLabels } from "../composeLabels.js";
import { sidebarTitle } from "./Sidebar.js";

export function MessageList() {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const messages = visibleMessages(state);
  const withAccount = showsAccountIndicator(state);
  const item = sidebarItem(state, state.selectedScope);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const searching = isSearching(state);
  // Ordnername je Mail (für Suchergebnisse aus allen Ordnern)
  const folderNames = new Map(
    state.sections.flatMap((section) =>
      section.items.flatMap((i) => (i.kind.type === "mailbox" ? [[i.kind.mailbox.id, sidebarTitle(i, t)] as const] : [])),
    ),
  );
  const showFolder = searching && state.searchAllFolders;

  const openMenu = (event: MouseEvent, message: Message) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, message });
  };

  return (
    <section className="message-list" aria-label={item ? sidebarTitle(item, t) : undefined}>
      <header className="list-header">
        <div className="list-title-row">
          <h2 className="list-title">{item ? sidebarTitle(item, t) : ""}</h2>
          <button
            type="button"
            className="icon-button"
            title={`${t("compose.new")} (N)`}
            aria-label={t("compose.new")}
            data-testid="compose-new"
            onClick={() => store.openCompose("new", composeLabels(t, locale))}
          >
            <SquarePen size={17} />
          </button>
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder={t("list.search")}
            aria-label={t("list.search")}
            value={state.searchText}
            onChange={(e) => store.setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void store.runSearch();
              if (e.key === "Escape") store.setSearchText("");
            }}
            data-testid="search-input"
          />
        </label>
        {searching && (
          <div className="search-scope" role="group" aria-label={t("search.scope")}>
            <button type="button" aria-pressed={state.searchAllFolders} onClick={() => store.setSearchAllFolders(true)} data-testid="search-all">
              {t("search.allFolders")}
            </button>
            <button type="button" aria-pressed={!state.searchAllFolders} onClick={() => store.setSearchAllFolders(false)} data-testid="search-here">
              {t("search.onlyHere", { folder: item ? sidebarTitle(item, t) : "" })}
            </button>
            {state.searchResults && (
              <span className="muted small" data-testid="search-count">{t("search.count", { count: state.searchResults.length })}</span>
            )}
          </div>
        )}
      </header>

      {messages.length === 0 ? (
        <div className="empty">
          <strong>{state.searchText.trim() ? t("list.noResults.title") : t("list.empty.title")}</strong>
          <span>{state.searchText.trim() ? t("list.noResults.text", { query: state.searchText.trim() }) : t("list.empty.text")}</span>
        </div>
      ) : (
        <ul className="rows" role="listbox" aria-label={item ? sidebarTitle(item, t) : undefined}>
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              selected={message.id === state.selectedMessageId}
              accountColor={withAccount ? state.accountsById[message.accountId]?.color : undefined}
              accountName={state.accountsById[message.accountId]?.displayName}
              folderName={showFolder ? folderNames.get(message.mailboxId) : undefined}
              onContextMenu={(e) => openMenu(e, message)}
            />
          ))}
        </ul>
      )}
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

function MessageRow(props: {
  message: Message;
  selected: boolean;
  accountColor: string | undefined;
  accountName: string | undefined;
  folderName?: string | undefined;
  onContextMenu: (event: MouseEvent) => void;
}) {
  const { message, selected, accountColor, accountName, folderName } = props;
  const { store, t, locale } = useUi();
  const read = isRead(message);
  const flagged = isFlagged(message);

  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-testid="message-row"
      data-message-id={message.id}
      className={`row${selected ? " selected" : ""}${read ? "" : " unread"}`}
      onClick={() => void store.selectMessage(message.id)}
      onDoubleClick={() => {
        if (store.isDraft(message)) void store.editDraft(message.id);
      }}
      onContextMenu={props.onContextMenu}
    >
      <div className="row-status" aria-hidden={read && !flagged}>
        {!read && <span className="unread-dot" title={t("list.unread")} />}
        {flagged && <Flag className="flag-icon" size={12} fill="currentColor" aria-label={t("list.flagged")} />}
      </div>
      <div className="row-main">
        <div className="row-line">
          {accountColor && (
            <span className={`account-bar color-${accountColor}`} title={t("list.account", { name: accountName ?? "" })} />
          )}
          <span className="row-sender">{displayName(message.from)}</span>
          {message.hasAttachments && <Paperclip className="muted" size={13} aria-label={t("list.hasAttachment")} />}
          {assessPhishing(message).level === "danger" && <ShieldAlert className="row-phishing" size={13} aria-label={t("phishing.listHint")} data-testid="row-phishing" />}
          <span className="row-date">{formatListDate(message.date, locale, t)}</span>
        </div>
        <div className="row-subject">{message.subject}</div>
        <div className="row-snippet">{message.snippet}</div>
        {folderName && <span className="row-folder" data-testid="row-folder">{folderName}</span>}
        {message.category && <CategoryChip category={message.category} />}
      </div>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" title={read ? t("action.markUnread") : t("action.markRead")} onClick={() => void store.toggleRead(message.id)}>
          {read ? <Mail size={15} /> : <MailOpen size={15} />}
        </button>
        <button type="button" title={flagged ? t("action.unflag") : t("action.flag")} onClick={() => void store.toggleFlag(message.id)}>
          {flagged ? <FlagOff size={15} /> : <Flag size={15} />}
        </button>
        <button type="button" title={t("action.archive")} onClick={() => void store.archive([message.id])}>
          <Archive size={15} />
        </button>
        <button type="button" title={t("action.trash")} onClick={() => void store.moveToTrash([message.id])}>
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}
