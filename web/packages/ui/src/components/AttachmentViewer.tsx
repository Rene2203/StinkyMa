import { Cpu, Download, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { isRiskyAttachment, type AIImage, type PreviewKind } from "@stinkyma/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { ReadingState } from "../store.js";

/** PDF-Seiten für die KI höchstens so groß (längere Seite in Pixeln) – reicht zum Lesen, spart Rechenzeit. */
const readingMaxSide = 1600;

/** Die ersten (bis zu 3) gerenderten PDF-Seiten als JPEG für „Mit KI lesen“. */
function pageImages(container: HTMLElement | null): AIImage[] {
  if (!container) return [];
  return [...container.querySelectorAll("canvas")].slice(0, 3).map((page) => {
    const scale = Math.min(1, readingMaxSide / Math.max(page.width, page.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(page.width * scale);
    canvas.height = Math.round(page.height * scale);
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(page, 0, 0, canvas.width, canvas.height);
    }
    return { mimeType: "image/jpeg" as const, base64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "" };
  });
}

/** Höchstens so viele PDF-Seiten auf einmal anzeigen (schwache Rechner). */
const maxPdfPages = 50;

/**
 * Vorschau eines Anhangs in der App: PDF (gerendert mit PDF.js, ohne Skripte), Bilder und Text.
 * Wird nachgeladen (React.lazy) – der PDF-Baustein ist groß.
 */
export default function AttachmentViewer({ attachmentId, filename, kind }: { attachmentId: string; filename: string; kind: PreviewKind }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const dialog = useRef<HTMLDialogElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const readable = (kind === "image" || kind === "pdf") && store.canReadAttachments;
  const reading = state.reading?.attachmentId === attachmentId ? state.reading : null;
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
        {readable && (
          <button
            type="button"
            className="viewer-read"
            data-testid="viewer-read"
            disabled={!content || reading?.busy}
            onClick={() => void store.readAttachmentWithAI(kind === "pdf" ? pageImages(pages.current) : undefined)}
          >
            <Sparkles size={15} aria-hidden="true" /> {reading?.view ? t("reading.again") : t("reading.action")}
          </button>
        )}
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
        {reading && <ReadingCard reading={reading} />}
        {error ? (
          <p className="dialog-error" role="alert">{error}</p>
        ) : !content ? (
          <p className="viewer-loading"><Loader2 size={18} className="spinning" aria-hidden="true" /> {t("viewer.loading")}</p>
        ) : kind === "pdf" ? (
          <PdfView bytes={content.bytes} container={pages} />
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
function PdfView({ bytes, container }: { bytes: Uint8Array; container: RefObject<HTMLDivElement | null> }) {
  const { t } = useUi();
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
  }, [bytes, container]);

  return (
    <>
      {error && <p className="dialog-error" role="alert">{t("viewer.pdfError")}</p>}
      <div ref={container} className="viewer-pages" />
      {pages && pages.total > pages.shown && <p className="muted small">{t("viewer.morePages", { shown: pages.shown, total: pages.total })}</p>}
    </>
  );
}

/** Ergebnis „Mit KI lesen“: Art, Kurzbeschreibung, gelesener Text (aufklappbar), Herkunft. */
function ReadingCard({ reading }: { reading: ReadingState }) {
  const { t } = useUi();
  const { view, busy, error } = reading;
  return (
    <section className="reading-card" aria-busy={busy} data-testid="reading-card">
      {busy && (
        <p className="muted small" role="status">
          <Loader2 size={14} className="spinning" aria-hidden="true" /> {t("reading.busy")} <span className="hint">{t("reading.busyHint")}</span>
        </p>
      )}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {view && (
        <div className={busy ? "dimmed" : undefined}>
          <p className="reading-head">
            <span className="chip">{t(`reading.type.${view.documentType}`)}</span> <strong>{view.title}</strong>
          </p>
          <p data-testid="reading-summary">{view.summary}</p>
          {view.text && (
            <details>
              <summary>{t("reading.text")}</summary>
              <pre className="reading-text" data-testid="reading-text">{view.text}</pre>
            </details>
          )}
          <p className="summary-origin muted small">
            <Cpu size={12} aria-hidden="true" /> {t("reading.origin", { model: view.modelName, seconds: Math.round(view.durationMs / 1000) })} · {t("reading.searchable")}
          </p>
        </div>
      )}
    </section>
  );
}
