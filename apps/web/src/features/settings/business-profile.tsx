'use client';

import type { PhotoImage } from '@fabric/contracts';
import { SHOP_NAME_MAX } from '@fabric/contracts';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, useSession } from '@/local-db';
import { BrandMark, LoadingState } from '@/shared/brand';
import { shopToday } from '@/shared/lib/dates';
import { compressImage, ImageError } from '@/shared/lib/image';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { logoSrcOf } from './identity';
import { checkLogoFile } from './logo-file';
import { LogoField } from './logo-field';
import { saveFailureOf } from './save-failure';
import { SettingsNotice, useSettingsAccess } from './settings-access';

/** What the owner has picked for the logo and not saved yet. */
type LogoDraft = { kind: 'keep' } | { kind: 'replace'; image: PhotoImage } | { kind: 'remove' };

/**
 * The business profile (ADR 0017): the name and the logo the shop shows everywhere, edited as a
 * draft and saved together. The one source of both is the settings `shop_name` and `shop_logo`
 * (the sidebar, the header and the text of an invoice or a statement all read them), so there is
 * nothing else to keep in step. A logo that fails to be prepared or saved leaves the current one.
 */
export function BusinessProfileScreen() {
  const t = messages.settings;
  const p = t.profile;
  const id = useId();
  const repositories = useRepositories();
  const user = useSession().user;
  const { isOwner, online, canEdit } = useSettingsAccess();
  const saved = useLiveQuery(() => repositories.settings.identity(shopToday()), [repositories]);

  /** Null until the owner types: the field follows what is saved (another device may change it). */
  const [typed, setTyped] = useState<string | null>(null);
  const [logo, setLogo] = useState<LogoDraft>({ kind: 'keep' });
  const [preparing, setPreparing] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const savedSrc = useMemo(() => logoSrcOf(saved?.logo ?? null), [saved]);
  const shownSrc =
    logo.kind === 'replace' ? logoSrcOf(logo.image) : logo.kind === 'remove' ? null : savedSrc;

  if (saved === undefined) return <LoadingState rows={4} />;

  const name = typed ?? saved.name;
  const trimmed = name.trim();
  const nameChanged = trimmed !== saved.name;
  const logoChanged = logo.kind !== 'keep';
  const dirty = nameChanged || logoChanged;
  const nameError = typed !== null && trimmed === '' ? p.name.required : null;
  const canSave = canEdit && dirty && nameError === null && trimmed !== '' && !preparing && !saving;

  const pickLogo = (file: File) => {
    setLogoError(null);
    const problem = checkLogoFile(file);
    if (problem !== null) {
      setLogoError(problem === 'not_image' ? p.logo.errors.notImage : p.logo.errors.tooBig);
      return;
    }
    setPreparing(true);
    compressImage(file)
      .then((image) => {
        setLogo({ kind: 'replace', image });
      })
      .catch((error: unknown) => {
        // The current logo stays: nothing was changed.
        setLogoError(
          error instanceof ImageError && error.reason === 'too_large'
            ? p.logo.errors.tooLarge
            : p.logo.errors.unreadable,
        );
      })
      .finally(() => {
        setPreparing(false);
      });
  };

  const discard = () => {
    setTyped(null);
    setLogo({ kind: 'keep' });
    setLogoError(null);
    setFailure(null);
  };

  const save = async () => {
    setSaving(true);
    setFailure(null);
    // The logo first: it is the part that can be refused for its size. Whatever is saved is kept
    // in the draft's place, whatever is not stays a draft to try again.
    let logoSaved = false;
    try {
      if (logo.kind !== 'keep') {
        await repositories.settings.save('shop_logo', logo.kind === 'replace' ? logo.image : null);
        logoSaved = true;
        setLogo({ kind: 'keep' });
      }
      if (nameChanged) {
        await repositories.settings.save('shop_name', trimmed);
        setTyped(null);
      }
      toast.success(p.saved);
    } catch (error) {
      const reason = p.failed[saveFailureOf(error)];
      setFailure(logoSaved ? `${p.failed.partial} ${reason}` : reason);
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
        <h2 className="font-heading text-xl font-semibold">{t.sections.profile.title}</h2>
        <p className="text-sm text-muted-foreground">{p.description}</p>
      </header>

      <SettingsNotice isOwner={isOwner} online={online} />

      <Card>
        <CardHeader>
          <CardTitle>{p.name.title}</CardTitle>
          <CardDescription>{p.name.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Field data-invalid={nameError !== null}>
            <FieldLabel htmlFor={`${id}-name`}>{p.name.label}</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={SHOP_NAME_MAX}
              placeholder={p.name.placeholder}
              disabled={!canEdit}
              aria-invalid={nameError !== null}
              aria-describedby={`${id}-name-hint`}
              autoComplete="organization"
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
            {nameError ? (
              <FieldError id={`${id}-name-hint`}>{nameError}</FieldError>
            ) : (
              <FieldDescription id={`${id}-name-hint`}>
                {p.name.hint(SHOP_NAME_MAX)}
              </FieldDescription>
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{p.logo.title}</CardTitle>
          <CardDescription>{p.logo.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <LogoField
            src={shownSrc}
            changed={logoChanged}
            hasLogo={shownSrc !== null}
            busy={preparing}
            disabled={!canEdit}
            error={logoError}
            onFile={pickLogo}
            onRemove={() => {
              setLogoError(null);
              setLogo(savedSrc === null ? { kind: 'keep' } : { kind: 'remove' });
            }}
            onUndo={() => {
              setLogoError(null);
              setLogo({ kind: 'keep' });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{p.preview.title}</CardTitle>
          <CardDescription>{p.preview.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{p.preview.sidebar}</span>
            <div
              data-testid="profile-preview-sidebar"
              className="flex items-center gap-3 rounded-xl border bg-background p-2"
            >
              <BrandMark logoSrc={shownSrc} className="h-10" />
              <div className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate font-heading text-sm font-semibold">
                  {trimmed || saved.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[user?.displayName, user?.role ? messages.shell.roles[user.role] : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </div>
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{p.preview.invoice}</span>
            <div
              data-testid="profile-preview-invoice"
              dir="auto"
              className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-line"
            >
              <span className="font-semibold">{trimmed || saved.name}</span>
              {'\n'}
              <span className="text-muted-foreground">{p.preview.sampleInvoice}</span>
            </div>
            <p className="text-xs text-muted-foreground">{p.preview.textNote}</p>
          </div>
        </CardContent>
      </Card>

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
            <Button type="button" variant="outline" disabled={!dirty || saving} onClick={discard}>
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
