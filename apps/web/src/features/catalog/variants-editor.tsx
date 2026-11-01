'use client';

import type { PhotoImage, Variant } from '@fabric/contracts';
import { PaletteIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type Local, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { EmptyState, LoadingState, ProductPhoto, VoidDialog } from '@/shared/brand';
import { MeterInput, Meters } from '@/shared/format';
import { errorsByField } from '@/shared/lib/form-errors';
import { compressImage, ImageError } from '@/shared/lib/image';
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
import { PhotoField } from './photo-field';

const t = messages.catalog;
const DEFAULT_THRESHOLD_CM = 500;

function ColorDialog({
  fabricId,
  variant,
  open,
  onOpenChange,
}: {
  fabricId: string;
  variant: Local<Variant> | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [colorName, setColorName] = useState(variant?.colorName ?? '');
  const [threshold, setThreshold] = useState<number | null>(
    variant?.lowStockThresholdCm ?? DEFAULT_THRESHOLD_CM,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  // The photo: the colour's own, or a change made here and saved with the colour.
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);
  const [picked, setPicked] = useState<PhotoImage | 'removed' | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const shown =
    picked === 'removed'
      ? undefined
      : picked
        ? `data:${picked.contentType};base64,${picked.data}`
        : variant && photos?.get(variant.id);

  const pickFile = (file: File) => {
    setPhotoError(null);
    setPreparing(true);
    compressImage(file)
      .then(setPicked)
      .catch((error: unknown) => {
        setPhotoError(
          error instanceof ImageError && error.reason === 'too_large'
            ? t.photo.tooLarge
            : t.photo.unreadable,
        );
      })
      .finally(() => {
        setPreparing(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (threshold === null) return;
            repositories.variants
              .save({ fabricId, colorName, lowStockThresholdCm: threshold }, variant?.id)
              .then(async (variantId) => {
                if (picked === 'removed') await repositories.photos.remove(variantId);
                else if (picked) await repositories.photos.set(variantId, picked);
                toast.success(t.colorSaved);
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                if (!(error instanceof ValidationError)) throw error;
                setErrors(errorsByField(error.issues));
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{variant ? t.editColor : t.addColor}</DialogTitle>
            <DialogDescription>{t.lowStockHint}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={errors.colorName ? true : undefined}>
              <FieldLabel htmlFor={`${id}-color`}>{t.colorName}</FieldLabel>
              <Input
                id={`${id}-color`}
                value={colorName}
                placeholder={t.colorNamePlaceholder}
                aria-invalid={errors.colorName ? true : undefined}
                onChange={(event) => {
                  setColorName(event.target.value);
                }}
              />
              {errors.colorName && <FieldError>{errors.colorName}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-threshold`}>{t.lowStock}</FieldLabel>
              <MeterInput
                id={`${id}-threshold`}
                required
                showError={submitted}
                value={threshold}
                onValueChange={setThreshold}
              />
              <FieldDescription>{t.lowStockHint}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t.photo.title}</FieldLabel>
              <PhotoField
                src={shown}
                busy={preparing}
                error={photoError}
                onFile={pickFile}
                onRemove={() => {
                  setPicked('removed');
                }}
              />
              <FieldDescription>{t.photo.hint}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            {/* Saving waits for the picture to be made small, or the colour would be saved without it. */}
            <Button type="submit" disabled={preparing}>
              {messages.forms.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The fabric's colours (variants): add, edit, remove (voided, never deleted). */
export function VariantsEditor({ fabricId }: { fabricId: string }) {
  const repositories = useRepositories();
  const variants = useLiveQuery(
    () => repositories.variants.listByFabric(fabricId),
    [repositories, fabricId],
  );
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);
  const [editing, setEditing] = useState<{ variant?: Local<Variant>; key: number } | null>(null);
  const [removing, setRemoving] = useState<Local<Variant> | null>(null);

  return (
    <section className="grid gap-3" aria-labelledby="colors-title">
      <div className="flex items-center gap-2">
        <h2 id="colors-title" className="me-auto font-heading text-lg font-semibold">
          {t.colorsTitle}
        </h2>
        <Button
          variant="outline"
          onClick={() => {
            setEditing({ key: Date.now() });
          }}
        >
          <PlusIcon data-icon="inline-start" aria-hidden />
          {t.addColor}
        </Button>
      </div>

      {variants === undefined ? (
        <LoadingState />
      ) : variants.length === 0 ? (
        <EmptyState icon={PaletteIcon} title={t.colorsEmpty} titleAs="h3" />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {variants.map((variant) => (
            <li key={variant.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
              <ProductPhoto src={photos?.get(variant.id)} className="size-10 rounded-md" />
              <span className="me-auto font-medium">{variant.colorName}</span>
              <span className="text-sm text-muted-foreground">
                {t.lowStock} <Meters cm={variant.lowStockThresholdCm} />
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${t.editColor}: ${variant.colorName}`}
                onClick={() => {
                  setEditing({ variant, key: Date.now() });
                }}
              >
                <PencilIcon aria-hidden />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${t.removeColor}: ${variant.colorName}`}
                onClick={() => {
                  setRemoving(variant);
                }}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ColorDialog
          key={editing.key}
          fabricId={fabricId}
          variant={editing.variant}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
      <VoidDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing ? `${t.removeColor}: ${removing.colorName}` : t.removeColor}
        description={t.removeColorDescription}
        onConfirm={async (reason) => {
          if (!removing) return;
          await repositories.variants.void(removing.id, reason);
          toast.success(t.colorRemoved);
          setRemoving(null);
        }}
      />
    </section>
  );
}
