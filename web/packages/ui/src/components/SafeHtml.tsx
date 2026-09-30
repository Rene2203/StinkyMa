import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUi } from "../context.js";
import { emailDocument, sanitizeEmailHtml } from "../sanitize.js";

/**
 * HTML-Mail in einem Sandbox-Frame: Skripte sind abgeschaltet (kein allow-scripts), Links öffnen im Browser.
 * allow-same-origin ohne allow-scripts ist unbedenklich und erlaubt, die Höhe des Inhalts zu messen.
 */
export function SafeHtml({ html }: { html: string }) {
  const { t } = useUi();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const sanitized = useMemo(() => sanitizeEmailHtml(html), [html]);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return;
      setHeight(Math.max(40, doc.documentElement.scrollHeight));
      if (!observer && doc.body) {
        observer = new ResizeObserver(() => setHeight(Math.max(40, doc.documentElement.scrollHeight)));
        observer.observe(doc.body);
      }
    };
    iframe.addEventListener("load", measure);
    return () => {
      iframe.removeEventListener("load", measure);
      observer?.disconnect();
    };
  }, [sanitized.html]);

  return (
    <div className="safe-html">
      {sanitized.blockedRemote > 0 && (
        <p className="blocked-note">
          <ShieldCheck size={14} aria-hidden="true" /> {t("html.blocked")}
        </p>
      )}
      <iframe
        ref={frame}
        title="E-Mail"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={emailDocument(sanitized.html)}
        style={{ height }}
      />
    </div>
  );
}
