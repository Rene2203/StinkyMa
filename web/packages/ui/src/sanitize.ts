import DOMPurify from "dompurify";

export interface SanitizedHtml {
  html: string;
  /** Anzahl entfernter externer Inhalte (Bilder, Hintergründe) – meist Tracking-Pixel. */
  blockedRemote: number;
}

const remote = /^\s*(https?:)?\/\//i;

/**
 * Macht HTML-Mails sicher für die Anzeige (Spezifikation 4.4 / 7.6):
 * keine Skripte, keine Formulare, keine eingebetteten Fremdseiten, externe Bilder blockiert,
 * Links öffnen außerhalb der App. Zusätzlich läuft die Anzeige in einem Sandbox-Frame ohne Skripte.
 */
export function sanitizeEmailHtml(html: string, window: Window & typeof globalThis = globalThis.window): SanitizedHtml {
  const purify = DOMPurify(window);
  let blockedRemote = 0;

  purify.addHook("afterSanitizeAttributes", (node) => {
    const element = node as Element;
    for (const attribute of ["src", "srcset", "background", "poster"]) {
      const value = element.getAttribute?.(attribute);
      if (value && remote.test(value)) {
        element.removeAttribute(attribute);
        blockedRemote += 1;
      }
    }
    const style = element.getAttribute?.("style");
    if (style && /url\(\s*['"]?\s*(https?:)?\/\//i.test(style)) {
      element.setAttribute("style", style.replace(/url\([^)]*\)/gi, "none"));
      blockedRemote += 1;
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      } else {
        element.removeAttribute("href");
      }
    }
  });

  const clean = purify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "iframe", "frame", "object", "embed", "base", "meta", "link", "script", "noscript"],
    FORBID_ATTR: ["action", "formaction", "ping"],
    ALLOW_DATA_ATTR: false,
  }) as unknown as string;

  purify.removeAllHooks();
  return { html: clean, blockedRemote };
}

/** Vollständiges Dokument für den Sandbox-Frame. Mails erwarten meist hellen Hintergrund – daher immer hell. */
export function emailDocument(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff;color:#1b1b1b;}
    body{font-family:"Avenir Next","Avenir","Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.5;overflow-wrap:anywhere;padding:4px 2px;}
    img{max-width:100%;height:auto;}
    table{max-width:100%;}
    a{color:#0067c0;}
  </style></head><body>${bodyHtml}</body></html>`;
}
