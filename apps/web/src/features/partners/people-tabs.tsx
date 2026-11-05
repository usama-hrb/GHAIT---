'use client';

import { messages } from '@/i18n';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';

export type PeopleTab = 'partners' | 'employees';

const PATH = '/settings/partners';

/** The tab a `?tab=` value names; anything else (or nothing) is the partners. */
export function peopleTabOf(value: string | null): PeopleTab {
  return value === 'employees' ? 'employees' : 'partners';
}

/** Where a tab lives. The tab is in the address so a link, a reload and "back" return to it. */
export function peopleTabHref(tab: PeopleTab): string {
  return tab === 'employees' ? `${PATH}?tab=employees` : PATH;
}

/** Partners and employees: two lists of people, one page (SPEC §6). */
export function PeopleTabs({ active }: { active: PeopleTab }) {
  const t = messages.partners.tabs;
  const navigation = useAppNavigation();
  return (
    <Tabs
      value={active}
      onValueChange={(next) => {
        navigation.push(peopleTabHref(peopleTabOf(next)));
      }}
    >
      {/* The triggers are the tap targets: 44px on a touch screen, the list grows around them. */}
      <TabsList aria-label={t.label} className="w-full sm:w-fit group-data-horizontal/tabs:h-auto">
        <TabsTrigger value="partners" className="h-9 px-5 pointer-coarse:h-11">
          {t.partners}
        </TabsTrigger>
        <TabsTrigger value="employees" className="h-9 px-5 pointer-coarse:h-11">
          {t.employees}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
