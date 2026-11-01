'use client';

import { CameraIcon, ImageIcon, Trash2Icon } from 'lucide-react';
import { type ChangeEvent, useRef } from 'react';
import { messages } from '@/i18n';
import { ProductPhoto } from '@/shared/brand';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { Button } from '@/shared/ui/button';

const t = messages.catalog.photo;

/**
 * A colour's picture: what it is now, and how to change it. On a phone or tablet the camera is
 * one tap away; everywhere a photo is chosen from the files. The picked file is handed up as it
 * is: the caller makes it small (compressImage) and saves it.
 */
export function PhotoField({
  src,
  busy,
  error,
  onFile,
  onRemove,
}: {
  /** The picture shown now (the saved one, or the one just picked), if any. */
  src: string | undefined;
  /** The picked file is being made small. */
  busy: boolean;
  error: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const filesRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // A camera button only where there is a camera to point (a touch device).
  const touch = useMediaQuery('(pointer: coarse)');

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file may be picked again after a change of mind.
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <div className="flex items-center gap-4">
      <ProductPhoto src={src} className="size-24 rounded-lg border" />
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            className="pointer-coarse:h-11"
            onClick={() => {
              filesRef.current?.click();
            }}
          >
            <ImageIcon data-icon="inline-start" aria-hidden />
            {src ? t.change : t.choose}
          </Button>
          {touch && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              className="pointer-coarse:h-11"
              onClick={() => {
                cameraRef.current?.click();
              }}
            >
              <CameraIcon data-icon="inline-start" aria-hidden />
              {t.take}
            </Button>
          )}
          {src && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              className="pointer-coarse:h-11"
              onClick={onRemove}
            >
              <Trash2Icon data-icon="inline-start" aria-hidden />
              {t.remove}
            </Button>
          )}
        </div>
        {src === undefined && !busy && error === null && (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            {t.preparing}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <input
        ref={filesRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={t.choose}
        onChange={picked}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={t.take}
        onChange={picked}
      />
    </div>
  );
}
