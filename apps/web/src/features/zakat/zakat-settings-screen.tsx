'use client';

import { messages } from '@/i18n';
import { useGuardedQuery, useRepositories, useSession } from '@/local-db';
import { ErrorState, LoadingState, OfflineNotice } from '@/shared/brand';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { ZakatSettingsForm } from './zakat-settings-form';
import { BackToZakat } from './zakat-ui';

const t = messages.zakat;

/**
 * The zakat methodology (/zakat/settings): the options the calculation follows, kept out of the
 * overview so that reviewing a calculation never sits next to changing the way it is made. The
 * notice says a change reaches future calculations only. A partner reads the settings; only the
 * owner changes them.
 */
export function ZakatSettingsScreen() {
  const repositories = useRepositories();
  const isOwner = useSession().user?.role === 'owner';
  const { result, retry } = useGuardedQuery(() => repositories.zakat.options(), [repositories]);
  return (
    <div className="@container mx-auto grid w-full max-w-3xl gap-5">
      <OfflineNotice />
      <BackToZakat />
      <header className="grid gap-1">
        <h2 className="font-heading text-xl font-semibold">{t.settings.title}</h2>
        <p className="max-w-prose text-muted-foreground">{t.settings.intro}</p>
      </header>
      <Alert>
        <AlertDescription>{t.settings.futureOnly}</AlertDescription>
      </Alert>
      {!isOwner && (
        <p role="note" className="text-sm text-muted-foreground">
          {t.settings.readOnly}
        </p>
      )}
      {result === undefined ? (
        <LoadingState rows={3} />
      ) : !result.ok ? (
        <ErrorState onRetry={retry} />
      ) : (
        <ZakatSettingsForm
          key={JSON.stringify(result.value)}
          options={result.value}
          canEdit={isOwner}
        />
      )}
    </div>
  );
}
