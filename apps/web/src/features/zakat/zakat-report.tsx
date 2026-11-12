'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useGuardedQuery, useRepositories, useSession } from '@/local-db';
import { EmptyState, ErrorState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { useMoneyUnit } from '@/shared/format';
import { whatsAppLink } from '@/shared/lib/whatsapp';
import { Button } from '@/shared/ui/button';
import { ZakatReportBody } from './report-body';
import { ZakatPayDialog } from './zakat-pay-dialog';
import { zakatShareText } from './zakat-share';
import { BackToZakat } from './zakat-ui';

const t = messages.zakat;

/**
 * One saved zakat report (/zakat/view?id=…): the report as it was saved, what was paid on it, and,
 * for the owner, recording a payment and voiding it while nothing is paid. A report that is not on
 * this device says so and points back to the overview.
 */
export function ZakatReportScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const isOwner = useSession().user?.role === 'owner';
  const { unit } = useMoneyUnit();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const { result, retry } = useGuardedQuery(
    async () => (await repositories.zakat.report(id)) ?? null,
    [repositories, id],
  );
  const view = result?.ok ? result.value : null;

  return (
    <div className="@container mx-auto grid w-full max-w-3xl gap-5">
      <OfflineNotice />
      <BackToZakat />
      {result === undefined ? (
        <LoadingState rows={3} />
      ) : !result.ok ? (
        <ErrorState onRetry={retry} />
      ) : view === null ? (
        <EmptyState
          title={t.notFound}
          action={
            <Button asChild variant="outline">
              <Link href="/zakat">{t.actions.back}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ZakatReportBody
            view={view}
            isOwner={isOwner}
            shareHref={whatsAppLink(
              zakatShareText({ report: view.report, paidCents: view.paidCents, unit }),
              null,
            )}
            onPay={() => {
              setPaying(true);
            }}
            onVoid={() => {
              setVoiding(true);
            }}
          />
          <ZakatPayDialog
            key={paying ? 'open' : 'closed'}
            report={{
              id: view.report.id,
              hawlDate: view.report.hawlDate,
              zakatDueCents: view.report.zakatDueCents,
              paidCents: view.paidCents,
            }}
            open={paying}
            onOpenChange={setPaying}
          />
          <VoidDialog
            open={voiding}
            onOpenChange={setVoiding}
            title={t.voidTitle}
            description={t.voidDescription}
            onConfirm={async (reason) => {
              await repositories.zakat.void(view.report.id, reason);
              setVoiding(false);
              toast.success(t.voided, { description: messages.forms.saved });
            }}
          />
        </>
      )}
    </div>
  );
}
