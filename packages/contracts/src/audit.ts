import { z } from 'zod';
import { idSchema, isoDateSchema, timestampSchema } from './common.js';
import { roleSchema } from './auth.js';

/** CLAUDE.md: every change or void writes audit_log. There is no delete. */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'void',
  'login',
  'logout',
  'password_set',
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEntrySchema = z.object({
  id: idSchema,
  at: timestampSchema,
  /** null for changes made by a CLI or the system. */
  actorId: idSchema.nullable(),
  /** The actor's display name, for the log viewer (null: a CLI or the system). */
  actorName: z.string().nullable(),
  entity: z.string(),
  entityId: z.string(),
  action: auditActionSchema,
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListQuerySchema = z.object({
  entity: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(64).optional(),
  actorId: idSchema.optional(),
  /** Days in the shop's time zone, inclusive (BUILD_PROMPTS 4.4). */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** nextCursor of the previous page. */
  cursor: z.coerce.number().int().positive().optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditListResponseSchema = z.object({
  /** Newest first. */
  items: z.array(auditEntrySchema),
  nextCursor: z.int().nullable(),
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

/** GET /audit/actors: who can appear in the log, for its filter. */
export const auditActorsSchema = z.array(
  z.object({ id: idSchema, displayName: z.string(), role: roleSchema }),
);
export type AuditActor = z.output<typeof auditActorsSchema>[number];
