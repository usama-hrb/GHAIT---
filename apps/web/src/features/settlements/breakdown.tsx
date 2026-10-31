import type { SettlementLine } from '@fabric/contracts';
import { messages } from '@/i18n';
import { Money, type MoneyTone } from '@/shared/format';
import { cn } from '@/shared/lib/utils';

const t = messages.settlements;

function toneOf(line: SettlementLine): MoneyTone | undefined {
  if (line.key === 'net_profit') return line.cents < 0 ? 'loss' : 'profit';
  if (line.key === 'carry_deficit_out') return line.cents > 0 ? 'debt' : undefined;
  if (line.key === 'shop_share') return 'capital';
  return line.cents < 0 ? 'loss' : undefined;
}

/**
 * A settlement's breakdown (SPEC §8.1): what makes up the net profit, then what becomes of it.
 * Lines are worded, so a figure never relies on its colour alone.
 */
export function Breakdown({ lines }: { lines: readonly SettlementLine[] }) {
  return (
    <dl className="grid gap-1">
      {lines.map((line) => (
        <div
          key={line.key}
          className={cn(
            'flex justify-between gap-2',
            line.key === 'net_profit' && 'mt-1 border-t pt-2 font-semibold',
          )}
        >
          <dt className={line.key === 'net_profit' ? undefined : 'text-muted-foreground'}>
            {t.lines[line.key]}
          </dt>
          <dd>
            <Money cents={line.cents} tone={toneOf(line)} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
