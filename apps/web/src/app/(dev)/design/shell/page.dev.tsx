import type { Metadata } from 'next';
import { designMessages as t } from '@/i18n/ar.design';
import { ShellDemo } from './shell-demo';

export const metadata: Metadata = {
  title: t.sections.shell,
  robots: { index: false, follow: false },
};

/** Dev-only AppShell preview, embedded by /design. */
export default function ShellPreviewPage() {
  return <ShellDemo />;
}
