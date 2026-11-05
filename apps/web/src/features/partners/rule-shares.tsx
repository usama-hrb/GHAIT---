'use client';

import { messages } from '@/i18n';
import { formatPermille } from '@/shared/lib/percent';
import { type RuleShare, ruleShares } from './people-view';

/**
 * The shares of a rule as a wrapping row: "Owner 25% · Sara 25% · Shop 50%". Display only.
 * `showWeights` adds the weight the rule was entered with after each percentage.
 */
export function ShareList({
  shares,
  showWeights = false,
}: {
  shares: readonly RuleShare[];
  showWeights?: boolean;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {shares.map((share) => (
        <li key={share.key} className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">
            <bdi>{share.label}</bdi>
          </span>
          <span data-num className="font-medium">
            <bdi>{formatPermille(share.permille)}</bdi>
          </span>
          {showWeights && (
            <span data-num className="text-xs text-muted-foreground">
              <bdi>({share.weight})</bdi>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What a rule's weights come to, with the partners named from `names` (id → name). */
export function RuleShareList({
  rule,
  names,
}: {
  rule: Parameters<typeof ruleShares>[0];
  names: ReadonlyMap<string, string>;
}) {
  const t = messages.partners;
  return (
    <ShareList
      shares={ruleShares(rule, {
        owner: t.owner,
        shop: t.splitRules.shop,
        partner: (partnerId) => names.get(partnerId) ?? t.splitRules.unknownPartner,
      })}
    />
  );
}
