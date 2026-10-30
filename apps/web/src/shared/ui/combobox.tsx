'use client';

import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { cn } from 'cn';
import { messages } from '@/i18n';
import { Button } from '@/shared/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra search terms, e.g. a roll code or a phone number. */
  keywords?: string[];
}

/**
 * Searchable select built from Command + Popover (Radix only; shadcn's Base UI
 * combobox is not used so the app keeps a single primitives library).
 */
function Combobox({
  options,
  value,
  onValueChange,
  placeholder = messages.ui.comboboxPlaceholder,
  searchPlaceholder = messages.ui.comboboxSearch,
  emptyText = messages.ui.comboboxEmpty,
  id,
  className,
  'aria-label': ariaLabel,
  disabled,
}: {
  options: readonly ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDownIcon className="opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  onSelect={(next) => {
                    onValueChange(next === value ? null : next);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(option.value === value ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
