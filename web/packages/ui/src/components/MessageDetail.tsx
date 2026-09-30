import { Archive, Flag, FlagOff, Mail as MailIcon, Reply, Trash2 } from "lucide-react";
import { displayName, initials, isFlagged, type Attachment, type Message } from "@stinkyma/core";
import { useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import { formatBytes, formatFullDate, formatList } from "../format.js";
import { attachmentIcon } from "../icons.js";
import { selectedMessage, threadFor } from "../store.js";
import { CategoryChip } from "./CategoryChip.js";

export function MessageDetail() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const message = selectedMessage(state);

  if (!message) {
    return (
      <section className="detail detail-empty">
        <MailIcon size={48} strokeWidth={1.25} aria-hidden="true" />
        <strong>{t("detail.empty.title")}</strong>
        <span>{t("detail.empty.text")}</span>
      </section>
    );
  }

  const thread = threadFor(state, message);
  const last = thread.at(-1);
  const flagged = isFlagged(message);

  return (
    <section className="detail" aria-label={message.subject}>
      <div className="toolbar" role="toolbar">
        <button type="button" disabled title={t("action.replyLater")}>
          <Reply size={17} /> <span>{t("action.reply")}</span>
        </button>
        <button type="button" title={`${flagged ? t("action.unflag") : t("action.flag")} (S)`} onClick={() => void store.toggleFlag(message.id)}>
          {flagged ? <FlagOff size={17} /> : <Flag size={17} />}
        </button>
        <button type="button" title={`${t("action.archive")} (E)`} onClick={() => void store.archive([message.id])}>
          <Archive size={17} />
        </button>
        <button type="button" title={`${t("action.trash")} (Entf)`} onClick={() => void store.moveToTrash([message.id])}>
          <Trash2 size={17} />
        </button>
      </div>
      <div className="detail-scroll">
        <div className="detail-content">
          <h2 className="thread-subject" data-testid="thread-subject">{message.subject}</h2>
          {message.category && <CategoryChip category={message.category} />}
          {thread.map((m) => (
            <ThreadMessage
              key={`${message.id}-${m.id}`}
              message={m}
              attachments={state.attachmentsByMessageId[m.id] ?? []}
              initiallyExpanded={m.id === message.id || m.id === last?.id}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ThreadMessage({ message, attachments, initiallyExpanded }: { message: Message; attachments: Attachment[]; initiallyExpanded: boolean }) {
  const { t, locale } = useUi();
  const [expanded, setExpanded] = useState(initiallyExpanded);

  return (
    <article className={`card${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="card-header"
        aria-expanded={expanded}
        title={expanded ? t("detail.collapse") : t("detail.expand")}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="avatar" aria-hidden="true">{initials(message.from)}</span>
        <span className="card-meta">
          <span className="card-line">
            <strong>{displayName(message.from)}</strong>
            <span className="muted small">{formatFullDate(message.date, locale)}</span>
          </span>
          <span className="muted small ellipsis">
            {expanded ? t("detail.to", { names: formatList(message.to.map(displayName), locale) }) : message.snippet}
          </span>
        </span>
      </button>
      {expanded && (
        <>
          {/* Phase W1 zeigt nur Text. HTML-Mails (abgesichert, ohne Skripte und externe Inhalte) folgen mit echten Konten. */}
          <div className="card-body">{message.bodyText ?? message.snippet}</div>
          {attachments.length > 0 && (
            <ul className="attachments" role="list">
              {attachments.map((a) => {
                const Icon = attachmentIcon(a.filename);
                return (
                  <li key={a.id} className="attachment">
                    <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
                    <span>
                      <span className="attachment-name">{a.filename}</span>
                      <span className="muted small">
                        {formatBytes(a.size, locale)}
                        {a.pageCount ? ` · ${t("detail.pages", { count: a.pageCount })}` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
