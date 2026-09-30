import { Paperclip, Send, X } from "lucide-react";
import {
  attachmentLimitBytes,
  attachmentWarningBytes,
  formatAddressList,
  parseAddressList,
  textToHtml,
  type ComposeDraft,
  type OutgoingAttachment,
} from "@stinkyma/core";
import { formatBytes } from "../format.js";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useBrowserState, useUi } from "../context.js";
import { RichTextEditor } from "./RichTextEditor.js";

const titles = { new: "compose.new", reply: "compose.reply", replyAll: "compose.replyAll", forward: "compose.forward" } as const;

/**
 * Composer: Von, An, Cc/Bcc, Betreff, Text. Gesendet wird nur per Klick auf „Senden“ (oder Strg+Enter).
 * Die Mail geht in den Postausgang; der Composer schließt sofort.
 */
export default function Composer({ draft }: { draft: ComposeDraft }) {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const accounts = useMemo(() => Object.values(state.accountsById).sort((a, b) => a.sortOrder - b.sortOrder), [state.accountsById]);

  const [accountId, setAccountId] = useState(draft.accountId);
  const [to, setTo] = useState(formatAddressList(draft.to));
  const [cc, setCc] = useState(formatAddressList(draft.cc));
  const [bcc, setBcc] = useState(formatAddressList(draft.bcc));
  const [showCcBcc, setShowCcBcc] = useState(draft.cc.length + draft.bcc.length > 0);
  const [subject, setSubject] = useState(draft.subject);
  const initialHtml = useMemo(() => draft.bodyHtml ?? textToHtml(draft.bodyText), [draft]);
  const [body, setBody] = useState({ html: initialHtml, text: draft.bodyText });
  const [bodyTouched, setBodyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnedNoSubject, setWarnedNoSubject] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>(draft.attachments ?? []);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  const dialog = useRef<HTMLDialogElement>(null);
  const toField = useRef<HTMLInputElement>(null);
  const isReply = draft.mode === "reply" || draft.mode === "replyAll";

  useEffect(() => {
    dialog.current?.showModal();
    // Antworten: Cursor an den Anfang des Textes (über dem Zitat, macht der Editor); sonst ins Feld „An“.
    if (!isReply) toField.current?.focus();
  }, [isReply]);

  const changed =
    to !== formatAddressList(draft.to) || cc !== formatAddressList(draft.cc) || bcc !== formatAddressList(draft.bcc) ||
    subject !== draft.subject || bodyTouched || attachments.length !== (draft.attachments?.length ?? 0);

  const addFiles = async (files: FileList | File[]) => {
    const added = await Promise.all([...files].map(readAttachment));
    setAttachments((current) => [...current, ...added]);
    setError(null);
  };

  const close = () => {
    if (busy) return;
    if (changed && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    store.closeCompose();
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    const lists = [to, cc, bcc].map(parseAddressList);
    const invalid = lists.flatMap((l) => l.invalid);
    if (invalid.length > 0) {
      setError(t("compose.invalidAddresses", { list: invalid.join(", ") }));
      return;
    }
    const [toList, ccList, bccList] = lists.map((l) => l.addresses);
    if (!toList?.length && !ccList?.length && !bccList?.length) {
      setError(t("compose.noRecipients"));
      toField.current?.focus();
      return;
    }
    if (totalSize > attachmentLimitBytes) {
      setError(t("attachment.tooLarge", { size: formatBytes(totalSize, locale), limit: formatBytes(attachmentLimitBytes, locale) }));
      return;
    }
    if (subject.trim() === "" && !warnedNoSubject) {
      setWarnedNoSubject(true);
      setError(t("compose.noSubject"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await store.send({
        accountId,
        to: toList ?? [],
        cc: ccList ?? [],
        bcc: bccList ?? [],
        subject: subject.trim(),
        bodyText: body.text,
        bodyHtml: body.html,
        attachments,
        inReplyTo: draft.inReplyTo ?? null,
        references: draft.references ?? [],
        answeredMessageId: draft.answeredMessageId ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
      setBusy(false);
    }
  };

  // In der Capture-Phase, damit der Editor Strg+Enter nicht als Zeilenumbruch nimmt.
  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void send();
    }
  };

  return (
    <dialog
      ref={dialog}
      className={`dialog composer${dragging ? " dragging" : ""}`}
      aria-labelledby="composer-title"
      data-testid="composer"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDownCapture={onKeyDownCapture}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <form onSubmit={send}>
        <header className="dialog-header">
          <h2 id="composer-title">{t(titles[draft.mode])}</h2>
          <button type="button" className="icon-button" aria-label={t("compose.close")} onClick={close} disabled={busy}>
            <X size={16} />
          </button>
        </header>

        <div className="composer-fields">
          {accounts.length > 1 && (
            <label className="composer-row">
              <span>{t("compose.from")}</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="compose-from">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName} &lt;{a.email}&gt;
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="composer-row">
            <span>{t("compose.to")}</span>
            <input
              ref={toField}
              value={to}
              onChange={(e) => { setTo(e.target.value); setError(null); }}
              placeholder={t("compose.addressHint")}
              data-testid="compose-to"
              autoComplete="off"
              spellCheck={false}
            />
            {!showCcBcc && (
              <button type="button" className="link-button" onClick={() => setShowCcBcc(true)}>
                {t("compose.showCcBcc")}
              </button>
            )}
          </label>
          {showCcBcc && (
            <>
              <label className="composer-row">
                <span>{t("compose.cc")}</span>
                <input value={cc} onChange={(e) => { setCc(e.target.value); setError(null); }} data-testid="compose-cc" autoComplete="off" spellCheck={false} />
              </label>
              <label className="composer-row">
                <span>{t("compose.bcc")}</span>
                <input value={bcc} onChange={(e) => { setBcc(e.target.value); setError(null); }} data-testid="compose-bcc" autoComplete="off" spellCheck={false} />
              </label>
            </>
          )}
          <label className="composer-row">
            <span>{t("compose.subject")}</span>
            <input value={subject} onChange={(e) => { setSubject(e.target.value); setWarnedNoSubject(false); }} data-testid="compose-subject" />
          </label>
        </div>

        <RichTextEditor
          initialHtml={initialHtml}
          focus={isReply ? "start" : null}
          onChange={(value) => {
            setBody(value);
            setBodyTouched(true);
          }}
        />

        {attachments.length > 0 && (
          <ul className="composer-attachments" aria-label={t("attachment.add")}>
            {attachments.map((a, i) => (
              <li key={`${a.filename}-${i}`} className="composer-attachment" data-testid="compose-attachment">
                <Paperclip size={13} aria-hidden="true" />
                <span className="name" title={a.filename}>{a.filename}</span>
                <span className="muted">{formatBytes(a.size, locale)}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("attachment.remove", { name: a.filename })}
                  onClick={() => setAttachments((current) => current.filter((_, index) => index !== i))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {totalSize > attachmentWarningBytes && totalSize <= attachmentLimitBytes && (
          <p className="hint warning attachment-warning">{t("attachment.large", { size: formatBytes(totalSize, locale) })}</p>
        )}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        {confirmDiscard && (
          <p className="composer-confirm" role="alert">
            <span>{t("compose.confirmDiscard")}</span>
            <button type="button" onClick={() => setConfirmDiscard(false)}>{t("compose.keepWriting")}</button>
            <button type="button" className="danger" onClick={() => store.closeCompose()} data-testid="compose-confirm-discard">
              {t("compose.discard")}
            </button>
          </p>
        )}

        <footer className="dialog-footer">
          <span className="footer-start">
            <button type="button" className="icon-button" onClick={() => fileInput.current?.click()} title={`${t("attachment.add")} – ${t("attachment.dropHint")}`} aria-label={t("attachment.add")} data-testid="compose-attach">
              <Paperclip size={17} />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="compose-file-input"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </span>
          <button type="button" onClick={close} disabled={busy}>{t("compose.discard")}</button>
          <button type="submit" className="primary" disabled={busy} data-testid="compose-send" title={`${t("compose.send")} (Strg+Enter)`}>
            <Send size={15} aria-hidden="true" /> {busy ? t("compose.sending") : t("compose.send")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/** Liest eine Datei als Base64 (für IPC und den Postausgang). */
function readAttachment(file: File): Promise<OutgoingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gelesen werden."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        contentBase64: result.slice(result.indexOf(",") + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}
