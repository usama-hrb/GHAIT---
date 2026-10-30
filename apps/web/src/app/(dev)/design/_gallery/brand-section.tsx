import { designMessages as t } from '@/i18n/ar.design';
import { ConnectivityStatus, DiamondBullet, Logo } from '@/shared/brand';
import { Demo, Section } from './section';

export function BrandSection() {
  return (
    <Section id="brand" title={t.sections.brand}>
      <Demo title={t.brand.logo}>
        <div className="rounded-xl bg-sidebar p-4">
          <Logo className="h-20" />
        </div>
        <Logo className="h-16" />
      </Demo>
      <Demo title={t.brand.mark}>
        <Logo variant="mark" className="h-16" />
        <Logo variant="mark" className="h-10" />
        <Logo variant="mark" className="h-8" />
      </Demo>
      <Demo title={t.brand.diamond}>
        <DiamondBullet className="text-xs" />
        <DiamondBullet />
        <DiamondBullet className="text-2xl" />
        <ul className="space-y-1">
          {t.fabrics.slice(0, 3).map((name) => (
            <li key={name} className="flex items-center gap-2">
              <DiamondBullet className="text-xs" />
              {name}
            </li>
          ))}
        </ul>
      </Demo>
      <Demo title={t.brand.connectivity}>
        <ConnectivityStatus online />
        <ConnectivityStatus online pendingCount={2} />
        <ConnectivityStatus online={false} pendingCount={12} />
      </Demo>
    </Section>
  );
}
