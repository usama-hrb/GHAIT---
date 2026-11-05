'use client';

import { messages } from '@/i18n';
import type { SplitRuleRow } from '@/local-db';
import { DateText } from '@/shared/format';
import { type PeriodState, ruleInEffect, type SettlementFacts } from './settlement-facts';

const d = messages.settlements.distribution;

/**
 * Which rule the shares come from: for a period still open, the rule in effect on its first day
 * (the default, or an entered rule's date); for a settled one, the weights it was settled with.
 */
export function RuleNote({
  facts,
  state,
  rules = [],
}: {
  facts: SettlementFacts;
  state: PeriodState;
  /** The entered rules, to name the one in effect (an open period only). */
  rules?: readonly SplitRuleRow[];
}) {
  // Owner / each partner / shop: a settlement that names none shows its partners together.
  const parts = [
    facts.weights.owner,
    ...(facts.weights.partners ?? []).map(({ weight }) => weight),
    ...(facts.weights.partners ? [] : [facts.weights.partner]),
    facts.weights.shop,
  ];
  const weights = <bdi data-num>{parts.join(' / ')}</bdi>;
  if (state === 'settled') {
    return (
      <>
        {d.ruleKept}: {weights}
      </>
    );
  }
  const { rule, isDefault } = ruleInEffect(
    rules.filter((row) => row.rule !== null),
    facts.periodStart,
  );
  return (
    <>
      {isDefault ? (
        d.ruleDefault
      ) : (
        <>
          {d.ruleFrom} <DateText value={rule.effectiveFrom} />
        </>
      )}{' '}
      ({weights})
    </>
  );
}
