import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginScreen } from '@/features/auth';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.auth.title };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
