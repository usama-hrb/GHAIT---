import { designMessages as t } from '@/i18n/ar.design';
import { Section } from './section';

export function TypographySection() {
  return (
    <Section id="typography" title={t.sections.typography}>
      <div className="space-y-3">
        <p className="font-heading text-4xl font-bold leading-[1.35]">{t.typography.h1}</p>
        <p className="font-heading text-3xl font-semibold leading-[1.35]">{t.typography.h2}</p>
        <p className="font-heading text-xl font-medium leading-[1.35]">{t.typography.h3}</p>
        <p className="max-w-prose">{t.typography.body}</p>
        <p className="text-sm text-muted-foreground">{t.typography.muted}</p>
        <div className="flex gap-8">
          <div className="num text-end">
            <p className="text-xs text-muted-foreground">{t.typography.numbers}</p>
            <p>1,234.50</p>
            <p>98.05</p>
            <p>410</p>
          </div>
          <code dir="ltr" className="self-end text-xs text-muted-foreground">
            Noto Kufi Arabic · IBM Plex Sans Arabic · 12/14/16/18/20/24/30/36
          </code>
        </div>
      </div>
    </Section>
  );
}
