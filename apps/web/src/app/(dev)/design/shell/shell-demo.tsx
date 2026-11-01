'use client';

import { ShoppingCartIcon } from 'lucide-react';
import { useState } from 'react';
import { messages } from '@/i18n';
import { designMessages as t } from '@/i18n/ar.design';
import { shopNavigation } from '@/app/navigation';
import { AppShell, ConnectivityStatus, EmptyState } from '@/shared/brand';
import { Money } from '@/shared/format';
import { LanguageToggle } from '@/shared/language';
import { ThemeToggle } from '@/shared/theme';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/ui/command';

export function ShellDemo() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <AppShell
      nav={shopNavigation()}
      activeHref="/pos"
      title={t.shellDemo.title}
      onSearch={() => {
        setSearchOpen(true);
      }}
      status={<ConnectivityStatus pendingCount={3} />}
      actions={
        <>
          <LanguageToggle />
          <ThemeToggle />
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t.data.cardTitle}</CardTitle>
            <CardDescription>{t.data.cardDescription}</CardDescription>
          </CardHeader>
          <CardContent className="font-heading text-2xl font-semibold">
            <Money cents={27_500} />
          </CardContent>
        </Card>
        <EmptyState
          className="md:col-span-2"
          icon={ShoppingCartIcon}
          title={t.shellDemo.sectionTitle}
          description={t.shellDemo.sectionBody}
          action={<Button variant="accent">{t.shellDemo.action}</Button>}
        />
      </div>
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder={messages.shell.searchPlaceholder} />
        <CommandList>
          <CommandEmpty>{messages.shell.searchEmpty}</CommandEmpty>
          <CommandGroup heading={t.overlays.commandPages}>
            {shopNavigation().map((item) => (
              <CommandItem
                key={item.href}
                onSelect={() => {
                  setSearchOpen(false);
                }}
              >
                <item.icon aria-hidden />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </AppShell>
  );
}
