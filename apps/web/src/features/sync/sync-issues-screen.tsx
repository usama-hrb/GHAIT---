'use client';

import { amountOfQuantity } from '@fabric/contracts';
import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState } from '@/shared/brand';
import { DateText, Quantity } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.syncIssues;
const entityName = (entity: string) => messages.settings.entities[entity] ?? entity;

/** A record's name for people, when it has one (fabric, customer…), else its short id. */
function labelOf(record: unknown, id: string): string {
  if (record && typeof record === 'object') {
    for (const key of ['name', 'colorName', 'shortCode'] as const) {
      const value = (record as Record<string, unknown>)[key];
      if (typeof value === 'string') return value;
    }
  }
  return id.slice(0, 8);
}

/**
 * What needs a look after syncing (BUILD_PROMPTS 3.6), read-only: changes the server refused,
 * conflicts it settled (last write wins, the loser kept), and batches sold beyond what they held.
 * A part of the Synchronization section of Settings (SyncSettingsScreen).
 */
export function SyncIssues() {
  const repositories = useRepositories();
  const data = useLiveQuery(async () => {
    const [rejected, conflicts, review] = await Promise.all([
      repositories.maintenance.rejected(),
      repositories.maintenance.conflicts(),
      repositories.maintenance.batchesToReview(),
    ]);
    return { rejected, conflicts, review };
  }, [repositories]);

  if (data === undefined) return <LoadingState />;
  const { rejected, conflicts, review } = data;

  return (
    <div className="grid gap-4">
      <section aria-label={t.reviewTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.reviewTitle}</h3>
        <p className="text-sm text-muted-foreground">{t.reviewDescription}</p>
        {review.length === 0 ? (
          <p className="text-muted-foreground">{t.noReview}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.batch}</TableHead>
                  <TableHead>{t.columns.item}</TableHead>
                  <TableHead className="text-end">{t.columns.remaining}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.map(({ batch, product, ledger }) => (
                  <TableRow key={batch.id}>
                    <TableCell>
                      <Link
                        href={`/inventory/product?id=${batch.productId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        <bdi dir="ltr" data-num>
                          {batch.code}
                        </bdi>
                      </Link>
                    </TableCell>
                    <TableCell label={t.columns.item}>{product?.name}</TableCell>
                    <TableCell className="text-end" label={t.columns.remaining}>
                      <Quantity
                        unit={ledger.remaining.unit}
                        amount={amountOfQuantity(ledger.remaining)}
                      />
                      <Badge variant="warning" className="ms-1.5">
                        {t.oversold}:{' '}
                        <Quantity
                          unit={ledger.oversold.unit}
                          amount={amountOfQuantity(ledger.oversold)}
                        />
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-label={t.rejectedTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.rejectedTitle}</h3>
        <p className="text-sm text-muted-foreground">{t.rejectedDescription}</p>
        {rejected.length === 0 ? (
          <p className="text-muted-foreground">{t.noRejected}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.when}</TableHead>
                  <TableHead>{t.columns.entity}</TableHead>
                  <TableHead>{t.columns.error}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rejected.map((entry) => (
                  <TableRow key={entry.opId}>
                    <TableCell>
                      <DateText value={entry.clientTs} format="dateTime" />
                    </TableCell>
                    <TableCell label={t.columns.entity}>{entityName(entry.entity)}</TableCell>
                    <TableCell label={t.columns.error}>
                      {(entry.error && t.errors[entry.error.code]) ?? messages.forms.invalid}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-label={t.conflictsTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.conflictsTitle}</h3>
        <p className="text-sm text-muted-foreground">{t.conflictsDescription}</p>
        {conflicts.length === 0 ? (
          <p className="text-muted-foreground">{t.noConflicts}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.when}</TableHead>
                  <TableHead>{t.columns.entity}</TableHead>
                  <TableHead>{t.columns.record}</TableHead>
                  <TableHead>{t.lost}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conflicts.map((conflict) => (
                  <TableRow key={conflict.id}>
                    <TableCell>
                      <DateText value={conflict.createdAt} format="dateTime" />
                    </TableCell>
                    <TableCell label={t.columns.entity}>{entityName(conflict.entity)}</TableCell>
                    <TableCell label={t.columns.record}>
                      {labelOf(conflict.winnerRecord, conflict.entityId)}
                      <span className="block text-xs text-muted-foreground">
                        {t.winner[conflict.winner]}
                      </span>
                    </TableCell>
                    <TableCell label={t.lost}>
                      {labelOf(conflict.loser, conflict.entityId)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
