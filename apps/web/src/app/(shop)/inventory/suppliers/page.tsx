import type { Metadata } from 'next';
import { SupplierListScreen } from '@/features/catalog';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.catalog.suppliersTitle };

export default function SuppliersPage() {
  return <SupplierListScreen />;
}
