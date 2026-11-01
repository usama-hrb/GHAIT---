'use client';

import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Meters } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
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
 * conflicts it settled (last write wins, the loser kept), and rolls sold beyond their length.
 */
export function SyncIssuesScreen() {
  const repositories = useRepositories();
  const data = useLiveQuery(async () => {
    const [rejected, conflicts, review] = await Promise.all([
      repositories.maintenance.rejected(),
      repositories.maintenance.conflicts(),
      repositories.maintenance.rollsToReview(),
    ]);
    return { rejected, conflicts, review };
  }, [repositories]);

  if (data === undefined) return <LoadingState />;
  const { rejected, conflicts, review } = data;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/settings">{t.back}</Link>
      </Button>
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>

      <section aria-label={t.reviewTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.reviewTitle}</h3>
        <p className="text-sm text-muted-foreground">{t.reviewDescription}</p>
        {review.length === 0 ? (
          <p className="text-muted-foreground">{t.noReview}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.roll}</TableHead>
                  <TableHead>{t.columns.item}</TableHead>
                  <TableHead className="text-end">{t.columns.remaining}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.map(({ roll, fabric, variant, ledger }) => (
                  <TableRow key={roll.id}>
                    <TableCell>
                      <Link
                        href={`/inventory/roll?id=${roll.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        <bdi dir="ltr" data-num>
                          {roll.shortCode}
                        </bdi>
                      </Link>
                    </TableCell>
                    <TableCell>
                      {fabric?.name} · {variant?.colorName}
                    </TableCell>
                    <TableCell className="text-end">
                      <Meters cm={ledger.remainingCm} />
                      {ledger.oversoldCm > 0 && (
                        <Badge variant="warning" className="ms-1.5">
                          {t.oversold}: <Meters cm={ledger.oversoldCm} />
                        </Badge>
                      )}
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
            <Table>
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
                    <TableCell>{entityName(entry.entity)}</TableCell>
                    <TableCell>
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
            <Table>
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
                    <TableCell>{entityName(conflict.entity)}</TableCell>
                    <TableCell>
                      {labelOf(conflict.winnerRecord, conflict.entityId)}
                      <span className="block text-xs text-muted-foreground">
                        {t.winner[conflict.winner]}
                      </span>
                    </TableCell>
                    <TableCell>{labelOf(conflict.loser, conflict.entityId)}</TableCell>
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
