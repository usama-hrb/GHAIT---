import Link from 'next/link';
import { designMessages as t } from '@/i18n/ar.design';
import { Section } from './section';

export function ShellSection() {
  return (
    <Section id="shell" title={t.sections.shell} hint={t.sections.shellHint}>
      <Link
        href="/design/shell"
        className="text-sm font-medium text-primary underline underline-offset-4"
      >
        {t.sections.shellOpen}
      </Link>
      <div className="flex flex-wrap items-start gap-6">
        <iframe
          title={`${t.sections.shell} 1024`}
          src="/design/shell"
          className="h-[560px] w-full max-w-[1024px] rounded-xl border"
        />
        <iframe
          title={`${t.sections.shell} 375`}
          src="/design/shell"
          className="h-[680px] w-[375px] rounded-[2rem] border-8 border-foreground"
        />
      </div>
    </Section>
  );
}
