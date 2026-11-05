'use client';

import { ImageIcon, Trash2Icon, Undo2Icon } from 'lucide-react';
import { type ChangeEvent, useRef } from 'react';
import { messages } from '@/i18n';
import { BrandMark } from '@/shared/brand';
import { Button } from '@/shared/ui/button';
import { LOGO_FILE_TYPES } from './logo-file';

/**
 * The shop's logo: what shows now (the saved one, the one just picked, or the built-in mark), and
 * how to replace, remove or keep it. The picked file is handed up as it is; the caller checks it,
 * makes it small (compressImage) and keeps it as a draft until the profile is saved. Sign-up
 * (ADR 0023) uses it too: it passes `note` for the status line and leaves `onUndo` out.
 */
export function LogoField({
  src,
  changed,
  hasLogo,
  busy,
  disabled,
  error,
  note,
  onFile,
  onRemove,
  onUndo,
}: {
  /** The logo shown now, as a `data:` URL; null: the built-in mark. */
  src: string | null;
  /** The shown logo is a draft that is not saved yet. */
  changed: boolean;
  /** There is a logo of the shop's own (saved or picked) to remove. */
  hasLogo: boolean;
  /** The picked file is being made small. */
  busy: boolean;
  disabled: boolean;
  error: string | null;
  /** Replaces the status line under the buttons (not the busy or error line). */
  note?: string;
  onFile: (file: File) => void;
  onRemove: () => void;
  /** Without it there is no Undo button. */
  onUndo?: () => void;
}) {
  const t = messages.settings.profile.logo;
  const filesRef = useRef<HTMLInputElement>(null);

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file may be picked again after a change of mind.
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid size-28 shrink-0 place-items-center rounded-xl border bg-muted/40">
        <BrandMark logoSrc={src} alt={t.alt} className="h-20" />
      </div>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || disabled}
            className="pointer-coarse:h-11"
            onClick={() => {
              filesRef.current?.click();
            }}
          >
            <ImageIcon data-icon="inline-start" aria-hidden />
            {hasLogo ? t.replace : t.upload}
          </Button>
          {hasLogo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || disabled}
              className="pointer-coarse:h-11"
              onClick={onRemove}
            >
              <Trash2Icon data-icon="inline-start" aria-hidden />
              {t.remove}
            </Button>
          )}
          {changed && onUndo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || disabled}
              className="pointer-coarse:h-11"
              onClick={onUndo}
            >
              <Undo2Icon data-icon="inline-start" aria-hidden className="rtl:-scale-x-100" />
              {t.undo}
            </Button>
          )}
        </div>
        {busy ? (
          <div className="grid gap-1.5">
            <div
              role="progressbar"
              aria-label={t.preparing}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full w-1/2 rounded-full bg-primary motion-safe:animate-pulse" />
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              {t.preparing}
            </p>
          </div>
        ) : error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {note ??
              (changed
                ? hasLogo
                  ? t.pendingReplace
                  : t.pendingRemove
                : hasLogo
                  ? t.saved
                  : t.empty)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t.formats}</p>
      </div>
      <input
        ref={filesRef}
        type="file"
        accept={LOGO_FILE_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-label={t.upload}
        disabled={disabled}
        onChange={picked}
      />
    </div>
  );
}
