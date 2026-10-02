import { Trash2, X } from "lucide-react";
import { userCategoryColors, type UserCategoryColor } from "@stinkyma/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useBrowserState, useUi } from "../context.js";

/** Eigene Kategorie anlegen oder bearbeiten: Name, wofür sie da ist (liest die KI), feste Absender, Farbe. */
export function CategoryDialog() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const dialog = useRef<HTMLDialogElement>(null);
  const current = state.categoryDialog;
  const editing = current?.category ?? null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [senders, setSenders] = useState(editing?.senders.join(", ") ?? "");
  const used = new Set(state.userCategories?.categories.map((c) => c.color));
  const [color, setColor] = useState<UserCategoryColor>(editing?.color ?? userCategoryColors.find((c) => !used.has(c)) ?? "blue");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  if (!current) return null;
  const busy = current.busy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void store.saveUserCategory({
      ...(editing ? { id: editing.id } : {}),
      name,
      description,
      senders: senders.split(/[\s,;]+/).filter(Boolean),
      color,
    });
  };
  const remove = () => {
    if (editing && window.confirm(t("ucat.removeConfirm", { name: editing.name }))) void store.removeUserCategory(editing.id);
  };

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="ucat-title" data-testid="category-dialog" onCancel={(e) => { e.preventDefault(); if (!busy) store.closeCategoryDialog(); }}>
      <form onSubmit={submit}>
        <header className="dialog-header">
          <h2 id="ucat-title">{editing ? t("ucat.editTitle") : t("ucat.newTitle")}</h2>
          <button type="button" className="icon-button" aria-label={t("dialog.cancel")} onClick={() => store.closeCategoryDialog()} disabled={busy}>
            <X size={16} />
          </button>
        </header>
        <label>
          {t("ucat.name")}
          <input value={name} maxLength={40} placeholder={t("ucat.namePlaceholder")} autoFocus data-testid="ucat-name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t("ucat.description")}
          <textarea
            className="ucat-textarea"
            value={description}
            maxLength={300}
            rows={2}
            placeholder={t("ucat.descriptionPlaceholder")}
            data-testid="ucat-description"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <p className="hint">{t("ucat.descriptionHint")}</p>
        <label>
          {t("ucat.senders")}
          <input value={senders} placeholder={t("ucat.sendersPlaceholder")} data-testid="ucat-senders" onChange={(e) => setSenders(e.target.value)} />
        </label>
        <p className="hint">{t("ucat.sendersHint")}</p>
        <fieldset className="ucat-colors">
          <legend>{t("ucat.color")}</legend>
          {userCategoryColors.map((c) => (
            <label key={c} className={`ucat-color color-${c}`} title={c}>
              <input type="radio" name="ucat-color" value={c} checked={color === c} onChange={() => setColor(c)} aria-label={c} />
              <span className="account-dot" aria-hidden="true" />
            </label>
          ))}
        </fieldset>
        {current.error && <p className="dialog-error" role="alert">{current.error}</p>}
        <footer className="dialog-footer">
          {editing && (
            <button type="button" className="ucat-remove" data-testid="ucat-remove" onClick={remove} disabled={busy}>
              <Trash2 size={14} aria-hidden="true" /> {t("ucat.remove")}
            </button>
          )}
          <button type="button" onClick={() => store.closeCategoryDialog()} disabled={busy}>{t("dialog.cancel")}</button>
          <button type="submit" className="primary" disabled={busy || !name.trim()} data-testid="ucat-save">
            {t("ucat.save")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
