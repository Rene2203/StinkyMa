import { useMemo, useState } from "react";
import { isDemoAccount } from "@stinkyma/core";
import { useBrowserState, useUi } from "../context.js";
import { RichTextEditor } from "./RichTextEditor.js";

/**
 * Signatur pro Konto (Bereich im Optionen-Dialog). Wird nachgeladen, weil sie den Editor braucht.
 * Default-Export für React.lazy.
 */
export default function SignatureEditor() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const accounts = useMemo(
    () => Object.values(state.accountsById).sort((a, b) => Number(isDemoAccount(a)) - Number(isDemoAccount(b)) || a.sortOrder - b.sortOrder),
    [state.accountsById],
  );
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = state.accountsById[accountId];
  const [html, setHtml] = useState(account?.signatureHtml ?? "");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  if (!account) return null;

  const switchAccount = (id: string) => {
    setAccountId(id);
    setHtml(state.accountsById[id]?.signatureHtml ?? "");
    setStatus("idle");
  };

  const save = async () => {
    try {
      await store.setSignature(accountId, html);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="signature-editor">
      {accounts.length > 1 && (
        <label className="signature-account">
          <span>{t("signature.account")}</span>
          <select value={accountId} onChange={(e) => switchAccount(e.target.value)} data-testid="signature-account">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName} &lt;{a.email}&gt;
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="signature-box">
        <RichTextEditor
          key={accountId}
          initialHtml={account.signatureHtml ?? ""}
          focus={null}
          testId="signature-body"
          placeholder={t("signature.placeholder")}
          label={t("signature.title")}
          onChange={(value) => {
            setHtml(value.text.trim() ? value.html : "");
            setStatus("idle");
          }}
        />
      </div>
      <div className="signature-actions">
        <span className="muted small" aria-live="polite">
          {status === "saved" ? t("signature.saved") : status === "error" ? t("draft.error") : ""}
        </span>
        <button type="button" className="primary" onClick={() => void save()} data-testid="signature-save">
          {t("signature.save")}
        </button>
      </div>
    </div>
  );
}
