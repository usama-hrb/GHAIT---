'use client';

import { type NewSaleReturnInput } from '@fabric/contracts';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import {
  isPeriodLocked,
  type SaleView,
  useLiveQuery,
  useRepositories,
  ValidationError,
} from '@/local-db';
import { Meters, Money, MeterInput, MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

const t = messages.sales.return;

const issueText = (error: unknown) => {
  if (isPeriodLocked(error)) return t.issues.period_locked;
  return (
    (error instanceof ValidationError && t.issues[error.issues[0]?.message ?? '']) ||
    messages.forms.invalid
  );
};

/**
 * Records goods a customer gave back (BUILD_PROMPTS 5.3, RT1–RT3): a length per line, the reason,
 * and how much of the overpayment is handed back now. The dialog shows the credit, the invoice's
 * worth afterwards and what can be refunded; saving puts the cloth back on its rolls (or marks the
 * roll a remnant), lowers the invoice, and reverses the profit recognised on it in proportion.
 */
export function ReturnDialog({
  open,
  onOpenChange,
  view,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: SaleView;
}) {
  const id = useId();
  const repositories = useRepositories();
  const { sale } = view;
  const [lengths, setLengths] = useState<Record<string, number | null>>({});
  const [remnants, setRemnants] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => shopToday());
  const [refund, setRefund] = useState<number | null | undefined>(undefined);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const returnedBefore = (lineId: string) =>
    view.figures.lines.find((entry) => entry.lineId === lineId)?.returnedCm ?? 0;

  const picked = useMemo(
    () =>
      view.lines.flatMap(({ line }) => {
        const returnedCm = lengths[line.id];
        return returnedCm && returnedCm > 0 ? [{ lineId: line.id, returnedCm }] : [];
      }),
    [view.lines, lengths],
  );
  const draft = useMemo<NewSaleReturnInput | null>(
    () =>
      picked.length === 0
        ? null
        : { saleId: sale.id, date, reason: reason.trim() || '-', lines: picked, refundCents: 0 },
    [picked, sale.id, date, reason],
  );
  const priced = useLiveQuery(
    async () => (draft ? repositories.sales.previewReturn(draft) : null),
    [repositories, draft],
  );
  // Handed back by default: the whole overpayment, as the shop would at the counter.
  const maxRefund = priced?.maxRefundCents ?? 0;
  const refundCents = Math.min(refund === undefined ? maxRefund : (refund ?? 0), maxRefund);
  const walkIn = sale.customerId === null;
  const issues = priced?.issues.filter(
    (found) => found.message !== 'return_refund_required' || refundCents < maxRefund,
  );

  const close = (next: boolean) => {
    if (!next) {
      setLengths({});
      setRemnants({});
      setReason('');
      setRefund(undefined);
      setAttempted(false);
    }
    onOpenChange(next);
  };

  const input: NewSaleReturnInput | null =
    draft && reason.trim() !== ''
      ? { ...draft, reason: reason.trim(), refundCents: walkIn ? maxRefund : refundCents }
      : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!input) return;
            setBusy(true);
            repositories.sales
              .giveBack(input)
              .then(async () => {
                // "Restore to the roll" is the default; a remnant is marked by hand (SPEC §4).
                for (const { line } of view.lines) {
                  if (remnants[line.id] && lengths[line.id]) {
                    await repositories.inventory.setRemnant(line.rollId, true);
                  }
                }
                toast.success(t.saved, { description: messages.forms.saved });
                close(false);
              })
              .catch((error: unknown) => {
                toast.error(issueText(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {view.lines.map(({ line, fabric, variant, roll }) => {
              const left = line.soldCm - returnedBefore(line.id);
              return (
                <Field key={line.id}>
                  <FieldLabel htmlFor={`${id}-${line.id}`}>
                    {fabric?.name} · {variant?.colorName}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {t.soldOf} <Meters cm={line.soldCm} />
                      {returnedBefore(line.id) > 0 && (
                        <>
                          {' · '}
                          {t.alreadyReturned} <Meters cm={returnedBefore(line.id)} />
                        </>
                      )}
                    </span>
                  </FieldLabel>
                  <MeterInput
                    id={`${id}-${line.id}`}
                    aria-label={`${t.length} ${fabric?.name ?? ''} ${variant?.colorName ?? ''}`}
                    value={lengths[line.id] ?? null}
                    disabled={left === 0}
                    onValueChange={(next) => {
                      setLengths((current) => ({ ...current, [line.id]: next }));
                    }}
                  />
                  {roll && (lengths[line.id] ?? 0) > 0 && (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={remnants[line.id] ?? false}
                        onCheckedChange={(checked) => {
                          setRemnants((current) => ({ ...current, [line.id]: checked === true }));
                        }}
                      />
                      {t.remnant}
                    </label>
                  )}
                </Field>
              );
            })}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-reason`}>{t.reason}</FieldLabel>
                <Input
                  id={`${id}-reason`}
                  value={reason}
                  placeholder={t.reasonPlaceholder}
                  aria-invalid={attempted && reason.trim() === ''}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>{t.date}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={date}
                  min={sale.date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              </Field>
            </div>
          </FieldGroup>

          {attempted && picked.length === 0 && (
            <p role="alert" className="text-sm text-destructive">
              {t.nothing}
            </p>
          )}
          {priced && (
            <dl className="grid gap-1 text-sm" aria-live="polite">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t.credit}</dt>
                <dd className="font-medium">
                  <Money cents={priced.creditCents} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t.after}</dt>
                <dd>
                  <Money cents={priced.totalAfterCents} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t.paid}</dt>
                <dd>
                  <Money cents={priced.paidCents} />
                </dd>
              </div>
              {maxRefund > 0 ? (
                <>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t.overpaid}</dt>
                    <dd>
                      <Money cents={maxRefund} tone="capital" />
                    </dd>
                  </div>
                  {walkIn ? (
                    <p className="text-muted-foreground">{t.walkInHint}</p>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor={`${id}-refund`}>{t.refund}</FieldLabel>
                      <MoneyInput
                        id={`${id}-refund`}
                        value={refundCents}
                        onValueChange={(next) => {
                          setRefund(next ?? 0);
                        }}
                      />
                      <p className="text-xs text-muted-foreground">{t.refundHint}</p>
                    </Field>
                  )}
                </>
              ) : (
                <div className="text-muted-foreground">{t.reducesDebt}</div>
              )}
            </dl>
          )}
          {issues && issues.length > 0 && (
            <ul role="alert" className="text-sm text-destructive">
              {issues.map((found) => (
                <li key={`${found.path.join('.')}-${found.message}`}>
                  {t.issues[found.message] ?? messages.forms.invalid}
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? messages.forms.saving : t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
