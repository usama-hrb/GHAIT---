'use client';

import { mayPush } from '@fabric/contracts';
import {
  BoxesIcon,
  CircleXIcon,
  CoinsIcon,
  EllipsisIcon,
  LayoutGridIcon,
  type LucideIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  TableIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { messages } from '@/i18n';
import {
  type ProductStockView,
  STOCK_FILTERS,
  type StockFilter,
  useCanSeeCosts,
  useLiveQuery,
  useRepositories,
  useSession,
} from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, ProductPhoto } from '@/shared/brand';
import { Kilograms, Money } from '@/shared/format';
import { useAppNavigation } from '@/shared/lib/navigation';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/shared/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { BatchListPopover } from './batch-list-popover';
import { useInventoryView } from './inventory-view';
import { ProductFormDialog } from './product-form-dialog';
import { AvailableText, StockStatusBadge } from './product-stock-parts';
import { RemoveProductDialog } from './remove-product-dialog';
import { RestockDialog } from './restock-dialog';
import { stockFilterOf } from './stock-filter';
import { ReviewBadge } from './stock-badges';

const t = messages.productStock;

/** Column heads: small and quiet, like the labels of the POS bill. */
const HEAD = 'text-xs font-semibold tracking-wide text-muted-foreground';

/**
 * The weighted average cost of what the product still holds (PB18), per metre and per piece when
 * it holds both. A weight with no length has no cost per metre, and a product with nothing in a
 * unit has no average there: a dash, never a made-up figure.
 */
function AverageCost({ product }: { product: ProductStockView }) {
  const parts = [
    { key: 'meter', cents: product.averageCostPerMeterCents, unit: t.perUnit.meter },
    { key: 'piece', cents: product.averageCostPerPieceCents, unit: t.perUnit.piece },
  ].flatMap((part) => (part.cents === null ? [] : [{ ...part, cents: part.cents }]));
  if (parts.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {parts.map((part) => (
        <span key={part.key} className="block whitespace-nowrap tabular-nums">
          <Money cents={part.cents} />
          <span className="text-xs text-muted-foreground"> {part.unit}</span>
        </span>
      ))}
    </>
  );
}

/** What the stock still held cost, batch by batch (PB18). */
function StockValue({ product }: { product: ProductStockView }) {
  if (product.stockValueCents <= 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-medium whitespace-nowrap tabular-nums">
      <Money cents={product.stockValueCents} />
    </span>
  );
}

/** Weight received and not measured yet: said apart, never added to the metres. */
function AwaitingNote({ product }: { product: ProductStockView }) {
  if (product.awaitingMeasurementG <= 0) return null;
  return (
    <span className="block text-sm text-muted-foreground">
      <Kilograms grams={product.awaitingMeasurementG} />
      {' · '}
      {t.status.awaiting}
    </span>
  );
}

function ProductName({ product }: { product: ProductStockView }) {
  return (
    <>
      <span className="truncate font-semibold">{product.name}</span>
      {product.sku && (
        <bdi dir="ltr" data-num className="text-xs text-muted-foreground">
          {product.sku}
        </bdi>
      )}
    </>
  );
}

function StatusBadges({ product }: { product: ProductStockView }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StockStatusBadge status={product.status} />
      {product.needsReview && <ReviewBadge />}
    </span>
  );
}

/** The row's own menu: open the product, or add stock to it without leaving the list. */
function RowActions({
  product,
  canBuy,
  canRemove,
  onRestock,
  onRemove,
}: {
  product: ProductStockView;
  canBuy: boolean;
  canRemove: boolean;
  onRestock: (productId: string) => void;
  onRemove: (product: ProductStockView) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${t.actions.rowMenu}: ${product.name}`}
          className="pointer-coarse:size-11"
        >
          <EllipsisIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/inventory/product?id=${product.id}`}>{t.actions.open}</Link>
        </DropdownMenuItem>
        {canBuy && (
          <DropdownMenuItem
            onSelect={() => {
              onRestock(product.id);
            }}
          >
            {t.actions.addStock}
          </DropdownMenuItem>
        )}
        {canRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onRemove(product);
              }}
            >
              <Trash2Icon aria-hidden />
              {t.actions.remove}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Add Stock opened from the list: the dialog needs the product's record, read from this device. */
function RestockFromList({ productId, onClose }: { productId: string; onClose: () => void }) {
  const repositories = useRepositories();
  const detail = useLiveQuery(
    () => repositories.productInventory.detail(productId),
    [repositories, productId],
  );
  if (!detail) return null;
  return <RestockDialog product={detail.record} onClose={onClose} />;
}

/** A small label over a figure, like the labels of the POS bill. */
function CardFact({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-0.5 text-sm', className)}>
      <dt className="text-[11px] leading-tight font-semibold tracking-[0.12em] text-muted-foreground uppercase rtl:tracking-normal">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A product as a compact card: a small picture, the name and code, what is available and where it
 * stands, then what the stock cost. The name's link covers the card; the batches button sits above it.
 */
function ProductCard({
  product,
  photo,
  seesCosts,
}: {
  product: ProductStockView;
  photo: string | undefined;
  seesCosts: boolean;
}) {
  return (
    <div className="relative flex w-full flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm transition-colors has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50 hover:border-primary/30">
      <div className="flex items-center gap-3">
        <ProductPhoto src={photo} className="size-12 rounded-md" />
        <Link
          href={`/inventory/product?id=${product.id}`}
          className="grid min-w-0 flex-1 outline-none after:absolute after:inset-0 after:content-['']"
        >
          <ProductName product={product} />
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="font-heading text-lg font-semibold tabular-nums">
          <AvailableText cm={product.availableCm} pieces={product.availablePieces} />
        </span>
        <StatusBadges product={product} />
      </div>
      <AwaitingNote product={product} />
      <dl className="mt-auto flex items-end justify-between gap-3 border-t border-dashed border-border pt-2">
        {seesCosts && (
          <>
            <CardFact label={t.columns.avgCost}>
              <AverageCost product={product} />
            </CardFact>
            <CardFact label={t.columns.value}>
              <StockValue product={product} />
            </CardFact>
          </>
        )}
        <CardFact label={t.columns.batches} className="justify-items-end">
          <BatchListPopover product={product} seesCosts={seesCosts} />
        </CardFact>
      </dl>
    </div>
  );
}

/** One figure of the overview. A warning figure gets its icon coloured only when there is any. */
function StatTile({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  tone?: 'warning' | 'destructive';
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 content-start gap-1.5 rounded-xl border border-border/70 bg-card p-3 shadow-sm max-sm:last:odd:col-span-2">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon
          className={cn(
            'size-4 shrink-0',
            tone === 'warning' && 'text-warning',
            tone === 'destructive' && 'text-destructive',
          )}
          aria-hidden
        />
        {label}
      </dt>
      <dd className="font-heading text-lg font-semibold tracking-tight break-words tabular-nums sm:text-xl sm:whitespace-nowrap">
        {children}
      </dd>
    </div>
  );
}

/**
 * Inventory (/inventory): what the shop holds and what it cost: the quantity, the average cost
 * and the value of each product's stock, where it stands, and its batches. Selling prices are
 * not here (they belong to the product and the till). Every figure comes from the product ledger
 * of @fabric/core through the repository; nothing here adds up stock.
 */
export function ProductInventoryScreen() {
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const seesCosts = useCanSeeCosts();
  const { user } = useSession();
  const canCreate = user !== null && mayPush(user.role, 'product', 'upsert');
  const canBuy = user !== null && mayPush(user.role, 'purchase', 'append');
  const canRemove = user !== null && mayPush(user.role, 'product', 'void');
  const [search, setSearch] = useState('');
  // The Home links here with ?filter=low (or out, awaiting): the list opens already filtered.
  const requested = useSearchParams().get('filter');
  const [filter, setFilter] = useState<StockFilter>(() => stockFilterOf(requested));
  const [creating, setCreating] = useState(false);
  const [restocking, setRestocking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProductStockView | null>(null);
  const [view, setView] = useInventoryView();
  const data = useLiveQuery(
    () => repositories.productInventory.overview({ search, filter }),
    [repositories, search, filter],
  );
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);
  const products = data?.products ?? [];

  return (
    <div className="grid w-full gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto font-heading text-xl font-semibold">{t.title}</h2>
        {canCreate && (
          <Button
            variant="accent"
            onClick={() => {
              setCreating(true);
            }}
          >
            <PlusIcon data-icon="inline-start" aria-hidden />
            {t.newProduct}
          </Button>
        )}
        {seesCosts && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t.more}>
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/payables">{t.moreMenu.suppliers}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {data !== undefined && data.summary.products > 0 && (
        <section aria-label={t.overview.label}>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] sm:gap-3">
            <StatTile icon={PackageIcon} label={t.overview.products}>
              <span data-num>{data.summary.products}</span>
            </StatTile>
            {seesCosts && (
              <StatTile icon={CoinsIcon} label={t.overview.value}>
                <Money cents={data.summary.stockValueCents} />
              </StatTile>
            )}
            <StatTile icon={BoxesIcon} label={t.overview.available}>
              <AvailableText cm={data.summary.availableCm} pieces={data.summary.availablePieces} />
            </StatTile>
            <StatTile
              icon={TriangleAlertIcon}
              label={t.overview.low}
              tone={data.summary.low > 0 ? 'warning' : undefined}
            >
              <span data-num>{data.summary.low}</span>
            </StatTile>
            <StatTile
              icon={CircleXIcon}
              label={t.overview.out}
              tone={data.summary.out > 0 ? 'destructive' : undefined}
            >
              <span data-num>{data.summary.out}</span>
            </StatTile>
          </dl>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 lg:grid-cols-[minmax(14rem,1fr)_auto_auto] lg:items-center">
        <InputGroup className="col-span-2 lg:col-span-1">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            aria-label={t.search}
            placeholder={t.search}
            autoComplete="off"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </InputGroup>
        <div
          role="group"
          aria-label={t.view.label}
          className="hidden items-center gap-1 rounded-lg border border-border/70 bg-card p-1 shadow-sm xl:flex lg:order-3"
        >
          {(['table', 'cards'] as const).map((value) => {
            const Icon = value === 'cards' ? LayoutGridIcon : TableIcon;
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={view === value ? 'secondary' : 'ghost'}
                aria-pressed={view === value}
                className="touch-manipulation pointer-coarse:h-11"
                onClick={() => {
                  setView(value);
                }}
              >
                <Icon data-icon="inline-start" aria-hidden />
                {t.view[value]}
              </Button>
            );
          })}
        </div>
        <div
          role="group"
          aria-label={t.filters.label}
          className="col-span-2 flex flex-wrap gap-2 lg:order-2 lg:col-span-1 lg:flex-nowrap"
        >
          {STOCK_FILTERS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? 'secondary' : 'outline'}
              aria-pressed={filter === value}
              className="shrink-0 touch-manipulation pointer-coarse:h-11 pointer-coarse:min-w-11"
              onClick={() => {
                setFilter(value);
              }}
            >
              {t.filters[value]}
            </Button>
          ))}
        </div>
      </div>

      {data === undefined ? (
        <LoadingState />
      ) : products.length === 0 ? (
        search.trim() ? (
          <EmptyState icon={SearchIcon} title={t.noResults} />
        ) : filter !== 'all' ? (
          <EmptyState
            icon={PackageIcon}
            title={t.noFiltered}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setFilter('all');
                }}
              >
                {t.filters.all}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={PackageIcon}
            title={t.emptyTitle}
            description={t.emptyDescription}
            action={
              canCreate ? (
                <Button
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  {t.newProduct}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          {view === 'table' && (
            <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm xl:block">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className={HEAD}>{t.columns.product}</TableHead>
                    <TableHead className={cn(HEAD, 'text-end')}>{t.columns.available}</TableHead>
                    {seesCosts && (
                      <>
                        <TableHead className={cn(HEAD, 'text-end')}>
                          <span title={t.avgCostHint}>{t.columns.avgCost}</span>
                        </TableHead>
                        <TableHead className={cn(HEAD, 'text-end')}>{t.columns.value}</TableHead>
                      </>
                    )}
                    <TableHead className={HEAD}>{t.columns.status}</TableHead>
                    <TableHead className={cn(HEAD, 'text-end')}>{t.columns.batches}</TableHead>
                    <TableHead className={cn(HEAD, 'w-12 text-end')}>
                      <span className="sr-only">{t.columns.actions}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.id} className="h-14">
                      <TableCell className="min-w-48">
                        <Link
                          href={`/inventory/product?id=${product.id}`}
                          className="flex items-center gap-3 underline-offset-4 hover:underline"
                        >
                          <ProductPhoto
                            src={photos?.get(product.id)}
                            className="size-10 rounded-md"
                          />
                          <span className="grid min-w-0">
                            <ProductName product={product} />
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-end">
                        <span className="font-medium tabular-nums">
                          <AvailableText
                            cm={product.availableCm}
                            pieces={product.availablePieces}
                          />
                        </span>
                        <AwaitingNote product={product} />
                      </TableCell>
                      {seesCosts && (
                        <>
                          <TableCell className="text-end text-sm">
                            <AverageCost product={product} />
                          </TableCell>
                          <TableCell className="text-end text-sm">
                            <StockValue product={product} />
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <StatusBadges product={product} />
                      </TableCell>
                      <TableCell className="text-end">
                        <BatchListPopover product={product} seesCosts={seesCosts} />
                      </TableCell>
                      <TableCell className="text-end">
                        <RowActions
                          product={product}
                          canBuy={canBuy}
                          canRemove={canRemove}
                          onRestock={setRestocking}
                          onRemove={setRemoving}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <ul
            className={cn(
              'grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(19rem,1fr))]',
              view === 'table' && 'xl:hidden',
            )}
          >
            {products.map((product) => (
              <li key={product.id} className="flex">
                <ProductCard
                  product={product}
                  photo={photos?.get(product.id)}
                  seesCosts={seesCosts}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {creating && (
        <ProductFormDialog
          onClose={() => {
            setCreating(false);
          }}
          onSaved={(id) => {
            navigation.push(`/inventory/product?id=${id}`);
          }}
        />
      )}
      {removing && (
        <RemoveProductDialog
          product={removing}
          onClose={() => {
            setRemoving(null);
          }}
        />
      )}
      {restocking !== null && (
        <RestockFromList
          productId={restocking}
          onClose={() => {
            setRestocking(null);
          }}
        />
      )}
    </div>
  );
}
