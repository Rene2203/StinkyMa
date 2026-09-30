import { Archive, Flag, FlagOff, Mail, MailOpen, Paperclip, Search, Trash2 } from "lucide-react";
import { displayName, isFlagged, isRead, type Message } from "@stinkyma/core";
import { useState, type MouseEvent } from "react";
import { useBrowserState, useUi } from "../context.js";
import { formatListDate } from "../format.js";
import { showsAccountIndicator, sidebarItem, visibleMessages } from "../store.js";
import { CategoryChip } from "./CategoryChip.js";
import { ContextMenu, type ContextMenuState } from "./ContextMenu.js";
import { sidebarTitle } from "./Sidebar.js";

export function MessageList() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const messages = visibleMessages(state);
  const withAccount = showsAccountIndicator(state);
  const item = sidebarItem(state, state.selectedScope);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const openMenu = (event: MouseEvent, message: Message) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, message });
  };

  return (
    <section className="message-list" aria-label={item ? sidebarTitle(item, t) : undefined}>
      <header className="list-header">
        <h2 className="list-title">{item ? sidebarTitle(item, t) : ""}</h2>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder={t("list.search")}
            aria-label={t("list.search")}
            value={state.searchText}
            onChange={(e) => store.setSearchText(e.target.value)}
          />
        </label>
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
  onContextMenu: (event: MouseEvent) => void;
}) {
  const { message, selected, accountColor, accountName } = props;
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
          <span className="row-date">{formatListDate(message.date, locale, t)}</span>
        </div>
        <div className="row-subject">{message.subject}</div>
        <div className="row-snippet">{message.snippet}</div>
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
