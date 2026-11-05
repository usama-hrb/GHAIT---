import type { Metadata } from 'next';
import { AccountsScreen } from '@/features/accounts';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.userAccounts.title };

/** The owner's cashier and partner logins (ADR 0024); a section of Settings. */
export default function AccountsSettingsPage() {
  return <AccountsScreen />;
}
