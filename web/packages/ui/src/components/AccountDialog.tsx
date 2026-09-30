import { ChevronDown, ChevronRight, ExternalLink, Info, Lock, X } from "lucide-react";
import { detectProvider, guessSettings, isDemoAccount, type AccountSettings, type ConnectionSecurity } from "@stinkyma/core";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useBrowserState, useUi } from "../context.js";

interface ServerFields {
  host: string;
  port: string;
  security: ConnectionSecurity;
}

/** Dialog „Konto hinzufügen“: Adresse eingeben → Anbieter erkennen → Passwort → Verbindung testen → speichern. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const hasDemo = Object.values(state.accountsById).some(isDemoAccount);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [removeDemo, setRemoveDemo] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [username, setUsername] = useState("");
  const [imap, setImap] = useState<ServerFields>({ host: "", port: "993", security: "tls" });
  const [smtp, setSmtp] = useState<ServerFields>({ host: "", port: "587", security: "starttls" });
  const [touchedServers, setTouchedServers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const detected = useMemo(() => detectProvider(email), [email]);
  const suggestion = detected ?? guessSettings(email);

  // Servereinstellungen aus der Erkennung übernehmen, solange der Nutzer sie nicht selbst geändert hat.
  useEffect(() => {
    if (touchedServers || !suggestion) return;
    setImap({ host: suggestion.imap.host, port: String(suggestion.imap.port), security: suggestion.imap.security });
    setSmtp({ host: suggestion.smtp.host, port: String(suggestion.smtp.port), security: suggestion.smtp.security });
  }, [suggestion?.imap.host, suggestion?.smtp.host, touchedServers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const oauthOnly = detected?.auth === "oauth-required";
  const needsAppPassword = detected?.auth === "app-password";
  const canSubmit = !busy && !oauthOnly && email.includes("@") && password.length > 0 && imap.host.trim() !== "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const settings: AccountSettings = {
      email: email.trim(),
      displayName: displayName.trim() || detected?.label || "",
      provider: detected?.provider ?? "imap",
      username: username.trim() || email.trim(),
      imapHost: imap.host.trim(),
      imapPort: Number(imap.port) || 993,
      imapSecurity: imap.security,
      smtpHost: smtp.host.trim(),
      smtpPort: Number(smtp.port) || 587,
      smtpSecurity: smtp.security,
    };
    try {
      await store.addAccount(settings, password, hasDemo && removeDemo);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const serverFields = (label: string, value: ServerFields, set: (v: ServerFields) => void, prefix: string) => (
    <fieldset className="server-fields">
      <legend>{label}</legend>
      <label className="grow">
        {t("dialog.host")}
        <input value={value.host} data-testid={`${prefix}-host`} onChange={(e) => { setTouchedServers(true); set({ ...value, host: e.target.value }); }} />
      </label>
      <label className="port">
        {t("dialog.port")}
        <input value={value.port} inputMode="numeric" data-testid={`${prefix}-port`} onChange={(e) => { setTouchedServers(true); set({ ...value, port: e.target.value.replace(/\D/g, "") }); }} />
      </label>
      <label>
        {t("dialog.security")}
        <select value={value.security} data-testid={`${prefix}-security`} onChange={(e) => { setTouchedServers(true); set({ ...value, security: e.target.value as ConnectionSecurity }); }}>
          <option value="tls">{t("security.tls")}</option>
          <option value="starttls">{t("security.starttls")}</option>
          <option value="none">{t("security.none")}</option>
        </select>
      </label>
    </fieldset>
  );

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="account-dialog-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={submit}>
        <header className="dialog-header">
          <h2 id="account-dialog-title">{t("dialog.title")}</h2>
          <button type="button" className="icon-button" aria-label={t("dialog.cancel")} onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </header>

        <label>
          {t("dialog.email")}
          <input type="email" autoFocus required value={email} data-testid="account-email" autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
        </label>
        {detected && <p className="hint">{t("dialog.detected", { provider: detected.label })}</p>}
        {oauthOnly && detected && <p className="hint warning"><Info size={14} /> {t("dialog.oauthRequired", { provider: detected.label })}</p>}

        <label>
          {needsAppPassword ? t("dialog.appPassword") : t("dialog.password")}
          <input type="password" required value={password} data-testid="account-password" autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        {needsAppPassword && detected && (
          <p className="hint">
            {t("dialog.appPasswordHint", { provider: detected.label })}{" "}
            {detected.helpUrl && (
              <a href={detected.helpUrl} target="_blank" rel="noopener noreferrer">
                {t("dialog.appPasswordHelp")} <ExternalLink size={12} />
              </a>
            )}
          </p>
        )}

        <label>
          {t("dialog.displayName")}
          <input value={displayName} placeholder={detected?.label ?? t("dialog.displayNamePlaceholder")} onChange={(e) => setDisplayName(e.target.value)} />
        </label>

        <button type="button" className="disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
          {advanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {t("dialog.advanced")}
        </button>
        {advanced && (
          <div className="advanced">
            <label>
              {t("dialog.username")}
              <input value={username} placeholder={email} data-testid="account-username" onChange={(e) => setUsername(e.target.value)} />
            </label>
            {serverFields(t("dialog.imap"), imap, setImap, "imap")}
            {serverFields(t("dialog.smtp"), smtp, setSmtp, "smtp")}
          </div>
        )}

        {hasDemo && (
          <label className="checkbox">
            <input type="checkbox" checked={removeDemo} onChange={(e) => setRemoveDemo(e.target.checked)} />
            {t("dialog.removeDemo")}
          </label>
        )}

        <p className="hint privacy"><Lock size={13} aria-hidden="true" /> {t("dialog.privacy")}</p>
        {error && <p className="dialog-error" role="alert">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" onClick={onClose} disabled={busy}>{t("dialog.cancel")}</button>
          <button type="submit" className="primary" disabled={!canSubmit} data-testid="account-connect">
            {busy ? t("dialog.connecting") : t("dialog.connect")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
