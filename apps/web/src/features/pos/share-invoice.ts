import { toast } from 'sonner';
import { messages } from '@/i18n';

/**
 * Shares an invoice's text: the device's share sheet where there is one, else the clipboard
 * (with a toast), else the WhatsApp link in a new tab.
 */
export function shareInvoice(text: string, whatsAppUrl: string): void {
  if (typeof navigator.share === 'function') {
    navigator.share({ text }).catch(() => {
      // Closed without sharing: nothing to do.
    });
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(messages.sales.copied))
    .catch(() => {
      window.open(whatsAppUrl, '_blank', 'noopener');
    });
}
