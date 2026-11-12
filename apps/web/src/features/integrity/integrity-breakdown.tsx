import type { IntegrityReport } from '@fabric/contracts';
import { ChevronDownIcon, InfoIcon } from 'lucide-react';
import { messages } from '@/i18n';
import { Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { hasNegativeNote, type IntegrityLine, LINE_GROUPS, linesOf } from './integrity-model';

/**
 * How the money per the records is worked out, folded away until asked for: it is the one figure
 * that is not a count, and the one most often misread as the money in the till.
 */
function CashHow({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const t = messages.integrity.cashHow;
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group/how -ms-2.5">
          {t.title}
          <ChevronDownIcon
            aria-hidden
            className="transition-transform group-data-[state=open]/how:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 pt-1 text-sm text-muted-foreground">
        <p>{t.added}</p>
        <p>{t.removed}</p>
        <p>{t.scope}</p>
        <p>{t.counted}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One line of the check: its name, its amount, what it means, and what a negative amount means. */
function Line({ line, cashOpen }: { line: IntegrityLine; cashOpen: boolean }) {
  const t = messages.integrity;
  const negativeKey = line.cents < 0 && hasNegativeNote(line.key) ? line.key : null;
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
      <dt className="font-medium">{t.lines[line.key]}</dt>
      <dd className="text-end font-medium">
        <Money cents={line.cents} />
      </dd>
      <dd className="col-span-2 text-sm text-muted-foreground">{t.helps[line.key]}</dd>
      {negativeKey !== null && (
        <dd className="col-span-2 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{t.negatives[negativeKey]}</span>
        </dd>
      )}
      {line.key === 'cash' && (
        <dd className="col-span-2">
          <CashHow defaultOpen={cashOpen} />
        </dd>
      )}
    </div>
  );
}

/** A side of the check: its lines (in groups, when the side has them) and their total. */
function Side({
  title,
  description,
  totalLabel,
  totalCents,
  groups,
  cashOpen,
}: {
  title: string;
  description: string;
  totalLabel: string;
  totalCents: number;
  groups: { id: string; heading?: string; lines: IntegrityLine[] }[];
  cashOpen: boolean;
}) {
  return (
    <Card role="region" aria-label={title} className="content-start">
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">{title}</h2>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {groups.map((group) => (
          <div key={group.id} className="grid gap-2">
            {group.heading !== undefined && (
              <h3 className="text-sm font-medium text-muted-foreground">{group.heading}</h3>
            )}
            <dl className="grid divide-y">
              {group.lines.map((line) => (
                <Line key={line.key} line={line} cashOpen={cashOpen} />
              ))}
            </dl>
          </div>
        ))}
      </CardContent>
      <CardFooter className="justify-between gap-3 font-semibold">
        <span>{totalLabel}</span>
        <Money cents={totalCents} />
      </CardFooter>
    </Card>
  );
}

/**
 * The two sides of the check (SPEC §9): what the shop holds, and who it belongs to and what it
 * owes, each line with a short explanation and the side's total. Side by side when there is room,
 * one above the other when there is not; the totals are also at the top, in the verdict.
 * `cashOpen` opens the cash explanation to start with (for a document or a test).
 */
export function IntegrityBreakdown({
  report,
  cashOpen = false,
}: {
  report: IntegrityReport;
  cashOpen?: boolean;
}) {
  const t = messages.integrity;
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      <Side
        title={t.holdings}
        description={t.holdingsDescription}
        totalLabel={t.holdingsTotal}
        totalCents={report.holdingsCents}
        groups={[{ id: 'holdings', lines: linesOf(report, LINE_GROUPS.holdings) }]}
        cashOpen={cashOpen}
      />
      <Side
        title={t.claims}
        description={t.claimsDescription}
        totalLabel={t.claimsTotal}
        totalCents={report.claimsCents}
        groups={[
          {
            id: 'partners',
            heading: t.partnersGroup,
            lines: linesOf(report, LINE_GROUPS.partners),
          },
          { id: 'owed', heading: t.othersGroup, lines: linesOf(report, LINE_GROUPS.owed) },
        ]}
        cashOpen={cashOpen}
      />
    </div>
  );
}
