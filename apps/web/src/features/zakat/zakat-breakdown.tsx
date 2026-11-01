import type { ZakatBreakdown } from '@fabric/contracts';
import { messages } from '@/i18n';
import { Meters, Money } from '@/shared/format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.zakat;

/**
 * Every item of the zakat base with the records it comes from (BUILD_PROMPTS 5.1): each roll,
 * the money, what each customer owes (doubtful ones apart), what the shop owes them.
 */
export function ZakatBreakdownView({
  breakdown,
  baseCents,
  nisabCents,
  zakatDueCents,
}: {
  breakdown: ZakatBreakdown;
  baseCents: number;
  nisabCents: number;
  zakatDueCents: number;
}) {
  const lines = [
    [t.lines.goods, breakdown.goodsCents],
    [t.lines.cash, breakdown.cashCents],
    [t.lines.receivables, breakdown.receivablesCents],
    [t.lines.debts, 0 - breakdown.debtsDueCents],
  ] as const;
  return (
    <div className="grid gap-4">
      <dl className="grid gap-1 rounded-xl border bg-card p-4">
        {lines.map(([label, cents]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>
              <Money cents={cents} tone={cents < 0 ? 'loss' : undefined} />
            </dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-2 border-t pt-2 font-semibold">
          <dt>{t.lines.base}</dt>
          <dd>
            <Money cents={baseCents} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.lines.nisab}</dt>
          <dd>
            <Money cents={nisabCents} />
          </dd>
        </div>
        <div className="flex justify-between gap-2 text-lg font-semibold">
          <dt>{t.lines.due}</dt>
          <dd>
            <Money cents={zakatDueCents} />
          </dd>
        </div>
        <p className="text-sm text-muted-foreground">
          {!breakdown.hawlCompleted
            ? t.hawlNotCompleted
            : breakdown.reachesNisab
              ? t.reachesNisab
              : t.belowNisab}
        </p>
        {breakdown.doubtfulReceivablesCents > 0 && (
          <p className="text-sm text-muted-foreground">
            {t.doubtfulApart} <Money cents={breakdown.doubtfulReceivablesCents} />
          </p>
        )}
      </dl>

      <section aria-label={t.goodsTitle} className="grid gap-2">
        <h4 className="font-heading font-semibold">{t.goodsTitle}</h4>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.roll}</TableHead>
                <TableHead className="text-end">{t.columns.left}</TableHead>
                <TableHead className="text-end max-sm:hidden">{t.columns.refPrice}</TableHead>
                <TableHead className="text-end">{t.columns.value}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {breakdown.goods.map((item) => (
                <TableRow key={item.rollId}>
                  <TableCell>{item.label}</TableCell>
                  <TableCell className="text-end">
                    <Meters cm={item.remainingCm} />
                  </TableCell>
                  <TableCell className="text-end max-sm:hidden">
                    <Money cents={item.refPricePerMeterCents} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={item.valueCents} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {(
        [
          [t.receivablesTitle, breakdown.receivables],
          [t.debtsTitle, breakdown.debts.map((debt) => ({ ...debt, doubtful: false }))],
          [
            t.supplierDebtsTitle,
            breakdown.supplierDebts.map((debt) => ({
              customerId: debt.supplierId,
              name: debt.name,
              amountCents: debt.amountCents,
              doubtful: false,
            })),
          ],
        ] as const
      ).map(
        ([title, rows]) =>
          rows.length > 0 && (
            <section key={title} aria-label={title} className="grid gap-2">
              <h4 className="font-heading font-semibold">{title}</h4>
              <dl className="grid gap-1 rounded-lg border bg-card p-4">
                {rows.map((row) => (
                  <div
                    key={`${row.customerId}-${String(row.doubtful)}`}
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-muted-foreground">
                      {row.name}
                      {row.doubtful && ` (${t.doubtful})`}
                    </dt>
                    <dd>
                      <Money cents={row.amountCents} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ),
      )}
    </div>
  );
}
