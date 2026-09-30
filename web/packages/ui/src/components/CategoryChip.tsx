import type { MessageCategory } from "@stinkyma/core";
import { useUi } from "../context.js";
import { categoryIcon } from "../icons.js";

export function CategoryChip({ category }: { category: MessageCategory }) {
  const { t } = useUi();
  const Icon = categoryIcon[category];
  return (
    <span className={`chip category-${category}`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {t(`category.${category}`)}
    </span>
  );
}
