'use client';

import { designMessages as t } from '@/i18n/ar.design';
import { DiamondBullet, Logo } from '@/shared/brand';
import { MoneyUnitProvider, MoneyUnitToggle } from '@/shared/format';
import { ThemeToggle } from '@/shared/theme';
import { BrandSection } from './brand-section';
import { ButtonsSection } from './buttons-section';
import { ChartSection } from './chart-section';
import { DataSection } from './data-section';
import { FeedbackSection } from './feedback-section';
import { FormatSection } from './format-section';
import { FormsSection } from './forms-section';
import { OverlaysSection } from './overlays-section';
import { RtlSection } from './rtl-section';
import { ShellSection } from './shell-section';
import { TokensSection } from './tokens-section';
import { TypographySection } from './typography-section';

const TOC = [
  ['tokens', t.sections.tokens],
  ['typography', t.sections.typography],
  ['buttons', t.sections.buttons],
  ['forms', t.sections.forms],
  ['data', t.sections.data],
  ['feedback', t.sections.feedback],
  ['overlays', t.sections.overlays],
  ['chart', t.sections.chart],
  ['format', t.sections.format],
  ['brand', t.sections.brand],
  ['shell', t.sections.shell],
  ['rtl', t.sections.rtl],
] as const;

export function Gallery() {
  return (
    // Its own unit, so the toggle works here whatever the shop setting says.
    <MoneyUnitProvider>
      <>
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Logo variant="mark" className="h-9" />
            <p className="font-heading text-lg font-semibold">{t.title}</p>
            <div className="ms-auto flex items-center gap-2">
              <MoneyUnitToggle />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="content" className="mx-auto max-w-6xl space-y-10 px-4 py-8">
          <div className="space-y-3">
            <h1 className="font-heading text-3xl font-bold">{t.title}</h1>
            <p className="max-w-prose text-muted-foreground">{t.intro}</p>
            <p className="inline-flex items-center gap-2 text-sm text-estimated">
              <DiamondBullet className="text-xs" />
              {t.devOnly}
            </p>
            <nav aria-label={t.title}>
              <ul className="flex flex-wrap gap-2">
                {TOC.map(([id, label]) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="inline-block rounded-full border px-3 py-1 text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <TokensSection />
          <TypographySection />
          <ButtonsSection />
          <FormsSection />
          <DataSection />
          <FeedbackSection />
          <OverlaysSection />
          <ChartSection />
          <FormatSection />
          <BrandSection />
          <ShellSection />
          <RtlSection />
        </main>
      </>
    </MoneyUnitProvider>
  );
}
