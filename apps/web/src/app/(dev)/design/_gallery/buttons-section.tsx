import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, ShoppingCartIcon } from 'lucide-react';
import { designMessages as t } from '@/i18n/ar.design';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Demo, Section } from './section';

export function ButtonsSection() {
  return (
    <>
      <Section id="buttons" title={t.sections.buttons}>
        <Demo title="variant">
          <Button variant="accent">
            <ShoppingCartIcon data-icon="inline-start" aria-hidden />
            {t.buttons.accent}
          </Button>
          <Button>{t.buttons.primary}</Button>
          <Button variant="secondary">{t.buttons.secondary}</Button>
          <Button variant="outline">{t.buttons.outline}</Button>
          <Button variant="ghost">{t.buttons.ghost}</Button>
          <Button variant="destructive">{t.buttons.destructive}</Button>
          <Button variant="link">{t.buttons.link}</Button>
          <Button disabled>{t.buttons.disabled}</Button>
        </Demo>
        <Demo title={t.buttons.sizes}>
          <Button size="xs">{t.buttons.primary}</Button>
          <Button size="sm">{t.buttons.primary}</Button>
          <Button>{t.buttons.primary}</Button>
          <Button size="lg">{t.buttons.primary}</Button>
          <Button size="icon-sm" variant="outline" aria-label={t.buttons.add}>
            <PlusIcon aria-hidden />
          </Button>
          <Button size="icon" variant="outline" aria-label={t.buttons.add}>
            <PlusIcon aria-hidden />
          </Button>
          <Button size="icon-lg" variant="outline" aria-label={t.buttons.add}>
            <PlusIcon aria-hidden />
          </Button>
        </Demo>
        <Demo title="icons + RTL">
          {/* Direction-aware: authored for LTR, flipped in RTL (back → points right here). */}
          <Button variant="outline">
            <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" aria-hidden />
            {t.buttons.back}
          </Button>
          <Button>
            {t.buttons.next}
            <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" aria-hidden />
          </Button>
        </Demo>
      </Section>
      <Section id="badges" title={t.sections.badges}>
        <Demo title="variant">
          <Badge>{t.badges.default}</Badge>
          <Badge variant="secondary">{t.badges.secondary}</Badge>
          <Badge variant="success">{t.badges.success}</Badge>
          <Badge variant="warning">{t.badges.warning}</Badge>
          <Badge variant="destructive">{t.badges.destructive}</Badge>
          <Badge variant="outline">{t.badges.outline}</Badge>
        </Demo>
      </Section>
    </>
  );
}
