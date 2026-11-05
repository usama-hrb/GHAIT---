import type { Metadata } from 'next';
import { ChangePasswordScreen } from '@/features/auth';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.auth.changePassword.title };

export default function ChangePasswordPage() {
  return <ChangePasswordScreen />;
}
