'use client';

import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';

const t = messages.home;

/** The home screen's card: what the shop owes its suppliers, with the way to the list. */
export function PayablesSummary() {
  const repositories = useRepositories();
  const payables = useLiveQuery(() => repositories.supplierAccounts.payables(), [repositories]);
  if (payables === undefined) return null;
  const owing = payables.filter(({ account }) => account.owedCents > 0);
  return (
    <section
      aria-label={t.payables}
      className="grid content-start gap-2 rounded-xl border bg-card p-4"
    >
      <h3 className="font-heading font-semibold">{t.payables}</h3>
      {owing.length === 0 ? (
        <p className="text-muted-foreground">{t.noPayables}</p>
      ) : (
        <ul className="grid gap-1">
          {owing.slice(0, 8).map(({ supplier, account }) => (
            <li key={supplier.id} className="flex justify-between gap-2">
              <Link
                href={`/payables/view?id=${supplier.id}`}
                className="underline-offset-4 hover:underline"
              >
                {supplier.name}
              </Link>
              <Money cents={account.owedCents} tone="debt" />
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/payables">{t.seeAll}</Link>
      </Button>
    </section>
  );
}
