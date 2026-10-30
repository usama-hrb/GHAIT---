import { designMessages as t } from '@/i18n/ar.design';
import { cn } from '@/shared/lib/utils';
import { Demo, Section } from './section';

// Literal class names so Tailwind generates them.
const SEMANTIC = [
  { name: 'background / foreground', className: 'bg-background text-foreground border' },
  { name: 'card', className: 'bg-card text-card-foreground border' },
  { name: 'popover', className: 'bg-popover text-popover-foreground border' },
  { name: 'primary', className: 'bg-primary text-primary-foreground' },
  { name: 'secondary', className: 'bg-secondary text-secondary-foreground' },
  { name: 'muted', className: 'bg-muted text-muted-foreground' },
  { name: 'accent', className: 'bg-accent text-accent-foreground' },
  { name: 'destructive', className: 'bg-destructive text-destructive-foreground' },
  { name: 'success', className: 'bg-success text-success-foreground' },
  { name: 'warning', className: 'bg-warning text-warning-foreground' },
  { name: 'info', className: 'bg-info text-info-foreground' },
  { name: 'sidebar', className: 'bg-sidebar text-sidebar-foreground' },
  { name: 'sidebar-primary', className: 'bg-sidebar-primary text-sidebar-primary-foreground' },
  { name: 'sidebar-accent', className: 'bg-sidebar-accent text-sidebar-accent-foreground' },
] as const;

const OUTLINES = [
  { name: 'border', className: 'border-2 border-border' },
  { name: 'input', className: 'border-2 border-input' },
  { name: 'ring', className: 'ring-2 ring-ring ring-offset-2 ring-offset-background' },
] as const;

const TEXT_TONES = [
  { name: 'text-profit', className: 'text-profit' },
  { name: 'text-loss', className: 'text-loss' },
  { name: 'text-debt', className: 'text-debt' },
  { name: 'text-capital', className: 'text-capital' },
  { name: 'text-estimated', className: 'text-estimated' },
] as const;

// Gold as text: gold-800 on light surfaces only, gold-500 on burgundy (DESIGN_SYSTEM.md §2.2).
const GOLD_TEXT = [
  { name: 'text-gold-800 / bg-cream-50', className: 'bg-cream-50 text-gold-800' },
  { name: 'text-gold-500 / bg-burgundy-800', className: 'bg-burgundy-800 text-gold-500' },
] as const;

const CHARTS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const;

const SCALES = {
  burgundy: [
    'bg-burgundy-50',
    'bg-burgundy-100',
    'bg-burgundy-200',
    'bg-burgundy-300',
    'bg-burgundy-400',
    'bg-burgundy-500',
    'bg-burgundy-600',
    'bg-burgundy-700',
    'bg-burgundy-800',
    'bg-burgundy-900',
    'bg-burgundy-950',
  ],
  gold: [
    'bg-gold-50',
    'bg-gold-100',
    'bg-gold-200',
    'bg-gold-300',
    'bg-gold-400',
    'bg-gold-500',
    'bg-gold-600',
    'bg-gold-700',
    'bg-gold-800',
    'bg-gold-900',
    'bg-gold-950',
  ],
  cream: [
    'bg-cream-50',
    'bg-cream-100',
    'bg-cream-200',
    'bg-cream-300',
    'bg-cream-400',
    'bg-cream-500',
  ],
} as const;

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex w-20 flex-col items-center gap-1">
      <span className={cn('size-12 rounded-md border border-border/60', className)} />
      <code dir="ltr" className="text-[0.7rem] text-muted-foreground">
        {label}
      </code>
    </div>
  );
}

export function TokensSection() {
  return (
    <Section id="tokens" title={t.sections.tokens} hint={t.sections.tokensHint}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SEMANTIC.map((token) => (
          <div key={token.name} className={cn('rounded-lg p-4', token.className)}>
            <p className="font-heading text-lg font-semibold">Aa غيث</p>
            <code dir="ltr" className="text-xs">
              {token.name}
            </code>
          </div>
        ))}
      </div>
      <Demo title="border / input / ring">
        {OUTLINES.map((token) => (
          <div key={token.name} className={cn('rounded-md px-4 py-3', token.className)}>
            <code dir="ltr" className="text-xs">
              {token.name}
            </code>
          </div>
        ))}
      </Demo>
      <Demo title="text tones">
        {TEXT_TONES.map((token) => (
          <span key={token.name} className={cn('font-semibold', token.className)}>
            <code dir="ltr">{token.name}</code>
          </span>
        ))}
      </Demo>
      <Demo title="gold text">
        {GOLD_TEXT.map((token) => (
          <span
            key={token.name}
            className={cn('rounded-md px-3 py-1.5 font-semibold', token.className)}
          >
            <code dir="ltr">{token.name}</code>
          </span>
        ))}
      </Demo>
      <Demo title="chart-1…5">
        {CHARTS.map((className) => (
          <Swatch key={className} className={className} label={className.replace('bg-', '')} />
        ))}
      </Demo>
      <h3 className="text-sm font-semibold text-muted-foreground">{t.sections.scales}</h3>
      {Object.entries(SCALES).map(([name, classes]) => (
        <Demo key={name} title={name}>
          {classes.map((className) => (
            <Swatch
              key={className}
              className={className}
              label={className.replace(/^bg-\w+-/, '')}
            />
          ))}
        </Demo>
      ))}
    </Section>
  );
}
