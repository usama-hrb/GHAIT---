'use client';

import { PackageIcon, PlusIcon, SearchIcon, TruckIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/shared/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.catalog;

/** Fabrics with their reference prices and colours (SPEC §14.2–3). Reads the device only. */
export function FabricListScreen() {
  const repositories = useRepositories();
  const [search, setSearch] = useState('');
  const fabrics = useLiveQuery(() => repositories.fabrics.list(search), [repositories, search]);
  const colors = useLiveQuery(() => repositories.variants.countByFabric(), [repositories]);

  return (
    <div className="grid gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto font-heading text-xl font-semibold">{t.fabricsTitle}</h2>
        <Button asChild variant="outline">
          <Link href="/inventory/suppliers">
            <TruckIcon data-icon="inline-start" aria-hidden />
            {t.suppliersLink}
          </Link>
        </Button>
        <Button asChild variant="accent">
          <Link href="/inventory/fabric">
            <PlusIcon data-icon="inline-start" aria-hidden />
            {t.newFabric}
          </Link>
        </Button>
      </div>

      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={search}
          aria-label={t.searchFabrics}
          placeholder={t.searchFabrics}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </InputGroup>

      {fabrics === undefined ? (
        <LoadingState />
      ) : fabrics.length === 0 ? (
        search ? (
          <EmptyState icon={SearchIcon} title={t.noResults} />
        ) : (
          <EmptyState
            icon={PackageIcon}
            title={t.emptyTitle}
            description={t.emptyDescription}
            action={
              <Button asChild>
                <Link href="/inventory/fabric">{t.newFabric}</Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.name}</TableHead>
                <TableHead className="text-end">{t.columns.refPrice}</TableHead>
                <TableHead className="text-end max-sm:hidden">{t.columns.minPrice}</TableHead>
                <TableHead className="text-end">{t.columns.colors}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fabrics.map((fabric) => (
                <TableRow key={fabric.id} className="h-12">
                  <TableCell>
                    <Link
                      href={`/inventory/fabric?id=${fabric.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {fabric.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      {fabric.type && <span>{fabric.type}</span>}
                      {fabric.sellableAsPiece && <Badge variant="secondary">{t.piece}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={fabric.refPricePerMeterCents} />
                  </TableCell>
                  <TableCell className="text-end max-sm:hidden">
                    <Money cents={fabric.minPricePerMeterCents} />
                  </TableCell>
                  <TableCell className="text-end text-sm">
                    {t.colorsCount(colors?.get(fabric.id) ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
