'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type ZakatOptions, useRepositories } from '@/local-db';
import { useOnlineStatus } from '@/shared/brand';
import { DateText, MoneyInput } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';

const t = messages.zakat;

/**
 * The zakat settings (SPEC §10 [قابل للإعداد]): every option, saved on the server with the rest
 * of the shop's settings. The merchant type is fixed to "managing" (Z4).
 */
export function ZakatSettingsForm({ options }: { options: ZakatOptions }) {
  const id = useId();
  const repositories = useRepositories();
  const online = useOnlineStatus();
  const [metal, setMetal] = useState(options.nisabMetal);
  const [valuation, setValuation] = useState(options.goodsValuation);
  const [doubtful, setDoubtful] = useState(options.includeDoubtfulDebts);
  const [start, setStart] = useState(options.hawlStart ?? '');
  const [gold, setGold] = useState(options.goldPrice?.pricePerGramCents ?? null);
  const [goldDate, setGoldDate] = useState(options.goldPrice?.date ?? '');
  const [silver, setSilver] = useState(options.silverPrice?.pricePerGramCents ?? null);
  const [silverDate, setSilverDate] = useState(options.silverPrice?.date ?? '');
  const [reminder, setReminder] = useState(String(options.reminderDays));
  const [busy, setBusy] = useState(false);

  async function save() {
    const zakat = repositories.zakat;
    const price = (cents: number | null, date: string) =>
      cents !== null && cents > 0 && date !== '' ? { pricePerGramCents: cents, date } : null;
    await zakat.saveOption('zakat_nisab_metal', metal);
    await zakat.saveOption('zakat_goods_valuation', valuation);
    await zakat.saveOption('zakat_include_doubtful_debts', doubtful);
    await zakat.saveOption('zakat_hawl_start', start === '' ? null : start);
    await zakat.saveOption('zakat_gold_price', price(gold, goldDate));
    await zakat.saveOption('zakat_silver_price', price(silver, silverDate));
    const days = Number(reminder);
    if (Number.isInteger(days) && days >= 0 && days <= 60)
      await zakat.saveOption('zakat_reminder_days', days);
  }

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        save()
          .then(() => toast.success(t.settingsSaved))
          .catch(() => toast.error(t.settingsOffline))
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-start`}>{t.fields.hawlStart}</FieldLabel>
            <Input
              id={`${id}-start`}
              type="date"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            />
            {start !== '' && (
              <p className="text-sm text-muted-foreground">
                <DateText value={start} format="hijri" />
              </p>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-merchant`}>{t.fields.merchant}</FieldLabel>
            <Input id={`${id}-merchant`} value={t.managing} readOnly />
            <p className="text-sm text-muted-foreground">{t.managingHint}</p>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-metal`}>{t.fields.nisabMetal}</FieldLabel>
            <Select
              value={metal}
              onValueChange={(value) => {
                setMetal(value === 'silver' ? 'silver' : 'gold');
              }}
            >
              <SelectTrigger id={`${id}-metal`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gold">{t.metals.gold}</SelectItem>
                <SelectItem value="silver">{t.metals.silver}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-valuation`}>{t.fields.valuation}</FieldLabel>
            <Select
              value={valuation}
              onValueChange={(value) => {
                setValuation(value === 'cost' ? 'cost' : 'market');
              }}
            >
              <SelectTrigger id={`${id}-valuation`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">{t.valuations.market}</SelectItem>
                <SelectItem value="cost">{t.valuations.cost}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {(
            [
              ['gold', t.fields.goldPrice, gold, setGold, goldDate, setGoldDate],
              ['silver', t.fields.silverPrice, silver, setSilver, silverDate, setSilverDate],
            ] as const
          ).map(([key, label, cents, setCents, date, setDate]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
              <div className="flex gap-2">
                <MoneyInput id={`${id}-${key}`} value={cents} onValueChange={setCents} />
                <Input
                  aria-label={t.fields.priceDate}
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              </div>
            </Field>
          ))}
          <Field orientation="horizontal">
            <Switch id={`${id}-doubtful`} checked={doubtful} onCheckedChange={setDoubtful} />
            <FieldLabel htmlFor={`${id}-doubtful`}>{t.fields.doubtful}</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-reminder`}>{t.fields.reminderDays}</FieldLabel>
            <Input
              id={`${id}-reminder`}
              inputMode="numeric"
              dir="ltr"
              value={reminder}
              onChange={(event) => {
                setReminder(event.target.value);
              }}
            />
          </Field>
        </div>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={busy || !online}>
          {busy ? messages.forms.saving : t.saveSettings}
        </Button>
        {!online && <span className="text-sm text-muted-foreground">{t.settingsOffline}</span>}
      </div>
    </form>
  );
}
