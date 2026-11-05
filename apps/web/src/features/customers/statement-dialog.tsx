'use client';

import { CopyIcon, SendIcon } from 'lucide-react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { whatsAppLink } from '@/shared/lib/whatsapp';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

const t = messages.customers.statementDialog;

/**
 * The statement as the customer will read it, before it goes: sent on WhatsApp to the customer's
 * number (or to a contact picked there), or copied. The text is `statementText`, the same one the
 * share button always sent.
 */
export function StatementDialog({
  open,
  onOpenChange,
  text,
  phone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  phone: string | null;
}) {
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t.copied))
      .catch(() => toast.error(messages.forms.invalid));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <pre
          dir="auto"
          tabIndex={0}
          className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-sans text-sm whitespace-pre-wrap focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {text}
        </pre>
        {!phone && <p className="text-sm text-muted-foreground">{t.noPhone}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {messages.forms.cancel}
            </Button>
          </DialogClose>
          <Button type="button" variant="outline" onClick={copy}>
            <CopyIcon aria-hidden />
            {t.copy}
          </Button>
          <Button asChild>
            <a href={whatsAppLink(text, phone)} target="_blank" rel="noopener noreferrer">
              <SendIcon aria-hidden />
              {t.send}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
