import { ChevronDown, FolderPlus, Plus, X } from "lucide-react";
import { displayName, type Message, type UserCategory } from "@stinkyma/core";
import { useEffect, useRef, useState } from "react";
import { useBrowserState, useUi } from "../context.js";

/** Eigene Kategorie als Etikett (Liste, Mail). */
export function UserCategoryChip({ category }: { category: UserCategory }) {
  return (
    <span className={`chip ucat-chip color-${category.color}`} data-testid="ucat-chip">
      <span className="account-dot" aria-hidden="true" />
      {category.name}
    </span>
  );
}

/** Eigene Kategorie der geöffneten Mail – zusätzlich zur festen Einordnung, von Hand änderbar und für den Absender merkbar. */
export function UserCategoryPicker({ message }: { message: Message }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const categories = state.userCategories?.categories ?? [];
  const current = categories.find((c) => c.id === message.userCategory) ?? null;
  const note = state.userCategoryNote?.messageId === message.id ? state.userCategoryNote : null;
  const sender = displayName(message.from);
  const pick = (id: string | null) => {
    setOpen(false);
    void store.assignUserCategory(message.id, id, remember);
  };

  return (
    <div className="category-picker" ref={box}>
      <button
        type="button"
        className={`chip chip-button ucat-chip ${current ? `color-${current.color}` : "category-none"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("ucat.pickerTitle")}
        data-testid="ucat-picker"
        onClick={() => setOpen(!open)}
      >
        {current ? <span className="account-dot" aria-hidden="true" /> : <FolderPlus size={12} aria-hidden="true" />}
        {current ? current.name : t("ucat.pickerNone")}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div className="category-menu" role="menu">
          {categories.map((c) => (
            <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === current?.id} className={`ucat-option color-${c.color}`} data-testid={`ucat-option-${c.name}`} onClick={() => pick(c.id)}>
              <span className="account-dot" aria-hidden="true" /> {c.name}
            </button>
          ))}
          {current && (
            <button type="button" role="menuitemradio" aria-checked={false} onClick={() => pick(null)}>
              <X size={13} aria-hidden="true" /> {t("ucat.clear")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              store.openCategoryDialog(null);
            }}
          >
            <Plus size={13} aria-hidden="true" /> {t("ucat.new")}
          </button>
          {categories.length > 0 && (
            <label className="checkbox small">
              <input type="checkbox" checked={remember} data-testid="ucat-remember" onChange={(e) => setRemember(e.target.checked)} />
              <span>{t("categoryPicker.remember", { sender })}</span>
            </label>
          )}
        </div>
      )}
      {note && (
        <span className="category-note small" role="status" data-testid="ucat-note">
          {note.remembered && note.categoryId
            ? note.changed > 0
              ? t("categoryPicker.learnedMore", { sender, count: note.changed })
              : t("categoryPicker.learned", { sender })
            : t("categoryPicker.saved")}
          <button type="button" className="icon-button" aria-label={t("summary.close")} onClick={() => store.closeUserCategoryNote()}>
            <X size={12} />
          </button>
        </span>
      )}
    </div>
  );
}
