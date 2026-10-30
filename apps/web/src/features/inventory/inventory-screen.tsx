'use client';

import {
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  TruckIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { messages } from '@/i18n';
import { type ColorStock, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { Meters } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/shared/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.inventory;

function StockBadge({ color }: { color: ColorStock }) {
  if (color.state === 'in_stock') return null;
  return (
    <Badge variant={color.state === 'out' ? 'destructive' : 'warning'}>
      <TriangleAlertIcon aria-hidden />
      {color.state === 'out' ? t.out : t.low}
    </Badge>
  );
}

function ColorRows({ colors }: { colors: ColorStock[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.columns.color}</TableHead>
          <TableHead className="text-end">{t.columns.remaining}</TableHead>
          <TableHead className="text-end">{t.columns.rolls}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {colors.map((color) => (
          <TableRow key={color.variant.id} className="h-12">
            <TableCell>
              <Link
                href={`/inventory/color?id=${color.variant.id}`}
                className="me-2 font-medium underline-offset-4 hover:underline"
              >
                {color.variant.colorName}
              </Link>
              <StockBadge color={color} />
            </TableCell>
            <TableCell className="text-end">
              <Meters cm={color.remainingCm} />
            </TableCell>
            <TableCell className="text-end text-sm">{t.rollsCount(color.rollCount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Stock (SPEC §14.2): fabrics → colours → metres left, rolls, low-stock and out-of-stock, from
 * the device's stock moves. Search by fabric, colour, tag or roll code.
 */
export function InventoryScreen() {
  const repositories = useRepositories();
  const [search, setSearch] = useState('');
  const data = useLiveQuery(() => repositories.inventory.overview(search), [repositories, search]);

  const out = (data?.fabrics ?? []).flatMap(({ fabric, colors }) =>
    colors.filter((color) => color.state === 'out').map((color) => ({ fabric, color })),
  );

  return (
    <div className="grid gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto font-heading text-xl font-semibold">{t.title}</h2>
        <Button asChild variant="outline">
          <Link href="/inventory/suppliers">
            <TruckIcon data-icon="inline-start" aria-hidden />
            {t.suppliers}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/inventory/fabric">
            <PlusIcon data-icon="inline-start" aria-hidden />
            {t.newFabric}
          </Link>
        </Button>
        <Button asChild variant="accent">
          <Link href="/purchases/new">
            <PlusIcon data-icon="inline-start" aria-hidden />
            {t.newPurchase}
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
          aria-label={t.search}
          placeholder={t.search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </InputGroup>

      {data === undefined ? (
        <LoadingState />
      ) : data.rollMatch ? (
        <Button asChild variant="outline" className="justify-self-start">
          <Link href={`/inventory/roll?id=${data.rollMatch.id}`}>
            {t.rollFound}{' '}
            <bdi dir="ltr" data-num>
              {data.rollMatch.shortCode}
            </bdi>
          </Link>
        </Button>
      ) : data.fabrics.length === 0 ? (
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
        <>
          {data.fabrics.map(({ fabric, colors, remainingCm }) => (
            <section key={fabric.id} className="rounded-lg border bg-card" aria-label={fabric.name}>
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <Link
                  href={`/inventory/fabric?id=${fabric.id}`}
                  className="font-heading text-lg font-semibold underline-offset-4 hover:underline"
                >
                  {fabric.name}
                </Link>
                <Button
                  asChild
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${t.editFabric}: ${fabric.name}`}
                >
                  <Link href={`/inventory/fabric?id=${fabric.id}`}>
                    <PencilIcon aria-hidden />
                  </Link>
                </Button>
                <span className="ms-auto text-sm text-muted-foreground">
                  {t.total}: <Meters cm={remainingCm} />
                </span>
              </div>
              {colors.length > 0 ? (
                <ColorRows colors={colors} />
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  {messages.catalog.colorsEmpty}
                </p>
              )}
            </section>
          ))}
          {out.length > 0 && (
            <section className="grid gap-2" aria-labelledby="out-of-stock">
              <h3 id="out-of-stock" className="font-heading font-semibold">
                {t.outTitle}
              </h3>
              <ul className="flex flex-wrap gap-2">
                {out.map(({ fabric, color }) => (
                  <li key={color.variant.id}>
                    <Badge asChild variant="outline">
                      <Link href={`/inventory/color?id=${color.variant.id}`}>
                        {fabric.name} · {color.variant.colorName}
                      </Link>
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
