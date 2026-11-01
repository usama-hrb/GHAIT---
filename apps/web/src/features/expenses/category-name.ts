import { SETTINGS } from '@fabric/contracts';
import { messages } from '@/i18n';

/** The label each shipped category has in the settings until the owner changes it. */
const SHIPPED_LABELS = new Map<string, string>(
  SETTINGS.expense_categories.default.map((category) => [category.key, category.label]),
);

/**
 * A category's name on screen. The shipped categories are stored with Arabic labels, so they are
 * shown by key in the language shown; one the owner renamed or added keeps the name they gave.
 */
export function categoryName(category: { key: string; label: string }): string {
  const names: Readonly<Record<string, string>> = messages.expenses.categoryNames;
  return SHIPPED_LABELS.get(category.key) === category.label
    ? (names[category.key] ?? category.label)
    : category.label;
}
