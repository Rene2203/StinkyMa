import { ExternalLink, Lock, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useBrowserState, useUi } from "../context.js";

const margin = 16;

/**
 * Fremde Seite (z. B. Abmelde-Seite) in einem verschiebbaren Fenster innerhalb der App; der Rest wird abgedunkelt.
 * Die Seite selbst zeichnet der Main-Prozess abgeschottet genau in den Bereich `.webpanel-body` – dessen Lage meldet
 * diese Komponente bei jeder Bewegung.
 */
export function WebPanelDialog() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const panel = state.webPanel;
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const size = () => ({ width: Math.min(620, window.innerWidth - 2 * margin), height: Math.min(720, window.innerHeight - 2 * margin) });
  const [box, setBox] = useState(() => {
    const s = size();
    return { ...s, x: Math.round((window.innerWidth - s.width) / 2), y: Math.round((window.innerHeight - s.height) / 2) };
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const report = useCallback(() => {
    const rect = body.current?.getBoundingClientRect();
    if (rect) store.webPanelHost?.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }, [store]);
  useLayoutEffect(report, [box, report, panel?.error]);

  // Fenstergröße geändert: Fenster im sichtbaren Bereich halten
  useEffect(() => {
    const onResize = () =>
      setBox((b) => {
        const s = size();
        const width = Math.min(b.width, s.width);
        const height = Math.min(b.height, s.height);
        return { width, height, x: clamp(b.x, window.innerWidth - width), y: clamp(b.y, window.innerHeight - height) };
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!panel) return null;
  let host = panel.url;
  try {
    host = new URL(panel.url).host;
  } catch {
    // Adresse so anzeigen, wie sie ist
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    setBox((b) => ({ ...b, x: clamp(e.clientX - d.dx, window.innerWidth - b.width), y: clamp(e.clientY - d.dy, window.innerHeight - b.height) }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <dialog
      ref={dialog}
      className="webpanel"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      aria-label={t("webPanel.title")}
      data-testid="webpanel"
      onCancel={(e) => {
        e.preventDefault();
        void store.closeWebPanel();
      }}
    >
      <header className="webpanel-bar" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} data-testid="webpanel-bar">
        <Lock size={13} aria-hidden="true" />
        <span className="webpanel-title">
          <strong data-testid="webpanel-host">{host}</strong>
          <span className="muted small">{panel.error ? t("webPanel.error", { error: panel.error }) : panel.loading ? t("webPanel.loading") : panel.title}</span>
        </span>
        <button type="button" className="icon-button" title={t("webPanel.external")} aria-label={t("webPanel.external")} onClick={() => void store.openWebPanelExternally()}>
          <ExternalLink size={15} />
        </button>
        <button type="button" className="icon-button" title={t("webPanel.close")} aria-label={t("webPanel.close")} data-testid="webpanel-close" onClick={() => void store.closeWebPanel()}>
          <X size={16} />
        </button>
      </header>
      <div className="webpanel-body" ref={body}>
        <span className="muted small">{t("webPanel.loading")}</span>
      </div>
      <footer className="webpanel-foot muted small">{t("webPanel.hint")}</footer>
    </dialog>
  );
}

function clamp(value: number, max: number): number {
  return Math.round(Math.min(Math.max(0, value), Math.max(0, max)));
}
