import { Download, Image as ImageIcon, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { categorizeWindowDays, type AIModelInfo } from "@stinkyma/core";
import { useBrowserState, useUi } from "../context.js";
import { formatBytes } from "../format.js";

/** Optionen → KI: einschalten, Modell laden/wählen/löschen, Einordnung im Hintergrund. */
export function AISection() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const ai = state.ai;
  if (!ai) return null;
  const { settings } = ai;

  return (
    <section className="options-section" aria-labelledby="options-ai-heading" data-testid="ai-section">
      <h3 id="options-ai-heading">
        <Sparkles size={16} aria-hidden="true" /> {t("ai.title")}
      </h3>
      <p className="hint">{t("ai.text")}</p>
      <label className="checkbox">
        <input type="checkbox" checked={settings.enabled} data-testid="ai-enabled" onChange={(e) => void store.updateAI({ enabled: e.target.checked })} />
        <span>{t("ai.enabled")}</span>
      </label>
      {settings.enabled && (
        <>
          <label className="checkbox">
            <input type="checkbox" checked={settings.autoCategorize} data-testid="ai-auto-categorize" onChange={(e) => void store.updateAI({ autoCategorize: e.target.checked })} />
            <span>
              {t("ai.autoCategorize")}
              <span className="hint block">{t("ai.autoCategorizeHint", { days: categorizeWindowDays })}</span>
            </span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={settings.useGpu} data-testid="ai-use-gpu" onChange={(e) => void store.updateAI({ useGpu: e.target.checked })} />
            <span>{t("ai.useGpu")}</span>
          </label>
        </>
      )}
      {ai.categorizing && (
        <p className="muted small" role="status">
          <Loader2 size={13} className="spinning" aria-hidden="true" /> {t("ai.categorizing", { count: ai.categorizing.remaining })}
        </p>
      )}
      {ai.error && <p className="dialog-error" role="alert">{ai.error}</p>}
      <h4 className="options-subheading">{t("ai.models")}</h4>
      <p className="hint">
        {t("ai.ram", { ram: ai.ramGb })} {settings.enabled && !ai.ready && t("ai.notReady")}
      </p>
      <ul className="model-list" role="list">
        {ai.models.map((model) => (
          <ModelRow key={model.id} model={model} selected={settings.modelId === model.id} busyElsewhere={ai.download !== null && ai.download.modelId !== model.id} />
        ))}
      </ul>
    </section>
  );
}

function ModelRow({ model, selected, busyElsewhere }: { model: AIModelInfo; selected: boolean; busyElsewhere: boolean }) {
  const { store, t, locale } = useUi();
  const progress = model.state === "downloading" || model.state === "partial" ? Math.min(1, model.receivedBytes / model.sizeBytes) : null;
  return (
    <li className={`model-row${selected ? " selected" : ""}`} data-testid="ai-model" data-model={model.id}>
      <div className="model-info">
        <strong>{model.name}</strong>
        <span className="muted small">
          {t("ai.model.size", { size: formatBytes(model.sizeBytes, locale), ram: model.minRamGb })}
          {model.capabilities.includes("image") && (
            <>
              {" · "}
              <ImageIcon size={12} aria-hidden="true" /> {t("ai.model.image")}
            </>
          )}
        </span>
        <span className="hint block">{model.note}</span>
        {!model.fits && <span className="hint block warning">{t("ai.model.tooBig")}</span>}
        {progress !== null && (
          <span className="model-progress">
            <progress value={progress} max={1} aria-label={model.name} />
            <span className="muted small">{t("ai.model.progress", { done: formatBytes(model.receivedBytes, locale), total: formatBytes(model.sizeBytes, locale) })}</span>
          </span>
        )}
      </div>
      <div className="model-actions">
        {model.state === "installed" ? (
          <>
            {selected ? (
              <span className="chip">{t("ai.model.inUse")}</span>
            ) : (
              <button type="button" data-testid="ai-model-use" onClick={() => void store.updateAI({ modelId: model.id, enabled: true })}>{t("ai.model.use")}</button>
            )}
            <button type="button" className="icon-button" title={t("ai.model.delete", { name: model.name })} aria-label={t("ai.model.delete", { name: model.name })} onClick={() => void store.deleteModel(model.id)}>
              <Trash2 size={15} />
            </button>
          </>
        ) : model.state === "downloading" ? (
          <button type="button" onClick={() => void store.cancelModelDownload()}>
            <X size={15} aria-hidden="true" /> {t("ai.model.cancel")}
          </button>
        ) : (
          <>
            <button type="button" className={model.fits ? "primary" : undefined} disabled={busyElsewhere} data-testid="ai-model-download" onClick={() => void store.downloadModel(model.id)}>
              <Download size={15} aria-hidden="true" /> {model.state === "partial" ? t("ai.model.resume") : t("ai.model.download")}
            </button>
            {model.state === "partial" && (
              <button type="button" className="icon-button" title={t("ai.model.delete", { name: model.name })} aria-label={t("ai.model.delete", { name: model.name })} onClick={() => void store.deleteModel(model.id)}>
                <Trash2 size={15} />
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
