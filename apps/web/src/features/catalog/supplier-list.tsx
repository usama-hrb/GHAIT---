'use client';

import type { Supplier } from '@fabric/contracts';
import { normalizeDigits } from '@fabric/core';
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon, TruckIcon } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type Local, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { errorsByField } from '@/shared/lib/form-errors';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/shared/ui/input-group';
import { Textarea } from '@/shared/ui/textarea';
import { VoidDialog } from './void-dialog';

const t = messages.catalog;

function SupplierDialog({
  supplier,
  onClose,
}: {
  supplier: Local<Supplier> | undefined;
  onClose: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            repositories.suppliers
              // Phones typed with Arabic-Indic digits are stored with Western ones.
              .save({ name, phone: normalizeDigits(phone), notes }, supplier?.id)
              .then(() => {
                toast.success(t.supplierSaved, { description: messages.forms.saved });
                onClose();
              })
              .catch((error: unknown) => {
                if (!(error instanceof ValidationError)) throw error;
                setErrors(errorsByField(error.issues));
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{supplier ? t.editSupplier : t.newSupplier}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{t.supplierName}</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>
            <Field data-invalid={errors.phone ? true : undefined}>
              <FieldLabel htmlFor={`${id}-phone`}>{t.supplierPhone}</FieldLabel>
              <Input
                id={`${id}-phone`}
                type="tel"
                dir="ltr"
                className="text-start"
                value={phone}
                aria-invalid={errors.phone ? true : undefined}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
              {errors.phone && <FieldError>{errors.phone}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-notes`}>{t.supplierNotes}</FieldLabel>
              <Textarea
                id={`${id}-notes`}
                value={notes}
                maxLength={1000}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit">{messages.forms.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Suppliers (SPEC §13): who the shop buys from, picked on a fabric and later on purchases. */
export function SupplierListScreen() {
  const repositories = useRepositories();
  const [search, setSearch] = useState('');
  const suppliers = useLiveQuery(() => repositories.suppliers.list(search), [repositories, search]);
  const [editing, setEditing] = useState<{ supplier?: Local<Supplier>; key: number } | null>(null);
  const [voiding, setVoiding] = useState<Local<Supplier> | null>(null);

  return (
    <div className="grid gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="link" className="px-0">
          <Link href="/inventory">{t.backToFabrics}</Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto font-heading text-xl font-semibold">{t.suppliersTitle}</h2>
        <Button
          variant="accent"
          onClick={() => {
            setEditing({ key: Date.now() });
          }}
        >
          <PlusIcon data-icon="inline-start" aria-hidden />
          {t.newSupplier}
        </Button>
      </div>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={search}
          aria-label={t.searchSuppliers}
          placeholder={t.searchSuppliers}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </InputGroup>

      {suppliers === undefined ? (
        <LoadingState />
      ) : suppliers.length === 0 ? (
        search ? (
          <EmptyState icon={SearchIcon} title={messages.shell.searchEmpty} />
        ) : (
          <EmptyState
            icon={TruckIcon}
            title={t.suppliersEmptyTitle}
            description={t.suppliersEmptyDescription}
          />
        )
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {suppliers.map((supplier) => (
            <li key={supplier.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
              <div className="me-auto grid">
                <span className="font-medium">{supplier.name}</span>
                {supplier.phone && (
                  <bdi dir="ltr" className="text-start text-sm text-muted-foreground" data-num>
                    {supplier.phone}
                  </bdi>
                )}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${t.editSupplier}: ${supplier.name}`}
                onClick={() => {
                  setEditing({ supplier, key: Date.now() });
                }}
              >
                <PencilIcon aria-hidden />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${t.voidSupplier}: ${supplier.name}`}
                onClick={() => {
                  setVoiding(supplier);
                }}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <SupplierDialog
          key={editing.key}
          supplier={editing.supplier}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={voiding ? `${t.voidSupplier}: ${voiding.name}` : t.voidSupplier}
        description={t.voidSupplierDescription}
        onConfirm={async (reason) => {
          if (!voiding) return;
          await repositories.suppliers.void(voiding.id, reason);
          toast.success(t.supplierVoided);
          setVoiding(null);
        }}
      />
    </div>
  );
}
