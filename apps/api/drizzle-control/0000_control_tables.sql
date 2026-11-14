CREATE TYPE "public"."shop_state" AS ENUM('provisioning', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TABLE "shop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"db_name" text NOT NULL,
	"state" "shop_state" DEFAULT 'provisioning' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_slug_key" UNIQUE("slug"),
	CONSTRAINT "shop_db_name_key" UNIQUE("db_name"),
	CONSTRAINT "shop_slug_valid" CHECK ("shop"."slug" ~ '^[a-z][a-z0-9_]{2,30}$'),
	CONSTRAINT "shop_db_name_valid" CHECK ("shop"."db_name" ~ '^[a-z][a-z0-9_]{2,62}$'),
	CONSTRAINT "shop_suspension_dated" CHECK ("shop"."state" <> 'suspended' OR "shop"."suspended_at" IS NOT NULL),
	CONSTRAINT "shop_closure_dated" CHECK ("shop"."state" <> 'closed' OR "shop"."closed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "shop_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shop_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_host" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text NOT NULL,
	"shop_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "shop_host_valid" CHECK ("shop_host"."host" ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE TABLE "shop_setup_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"failed_tries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_setup_code_tries_valid" CHECK ("shop_setup_code"."failed_tries" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shop_event" ADD CONSTRAINT "shop_event_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_host" ADD CONSTRAINT "shop_host_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_setup_code" ADD CONSTRAINT "shop_setup_code_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_host_live_host" ON "shop_host" USING btree ("host") WHERE "shop_host"."released_at" IS NULL;