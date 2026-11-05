ALTER TYPE "public"."audit_action" ADD VALUE 'deactivate';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'reactivate';--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A partner account made by `make partner-user` before accounts were linked to a partner has no
-- partner to belong to (ADR 0024). Guessing the partner would be a guess about who a login is, so
-- such an account is switched off, with its sessions and an audit entry, and the owner makes a
-- linked one in Settings > Accounts. Nothing else about it or the partner changes.
INSERT INTO "audit_log" ("device_id", "entity", "entity_id", "action", "before", "after", "reason")
SELECT 'server', 'app_user', "id"::text, 'update', jsonb_build_object('deactivatedAt', NULL), jsonb_build_object('deactivatedAt', now()), 'switched off by the account-management upgrade: a partner account must be linked to a partner (ADR 0024); create a linked one in Settings, Accounts'
FROM "app_user" WHERE "role" = 'partner' AND "partner_id" IS NULL AND "deactivated_at" IS NULL AND "voided_at" IS NULL;--> statement-breakpoint
UPDATE "auth_session" SET "revoked_at" = now(), "updated_at" = now() WHERE "revoked_at" IS NULL AND "user_id" IN (SELECT "id" FROM "app_user" WHERE "role" = 'partner' AND "partner_id" IS NULL AND "deactivated_at" IS NULL AND "voided_at" IS NULL);--> statement-breakpoint
UPDATE "app_user" SET "deactivated_at" = now(), "updated_at" = now() WHERE "role" = 'partner' AND "partner_id" IS NULL AND "deactivated_at" IS NULL AND "voided_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_one_active_partner_account" ON "app_user" USING btree ("partner_id") WHERE "app_user"."partner_id" IS NOT NULL AND "app_user"."deactivated_at" IS NULL AND "app_user"."voided_at" IS NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_partner_link_role" CHECK ("app_user"."role" = 'partner' OR "app_user"."partner_id" IS NULL);--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_active_partner_linked" CHECK ("app_user"."role" <> 'partner' OR "app_user"."partner_id" IS NOT NULL OR "app_user"."deactivated_at" IS NOT NULL OR "app_user"."voided_at" IS NOT NULL);