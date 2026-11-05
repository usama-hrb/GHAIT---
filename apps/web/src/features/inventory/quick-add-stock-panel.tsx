'use client';

import { messages } from '@/i18n';
import { Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { RestockFields, type RestockForm } from './restock-form';

const t = messages.productStock.restock;

/**
 * Restocking from the product page, laid out like the till's bill: the fields in a scrolling body,
 * the purchase total and the one big button always in view at the bottom. It is the same purchase
 * as the product list's dialog (`useRestockForm`): a new batch of this product, with its own cost.
 * The screen owns the form, so a half-typed purchase survives the phone's sheet closing.
 */
export function QuickAddStockPanel({ form, className }: { form: RestockForm; className?: string }) {
  return (
    <section
      aria-label={t.title}
      className={cn(
        'flex min-h-0 flex-col rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm',
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-dashed border-border px-3 py-2.5">
        <h3 className="font-heading text-sm font-semibold tracking-tight">{t.title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto"
          disabled={form.saving}
          onClick={form.clear}
        >
          {t.clear}
        </Button>
      </header>
      <form
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
      >
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-3">
          <p className="text-sm text-muted-foreground">{t.hint}</p>
          <RestockFields form={form} showTotal={false} />
        </div>
        <footer className="grid gap-3 border-t border-dashed border-border bg-muted/10 p-3">
          <dl className="flex items-baseline justify-between gap-2">
            <dt className="text-sm text-muted-foreground">{t.total}</dt>
            <dd className="font-heading text-2xl font-semibold tabular-nums">
              {form.totalCents === null ? '—' : <Money cents={form.totalCents} />}
            </dd>
          </dl>
          <Button
            type="submit"
            variant="accent"
            size="lg"
            className="h-12 w-full text-base font-semibold shadow-sm pointer-coarse:h-12"
            disabled={form.saving}
          >
            {form.saving ? messages.forms.saving : t.save}
          </Button>
        </footer>
      </form>
    </section>
  );
}
