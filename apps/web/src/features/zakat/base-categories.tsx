import type {
  BaseCategory,
  BaseCategoryKey,
  BaseEffect,
  ZakatBreakdown,
  ZakatReviewItem,
} from '@fabric/contracts';
import { ChevronDownIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { ReviewItemList } from './review-items';
import { itemsForCategory } from './zakat-model';

const t = messages.zakat;

/** The records behind a category: a name and an amount each, as the breakdown holds them. */
interface RecordRow {
  id: string;
  name: string;
  cents: number;
}

function recordsOf(key: BaseCategoryKey, breakdown: ZakatBreakdown): RecordRow[] | null {
  switch (key) {
    case 'inventory':
      return breakdown.goods.map((line) => ({
        id: line.rollId,
        name: line.label,
        cents: line.valueCents,
      }));
    case 'receivables':
    case 'doubtful_receivables':
      return breakdown.receivables
        .filter((receivable) => receivable.doubtful === (key === 'doubtful_receivables'))
        .map((receivable) => ({
          id: receivable.customerId,
          name: receivable.name,
          cents: receivable.amountCents,
        }));
    case 'customer_credits':
      return breakdown.debts.map((debt) => ({
        id: debt.customerId,
        name: debt.name,
        cents: debt.amountCents,
      }));
    case 'supplier_debts':
      return breakdown.supplierDebts.map((debt) => ({
        id: debt.supplierId,
        name: debt.name,
        cents: debt.amountCents,
      }));
    // The money is one figure from the records of cash and bank, and the bills not paid are only a
    // total: neither has records of its own to open.
    case 'money':
    case 'unpaid_bills':
    case 'other_assets':
      return null;
  }
}

/** What to say under a category beyond where its figure comes from: how a setting treats it. */
function noteOf(category: BaseCategory): string | null {
  const notes = t.baseStep.notes;
  switch (category.key) {
    case 'doubtful_receivables':
      return category.effect === 'added' ? notes.doubtfulCounted : notes.doubtfulLeftOut;
    case 'unpaid_bills':
      return category.cents === null ? notes.notKept : notes.unpaidBills;
    case 'other_assets':
      return notes.otherAssets;
    case 'money':
      return notes.singleFigure;
    default:
      return null;
  }
}

/** Counted in the base (added or deducted) or left out of it; the word is the signal, not the shade. */
const EFFECT_VARIANT: Record<BaseEffect, 'secondary' | 'outline'> = {
  added: 'secondary',
  deducted: 'secondary',
  excluded: 'outline',
  not_tracked: 'outline',
};

function Amount({ category }: { category: BaseCategory }): ReactNode {
  if (category.cents === null) return null;
  return (
    <span className={cn('font-medium', category.effect === 'excluded' && 'text-muted-foreground')}>
      {category.effect === 'deducted' && <span aria-hidden>−</span>}
      <Money cents={category.cents} />
    </span>
  );
}

function CategoryRow({
  category,
  breakdown,
  items,
}: {
  category: BaseCategory;
  breakdown: ZakatBreakdown;
  items: readonly ZakatReviewItem[];
}) {
  const copy = t.baseStep.categories[category.key];
  const flagged = itemsForCategory(items, category.key);
  const needsLook = flagged.some((item) => item.severity !== 'info');
  const records = recordsOf(category.key, breakdown);
  const note = noteOf(category);
  // Where the figure comes from and how a setting treats it are always shown: they are what makes
  // a figure checkable. Only the records behind it, and what needs a look, open and close.
  const explanation = (
    <div className="grid gap-1 px-3 pb-3 text-sm">
      <p className="text-muted-foreground">{copy.source}</p>
      {note !== null && <p>{note}</p>}
    </div>
  );
  const summary = (
    <>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="font-medium">{copy.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Badge variant={EFFECT_VARIANT[category.effect]}>
            {t.baseStep.effects[category.effect]}
          </Badge>
          {category.count !== null && category.count > 0 && <span data-num>{category.count}</span>}
          {needsLook && (
            <span className="flex items-center gap-1 text-foreground">
              <TriangleAlertIcon className="size-3.5 text-warning" aria-hidden />
              {t.severity.review}
            </span>
          )}
        </span>
      </span>
      <Amount category={category} />
    </>
  );
  if (records === null && flagged.length === 0) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-3 p-3 pb-2">{summary}</div>
        {explanation}
      </div>
    );
  }
  return (
    <Collapsible defaultOpen={flagged.length > 0} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="group/row flex w-full items-center gap-3 rounded-lg p-3 pb-2 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/row:rotate-180"
          aria-hidden
        />
        {summary}
      </CollapsibleTrigger>
      {explanation}
      <CollapsibleContent className="grid gap-3 border-t p-3">
        <ReviewItemList items={flagged} />
        {records !== null &&
          (records.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.baseStep.noRecords}</p>
          ) : (
            <dl className="grid gap-1.5 text-sm">
              {records.map((record) => (
                <div key={record.id} className="flex items-baseline justify-between gap-3">
                  <dt className="min-w-0 break-words text-muted-foreground">{record.name}</dt>
                  <dd className="shrink-0">
                    <Money cents={record.cents} />
                  </dd>
                </div>
              ))}
            </dl>
          ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The zakat base category by category: for each, whether it is added to the base, taken off it, left
 * out by a setting or a rule, or not recorded by the app at all; where its figure comes from; what
 * needs a look; and, opened, the records behind it. The categories and their figures come from
 * `zakatBaseCategoriesOf`; the base at the foot is the one the calculation worked out.
 */
export function BaseCategories({
  categories,
  breakdown,
  items,
  baseCents,
}: {
  categories: readonly BaseCategory[];
  breakdown: ZakatBreakdown;
  items: readonly ZakatReviewItem[];
  baseCents: number;
}) {
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {categories.map((category) => (
          <li key={category.key}>
            <CategoryRow category={category} breakdown={breakdown} items={items} />
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
        <span className="font-medium">{t.baseStep.total}</span>
        <span className="font-heading text-lg font-semibold">
          <Money cents={baseCents} />
        </span>
      </div>
    </div>
  );
}
