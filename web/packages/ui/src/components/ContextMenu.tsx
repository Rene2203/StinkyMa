import { Archive, Flag, FlagOff, Mail, MailOpen, Trash2 } from "lucide-react";
import { isFlagged, isRead, type Message } from "@stinkyma/core";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useUi } from "../context.js";

export interface ContextMenuState {
  x: number;
  y: number;
  message: Message;
}

/** Rechtsklick-Menü einer Mail. Schließt bei Klick daneben, Escape oder Scrollen. */
export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const { store, t } = useUi();
  const ref = useRef<HTMLDivElement>(null);
  const { message } = state;

  // Immer die aktuelle onClose-Funktion verwenden, ohne die Listener bei jedem Rendern neu anzumelden.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const close = (event: Event) => {
      if (event.type === "mousedown" && ref.current?.contains(event.target as Node)) return;
      onCloseRef.current();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  // Tastatur im Menü: Escape schließt, ↑/↓ wechseln den Eintrag. Nicht an die App-Kürzel weiterreichen.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  };

  const run = (action: () => Promise<void>) => () => {
    onClose();
    void action();
  };

  const left = Math.min(state.x, window.innerWidth - 240);
  const top = Math.min(state.y, window.innerHeight - 180);

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left, top }} onKeyDown={onKeyDown}>
      <button type="button" role="menuitem" onClick={run(() => store.toggleRead(message.id))}>
        {isRead(message) ? <Mail size={15} /> : <MailOpen size={15} />}
        {isRead(message) ? t("action.markUnread") : t("action.markRead")}
      </button>
      <button type="button" role="menuitem" onClick={run(() => store.toggleFlag(message.id))}>
        {isFlagged(message) ? <FlagOff size={15} /> : <Flag size={15} />}
        {isFlagged(message) ? t("action.unflag") : t("action.flag")}
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={run(() => store.archive([message.id]))}>
        <Archive size={15} />
        {t("action.archive")}
      </button>
      <button type="button" role="menuitem" className="danger" onClick={run(() => store.moveToTrash([message.id]))}>
        <Trash2 size={15} />
        {t("action.trash")}
      </button>
    </div>
  );
}
