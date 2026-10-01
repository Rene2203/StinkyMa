import { ChevronDown, Tag, X } from "lucide-react";
import { displayName, ruleCategories, type Message, type MessageCategory } from "@stinkyma/core";
import { useEffect, useRef, useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import { categoryIcon } from "../icons.js";
import type { MessageKey } from "../i18n.js";

/**
 * Einordnung der geöffneten Mail – anklickbar zum Korrigieren. Standard: für diesen Absender merken; künftige Mails
 * bekommen die Einordnung dann ohne Modell, und andere KI-Einordnungen des Absenders werden gleich mit korrigiert.
 */
export function CategoryPicker({ message }: { message: Message }) {
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

  const current = message.category ?? null;
  const Icon = current ? categoryIcon[current] : Tag;
  const pick = (category: MessageCategory | null) => {
    setOpen(false);
    void store.setMessageCategory(message.id, category, remember);
  };
  const note = state.categoryNote?.messageId === message.id ? state.categoryNote : null;
  const sender = displayName(message.from);

  return (
    <div className="category-picker" ref={box}>
      <button
        type="button"
        className={`chip chip-button ${current ? `category-${current}` : "category-none"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("categoryPicker.title")}
        data-testid="category-picker"
        onClick={() => setOpen(!open)}
      >
        <Icon size={12} strokeWidth={2} aria-hidden="true" />
        {current ? t(`category.${current}` as MessageKey) : t("categoryPicker.none")}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div className="category-menu" role="menu">
          {ruleCategories.map((category) => {
            const ItemIcon = categoryIcon[category];
            return (
              <button key={category} type="button" role="menuitemradio" aria-checked={category === current} className={`category-${category}`} data-testid={`category-option-${category}`} onClick={() => pick(category)}>
                <ItemIcon size={13} aria-hidden="true" /> {t(`category.${category}` as MessageKey)}
              </button>
            );
          })}
          <button type="button" role="menuitemradio" aria-checked={current === null} onClick={() => pick(null)}>
            <X size={13} aria-hidden="true" /> {t("categoryPicker.clear")}
          </button>
          <label className="checkbox small">
            <input type="checkbox" checked={remember} data-testid="category-remember" onChange={(e) => setRemember(e.target.checked)} />
            <span>{t("categoryPicker.remember", { sender })}</span>
          </label>
        </div>
      )}
      {note && (
        <span className="category-note small" role="status" data-testid="category-note">
          {note.remembered && note.category
            ? note.changed > 1
              ? t("categoryPicker.learnedMore", { sender, count: note.changed })
              : note.changed === 1
                ? t("categoryPicker.learnedOne", { sender })
              : t("categoryPicker.learned", { sender })
            : t("categoryPicker.saved")}
          <button type="button" className="icon-button" aria-label={t("summary.close")} onClick={() => store.closeCategoryNote()}>
            <X size={12} />
          </button>
        </span>
      )}
    </div>
  );
}
