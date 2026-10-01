import { AppWindow, ImageDown, PenLine, Plus, X } from "lucide-react";
import { normalizeRemoteContentException } from "@stinkyma/core";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";

// Der Signatur-Editor braucht den großen Editor-Baustein – erst laden, wenn die Optionen offen sind.
const SignatureEditor = lazy(() => import("./SignatureEditor.js"));
import { useBrowserState, useUi } from "../context.js";
import { AISection } from "./AISection.js";

/** Dialog „Optionen“. Erster Bereich: Absender, deren externe Inhalte sofort geladen werden. */
export function OptionsDialog({ suggestion, onClose }: { suggestion: string; onClose: () => void }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const [input, setInput] = useState(suggestion);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    field.current?.focus();
    field.current?.select();
  }, []);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || input.trim() === "") return;
    if (!normalizeRemoteContentException(input)) {
      setError(t("options.remote.invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await store.addRemoteContentException(input);
      setInput("");
      field.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exceptions = state.remoteContentExceptions;

  return (
    <dialog
      ref={dialog}
      className="dialog options-dialog"
      aria-labelledby="options-dialog-title"
      data-testid="options-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={add}>
        <header className="dialog-header">
          <h2 id="options-dialog-title">{t("options.title")}</h2>
          <button type="button" className="icon-button" aria-label={t("options.close")} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <section className="options-section" aria-labelledby="options-remote-heading">
          <h3 id="options-remote-heading">
            <ImageDown size={16} aria-hidden="true" /> {t("options.remote.title")}
          </h3>
          <p className="hint">{t("options.remote.text")}</p>
          <div className="options-add">
            <label className="grow">
              <span className="visually-hidden">{t("options.remote.label")}</span>
              <input
                ref={field}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError(null);
                }}
                placeholder={t("options.remote.placeholder")}
                aria-label={t("options.remote.label")}
                data-testid="remote-exception-input"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || input.trim() === ""} data-testid="remote-exception-add">
              <Plus size={15} aria-hidden="true" /> {t("options.remote.add")}
            </button>
          </div>
          {error && <p className="dialog-error" role="alert">{error}</p>}
          {exceptions.length === 0 ? (
            <p className="options-empty muted small">{t("options.remote.empty")}</p>
          ) : (
            <ul className="exception-list" role="list" aria-label={t("options.remote.title")}>
              {exceptions.map((exception) => (
                <li key={exception} data-testid="remote-exception">
                  <span className="exception-name">{exception}</span>
                  <span className="muted small">{exception.includes("@") ? t("options.remote.kindAddress") : t("options.remote.kindDomain")}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("options.remote.remove", { exception })}
                    title={t("options.remote.remove", { exception })}
                    onClick={() => void store.removeRemoteContentException(exception)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {state.ai && <AISection />}

        {state.appSettings && <AppSettingsSection />}

        <section className="options-section" aria-labelledby="options-signature-heading">
          <h3 id="options-signature-heading">
            <PenLine size={16} aria-hidden="true" /> {t("signature.title")}
          </h3>
          <p className="hint">{t("signature.text")}</p>
          <Suspense fallback={null}>
            <SignatureEditor />
          </Suspense>
        </section>

        <footer className="dialog-footer">
          <button type="button" onClick={onClose}>{t("options.done")}</button>
        </footer>
      </form>
    </dialog>
  );
}

/** Einstellungen der Windows-App: Infobereich, Autostart, Benachrichtigungen. */
function AppSettingsSection() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const settings = state.appSettings;
  const available = state.appSettingsAvailable;
  if (!settings) return null;
  return (
    <section className="options-section" aria-labelledby="options-app-heading">
      <h3 id="options-app-heading">
        <AppWindow size={16} aria-hidden="true" /> {t("appSettings.title")}
      </h3>
      {available.closeToTray !== false && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.closeToTray}
            data-testid="setting-close-to-tray"
            onChange={(e) => void store.updateAppSettings({ closeToTray: e.target.checked })}
          />
          <span>
            {t("appSettings.closeToTray")}
            <span className="hint block">{t("appSettings.closeToTrayHint")}</span>
          </span>
        </label>
      )}
      {available.launchAtLogin && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            data-testid="setting-launch-at-login"
            onChange={(e) => void store.updateAppSettings({ launchAtLogin: e.target.checked })}
          />
          <span>
            {t("appSettings.launchAtLogin")}
            <span className="hint block">{t("appSettings.launchAtLoginHint")}</span>
          </span>
        </label>
      )}
      <label className="setting-row">
        <span>{t("appSettings.notifications")}</span>
        <select
          value={settings.notifications}
          data-testid="setting-notifications"
          onChange={(e) => void store.updateAppSettings({ notifications: e.target.value as typeof settings.notifications })}
        >
          <option value="full">{t("appSettings.notifications.full")}</option>
          <option value="minimal">{t("appSettings.notifications.minimal")}</option>
          <option value="off">{t("appSettings.notifications.off")}</option>
        </select>
      </label>
    </section>
  );
}

