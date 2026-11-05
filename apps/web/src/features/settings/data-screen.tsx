'use client';

import { EXPORT_ENTITIES, settingAuditValue } from '@fabric/contracts';
import { DownloadIcon, ShieldCheckIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useRepositories } from '@/local-db';
import { download, toCsv } from '@/shared/lib/csv';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

type ExportEntity = (typeof EXPORT_ENTITIES)[number];
/** The tables offered as CSV: a picture is not a spreadsheet's business. */
const CSV_ENTITIES = EXPORT_ENTITIES.filter((entity) => entity !== 'photo');

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * Data (SPEC §14.7, ADR 0017): a full copy of the shop as it is on this device, and one table at
 * a time for a spreadsheet. Both read this device's own database, so they work offline. They only
 * read: nothing here imports, resets or deletes anything.
 */
export function DataScreen() {
  const t = messages.settings;
  const d = t.data;
  const id = useId();
  const repositories = useRepositories();
  const [table, setTable] = useState<ExportEntity>('sale');
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);

  const run = async (kind: 'json' | 'csv', job: () => Promise<void>) => {
    setBusy(kind);
    try {
      await job();
      toast.success(d.done);
    } catch {
      toast.error(d.failed);
    } finally {
      setBusy(null);
    }
  };

  const exportJson = () =>
    run('json', async () => {
      const data = await repositories.maintenance.exportData();
      download(`fabric-shop-${stamp()}.json`, JSON.stringify(data), 'application/json');
    });

  const exportCsv = () =>
    run('csv', async () => {
      const data = await repositories.maintenance.exportData();
      const rows = data.records[table] as Record<string, unknown>[];
      // The logo's picture stays out of a spreadsheet cell, as it stays out of the audit log.
      const flat =
        table === 'setting'
          ? rows.map((row) => ({
              ...row,
              value: settingAuditValue(String(row.key), row.value),
            }))
          : rows;
      download(`${table}-${stamp()}.csv`, toCsv(flat), 'text/csv;charset=utf-8');
    });

  return (
    <div className="grid gap-4">
      <header className="grid gap-0.5">
        <h2 className="font-heading text-xl font-semibold">{t.sections.data.title}</h2>
        <p className="text-sm text-muted-foreground">{d.description}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{d.json.title}</CardTitle>
          <CardDescription>{d.json.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid list-disc gap-1 ps-5 text-sm text-muted-foreground">
            {Object.values(d.json.includes).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant="accent"
            className="justify-self-start"
            disabled={busy !== null}
            onClick={() => void exportJson()}
          >
            <DownloadIcon aria-hidden />
            {busy === 'json' ? d.preparing : d.json.button}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{d.csv.title}</CardTitle>
          <CardDescription>{d.csv.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid list-disc gap-1 ps-5 text-sm text-muted-foreground">
            {Object.values(d.csv.includes).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-auto min-w-56">
              <FieldLabel htmlFor={`${id}-table`}>{d.csv.table}</FieldLabel>
              <Select
                value={table}
                onValueChange={(value) => {
                  setTable(value as ExportEntity);
                }}
              >
                <SelectTrigger id={`${id}-table`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CSV_ENTITIES.map((entity) => (
                    <SelectItem key={entity} value={entity}>
                      {t.entities[entity]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void exportCsv()}
            >
              <DownloadIcon aria-hidden />
              {busy === 'csv' ? d.preparing : d.csv.button}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert role="note">
        <ShieldCheckIcon aria-hidden />
        <AlertDescription>{d.safe}</AlertDescription>
      </Alert>
    </div>
  );
}
