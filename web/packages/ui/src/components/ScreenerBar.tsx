import { ShieldX, UserCheck } from "lucide-react";
import { displayName, type Message } from "@stinkyma/core";
import { useUi } from "../context.js";

/** Türsteher: Entscheidung für eine Mail eines neuen Absenders – erlauben oder blockieren. */
export function ScreenerBar({ message }: { message: Message }) {
  const { store, t } = useUi();
  return (
    <section className="screener-bar" data-testid="screener-bar">
      <UserCheck size={18} aria-hidden="true" />
      <div className="screener-text">
        <strong>{t("screener.newSender", { name: displayName(message.from), address: message.from.address })}</strong>
        <span className="small">{t("screener.explain")}</span>
      </div>
      <div className="screener-buttons">
        <button type="button" className="primary" data-testid="screener-allow" onClick={() => void store.decideSender(message.from.address, "allow")}>
          <UserCheck size={15} aria-hidden="true" /> {t("screener.allow")}
        </button>
        <button type="button" data-testid="screener-block" onClick={() => void store.decideSender(message.from.address, "block")}>
          <ShieldX size={15} aria-hidden="true" /> {t("screener.block")}
        </button>
      </div>
    </section>
  );
}
