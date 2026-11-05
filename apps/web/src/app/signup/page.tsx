import type { Metadata } from 'next';
import { SignupScreen } from '@/features/auth';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.signup.title };

export default function SignupPage() {
  return <SignupScreen />;
}
