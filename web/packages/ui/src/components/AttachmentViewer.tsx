import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { isRiskyAttachment, type PreviewKind } from "@stinkyma/core";
import { useEffect, useRef, useState } from "react";
import { useUi } from "../context.js";

/** Höchstens so viele PDF-Seiten auf einmal anzeigen (schwache Rechner). */
const maxPdfPages = 50;

/**
 * Vorschau eines Anhangs in der App: PDF (gerendert mit PDF.js, ohne Skripte), Bilder und Text.
 * Wird nachgeladen (React.lazy) – der PDF-Baustein ist groß.
 */
export default function AttachmentViewer({ attachmentId, filename, kind }: { attachmentId: string; filename: string; kind: PreviewKind }) {
  const { store, t } = useUi();
  const dialog = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<{ bytes: Uint8Array; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    store
      .readAttachment(attachmentId)
      .then((result) => {
        if (!cancelled) setContent({ bytes: Uint8Array.from(atob(result.contentBase64), (c) => c.charCodeAt(0)), mimeType: result.mimeType });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId, store]);

  return (
    <dialog
      ref={dialog}
      className="dialog viewer"
      aria-label={filename}
      data-testid="attachment-viewer"
      onCancel={(e) => {
        e.preventDefault();
        store.closePreview();
      }}
    >
      <header className="viewer-header">
        <strong className="viewer-title" title={filename}>{filename}</strong>
        {!isRiskyAttachment(filename) && (
          <button type="button" className="icon-button" title={t("viewer.openExternal")} aria-label={t("viewer.openExternal")} onClick={() => void store.openAttachment(attachmentId)}>
            <ExternalLink size={16} />
          </button>
        )}
        <button type="button" className="icon-button" title={t("attachment.save")} aria-label={t("attachment.save")} onClick={() => void store.saveAttachment(attachmentId)}>
          <Download size={16} />
        </button>
        <button type="button" className="icon-button" title={t("compose.close")} aria-label={t("compose.close")} onClick={() => store.closePreview()} data-testid="viewer-close">
          <X size={16} />
        </button>
      </header>
      <div className="viewer-body">
        {error ? (
          <p className="dialog-error" role="alert">{error}</p>
        ) : !content ? (
          <p className="viewer-loading"><Loader2 size={18} className="spinning" aria-hidden="true" /> {t("viewer.loading")}</p>
        ) : kind === "pdf" ? (
          <PdfView bytes={content.bytes} />
        ) : kind === "image" ? (
          <ImageView bytes={content.bytes} mimeType={content.mimeType} alt={filename} />
        ) : (
          <pre className="viewer-text" data-testid="viewer-text">{new TextDecoder().decode(content.bytes)}</pre>
        )}
      </div>
    </dialog>
  );
}

function ImageView({ bytes, mimeType, alt }: { bytes: Uint8Array; mimeType: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType.startsWith("image/") ? mimeType : "image/png" }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [bytes, mimeType]);
  return url ? <img className="viewer-image" src={url} alt={alt} data-testid="viewer-image" /> : null;
}

/** PDF-Seiten als Bilder (Canvas). PDF.js führt keine Skripte aus PDFs aus; Formulare/Links bleiben inaktiv. */
function PdfView({ bytes }: { bytes: Uint8Array }) {
  const { t } = useUi();
  const container = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ total: number; shown: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = container.current;
    if (!host) return;
    void (async () => {
      try {
        const { getDocumentProxy } = await import("unpdf");
        // Kopie: PDF.js übernimmt den Puffer
        const pdf = await getDocumentProxy(bytes.slice(), { disableFontFace: false });
        const total = pdf.numPages;
        const shown = Math.min(total, maxPdfPages);
        if (!cancelled) setPages({ total, shown });
        for (let number = 1; number <= shown && !cancelled; number++) {
          const page = await pdf.getPage(number);
          const viewport = page.getViewport({ scale: 1.4 * (window.devicePixelRatio || 1) });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "viewer-page";
          canvas.setAttribute("data-testid", "viewer-page");
          const context = canvas.getContext("2d");
          if (!context) break;
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          if (cancelled) break;
          host.appendChild(canvas);
          page.cleanup();
        }
        await pdf.loadingTask.destroy();
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [bytes]);

  return (
    <>
      {error && <p className="dialog-error" role="alert">{t("viewer.pdfError")}</p>}
      <div ref={container} className="viewer-pages" />
      {pages && pages.total > pages.shown && <p className="muted small">{t("viewer.morePages", { shown: pages.shown, total: pages.total })}</p>}
    </>
  );
}
