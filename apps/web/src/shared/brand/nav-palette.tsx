'use client';

import type { LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { messages } from '@/i18n';
import { useAppNavigation } from '@/shared/lib/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/ui/command';

/** Where the page search can go: the same pages as the menu. */
export interface NavTarget {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * "Go to a page": type a few letters, Enter. Opened from the sidebar's search field and by
 * Ctrl K / ⌘K from anywhere (a second press closes it).
 */
export function NavPalette({
  nav,
  open,
  onOpenChange,
}: {
  nav: readonly NavTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigation = useAppNavigation();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={messages.shell.pagesPlaceholder} />
      <CommandList>
        <CommandEmpty>{messages.shell.searchEmpty}</CommandEmpty>
        <CommandGroup heading={messages.shell.pages}>
          {nav.map((item) => (
            <CommandItem
              key={item.href}
              value={item.label}
              onSelect={() => {
                onOpenChange(false);
                navigation.push(item.href);
              }}
            >
              <item.icon aria-hidden />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
