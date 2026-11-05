'use client';

import { useSearchParams } from 'next/navigation';
import { messages } from '@/i18n';
import { OfflineNotice } from '@/shared/brand';
import { EmployeesPanel } from './employees-panel';
import { PartnersPanel } from './partners-panel';
import { PeopleTabs, peopleTabOf } from './people-tabs';

const t = messages.partners;

/**
 * People and partners (SPEC §6): the partners, who own the shop and share its profit, and the
 * employees, who are paid a salary and share nothing. Two tabs of one page. A salary is an
 * expense of the shop, never a partner's draw, and an employee is never in the profit split.
 */
export function PartnersScreen() {
  const tab = peopleTabOf(useSearchParams().get('tab'));
  return (
    <div className="grid w-full max-w-5xl gap-4">
      <OfflineNotice />
      <header className="grid gap-1">
        <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
        <p className="text-sm text-muted-foreground">{t.description}</p>
      </header>
      <PeopleTabs active={tab} />
      {tab === 'employees' ? <EmployeesPanel /> : <PartnersPanel />}
    </div>
  );
}
