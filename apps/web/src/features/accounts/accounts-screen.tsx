'use client';

import type { Account } from '@fabric/contracts';
import {
  EllipsisIcon,
  KeyRoundIcon,
  LockIcon,
  UserCheckIcon,
  UserPlusIcon,
  UserXIcon,
  WifiOffIcon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { messages } from '@/i18n';
import { useRepositories, useSession } from '@/local-db';
import { EmptyState, ErrorState, LoadingState, useOnlineStatus } from '@/shared/brand';
import { DateText } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { CashierDialog, DeactivateDialog, IssueDialog, PartnerDialog } from './account-dialogs';
import {
  type AccountAction,
  type AccountFilters,
  accountName,
  actionsOf,
  isFiltered,
  noFilters,
  queryOf,
  ROLE_FILTERS,
  type RoleFilter,
  STATUS_FILTERS,
  type StatusFilter,
} from './accounts-model';
import { CredentialDialog, type IssuedCredential } from './credential-dialog';

type Loaded =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; accounts: Account[] };

type Dialog =
  | { kind: 'cashier' }
  | { kind: 'partner' }
  | { kind: 'deactivate' | 'reactivate' | 'reset'; account: Account };

const ACTION_ICONS = {
  reset: KeyRoundIcon,
  reactivate: UserCheckIcon,
  deactivate: UserXIcon,
} as const satisfies Record<AccountAction, unknown>;

function AccountRow({
  account,
  canEdit,
  onAction,
}: {
  account: Account;
  canEdit: boolean;
  onAction: (action: AccountAction) => void;
}) {
  const t = messages.userAccounts;
  const actions = actionsOf(account);
  const active = account.status === 'active';
  const name = accountName(account);
  return (
    <li
      data-testid="account-row"
      data-username={account.username}
      data-role={account.role}
      data-status={account.status}
      className="flex flex-wrap items-start justify-between gap-3 p-4"
    >
      <div className="grid min-w-0 gap-1">
        <p className="font-medium wrap-anywhere">
          <bdi>{name}</bdi>
        </p>
        <p className="text-sm text-muted-foreground wrap-anywhere">
          <span className="sr-only">{t.row.username}: </span>
          <bdi dir="ltr">{account.username}</bdi>
        </p>
        {account.partner && (
          <p data-testid="account-partner" className="text-sm wrap-anywhere">
            <span className="text-muted-foreground">{t.row.partner}: </span>
            <bdi className="font-medium">{account.partner.name}</bdi>
          </p>
        )}
        {account.partner?.exitedOn && (
          <p className="text-sm text-muted-foreground">
            {t.row.left} <DateText value={account.partner.exitedOn} />
          </p>
        )}
        {account.mustChangePassword && active && (
          <p className="text-sm text-muted-foreground">{t.row.mustChange}</p>
        )}
        {account.deactivatedAt && (
          <p className="text-sm text-muted-foreground">
            {t.row.switchedOff} <DateText value={account.deactivatedAt} />
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary">{messages.shell.roles[account.role]}</Badge>
        <Badge variant={active ? 'success' : 'outline'}>{t.statuses[account.status]}</Badge>
        {actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canEdit}
                aria-label={t.row.actionsFor(name)}
                className="pointer-coarse:size-11"
              >
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action, index) => {
                const Icon = ACTION_ICONS[action];
                return (
                  <span key={action}>
                    {action === 'deactivate' && index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      variant={action === 'deactivate' ? 'destructive' : 'default'}
                      onSelect={() => {
                        onAction(action);
                      }}
                    >
                      <Icon aria-hidden />
                      {t.actions[action]}
                    </DropdownMenuItem>
                  </span>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

/**
 * The owner's account management (ADR 0024): every login, filtered by type and status; a new
 * cashier; a login for an existing partner; accounts switched off and on; passwords reset. A login
 * is not a business record, so nothing here creates or removes a partner, an employee or money.
 * The accounts are the server's, so the screen needs the connection to show or change them.
 */
export function AccountsScreen() {
  const t = messages.userAccounts;
  const id = useId();
  const repositories = useRepositories();
  const online = useOnlineStatus();
  // Only the owner manages accounts, and the accounts live on the server: both are needed to change one.
  const isOwner = useSession().user?.role === 'owner';
  const canEdit = isOwner && online;
  const [filters, setFilters] = useState<AccountFilters>(noFilters);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);

  useEffect(() => {
    if (!isOwner || !online) return;
    let current = true;
    repositories.userAccounts
      .list(queryOf(filters))
      .then((accounts) => {
        if (current) setLoaded({ status: 'ready', accounts });
      })
      .catch(() => {
        if (current) setLoaded({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [repositories, filters, reload, isOwner, online]);

  const refresh = () => {
    setReload((count) => count + 1);
  };
  const change = (patch: Partial<AccountFilters>) => {
    setLoaded({ status: 'loading' });
    setFilters((previous) => ({ ...previous, ...patch }));
  };
  const close = () => {
    setDialog(null);
  };

  const header = (
    <header className="grid gap-0.5">
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
      <p className="text-sm text-muted-foreground">{t.description}</p>
    </header>
  );

  if (!isOwner) {
    return (
      <div className="grid gap-4">
        {header}
        <Alert role="status">
          <LockIcon aria-hidden />
          <AlertDescription>{t.ownerOnly}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {header}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit}
            onClick={() => {
              setDialog({ kind: 'partner' });
            }}
          >
            <UserPlusIcon aria-hidden />
            {t.create.partner}
          </Button>
          <Button
            type="button"
            variant="accent"
            disabled={!canEdit}
            onClick={() => {
              setDialog({ kind: 'cashier' });
            }}
          >
            <UserPlusIcon aria-hidden />
            {t.create.cashier}
          </Button>
        </div>
      </div>

      {!online && (
        <Alert role="status">
          <WifiOffIcon aria-hidden />
          <AlertDescription>{t.needsConnection}</AlertDescription>
        </Alert>
      )}

      <div
        role="group"
        aria-label={t.filters.label}
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <Field>
          <FieldLabel htmlFor={`${id}-role`}>{t.filters.type}</FieldLabel>
          <Select
            value={filters.role}
            disabled={!online}
            onValueChange={(value) => {
              change({ role: value as RoleFilter });
            }}
          >
            <SelectTrigger id={`${id}-role`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_FILTERS.map((role) => (
                <SelectItem key={role} value={role}>
                  {role === 'all' ? t.filters.all : messages.shell.roles[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-status`}>{t.filters.status}</FieldLabel>
          <Select
            value={filters.status}
            disabled={!online}
            onValueChange={(value) => {
              change({ status: value as StatusFilter });
            }}
          >
            <SelectTrigger id={`${id}-status`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((status) => (
                <SelectItem key={status} value={status}>
                  {status === 'all' ? t.filters.all : t.statuses[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button
          type="button"
          variant="ghost"
          disabled={!isFiltered(filters)}
          onClick={() => {
            change(noFilters());
          }}
        >
          {t.filters.clear}
        </Button>
      </div>

      {!online ? null : loaded.status === 'loading' ? (
        <LoadingState rows={4} />
      ) : loaded.status === 'error' ? (
        <ErrorState description={t.loadFailed} onRetry={refresh} />
      ) : loaded.accounts.length === 0 ? (
        <EmptyState
          title={isFiltered(filters) ? t.empty.filtered : t.empty.title}
          description={isFiltered(filters) ? undefined : t.empty.description}
        />
      ) : (
        <section aria-label={t.title} className="grid gap-2">
          <p role="status" data-testid="account-count" className="text-sm text-muted-foreground">
            {t.count(loaded.accounts.length)}
          </p>
          <ul className="divide-y rounded-xl border bg-card">
            {loaded.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                canEdit={canEdit}
                onAction={(action) => {
                  setDialog({ kind: action, account });
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {dialog?.kind === 'cashier' && <CashierDialog onClose={close} onIssued={setIssued} />}
      {dialog?.kind === 'partner' && <PartnerDialog onClose={close} onIssued={setIssued} />}
      {dialog?.kind === 'deactivate' && (
        <DeactivateDialog account={dialog.account} onClose={close} onChanged={refresh} />
      )}
      {(dialog?.kind === 'reactivate' || dialog?.kind === 'reset') && (
        <IssueDialog
          kind={dialog.kind}
          account={dialog.account}
          onClose={close}
          onIssued={setIssued}
        />
      )}
      <CredentialDialog
        credential={issued}
        onDone={() => {
          setIssued(null);
          refresh();
        }}
      />
    </div>
  );
}
