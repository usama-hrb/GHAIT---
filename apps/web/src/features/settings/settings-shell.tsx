'use client';

import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { useSession } from '@/local-db';
import { cn } from '@/shared/lib/utils';
import { sectionOfPath, settingsSections } from './sections';

/**
 * The frame every settings page sits in (ADR 0017): the sections to move between (a list beside
 * the page from the `lg` width, a row of tabs above it on a phone), a breadcrumb that says where
 * the page is, and the page. It adds nothing else: each page brings its own title and actions.
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const t = messages.settings;
  const role = useSession().user?.role;
  const pathname = usePathname();
  const sections = settingsSections(role);
  const here = sectionOfPath(pathname);
  const current = sections.find((section) => section.key === here.key);

  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
      <nav
        aria-label={t.navLabel}
        className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:sticky lg:top-20 lg:mx-0 lg:grid lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {sections.map((section) => {
          const active = section.key === here.key;
          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active && !here.inner ? 'page' : undefined}
              data-active={active}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11 lg:items-start lg:gap-3 lg:whitespace-normal',
                'data-[active=true]:border-border data-[active=true]:bg-card data-[active=true]:text-foreground data-[active=true]:shadow-xs',
              )}
            >
              <section.icon
                className={cn('size-4 shrink-0 lg:mt-0.5', active && 'text-primary')}
                aria-hidden
              />
              <span className="grid gap-0.5">
                <span>{section.title}</span>
                <span className="hidden text-xs font-normal text-muted-foreground lg:block">
                  {section.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="grid min-w-0 content-start gap-4">
        <nav aria-label={t.breadcrumbLabel}>
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <li>
              <Link href="/settings" className="underline-offset-4 hover:underline">
                {t.title}
              </Link>
            </li>
            {current && (
              <>
                <Separator />
                <li>
                  {here.inner ? (
                    <Link href={current.href} className="underline-offset-4 hover:underline">
                      {current.title}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-foreground">
                      {current.title}
                    </span>
                  )}
                </li>
              </>
            )}
            {here.inner && here.key === 'partners' && (
              <>
                <Separator />
                <li aria-current="page" className="text-foreground">
                  {pathname.replace(/\/+$/, '').endsWith('/employee')
                    ? t.employeeRecord
                    : t.partnerAccount}
                </li>
              </>
            )}
          </ol>
        </nav>
        {children}
      </div>
    </div>
  );
}

function Separator() {
  return (
    <li aria-hidden className="flex">
      <ChevronRightIcon className="size-3.5 rtl:rotate-180" />
    </li>
  );
}
