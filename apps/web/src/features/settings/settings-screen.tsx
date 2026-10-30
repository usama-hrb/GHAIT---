'use client';

import { EXPORT_ENTITIES } from '@fabric/contracts';
import { DownloadIcon } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { useMoneyUnit } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { download, toCsv } from './csv';

const t = messages.settings;

/** Settings (SPEC §14.7): display, the sync issues, and a full export of the shop's data. */
export function SettingsScreen() {
  const id = useId();
  const repositories = useRepositories();
  const { unit } = useMoneyUnit();
  const [table, setTable] = useState<string>('sale');
  const issues = useLiveQuery(async () => {
    const [rejected, review] = await Promise.all([
      repositories.maintenance.rejected(),
      repositories.maintenance.rollsToReview(),
    ]);
    return rejected.length + review.length;
  }, [repositories]);

  if (issues === undefined) return <LoadingState />;
  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportJson = async () => {
    const data = await repositories.maintenance.exportData();
    download(`fabric-shop-${stamp()}.json`, JSON.stringify(data), 'application/json');
    toast.success(t.export.done);
  };
  const exportCsv = async () => {
    const data = await repositories.maintenance.exportData();
    const rows = data.records[table as (typeof EXPORT_ENTITIES)[number]] as Record<
      string,
      unknown
    >[];
    download(`${table}-${stamp()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
    toast.success(t.export.done);
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>

      <section aria-label={t.display} className="grid gap-2 rounded-xl border bg-card p-4">
        <h3 className="font-heading font-semibold">{t.display}</h3>
        <p>
          {messages.money.unitLabel}:{' '}
          <span className="font-medium">
            {unit === 'rial' ? messages.units.rial : messages.units.dirhamFull}
          </span>
        </p>
      </section>

      <section aria-label={t.syncIssues} className="grid gap-2 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading font-semibold">{t.syncIssues}</h3>
          {issues > 0 && <Badge variant="warning">{issues}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{t.syncIssuesDescription}</p>
        <Button asChild variant="outline" className="justify-self-start">
          <Link href="/settings/sync">{t.syncIssues}</Link>
        </Button>
      </section>

      <section aria-label={t.export.title} className="grid gap-3 rounded-xl border bg-card p-4">
        <h3 className="font-heading font-semibold">{t.export.title}</h3>
        <p className="text-sm text-muted-foreground">{t.export.description}</p>
        <Button variant="accent" className="justify-self-start" onClick={() => void exportJson()}>
          <DownloadIcon aria-hidden />
          {t.export.json}
        </Button>
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-auto min-w-48">
            <FieldLabel htmlFor={`${id}-table`}>{t.export.table}</FieldLabel>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger id={`${id}-table`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPORT_ENTITIES.map((entity) => (
                  <SelectItem key={entity} value={entity}>
                    {t.entities[entity]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button variant="outline" onClick={() => void exportCsv()}>
            <DownloadIcon aria-hidden />
            {t.export.csv}
          </Button>
        </div>
      </section>
    </div>
  );
}
