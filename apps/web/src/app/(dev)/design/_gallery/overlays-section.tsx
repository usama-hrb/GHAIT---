'use client';

import { MoreHorizontalIcon, PencilIcon, Share2Icon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { messages } from '@/i18n';
import { designMessages as t } from '@/i18n/ar.design';
import { MoneyInput } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/shared/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { Demo, Section } from './section';

export function OverlaysSection() {
  const [date, setDate] = useState<Date | undefined>(() => new Date(2026, 9, 29));
  const [payment, setPayment] = useState<number | null>(null);

  return (
    <Section id="overlays" title={t.sections.overlays}>
      <Demo title={t.overlays.dialog}>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">{t.overlays.dialog}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.overlays.dialogTitle}</DialogTitle>
              <DialogDescription>{t.overlays.dialogBody}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{messages.ui.close}</Button>
              </DialogClose>
              <Button variant="destructive">{t.overlays.confirm}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">{t.overlays.sheet}</Button>
          </SheetTrigger>
          {/* side="left" = the RTL end side, away from the sidebar */}
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>{t.overlays.sheetTitle}</SheetTitle>
              <SheetDescription>{t.typography.muted}</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">{t.overlays.drawer}</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t.overlays.drawerTitle}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4">
              <MoneyInput
                aria-label={t.overlays.drawerTitle}
                value={payment}
                onValueChange={setPayment}
              />
            </div>
            <DrawerFooter>
              <Button variant="accent">{t.overlays.confirm}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">{t.overlays.popover}</Button>
          </PopoverTrigger>
          <PopoverContent>{t.overlays.popoverBody}</PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t.overlays.menu}>
              <MoreHorizontalIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <PencilIcon aria-hidden />
              {t.overlays.menuEdit}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Share2Icon aria-hidden />
              {t.overlays.menuShare}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <Trash2Icon aria-hidden />
              {t.overlays.menuVoid}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">{t.overlays.tooltip}</Button>
          </TooltipTrigger>
          <TooltipContent>{t.overlays.tooltipBody}</TooltipContent>
        </Tooltip>
      </Demo>
      <Demo title={t.overlays.calendar}>
        <Calendar mode="single" selected={date} onSelect={setDate} className="rounded-lg border" />
      </Demo>
    </Section>
  );
}
