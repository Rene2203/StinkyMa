import { Cpu, Download, FileText, MessageCircleQuestion, Search, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useBrowserState, useUi } from "../context.js";

const examples = ["Wann hat die Hausverwaltung die Nebenkosten geschickt?", "Was habe ich Thomas zum Angebot zugesagt?", "Welche Rechnungen kamen im September?"];

/** „Frag dein Postfach“ (W8.1): Frage in normaler Sprache, Antwort mit Quellen – alles lokal. */
export function AskPanel() {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const ask = state.ask;
  const [question, setQuestion] = useState(ask?.question ?? "");
  const result = ask?.result ?? null;
  const status = ask?.status ?? null;
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim()) void store.askQuestion(question);
  };

  return (
    <section className="subs-panel ask-panel" aria-labelledby="ask-title" data-testid="ask">
      <header className="subs-header">
        <MessageCircleQuestion size={20} aria-hidden="true" />
        <div>
          <h2 id="ask-title">{t("ask.title")}</h2>
          <span className="muted small">{t("ask.subtitle")}</span>
        </div>
        <span className="toolbar-gap" aria-hidden="true" />
        <button type="button" className="icon-button" title={t("subs.close")} aria-label={t("subs.close")} onClick={() => store.closeAsk()}>
          <X size={16} />
        </button>
      </header>

      <form className="ask-form" onSubmit={submit}>
        <input
          value={question}
          placeholder={t("ask.placeholder")}
          aria-label={t("ask.placeholder")}
          data-testid="ask-input"
          autoFocus
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="primary" disabled={ask?.busy || question.trim().length < 3} data-testid="ask-submit">
          <Search size={14} aria-hidden="true" /> {t("ask.submit")}
        </button>
      </form>
      {ask?.sender && (
        <p className="ask-sender small">
          {t("ask.onlySender", { sender: ask.sender })}
          <button type="button" className="link" onClick={() => store.clearAskSender()}>{t("ask.allMails")}</button>
        </p>
      )}

      {status && (
        <div className="ask-index small muted" data-testid="ask-index">
          {status.model.state === "missing" && (
            <>
              <span>{t("ask.noModel", { size: mb(status.model.sizeBytes) })}</span>
              <button type="button" data-testid="ask-download" onClick={() => void store.downloadAskModel()}>
                <Download size={13} aria-hidden="true" /> {t("ask.download", { size: mb(status.model.sizeBytes) })}
              </button>
            </>
          )}
          {status.model.state === "downloading" && <span>{t("ask.downloading", { done: mb(status.model.receivedBytes), total: mb(status.model.sizeBytes) })}</span>}
          {status.model.state === "ready" && (
            <>
              <span>
                {status.running && <Cpu size={12} aria-hidden="true" />} {t("ask.indexed", { indexed: status.indexed.toLocaleString(lang), total: status.total.toLocaleString(lang) })}
              </span>
              <button type="button" className="link muted" title={t("ask.deleteModel")} onClick={() => void store.deleteAskModel()}>
                <Trash2 size={12} aria-hidden="true" /> {t("ask.deleteModel")}
              </button>
            </>
          )}
          <span className="ask-license">{t("ask.license", { license: status.model.license })}</span>
        </div>
      )}

      {ask?.error && <p className="dialog-error" role="alert">{ask.error}</p>}
      {ask?.busy && <p className="muted" data-testid="ask-busy"><Cpu size={13} aria-hidden="true" /> {t("ask.busy")}</p>}

      {!result && !ask?.busy && (
        <div className="ask-examples">
          <p className="muted small">{t("ask.examples")}</p>
          {examples.map((example) => (
            <button key={example} type="button" className="link" onClick={() => { setQuestion(example); void store.askQuestion(example); }}>
              {example}
            </button>
          ))}
        </div>
      )}

      {result && !ask?.busy && (
        <div className="ask-result" data-testid="ask-result">
          {result.answer ? (
            <p className="ask-answer" data-testid="ask-answer">{result.answer}</p>
          ) : (
            <p className="muted small">{result.sources.length ? t("ask.noAnswerModel") : t("ask.nothing")}</p>
          )}
          {result.sources.length > 0 && (
            <>
              <h3 className="ask-sources-title">{t("ask.sources")}</h3>
              <ol className="ask-sources">
                {result.sources.map((s) => (
                  <li key={s.messageId} className={result.cited.includes(s.n) ? "cited" : ""}>
                    <button type="button" className="ask-source" data-testid="ask-source" onClick={() => void store.openAskSource(s.messageId)}>
                      <span className="ask-source-n">[{s.n}]</span>
                      <span className="ask-source-main">
                        <strong>{s.subject || t("ask.noSubject")}</strong>
                        <span className="muted small">
                          {s.from} · {new Date(s.date).toLocaleDateString(lang)}
                          {s.attachment && (
                            <>
                              {" · "}
                              <FileText size={11} aria-hidden="true" /> {s.attachment}
                            </>
                          )}
                        </span>
                        <span className="ask-excerpt small">{s.excerpt}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="muted small">
            {t(result.search.semantic ? "ask.searchBoth" : "ask.searchKeyword")} · {(result.durationMs / 1000).toFixed(1)} s
          </p>
        </div>
      )}
    </section>
  );
}
