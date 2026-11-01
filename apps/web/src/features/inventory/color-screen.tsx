'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { messages } from '@/i18n';
import { useCanSeeCosts, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, ProductPhoto } from '@/shared/brand';
import { Meters, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { EstimatedBadge, ReviewBadge, RollStateBadge } from './roll-badges';

const t = messages.inventory;

/** One colour's rolls (/inventory/color?id=…), those with cloth left first. */
export function ColorScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const seesCosts = useCanSeeCosts();
  const data = useLiveQuery(async () => {
    const variant = await repositories.variants.get(id);
    if (!variant) return null;
    const fabric = await repositories.fabrics.get(variant.fabricId);
    return { variant, fabric, rolls: await repositories.inventory.rollsOfColor(id) };
  }, [repositories, id]);
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);

  if (data === undefined) return <LoadingState />;
  const back = (
    <Button asChild variant="link" className="justify-self-start px-0">
      <Link href="/inventory">{t.backToInventory}</Link>
    </Button>
  );
  if (data === null) return <EmptyState title={t.colorNotFound} action={back} />;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      {back}
      <div className="flex items-center gap-3">
        <ProductPhoto src={photos?.get(data.variant.id)} className="size-16 rounded-lg" />
        <h2 className="font-heading text-xl font-semibold">
          {data.fabric?.name} · {data.variant.colorName}
        </h2>
      </div>
      {data.rolls.length === 0 ? (
        <EmptyState
          title={t.colorEmpty}
          action={
            <Button asChild>
              <Link href="/purchases/new">{t.newPurchase}</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.rollFields.code}</TableHead>
                <TableHead className="text-end">{t.rollFields.remaining}</TableHead>
                {seesCosts && (
                  <TableHead className="text-end">{t.rollFields.costPerMeter}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rolls.map(({ roll, ledger, state }) => (
                <TableRow key={roll.id} className="h-12">
                  <TableCell>
                    <Link
                      href={`/inventory/roll?id=${roll.id}`}
                      className="me-2 underline-offset-4 hover:underline"
                    >
                      <bdi dir="ltr" data-num className="font-medium">
                        {roll.shortCode}
                      </bdi>
                    </Link>
                    <RollStateBadge state={state} />
                    {(ledger.remainingCm < 0 || ledger.oversoldCm > 0) && (
                      <span className="ms-1.5">
                        <ReviewBadge />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <Meters cm={Math.max(0, ledger.remainingCm)} />
                  </TableCell>
                  {seesCosts && (
                    <TableCell className="text-end">
                      <Money cents={ledger.costPerMeterCents} />
                      {ledger.lengthEstimated && (
                        <span className="ms-1.5">
                          <EstimatedBadge />
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
