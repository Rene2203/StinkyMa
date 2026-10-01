import { Download, Image as ImageIcon, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { categorizeWindowDays, type AIModelInfo, type CategorizeRange } from "@stinkyma/core";
import { useEffect } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { MessageKey } from "../i18n.js";
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
          {settings.autoCategorize && <CategorizeRangeRow />}
          <label className="checkbox">
            <input type="checkbox" checked={settings.useGpu} data-testid="ai-use-gpu" onChange={(e) => void store.updateAI({ useGpu: e.target.checked })} />
            <span>{t("ai.useGpu")}</span>
          </label>
          <VisionRow />
          <LearnedSenders />
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

/** „Bilder und Scans verstehen“: lädt Bild-Baustein und Bild-Laufzeit nach (nur, wenn das Modell es kann). */
function VisionRow() {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const ai = state.ai;
  if (!ai || ai.vision.state === "unavailable") return null;
  const download = ai.download?.kind === "vision" ? ai.download : null;
  return (
    <div className="vision-row" data-testid="ai-vision">
      {ai.vision.state === "ready" ? (
        <label className="checkbox">
          <input type="checkbox" checked={ai.settings.vision} data-testid="ai-vision-enabled" onChange={(e) => void store.updateAI({ vision: e.target.checked })} />
          <span>
            {t("ai.vision")}
            <span className="hint block">{t("ai.visionHint")}</span>
          </span>
        </label>
      ) : download ? (
        <div className="model-progress">
          <span className="small">{t("ai.vision")}</span>
          <progress value={download.receivedBytes / Math.max(1, download.totalBytes)} max={1} aria-label={t("ai.vision")} />
          <span className="muted small">{t("ai.model.progress", { done: formatBytes(download.receivedBytes, locale), total: formatBytes(download.totalBytes, locale) })}</span>
          <button type="button" className="link-button" onClick={() => void store.cancelModelDownload()}>{t("ai.model.cancel")}</button>
        </div>
      ) : (
        <div className="vision-setup">
          <span>
            {t("ai.vision")}
            <span className="hint block">{t("ai.visionHint")}</span>
          </span>
          <button type="button" data-testid="ai-vision-download" disabled={ai.download !== null} onClick={() => void store.downloadVision()}>
            <Download size={15} aria-hidden="true" /> {t("ai.visionDownload", { size: formatBytes(ai.vision.missingBytes, locale) })}
          </button>
        </div>
      )}
    </div>
  );
}

function ModelRow({ model, selected, busyElsewhere }: { model: AIModelInfo; selected: boolean; busyElsewhere: boolean }) {
  const { store, t, locale } = useUi();
  const progress = model.state === "downloading" || model.state === "partial" ? Math.min(1, model.receivedBytes / model.sizeBytes) : null;
  return (
    <li className={`model-row${selected ? " selected" : ""}`} data-testid="ai-model" data-model={model.id}>
      <div className="model-info">
        <strong>
          {model.name} {model.recommended && <span className="chip recommended">{t("ai.model.recommended")}</span>}
        </strong>
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

/** Aus Korrekturen gelernte Absender – ansehen und vergessen. */
function LearnedSenders() {
  const { store, t } = useUi();
  const state = useBrowserState();
  useEffect(() => {
    void store.loadLearnedSenders();
  }, [store]);
  if (state.learnedSenders.length === 0) return null;
  return (
    <div className="learned-senders" data-testid="learned-senders">
      <strong className="small">{t("learned.title")}</strong>
      <span className="hint">{t("learned.text")}</span>
      <ul role="list">
        {state.learnedSenders.map((s) => (
          <li key={s.address}>
            <span className="ellipsis">{s.address}</span>
            <span className={`chip category-${s.category}`}>{t(`category.${s.category}` as MessageKey)}</span>
            <button type="button" className="icon-button" title={t("learned.forget", { address: s.address })} aria-label={t("learned.forget", { address: s.address })} onClick={() => void store.forgetSender(s.address)}>
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const presets: { value: string; range: CategorizeRange }[] = [
  { value: "recent", range: { kind: "recent" } },
  { value: "30", range: { kind: "days", days: 30 } },
  { value: "90", range: { kind: "days", days: 90 } },
  { value: "365", range: { kind: "days", days: 365 } },
  { value: "all", range: { kind: "all" } },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Welche älteren Mails zusätzlich eingeordnet werden – Auswahl oder eigener Zeitraum mit Start- und Enddatum. */
function CategorizeRangeRow() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const ai = state.ai;
  if (!ai) return null;
  const range = ai.settings.categorizeRange;
  const value = range.kind === "custom" ? "custom" : range.kind === "days" ? String(range.days) : range.kind;
  const choose = (next: string) => {
    if (next === "custom") {
      const from = new Date(Date.now() - 90 * 86_400_000);
      void store.updateAI({ categorizeRange: { kind: "custom", from: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`, to: today() } });
      return;
    }
    const preset = presets.find((p) => p.value === next);
    if (preset) void store.updateAI({ categorizeRange: preset.range });
  };
  const open = ai.backlog.recent;
  // Grobe Schätzung für schwache Hardware: ~5 Sekunden je Mail
  const minutes = Math.max(1, Math.round((open * 5) / 60));
  return (
    <div className="categorize-range" data-testid="categorize-range">
      <label className="setting-row">
        <span>{t("ai.range.label")}</span>
        <select value={value} data-testid="categorize-range-select" onChange={(e) => choose(e.target.value)}>
          <option value="recent">{t("ai.range.recent")}</option>
          <option value="30">{t("ai.range.days", { days: 30 })}</option>
          <option value="90">{t("ai.range.days", { days: 90 })}</option>
          <option value="365">{t("ai.range.year")}</option>
          <option value="all">{t("ai.range.all")}</option>
          <option value="custom">{t("ai.range.custom")}</option>
        </select>
      </label>
      {range.kind === "custom" && (
        <div className="range-dates">
          <label>
            <span>{t("ai.range.from")}</span>
            <input type="date" value={range.from} max={range.to} data-testid="categorize-from" onChange={(e) => e.target.value && void store.updateAI({ categorizeRange: { ...range, from: e.target.value } })} />
          </label>
          <label>
            <span>{t("ai.range.to")}</span>
            <input type="date" value={range.to} min={range.from} max={today()} data-testid="categorize-to" onChange={(e) => e.target.value && void store.updateAI({ categorizeRange: { ...range, to: e.target.value } })} />
          </label>
        </div>
      )}
      <span className="hint block" data-testid="categorize-range-hint">
        {open === 0 ? t("ai.range.none") : t("ai.range.open", { count: open, minutes })}
        {ai.backlog.older > 0 ? ` ${t("ai.range.outside", { count: ai.backlog.older })}` : ""}
      </span>
    </div>
  );
}
