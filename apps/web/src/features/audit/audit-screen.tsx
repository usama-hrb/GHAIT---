'use client';

import type { AuditActor, AuditEntry } from '@fabric/contracts';
import { useEffect, useId, useState } from 'react';
import { messages } from '@/i18n';
import { type AuditFilters, type AuditPage, useRepositories } from '@/local-db';
import { EmptyState, ErrorState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateAr } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { AuditValue, changesOf, fieldLabel } from './audit-changes';

const t = messages.audit;
const ALL = 'all';
const entityName = (entity: string) => messages.settings.entities[entity] ?? entity;

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; page: AuditPage; more: AuditEntry[]; cursor: number | null }
  | { status: 'error' };

function Entry({ entry }: { entry: AuditEntry }) {
  const changes = changesOf(entry);
  return (
    <li className="grid gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={entry.action === 'void' ? 'destructive' : 'secondary'}>
          {t.actions[entry.action]}
        </Badge>
        <span className="font-medium">{entityName(entry.entity)}</span>
        <span className="text-sm text-muted-foreground">
          {entry.actorName ?? t.system} · <DateAr value={entry.at} format="dateTime" />
        </span>
      </div>
      {entry.reason && (
        <p className="text-sm">
          <span className="text-muted-foreground">{t.reason}: </span>
          {entry.reason}
        </p>
      )}
      {changes.length > 0 && (
        <dl className="grid gap-1 text-sm">
          {changes.map(({ field, before, after }) => (
            <div key={field} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{fieldLabel(field)}:</dt>
              <dd className="flex flex-wrap items-center gap-1">
                {entry.action !== 'create' && (
                  <>
                    <span className="line-through">
                      <AuditValue field={field} value={before} />
                    </span>
                    <span aria-label={t.becomes}>←</span>
                  </>
                )}
                <AuditValue field={field} value={after} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/**
 * The audit log (SPEC §11, BUILD_PROMPTS 4.4): every change and void the server applied, who
 * made it, when and why, with what it changed. Filter by kind of record, account and days. It is
 * the server's: read online; offline, the last search fetched is shown (ADR 0006).
 */
export function AuditScreen() {
  const id = useId();
  const repositories = useRepositories();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    void repositories.audit.actors().then((list) => {
      if (current) setActors(list);
    });
    return () => {
      current = false;
    };
  }, [repositories]);

  useEffect(() => {
    let current = true;
    repositories.audit
      .list(filters)
      .then((page) => {
        if (current) setLoaded({ status: 'ready', page, more: [], cursor: page.nextCursor });
      })
      .catch(() => {
        if (current) setLoaded({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [repositories, filters, reload]);

  const set = (change: AuditFilters) => {
    setLoaded({ status: 'loading' });
    setFilters({ ...filters, ...change });
  };
  const entities = Object.keys(messages.settings.entities);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
      <p className="text-sm text-muted-foreground">{t.description}</p>
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4">
        <Field>
          <FieldLabel htmlFor={`${id}-entity`}>{t.entity}</FieldLabel>
          <Select
            value={filters.entity ?? ALL}
            onValueChange={(value) => {
              set({ entity: value === ALL ? undefined : value });
            }}
          >
            <SelectTrigger id={`${id}-entity`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t.all}</SelectItem>
              {entities.map((entity) => (
                <SelectItem key={entity} value={entity}>
                  {entityName(entity)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-actor`}>{t.actor}</FieldLabel>
          <Select
            value={filters.actorId ?? ALL}
            onValueChange={(value) => {
              set({ actorId: value === ALL ? undefined : value });
            }}
          >
            <SelectTrigger id={`${id}-actor`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t.all}</SelectItem>
              {actors.map((actor) => (
                <SelectItem key={actor.id} value={actor.id}>
                  {actor.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-from`}>{t.from}</FieldLabel>
          <Input
            id={`${id}-from`}
            type="date"
            value={filters.from ?? ''}
            onChange={(event) => {
              set({ from: event.target.value || undefined });
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-to`}>{t.to}</FieldLabel>
          <Input
            id={`${id}-to`}
            type="date"
            value={filters.to ?? ''}
            onChange={(event) => {
              set({ to: event.target.value || undefined });
            }}
          />
        </Field>
      </div>

      {loaded.status === 'loading' && <LoadingState />}
      {loaded.status === 'error' && (
        <ErrorState
          title={t.unavailable}
          description={t.unavailableDescription}
          onRetry={() => {
            setLoaded({ status: 'loading' });
            setReload(reload + 1);
          }}
        />
      )}
      {loaded.status === 'ready' && (
        <>
          {loaded.page.cached && (
            <Alert>
              <AlertDescription>
                {t.cached} <DateAr value={loaded.page.fetchedAt} format="dateTime" />
              </AlertDescription>
            </Alert>
          )}
          {loaded.page.items.length === 0 ? (
            <EmptyState title={t.empty} />
          ) : (
            <ul className="grid gap-2" aria-label={t.title}>
              {[...loaded.page.items, ...loaded.more].map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
          {loaded.cursor !== null && (
            <Button
              variant="outline"
              className="justify-self-center"
              onClick={() => {
                const { cursor } = loaded;
                if (cursor === null) return;
                void repositories.audit.list(filters, cursor).then((next) => {
                  setLoaded({
                    ...loaded,
                    more: [...loaded.more, ...next.items],
                    cursor: next.nextCursor,
                  });
                });
              }}
            >
              {t.more}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
