'use client';

import type { SellingUnits } from '@fabric/contracts';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState } from '@/shared/brand';
import { shopToday } from '@/shared/lib/dates';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { saveFailureOf } from './save-failure';
import { sellingImpact } from './selling-impact';
import { SellingUnitToggles } from './selling-unit-toggles';
import { SettingsNotice, useSettingsAccess } from './settings-access';

const sameUnits = (a: SellingUnits, b: SellingUnits) =>
  a.piece === b.piece && a.kg === b.kg && a.meter === b.meter;

/**
 * Settings > Selling units (ADR 0023): the three switches for what the shop buys, stocks and sells
 * in. Saved on the server like every setting, so it needs a connection and the owner. Turning a
 * unit off never changes a record; this screen refuses the one change that would leave a live
 * product with nothing to be sold in, and says when a product could no longer be restocked.
 */
export function SellingPreferencesScreen() {
  const t = messages.settings;
  const p = t.selling;
  const repositories = useRepositories();
  const { isOwner, online, canEdit } = useSettingsAccess();
  const saved = useLiveQuery(() => repositories.settings.sellingUnits(shopToday()), [repositories]);
  const products = useLiveQuery(() => repositories.products.list(), [repositories]);
  const [draft, setDraft] = useState<SellingUnits | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (saved === undefined || products === undefined) return <LoadingState rows={4} />;

  const units = draft ?? saved;
  const dirty = !sameUnits(units, saved);
  const none = !units.piece && !units.kg && !units.meter;
  const impact = sellingImpact(units, products);
  const blocked = dirty && impact.unsellable > 0;
  const canSave = canEdit && dirty && !none && !blocked && !saving;

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await repositories.settings.save('selling_units', units);
      setDraft(null);
      toast.success(p.saved);
    } catch (error) {
      setFailure(p.failed[saveFailureOf(error)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void save();
      }}
    >
      <header className="grid gap-0.5">
        <h2 className="font-heading text-xl font-semibold">{t.sections.selling.title}</h2>
        <p className="text-sm text-muted-foreground">{p.description}</p>
      </header>

      <SettingsNotice isOwner={isOwner} online={online} />

      <Card>
        <CardHeader>
          <CardTitle>{p.units.title}</CardTitle>
          <CardDescription>{p.units.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SellingUnitToggles
            value={units}
            disabled={!canEdit}
            showError
            onChange={(next) => {
              setDraft(next);
              setFailure(null);
            }}
          />
          <p className="text-sm text-muted-foreground">{messages.sellingUnits.effect}</p>
        </CardContent>
      </Card>

      {blocked && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{p.blocked.title}</AlertTitle>
          <AlertDescription>{p.blocked.unsellable(impact.unsellable)}</AlertDescription>
        </Alert>
      )}
      {dirty && impact.restockBlocked > 0 && (
        <Alert role="status">
          <InfoIcon aria-hidden />
          <AlertDescription>{p.notice.restock(impact.restockBlocked)}</AlertDescription>
        </Alert>
      )}
      {failure !== null && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      {isOwner && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p role="status" className="text-sm text-muted-foreground">
            {dirty ? t.unsaved : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(null);
                setFailure(null);
              }}
            >
              {t.discard}
            </Button>
            <Button type="submit" variant="accent" disabled={!canSave}>
              {saving ? messages.forms.saving : t.save}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
