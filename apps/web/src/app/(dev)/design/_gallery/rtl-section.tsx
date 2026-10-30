import { ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon, SearchIcon } from 'lucide-react';
import { designMessages as t } from '@/i18n/ar.design';
import { Demo, Section } from './section';

export function RtlSection() {
  return (
    <Section id="rtl" title={t.sections.rtl}>
      <Demo title={t.rtl.icons} className="gap-6">
        <span className="inline-flex items-center gap-2">
          <ArrowRightIcon className="rtl:rotate-180" aria-hidden />
          {t.rtl.forward}
        </span>
        <span className="inline-flex items-center gap-2">
          <ArrowLeftIcon className="rtl:rotate-180" aria-hidden />
          {t.rtl.backward}
        </span>
        <span className="inline-flex items-center gap-2">
          <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
          {t.rtl.forward}
        </span>
        <span className="inline-flex items-center gap-2">
          <SearchIcon aria-hidden />
          {t.rtl.fixed}
        </span>
      </Demo>
      <Demo title={t.rtl.spacing} className="flex-col items-stretch">
        <div className="rounded-md border bg-muted">
          <div className="ms-8 rounded-md bg-card p-2 text-sm">{t.rtl.marginStart}</div>
        </div>
        <div className="rounded-md border bg-muted pe-8">
          <div className="rounded-md bg-card p-2 text-sm">{t.rtl.paddingEnd}</div>
        </div>
        <p className="rounded-md border p-2 text-start text-sm">{t.rtl.alignStart}</p>
        <p className="rounded-md border p-2 text-end text-sm">{t.rtl.alignEnd}</p>
        <p className="rounded-md border p-2 text-sm">{t.rtl.mixed}</p>
      </Demo>
    </Section>
  );
}
