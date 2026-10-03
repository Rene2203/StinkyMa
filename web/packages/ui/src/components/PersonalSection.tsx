import { Eye, RotateCcw, Star, StarOff } from "lucide-react";
import { useEffect } from "react";
import { useBrowserState, useUi } from "../context.js";

const percent = (value: number) => `${Math.round(value * 100)} %`;

/** Transparenz-Seite (W8.3/W8.4): Schreibstil, Anrede je Person, Wichtigkeit je Absender – ansehen, festlegen, vergessen. */
export function PersonalSection() {
  const { store, t } = useUi();
  const state = useBrowserState();
  useEffect(() => {
    void store.loadPersonal();
  }, [store]);
  if (!store.canPersonal) return null;
  const overview = state.personal?.overview ?? null;
  const style = overview?.style;
  const events = overview?.events;

  const forget = () => {
    if (window.confirm(t("personal.forgetConfirm"))) void store.forgetPersonal();
  };

  return (
    <section className="options-section personal-section" aria-labelledby="options-personal-heading" data-testid="personal-section">
      <h3 id="options-personal-heading">
        <Eye size={16} aria-hidden="true" /> {t("personal.title")}
      </h3>
      <p className="hint">{t("personal.text")}</p>
      {state.personal?.error && <p className="error small">{state.personal.error}</p>}
      {!overview && state.personal?.busy && <p className="muted small">{t("personal.loading")}</p>}

      {style && (
        <div className="personal-block" data-testid="personal-style">
          <strong className="small">{t("personal.style")}</strong>
          {style.analyzed === 0 ? (
            <p className="hint">{t("personal.styleEmpty")}</p>
          ) : (
            <dl className="personal-facts">
              <dt>{t("personal.analyzed")}</dt>
              <dd>{style.analyzed}</dd>
              <dt>{t("personal.greeting")}</dt>
              <dd>{style.greeting ?? "–"}</dd>
              <dt>{t("personal.closing")}</dt>
              <dd>{style.closing ?? "–"}</dd>
              <dt>{t("personal.length")}</dt>
              <dd>{style.medianWords !== null ? t("personal.words", { count: style.medianWords }) : "–"}</dd>
              <dt>{t("personal.emoji")}</dt>
              <dd>{percent(style.emojiRate)}</dd>
              <dt>{t("personal.exclamation")}</dt>
              <dd>{percent(style.exclamationRate)}</dd>
            </dl>
          )}
          <span className="hint">{t("personal.styleUse")}</span>
        </div>
      )}

      {overview && overview.recipients.length > 0 && (
        <div className="personal-block" data-testid="personal-recipients">
          <strong className="small">{t("personal.recipients")}</strong>
          <ul role="list" className="personal-list">
            {overview.recipients.map((r) => (
              <li key={r.address}>
                <span className="ellipsis">{r.address}</span>
                <span className="chip">{r.form ?? "?"}</span>
                {r.greetingLine && <span className="muted small ellipsis">{r.greetingLine}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {overview && overview.senders.length > 0 && (
        <div className="personal-block" data-testid="personal-senders">
          <strong className="small">{t("personal.senders")}</strong>
          <span className="hint">{t("personal.sendersText")}</span>
          <ul role="list" className="personal-list">
            {overview.senders.map((s) => (
              <li key={s.address} data-testid="personal-sender">
                <span className="ellipsis" title={s.address}>{s.name ? `${s.name} <${s.address}>` : s.address}</span>
                <span className="muted small" title={t("personal.statsTitle")}>
                  {t("personal.stats", { opened: s.stats.opened, received: s.stats.received, replied: s.stats.replied })}
                </span>
                <span className="chip">{percent(s.score)}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={s.stats.userPriority === 1}
                  title={t("personal.always")}
                  aria-label={t("personal.alwaysFor", { address: s.address })}
                  onClick={() => void store.setSenderPriority(s.address, s.stats.userPriority === 1 ? null : 1)}
                >
                  <Star size={13} fill={s.stats.userPriority === 1 ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={s.stats.userPriority === -1}
                  title={t("personal.never")}
                  aria-label={t("personal.neverFor", { address: s.address })}
                  onClick={() => void store.setSenderPriority(s.address, s.stats.userPriority === -1 ? null : -1)}
                >
                  <StarOff size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {events && (
        <div className="personal-block" data-testid="personal-events">
          <strong className="small">{t("personal.events")}</strong>
          <span className="hint">
            {t("personal.eventsText", { open: events.open, reply: events.reply, flag: events.flag, archive: events.archive, trash: events.trash })}
          </span>
        </div>
      )}

      <div className="row-buttons">
        <button type="button" onClick={forget} data-testid="personal-forget">
          <RotateCcw size={14} aria-hidden="true" /> {t("personal.forget")}
        </button>
      </div>
    </section>
  );
}
