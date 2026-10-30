'use client';

import { Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Button } from '@/shared/ui/button';
import { FabricForm } from './fabric-form';
import { VariantsEditor } from './variants-editor';
import { VoidDialog } from './void-dialog';

const t = messages.catalog;

/**
 * New fabric (no `id`) or an existing one: details, then its colours. The id is a query
 * parameter, not a path segment, so one cached page serves every fabric offline.
 */
export function FabricEditorScreen() {
  const id = useSearchParams().get('id');
  const navigation = useAppNavigation();
  const repositories = useRepositories();
  const [voiding, setVoiding] = useState(false);
  // undefined: loading; null: no such fabric on this device.
  const fabric = useLiveQuery(
    async () => (id ? ((await repositories.fabrics.get(id)) ?? null) : null),
    [repositories, id],
  );

  if (id && fabric === undefined) return <LoadingState />;
  if (id && (fabric === null || fabric?.voidedAt)) {
    return (
      <EmptyState
        title={t.fabricNotFound}
        action={
          <Button asChild variant="outline">
            <Link href="/inventory">{t.backToFabrics}</Link>
          </Button>
        }
      />
    );
  }
  const current = fabric ?? undefined;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <OfflineNotice />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="link" className="px-0">
          <Link href="/inventory">{t.backToFabrics}</Link>
        </Button>
      </div>
      <h2 className="font-heading text-xl font-semibold">{current ? current.name : t.newFabric}</h2>

      <FabricForm
        // A fresh form when switching between fabrics (or once a new one is saved).
        key={current?.id ?? 'new'}
        fabric={current}
        onSaved={(savedId) => {
          toast.success(t.fabricSaved, { description: messages.forms.saved });
          if (!current) navigation.replace(`/inventory/fabric?id=${savedId}`);
        }}
      />

      {current ? (
        <>
          <VariantsEditor fabricId={current.id} />
          <div>
            <Button
              variant="destructive"
              onClick={() => {
                setVoiding(true);
              }}
            >
              <Trash2Icon data-icon="inline-start" aria-hidden />
              {t.voidFabric}
            </Button>
          </div>
          <VoidDialog
            open={voiding}
            onOpenChange={setVoiding}
            title={`${t.voidFabric}: ${current.name}`}
            description={t.voidFabricDescription}
            onConfirm={async (reason) => {
              await repositories.fabrics.void(current.id, reason);
              toast.success(t.fabricVoided);
              navigation.push('/inventory');
            }}
          />
        </>
      ) : (
        <p className="text-muted-foreground">{t.saveFabricFirst}</p>
      )}
    </div>
  );
}
