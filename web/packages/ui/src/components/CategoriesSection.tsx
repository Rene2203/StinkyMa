import { ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import { ruleCategories, scopeKey, type MessageScope } from "@stinkyma/core";
import { useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import { categoryIcon } from "../icons.js";
import type { MessageKey } from "../i18n.js";

const storageKey = "stinkymail.categoriesOpen";

function initiallyOpen(): boolean {
  try {
    return localStorage.getItem(storageKey) !== "0";
  } catch {
    return true;
  }
}

/** Seitenleiste „Kategorien“: eigene Kategorien und die feste Einordnung als Filter über alle Konten. */
export function CategoriesSection() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const [open, setOpen] = useState(initiallyOpen);
  const view = state.userCategories;
  if (!view) return null;
  const selectedKey = state.panel === "mail" ? scopeKey(state.selectedScope) : "";
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(storageKey, open ? "0" : "1");
    } catch {
      // ohne Speicher: nur für diese Sitzung
    }
  };
  const item = (scope: MessageScope, label: string, icon: React.ReactNode, testId: string, extra?: React.ReactNode) => {
    const key = scopeKey(scope);
    const unread = scope.kind === "category" ? (view.unread[scope.category] ?? 0) : 0;
    return (
      <li key={key} className="ucat-item">
        <button
          type="button"
          className={`sidebar-item${key === selectedKey ? " selected" : ""}`}
          aria-current={key === selectedKey ? "page" : undefined}
          data-testid={testId}
          onClick={() => void store.selectScope(scope)}
        >
          {icon}
          <span className="sidebar-label">{label}</span>
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        {extra}
      </li>
    );
  };

  return (
    <section className="sidebar-section sidebar-subsection" aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="sidebar-heading">
        <button type="button" className="sidebar-heading-toggle" aria-expanded={open} data-testid="categories-toggle" onClick={toggle}>
          {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          <span className="sidebar-heading-label">{t("ucat.section")}</span>
        </button>
        <button type="button" className="icon-button heading-action" title={t("ucat.new")} aria-label={t("ucat.new")} data-testid="ucat-new" onClick={() => store.openCategoryDialog(null)}>
          <Plus size={13} />
        </button>
      </h2>
      {open && (
        <ul role="list">
          {view.categories.map((c) =>
            item(
              { kind: "category", category: `u:${c.id}` },
              c.name,
              <span className={`ucat-dot color-${c.color}`} aria-hidden="true"><span className="account-dot" /></span>,
              `sidebar-ucat-${c.name}`,
              <button type="button" className="icon-button ucat-edit" title={t("ucat.edit", { name: c.name })} aria-label={t("ucat.edit", { name: c.name })} onClick={() => store.openCategoryDialog(c)}>
                <Pencil size={12} />
              </button>,
            ),
          )}
          {view.categories.length === 0 && (
            <li>
              <button type="button" className="sidebar-item ucat-add" onClick={() => store.openCategoryDialog(null)}>
                <Plus className="sidebar-icon" size={16} aria-hidden="true" />
                <span className="sidebar-label muted">{t("ucat.addFirst")}</span>
              </button>
            </li>
          )}
          {state.ai?.settings.enabled &&
            ruleCategories.map((category) => {
              const Icon = categoryIcon[category];
              return item(
                { kind: "category", category },
                t(`category.${category}` as MessageKey),
                <Icon className={`sidebar-icon category-icon-${category}`} size={18} strokeWidth={1.75} aria-hidden="true" />,
                `sidebar-category-${category}`,
              );
            })}
        </ul>
      )}
      {open && view.checking && (
        <p className="muted small ucat-checking" data-testid="ucat-checking">{t("ucat.checking", { done: view.checking.done, total: view.checking.total })}</p>
      )}
    </section>
  );
}
