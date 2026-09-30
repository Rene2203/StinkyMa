import { Archive, Download, Flag, FlagOff, Forward, Loader2, Mail as MailIcon, Pencil, Reply, ReplyAll, ShieldAlert, Trash2 } from "lucide-react";
import { displayName, initials, isFlagged, isRiskyAttachment, type Attachment, type Message } from "@stinkyma/core";
import { useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import { formatBytes, formatFullDate, formatList } from "../format.js";
import { attachmentIcon } from "../icons.js";
import { selectedMessage, threadFor } from "../store.js";
import { CategoryChip } from "./CategoryChip.js";
import { composeLabels } from "../composeLabels.js";
import { SafeHtml } from "./SafeHtml.js";

export function MessageDetail() {
  const { store, t, locale } = useUi();
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
  const isDraft = store.isDraft(message);

  return (
    <section className="detail" aria-label={message.subject}>
      <div className="toolbar" role="toolbar">
        {isDraft ? (
          <>
            <button type="button" className="primary-action" data-testid="draft-edit" onClick={() => void store.editDraft(message.id)}>
              <Pencil size={17} /> <span>{t("draft.edit")}</span>
            </button>
            <span className="toolbar-gap" aria-hidden="true" />
            <button type="button" title={t("compose.discard")} aria-label={t("compose.discard")} data-testid="draft-delete" onClick={() => void store.deleteDraftMessage(message.id)}>
              <Trash2 size={17} />
            </button>
          </>
        ) : (
          <>
            <button type="button" title={`${t("compose.reply")} (R)`} data-testid="action-reply" onClick={() => store.openCompose("reply", composeLabels(t, locale))}>
              <Reply size={17} /> <span>{t("compose.reply")}</span>
            </button>
            <button type="button" title={`${t("compose.replyAll")} (A)`} aria-label={t("compose.replyAll")} data-testid="action-reply-all" onClick={() => store.openCompose("replyAll", composeLabels(t, locale))}>
              <ReplyAll size={17} />
            </button>
            <button type="button" title={`${t("compose.forward")} (F)`} aria-label={t("compose.forward")} data-testid="action-forward" onClick={() => store.openCompose("forward", composeLabels(t, locale))}>
              <Forward size={17} />
            </button>
            <span className="toolbar-gap" aria-hidden="true" />
            <button type="button" title={`${flagged ? t("action.unflag") : t("action.flag")} (S)`} onClick={() => void store.toggleFlag(message.id)}>
              {flagged ? <FlagOff size={17} /> : <Flag size={17} />}
            </button>
            <button type="button" title={`${t("action.archive")} (E)`} onClick={() => void store.archive([message.id])}>
              <Archive size={17} />
            </button>
            <button type="button" title={`${t("action.trash")} (Entf)`} onClick={() => void store.moveToTrash([message.id])}>
              <Trash2 size={17} />
            </button>
          </>
        )}
      </div>
      <div className="detail-scroll">
        <div className="detail-content">
          <h2 className="thread-subject" data-testid="thread-subject">{message.subject}</h2>
          {isDraft && <p className="draft-banner"><Pencil size={14} aria-hidden="true" /> {t("draft.banner")}</p>}
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
          {message.bodyHtml ? (
            <SafeHtml html={message.bodyHtml} sender={message.from.address} />
          ) : (
            <div className="card-body">{message.bodyText ?? message.snippet}</div>
          )}
          {attachments.length > 0 && (
            <ul className="attachments" role="list">
              {attachments.map((a) => (
                <AttachmentItem key={a.id} attachment={a} />
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

/** Anhang: Klick öffnet (Standardprogramm), Download-Symbol speichert. Ausführbares nur speichern. */
function AttachmentItem({ attachment: a }: { attachment: Attachment }) {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const Icon = attachmentIcon(a.filename);
  const risky = isRiskyAttachment(a.filename);
  const busy = state.attachmentBusy === a.id;
  const canOpen = store.canOpenAttachments && !risky;
  const info = (
    <>
      {busy ? <Loader2 size={22} className="spinning" aria-hidden="true" /> : risky ? <ShieldAlert size={22} strokeWidth={1.5} aria-hidden="true" className="risky" /> : <Icon size={22} strokeWidth={1.5} aria-hidden="true" />}
      <span>
        <span className="attachment-name">{a.filename}</span>
        <span className="muted small">
          {formatBytes(a.size, locale)}
          {a.pageCount ? ` · ${t("detail.pages", { count: a.pageCount })}` : ""}
          {risky ? ` · ${t("attachment.riskyShort")}` : ""}
        </span>
      </span>
    </>
  );
  return (
    <li className="attachment" data-testid="attachment" title={risky ? t("attachment.risky") : undefined}>
      {canOpen ? (
        <button
          type="button"
          className="attachment-open"
          onClick={() => void store.openAttachment(a.id)}
          disabled={busy}
          title={t("attachment.open")}
          aria-label={`${t("attachment.open")}: ${a.filename}`}
        >
          {info}
        </button>
      ) : (
        <span className="attachment-open">{info}</span>
      )}
      {store.canOpenAttachments && (
        <button
          type="button"
          className="icon-button"
          aria-label={`${t("attachment.save")}: ${a.filename}`}
          title={t("attachment.save")}
          data-testid="attachment-save"
          disabled={busy}
          onClick={() => void store.saveAttachment(a.id)}
        >
          <Download size={16} />
        </button>
      )}
    </li>
  );
}
