'use client';

import { TrendingUpIcon } from 'lucide-react';
import { designMessages as t } from '@/i18n/ar.design';
import { EmptyState } from '@/shared/brand';
import { Meters, Money } from '@/shared/format';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card';
import { Separator } from '@/shared/ui/separator';
import { Skeleton } from '@/shared/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Section } from './section';

// SPEC §16 numbers: Rosa at 16 dh/m sold at 18–20; Korean crepe 43.48 dh/m.
const LINES = [
  {
    id: 'l1',
    fabric: t.fabrics[0],
    cm: 275,
    priceCents: 2000,
    totalCents: 5500,
    profitCents: 1100,
  },
  {
    id: 'l2',
    fabric: t.fabrics[0],
    cm: 1000,
    priceCents: 1800,
    totalCents: 18000,
    profitCents: 2000,
  },
  {
    id: 'l3',
    fabric: t.fabrics[1],
    cm: 100,
    priceCents: 4000,
    totalCents: 4000,
    profitCents: -348,
  },
] as const;

export function DataSection() {
  const total = LINES.reduce((sum, line) => sum + line.totalCents, 0);
  const profit = LINES.reduce((sum, line) => sum + line.profitCents, 0);

  return (
    <Section id="data" title={t.sections.data}>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t.data.cardTitle}</CardTitle>
            <CardDescription>{t.data.cardDescription}</CardDescription>
            <CardAction>
              <Badge variant="success">
                <TrendingUpIcon aria-hidden />
                {t.format.profit}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-heading text-3xl font-semibold">
              <Money cents={total} />
            </p>
            <p className="text-sm">
              {t.format.profit}: <Money cents={profit} tone="profit" />
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent>
            <Tabs defaultValue="sales">
              <TabsList>
                <TabsTrigger value="sales">{t.data.tabsSales}</TabsTrigger>
                <TabsTrigger value="debts">{t.data.tabsDebts}</TabsTrigger>
                <TabsTrigger value="stock">{t.data.tabsStock}</TabsTrigger>
              </TabsList>
              <TabsContent value="sales">
                <Table>
                  <TableCaption>{t.data.tableCaption}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.data.colFabric}</TableHead>
                      <TableHead className="text-end">{t.data.colLength}</TableHead>
                      <TableHead className="text-end">{t.data.colPrice}</TableHead>
                      <TableHead className="text-end">{t.data.colTotal}</TableHead>
                      <TableHead className="text-end">{t.data.colProfit}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {LINES.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>{line.fabric}</TableCell>
                        <TableCell className="text-end">
                          <Meters cm={line.cm} />
                        </TableCell>
                        <TableCell className="text-end">
                          <Money cents={line.priceCents} />
                        </TableCell>
                        <TableCell className="text-end">
                          <Money cents={line.totalCents} />
                        </TableCell>
                        <TableCell className="text-end">
                          <Money
                            cents={line.profitCents}
                            tone={line.profitCents < 0 ? 'loss' : 'profit'}
                          />
                          {line.profitCents < 0 && (
                            <span className="ms-1 text-xs text-loss">({t.format.loss})</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>{t.data.colTotal}</TableCell>
                      <TableCell className="text-end">
                        <Money cents={total} />
                      </TableCell>
                      <TableCell className="text-end">
                        <Money cents={profit} tone="profit" />
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TabsContent>
              <TabsContent value="debts">
                <EmptyState title={t.data.debtsEmpty} titleAs="h3" />
              </TabsContent>
              <TabsContent value="stock">
                <Alert>
                  <AlertTitle>{t.data.stockLow}</AlertTitle>
                  <AlertDescription>
                    <Meters cm={420} />
                  </AlertDescription>
                </Alert>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      <div className="grid max-w-md gap-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <Separator />
        <Skeleton className="h-24 w-full" />
      </div>
    </Section>
  );
}
