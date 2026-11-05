'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import {
  type PartnerView,
  type SplitRuleRow,
  useLiveQuery,
  useRepositories,
  useSession,
} from '@/local-db';
import { VoidDialog } from '@/shared/brand';
import { DateText } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { failureText } from './people-errors';
import { nextMonthStart, ruleInForce, ruleShares, weightFrom, weightIn } from './people-view';
import { ShareList } from './rule-shares';

const t = messages.partners.splitRules;

/** A rule's shares, the partners named from the shop's partners (one who is gone shows as unknown). */
function sharesOf(row: SplitRuleRow, partners: readonly PartnerView[]) {
  const names = new Map(partners.map(({ partner }) => [partner.id, partner.name]));
  return ruleShares(row, {
    owner: messages.partners.owner,
    shop: t.shop,
    partner: (partnerId) => names.get(partnerId) ?? t.unknownPartner,
  });
}

function RuleDialog({
  editing,
  rows,
  partners,
  onOpenChange,
}: {
  /** The rule being changed, or 'new'. */
  editing: SplitRuleRow | 'new' | null;
  rows: readonly SplitRuleRow[];
  /** The partners who are not the owner. */
  partners: readonly PartnerView[];
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const current = editing === 'new' ? null : editing;
  // A new rule starts from the one in force, so only what changes is typed.
  const base = current ?? ruleInForce(rows);
  const [from, setFrom] = useState(() => current?.effectiveFrom ?? nextMonthStart(shopToday()));
  const [owner, setOwner] = useState(() => String(base?.ownerWeight ?? 1));
  const [shop, setShop] = useState(() => String(base?.shopWeight ?? 1));
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      partners.map(({ partner }) => [
        partner.id,
        String(base ? weightIn(base, { kind: 'partner', partnerId: partner.id }) : 1),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsedOwner = weightFrom(owner);
  const parsedShop = weightFrom(shop);
  const parsedPartners = partners.map(({ partner }) => weightFrom(weights[partner.id] ?? ''));

  const field = (
    key: string,
    label: string,
    value: string,
    bad: boolean,
    set: (v: string) => void,
  ) => (
    <Field key={key} data-invalid={bad || undefined}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        inputMode="numeric"
        dir="ltr"
        className="text-start"
        aria-invalid={bad || undefined}
        value={value}
        onChange={(event) => {
          set(event.target.value);
        }}
      />
    </Field>
  );

  return (
    <Dialog open={editing !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (parsedOwner === null || parsedShop === null || parsedPartners.includes(null)) {
              setError(messages.forms.invalid);
              return;
            }
            const partnerWeights = partners.map(({ partner }, index) => ({
              partnerId: partner.id,
              weight: parsedPartners[index] ?? 0,
            }));
            setBusy(true);
            repositories.settlements
              .saveSplitRule(
                {
                  effectiveFrom: from,
                  ownerWeight: parsedOwner,
                  partnerWeight: partnerWeights.reduce((sum, { weight }) => sum + weight, 0),
                  shopWeight: parsedShop,
                  partnerWeights,
                },
                current?.rule?.id,
              )
              .then(() => {
                toast.success(t.saved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((caught: unknown) => {
                setError(failureText(caught));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{current ? t.edit : t.add}</DialogTitle>
            <DialogDescription>{t.dialogDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-from`}>{t.from}</FieldLabel>
              <Input
                id={`${id}-from`}
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                }}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('owner', t.ownerWeight, owner, parsedOwner === null, setOwner)}
              {partners.map(({ partner }, index) =>
                field(
                  partner.id,
                  t.partnerWeightOf(partner.name),
                  weights[partner.id] ?? '',
                  parsedPartners[index] === null,
                  (value) => {
                    setWeights((currentWeights) => ({ ...currentWeights, [partner.id]: value }));
                  },
                ),
              )}
              {field('shop', t.shopWeight, shop, parsedShop === null, setShop)}
            </div>
            <FieldDescription>{t.weightsHint}</FieldDescription>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? messages.forms.saving : messages.forms.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The profit split rules (SPEC §8.3, S15, S17): equal thirds since the start (the first partner's
 * share), then the rules entered, each for a future date; one changes or goes only before it
 * takes effect. Each rule names the weight of the owner, of every partner, and of the shop. The
 * settlement page reads these and shows the rule it used; rules are managed only here.
 */
export function ProfitSplitRules({ partners }: { partners: readonly PartnerView[] }) {
  const repositories = useRepositories();
  const rows = useLiveQuery(() => repositories.settlements.splitRules(), [repositories]);
  const [editing, setEditing] = useState<SplitRuleRow | 'new' | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const canEdit = useSession().user?.role === 'owner';
  // A rule can name a partner who has since left (kept for the history), but a new rule never does.
  const others = partners.filter(
    ({ partner, standing }) => !partner.isOwner && standing === 'active',
  );
  const inForce = rows ? ruleInForce(rows) : undefined;

  const statusOf = (row: SplitRuleRow) =>
    row.future ? (
      <Badge variant="outline">{t.future}</Badge>
    ) : row === inForce ? (
      <Badge variant="secondary">{t.inEffect}</Badge>
    ) : (
      <Badge variant="ghost">{t.past}</Badge>
    );

  const actions = (row: SplitRuleRow) =>
    canEdit &&
    row.future &&
    row.rule && (
      <span className="flex justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(row);
          }}
        >
          {messages.forms.edit}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setVoiding(row.rule?.id ?? null);
          }}
        >
          {t.voidAction}
        </Button>
      </span>
    );

  return (
    <section aria-label={t.title} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading font-semibold">{t.title}</h3>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing('new');
            }}
          >
            {t.add}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t.description}</p>

      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.from}</TableHead>
              <TableHead>{t.columns.split}</TableHead>
              <TableHead>{t.columns.status}</TableHead>
              <TableHead>
                <span className="sr-only">{messages.forms.edit}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((row) => (
              <TableRow key={row.rule?.id ?? 'default'}>
                <TableCell className="align-top">
                  {row.rule ? <DateText value={row.effectiveFrom} /> : t.defaultRule}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <ShareList shares={sharesOf(row, partners)} showWeights />
                </TableCell>
                <TableCell className="align-top">{statusOf(row)}</TableCell>
                <TableCell className="text-end align-top">{actions(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-2 md:hidden">
        {(rows ?? []).map((row) => (
          <li
            key={row.rule?.id ?? 'default'}
            className="grid gap-2 rounded-lg border bg-card p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {row.rule ? <DateText value={row.effectiveFrom} /> : t.defaultRule}
              </span>
              {statusOf(row)}
            </div>
            <ShareList shares={sharesOf(row, partners)} showWeights />
            {actions(row)}
          </li>
        ))}
      </ul>

      <RuleDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : (editing.rule?.id ?? '')}
        editing={editing}
        rows={rows ?? []}
        partners={others}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={t.voidTitle}
        description={t.voidDescription}
        onConfirm={async (reason) => {
          if (!voiding) return;
          try {
            await repositories.settlements.voidSplitRule(voiding, reason);
          } catch (error) {
            // The dialog stays open: the reason typed is kept and the text says what stops it.
            toast.error(failureText(error));
            return;
          }
          setVoiding(null);
          toast.success(t.voided, { description: messages.forms.saved });
        }}
      />
    </section>
  );
}
