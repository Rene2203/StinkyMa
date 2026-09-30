import { Paperclip, Send, X } from "lucide-react";
import {
  attachmentLimitBytes,
  attachmentWarningBytes,
  formatAddressList,
  parseAddressList,
  textToHtml,
  type ComposeDraft,
  type EmailAddress,
  type OutgoingAttachment,
} from "@stinkyma/core";
import { formatBytes } from "../format.js";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useBrowserState, useUi } from "../context.js";
import { RichTextEditor } from "./RichTextEditor.js";
import { AddressInput } from "./AddressInput.js";

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

  // --- Entwurf: automatisch speichern (lokal sofort, Server gebündelt) ---
  const [draftId, setDraftId] = useState<string | null>(draft.draftId ?? null);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draftError, setDraftError] = useState<string | undefined>(undefined);
  const draftIdRef = useRef<string | null>(draft.draftId ?? null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const stopSaving = useRef(false);

  const snapshot = (): ComposeDraft => ({
    mode: draft.mode,
    accountId,
    to: lenientAddresses(to),
    cc: lenientAddresses(cc),
    bcc: lenientAddresses(bcc),
    subject,
    bodyText: body.text,
    bodyHtml: body.html,
    attachments,
    inReplyTo: draft.inReplyTo ?? null,
    references: draft.references ?? [],
    answeredMessageId: draft.answeredMessageId ?? null,
    draftId: draftIdRef.current,
  });
  const snapshotKey = JSON.stringify([accountId, to, cc, bcc, subject, body.html, attachments.map((a) => [a.filename, a.size])]);
  const savedKey = useRef(snapshotKey);
  const dirty = snapshotKey !== savedKey.current;

  const saveDraftNow = (): Promise<void> => {
    const key = snapshotKey;
    const data = snapshot();
    saveChain.current = saveChain.current.then(async () => {
      if (key === savedKey.current) return;
      setDraftStatus("saving");
      try {
        const id = await store.saveDraft(draftIdRef.current, { ...data, draftId: draftIdRef.current });
        draftIdRef.current = id;
        setDraftId(id);
        savedKey.current = key;
        setDraftStatus("saved");
        setDraftError(undefined);
      } catch (e) {
        setDraftStatus("error");
        setDraftError(e instanceof Error ? e.message : String(e));
      }
    });
    return saveChain.current;
  };

  useEffect(() => {
    if (!dirty || stopSaving.current) return;
    const timer = setTimeout(() => {
      if (!stopSaving.current) void saveDraftNow();
    }, 1500);
    return () => clearTimeout(timer);
  }, [snapshotKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    dialog.current?.showModal();
    // Antworten: Cursor an den Anfang des Textes (über dem Zitat, macht der Editor); sonst ins Feld „An“.
    if (!isReply) toField.current?.focus();
  }, [isReply]);


  const addFiles = async (files: FileList | File[]) => {
    const added = await Promise.all([...files].map(readAttachment));
    setAttachments((current) => [...current, ...added]);
    setError(null);
  };

  /** Schließen behält alles als Entwurf (nichts geht verloren). */
  const close = async () => {
    if (busy) return;
    stopSaving.current = true;
    if (dirty) await saveDraftNow();
    else await saveChain.current;
    store.closeCompose();
  };

  /** Verwerfen löscht den Entwurf – mit Rückfrage, wenn es etwas zu verlieren gibt. */
  const discard = async () => {
    if (busy) return;
    if ((dirty || draftIdRef.current) && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    stopSaving.current = true;
    await saveChain.current;
    if (draftIdRef.current) await store.deleteDraft(draftIdRef.current);
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
    stopSaving.current = true;
    await saveChain.current;
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
        draftId: draftIdRef.current,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
      stopSaving.current = false;
      setBusy(false);
    }
  };

  // In der Capture-Phase, damit der Editor Strg+Enter nicht als Zeilenumbruch nimmt.
  // Esc ebenso: der Editor würde es sonst schlucken. Im Link-Feld bricht Esc nur die Link-Eingabe ab.
  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void send();
    } else if (
      event.key === "Escape" &&
      !(event.target as HTMLElement).closest(".link-field") &&
      (event.target as HTMLElement).dataset.suggesting !== "true"
    ) {
      event.preventDefault();
      event.stopPropagation();
      void close();
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
        void close();
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
      {/* Kein Senden per Enter in einem Feld – nur per Knopf oder Strg+Enter. */}
      <form onSubmit={(e) => e.preventDefault()}>
        <header className="dialog-header">
          <h2 id="composer-title">{t(titles[draft.mode])}</h2>
          <button type="button" className="icon-button" aria-label={t("compose.close")} title={t("compose.closeKeeps")} onClick={() => void close()} disabled={busy}>
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
            <AddressInput
              ref={toField}
              value={to}
              onChange={(v) => { setTo(v); setError(null); }}
              placeholder={t("compose.addressHint")}
              testId="compose-to"
              label={t("compose.to")}
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
                <AddressInput value={cc} onChange={(v) => { setCc(v); setError(null); }} testId="compose-cc" label={t("compose.cc")} />
              </label>
              <label className="composer-row">
                <span>{t("compose.bcc")}</span>
                <AddressInput value={bcc} onChange={(v) => { setBcc(v); setError(null); }} testId="compose-bcc" label={t("compose.bcc")} />
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
          onChange={setBody}
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
            <button type="button" className="danger" onClick={() => void discard()} data-testid="compose-confirm-discard">
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
          <span className="muted small draft-status" data-testid="draft-status" aria-live="polite" title={draftError}>
            {draftStatus === "saving" ? t("draft.saving") : draftStatus === "saved" && !dirty ? t("draft.saved") : draftStatus === "error" ? t("draft.error") : ""}
          </span>
          <button type="button" onClick={() => void discard()} disabled={busy} data-testid="compose-discard">{t("compose.discard")}</button>
          <button type="button" className="primary" disabled={busy} data-testid="compose-send" onClick={() => void send()} title={`${t("compose.send")} (Strg+Enter)`}>
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

/** Adressen für den Entwurf: auch unfertige Eingaben behalten (sie werden erst beim Senden geprüft). */
function lenientAddresses(input: string): EmailAddress[] {
  const { addresses, invalid } = parseAddressList(input);
  return [...addresses, ...invalid.map((raw) => ({ name: null, address: raw }))];
}
