import { Cpu, ListFilter, Pencil, Trash2 } from "lucide-react";
import { ruleCategories, type MailRule, type RuleDefinition, type RuleMove } from "@stinkyma/core";
import { useEffect, useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { MessageKey, Translate } from "../i18n.js";

/** Kurzbeschreibung einer Regel: „Absender enthält „tsv“ · Newsletter → ins Archiv, als gelesen“. */
export function describeRule(definition: RuleDefinition, t: Translate): { when: string; then: string } {
  const when: string[] = [];
  if (definition.from.length) when.push(t("rules.when.from", { values: definition.from.map((v) => `„${v}“`).join(t("rules.or")) }));
  if (definition.subject.length) when.push(t("rules.when.subject", { values: definition.subject.map((v) => `„${v}“`).join(t("rules.or")) }));
  if (definition.category) when.push(t(`category.${definition.category}` as MessageKey));
  if (definition.hasAttachment) when.push(t("rules.when.attachment"));
  const then: string[] = [];
  if (definition.folder) then.push(t("rules.then.folder", { folder: definition.folder }));
  else if (definition.move) then.push(t(`rules.then.${definition.move}` as MessageKey));
  if (definition.markRead) then.push(t("rules.then.markRead"));
  if (definition.flag) then.push(t("rules.then.flag"));
  return { when: when.join(" · "), then: then.join(", ") };
}

const splitList = (value: string) => value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);

/** Optionen → Regeln: in normaler Sprache schreiben, prüfen, speichern. */
export function RulesSection() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const rules = state.rules;
  const [text, setText] = useState("");
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    void store.loadRules();
  }, [store]);
  // Nach dem Speichern ist das Eingabefeld wieder frei
  const count = rules?.list.length ?? 0;
  useEffect(() => setText(""), [count]);
  if (!rules) return null;
  const accounts = Object.values(state.accountsById).sort((a, b) => a.sortOrder - b.sortOrder);
  const draft = rules.draft;

  // Kein eigenes <form>: der Optionen-Dialog ist selbst ein Formular (verschachtelt würde es den Dialog schließen)
  const submit = () => {
    if (text.trim()) void store.interpretRule(text, accountId || null);
  };

  return (
    <section className="options-section" aria-labelledby="options-rules-heading" data-testid="rules-section">
      <h3 id="options-rules-heading">
        <ListFilter size={16} aria-hidden="true" /> {t("rules.title")}
      </h3>
      <p className="hint">{t("rules.text")}</p>
      {!draft && (
        <div className="rule-input">
          <input
            type="text"
            value={text}
            maxLength={400}
            placeholder={t("rules.placeholder")}
            aria-label={t("rules.inputLabel")}
            data-testid="rule-text"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <select value={accountId} aria-label={t("rules.account")} onChange={(e) => setAccountId(e.target.value)} data-testid="rule-account">
            <option value="">{t("rules.allAccounts")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName || a.email}</option>
            ))}
          </select>
          <button type="button" disabled={!text.trim()} data-testid="rule-interpret" onClick={submit}>{t("rules.interpret")}</button>
        </div>
      )}
      {draft && <RuleDraftEditor key={draft.id ?? draft.text} folders={rules.folders} />}

      {rules.list.length > 0 && (
        <ul className="rule-list" role="list" data-testid="rule-list">
          {rules.list.map((rule) => (
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleRow({ rule }: { rule: MailRule }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const { when, then } = describeRule(rule.definition, t);
  const account = rule.accountId ? state.accountsById[rule.accountId] : null;
  return (
    <li className={`rule-row${rule.enabled ? "" : " off"}`} data-testid="rule-row">
      <input type="checkbox" checked={rule.enabled} aria-label={t("rules.enabled")} onChange={(e) => void store.setRuleEnabled(rule.id, e.target.checked)} />
      <span className="rule-main">
        <span>{rule.text || `${when} → ${then}`}</span>
        <span className="muted small">
          {when} → {then}
          {account ? ` · ${account.displayName || account.email}` : ""}
        </span>
      </span>
      <button type="button" className="icon-button" title={t("rules.edit")} aria-label={t("rules.edit")} onClick={() => store.editRule(rule)}>
        <Pencil size={14} />
      </button>
      <button type="button" className="icon-button" title={t("rules.remove")} aria-label={t("rules.remove")} data-testid="rule-remove" onClick={() => void store.removeRule(rule.id)}>
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function RuleDraftEditor({ folders }: { folders: string[] }) {
  const { store, t, locale } = useUi();
  const state = useBrowserState();
  const draft = state.rules?.draft;
  const definition = draft?.preview?.definition;
  const [from, setFrom] = useState(definition?.from.join(", ") ?? "");
  const [subject, setSubject] = useState(definition?.subject.join(", ") ?? "");
  const [applyToExisting, setApplyToExisting] = useState(false);
  // Felder übernehmen, sobald die Vorschau (erstmals) da ist
  const loaded = !!definition;
  useEffect(() => {
    if (!definition) return;
    setFrom(definition.from.join(", "));
    setSubject(definition.subject.join(", "));
  }, [loaded]);
  if (!draft) return null;
  if (draft.busy && !draft.preview) return <p className="muted rule-busy" data-testid="rule-busy">{t("rules.busy")}</p>;
  const preview = draft.preview;
  const change = (patch: Partial<RuleDefinition>) => definition && void store.changeRuleDraft({ ...definition, ...patch });
  const moveValue = definition?.folder ? `folder:${definition.folder}` : definition?.move ?? "";
  const problems = preview?.problems.filter((p) => p !== "notInText") ?? [];

  return (
    <div className="rule-draft" data-testid="rule-draft">
      <p className="rule-said">„{draft.text}“</p>
      {draft.error && <p className="error" role="alert">{draft.error}</p>}
      {preview && definition && (
        <>
          <p className="muted small rule-origin" data-testid="rule-origin">
            {preview.origin === "rules" ? t("rules.origin.rules") : preview.origin ? <><Cpu size={11} aria-hidden="true" /> {t("rules.origin.onDevice")}</> : null}
          </p>
          <div className="rule-fields">
            <label>
              <span>{t("rules.field.from")}</span>
              <input type="text" value={from} data-testid="rule-from" onChange={(e) => setFrom(e.target.value)} onBlur={() => change({ from: splitList(from) })} />
            </label>
            <label>
              <span>{t("rules.field.subject")}</span>
              <input type="text" value={subject} data-testid="rule-subject" onChange={(e) => setSubject(e.target.value)} onBlur={() => change({ subject: splitList(subject) })} />
            </label>
            <label>
              <span>{t("rules.field.category")}</span>
              <select value={definition.category ?? ""} data-testid="rule-category" onChange={(e) => change({ category: (e.target.value || null) as RuleDefinition["category"] })}>
                <option value="">{t("rules.any")}</option>
                {ruleCategories.map((c) => (
                  <option key={c} value={c}>{t(`category.${c}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={definition.hasAttachment} onChange={(e) => change({ hasAttachment: e.target.checked })} />
              <span>{t("rules.when.attachment")}</span>
            </label>
            <label>
              <span>{t("rules.field.move")}</span>
              <select
                value={moveValue}
                data-testid="rule-move"
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.startsWith("folder:")) change({ folder: value.slice("folder:".length), move: null });
                  else change({ folder: null, move: (value || null) as RuleMove | null });
                }}
              >
                <option value="">{t("rules.noMove")}</option>
                <option value="archive">{t("rules.then.archive")}</option>
                <option value="trash">{t("rules.then.trash")}</option>
                <option value="spam">{t("rules.then.spam")}</option>
                {folders.map((f) => (
                  <option key={f} value={`folder:${f}`}>{t("rules.then.folder", { folder: f })}</option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={definition.markRead} data-testid="rule-mark-read" onChange={(e) => change({ markRead: e.target.checked })} />
              <span>{t("rules.then.markRead")}</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={definition.flag} data-testid="rule-flag" onChange={(e) => change({ flag: e.target.checked })} />
              <span>{t("rules.then.flag")}</span>
            </label>
          </div>
          {problems.length > 0 && (
            <p className="error" role="alert" data-testid="rule-problems">{problems.map((p) => t(`rules.problem.${p}` as MessageKey)).join(" ")}</p>
          )}
          {preview.problems.includes("notInText") && <p className="muted small">{t("rules.problem.notInText")}</p>}
          {definition.category && !(state.ai?.ready && state.ai.settings.autoCategorize) && (
            <p className="hint warning" data-testid="rule-needs-ai">{t("rules.needsCategorize")}</p>
          )}
          <div className="rule-preview" data-testid="rule-preview">
            <strong>{preview.matchCount === 1 ? t("rules.matchesOne") : t("rules.matches", { count: preview.matchCount })}</strong>
            {preview.samples.length > 0 && (
              <ul role="list">
                {preview.samples.map((s) => (
                  <li key={s.id} className="small">
                    <span>{s.from.name || s.from.address}</span> – <span>{s.subject}</span>{" "}
                    <span className="muted">{new Date(s.date).toLocaleDateString(locale === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.matchCount > 0 && (
              <label className="checkbox">
                <input type="checkbox" checked={applyToExisting} data-testid="rule-apply-existing" onChange={(e) => setApplyToExisting(e.target.checked)} />
                <span>{preview.matchCount === 1 ? t("rules.applyExistingOne") : t("rules.applyExisting", { count: preview.matchCount })}</span>
              </label>
            )}
          </div>
        </>
      )}
      <div className="rule-buttons">
        <button type="button" onClick={() => store.cancelRuleDraft()}>{t("rules.cancel")}</button>
        <button type="button" className="primary" disabled={!preview || problems.length > 0 || draft.busy} data-testid="rule-save" onClick={() => void store.saveRuleDraft(applyToExisting)}>
          {t("rules.save")}
        </button>
      </div>
    </div>
  );
}
