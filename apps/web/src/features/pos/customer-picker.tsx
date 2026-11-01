'use client';

import type { Customer } from '@fabric/contracts';
import { UserPlusIcon } from 'lucide-react';
import { messages } from '@/i18n';
import type { Local } from '@/local-db';
import { Button } from '@/shared/ui/button';
import { Combobox } from '@/shared/ui/combobox';

/** The bill's customer: nobody (a walk-in), one of the shop's, or a new one. */
export function CustomerPicker({
  id,
  customers,
  customerId,
  onCustomer,
  onAdd,
}: {
  id?: string;
  customers: readonly Local<Customer>[];
  customerId: string | null;
  onCustomer: (id: string | null) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-w-0 gap-2">
      <Combobox
        id={id}
        options={customers.map((customer) => ({
          value: customer.id,
          label: customer.phone ? `${customer.name} · ${customer.phone}` : customer.name,
        }))}
        value={customerId}
        onValueChange={onCustomer}
        placeholder={messages.pos.fields.customerPlaceholder}
        className="min-w-0 flex-1 shrink"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={messages.customers.add}
        onClick={onAdd}
      >
        <UserPlusIcon aria-hidden />
      </Button>
    </div>
  );
}
