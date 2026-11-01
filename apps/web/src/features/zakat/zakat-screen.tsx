'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { isPeriodLocked, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { ZakatBreakdownView } from './zakat-breakdown';
import { ZakatSettingsForm } from './zakat-settings';

const t = messages.zakat;

/**
 * Zakat (SPEC §10, BUILD_PROMPTS 5.1): the settings, the hawl in Hijri, the base for the latest
 * hawl with every item and the result against the nisab, saving it as a report, and the
 * archive. A calculation tool, not a fatwa: the note says so.
 */
export function ZakatScreen() {
  const repositories = useRepositories();
  const data = useLiveQuery(async () => {
    const [options, hawl, preview, history] = await Promise.all([
      repositories.zakat.options(),
      repositories.zakat.hawl(),
      repositories.zakat.preview(),
      repositories.zakat.history(),
    ]);
    return { options, hawl, preview, history };
  }, [repositories]);

  if (data === undefined) return <LoadingState />;
  const { hawl, preview } = data;
  const savedForHawl = preview.ok
    ? data.history.some(
        (report) => report.hawlDate === preview.hawlDate && report.voidedAt === null,
      )
    : false;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <OfflineNotice />
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
      <Alert>
        <AlertDescription>{t.notFatwa}</AlertDescription>
      </Alert>

      <section aria-label={t.settingsTitle} className="grid gap-3 rounded-xl border bg-card p-4">
        <h3 className="font-heading font-semibold">{t.settingsTitle}</h3>
        <ZakatSettingsForm key={JSON.stringify(data.options)} options={data.options} />
      </section>

      {hawl.start !== null && (
        <section aria-label={t.hawlTitle} className="grid gap-1 rounded-xl border bg-card p-4">
          <h3 className="font-heading font-semibold">{t.hawlTitle}</h3>
          {hawl.last && (
            <p>
              {t.lastHawl} <DateText value={hawl.last} /> (
              <DateText value={hawl.last} format="hijri" />)
            </p>
          )}
          {hawl.next && (
            <p>
              {t.nextHawl} <DateText value={hawl.next} /> (
              <DateText value={hawl.next} format="hijri" />) · {t.inDays(hawl.daysToNext ?? 0)}
            </p>
          )}
        </section>
      )}

      <section aria-label={t.reportTitle} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading font-semibold">{t.reportTitle}</h3>
          {preview.ok && (
            <Button
              variant="accent"
              disabled={!preview.fields.breakdown.hawlCompleted || savedForHawl}
              onClick={() => {
                repositories.zakat
                  .save()
                  .then(() => toast.success(t.saved, { description: messages.forms.saved }))
                  .catch((error: unknown) => {
                    const message =
                      error instanceof ValidationError ? error.issues[0]?.message : undefined;
                    toast.error(
                      isPeriodLocked(error)
                        ? messages.forms.periodLocked
                        : ((message && t.issues[message]) ?? messages.forms.invalid),
                    );
                  });
              }}
            >
              {t.save}
            </Button>
          )}
        </div>
        {preview.ok ? (
          <>
            <p className="text-sm text-muted-foreground">
              {preview.fields.breakdown.hawlCompleted ? t.forHawl : t.positionToday}{' '}
              <DateText value={preview.hawlDate} /> · {savedForHawl ? t.alreadySaved : t.fromDevice}
            </p>
            <ZakatBreakdownView
              breakdown={preview.fields.breakdown}
              baseCents={preview.fields.baseCents}
              nisabCents={preview.fields.nisabCents}
              zakatDueCents={preview.fields.zakatDueCents}
            />
          </>
        ) : (
          <Alert>
            <AlertDescription>
              {preview.issues.map((issue) => t.issues[issue.message] ?? messages.forms.invalid)}
            </AlertDescription>
          </Alert>
        )}
      </section>

      <section aria-label={t.archiveTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.archiveTitle}</h3>
        {data.history.length === 0 ? (
          <p className="text-muted-foreground">{t.noReports}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.hawl}</TableHead>
                  <TableHead className="text-end">{t.columns.due}</TableHead>
                  <TableHead className="text-end">{t.columns.paid}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.view}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((report) => (
                  <TableRow
                    key={report.id}
                    className={report.voidedAt ? 'text-muted-foreground line-through' : undefined}
                  >
                    <TableCell>
                      <DateText value={report.hawlDate} format="hijri" />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={report.zakatDueCents} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={report.paidCents} />
                      {report.voidedAt === null && report.paidCents >= report.zakatDueCents && (
                        <Badge variant="success" className="ms-2">
                          {t.fullyPaid}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button asChild size="sm" variant="link">
                        <Link href={`/zakat/view?id=${report.id}`}>{t.view}</Link>
                      </Button>
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
