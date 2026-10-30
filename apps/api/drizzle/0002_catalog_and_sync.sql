CREATE TYPE "public"."sync_op_status" AS ENUM('applied', 'conflict', 'rejected');--> statement-breakpoint
CREATE TABLE "fabric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"default_supplier_id" uuid,
	"ref_price_per_m_cents" bigint NOT NULL,
	"min_price_per_m_cents" bigint NOT NULL,
	"est_cm_per_kg" integer,
	"sellable_as_piece" boolean DEFAULT false NOT NULL,
	"piece_price_cents" bigint,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	CONSTRAINT "fabric_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "fabric_prices_valid" CHECK ("fabric"."min_price_per_m_cents" >= 0 AND "fabric"."min_price_per_m_cents" <= "fabric"."ref_price_per_m_cents"),
	CONSTRAINT "fabric_piece_price_valid" CHECK (NOT "fabric"."sellable_as_piece" OR "fabric"."piece_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	CONSTRAINT "supplier_server_seq_key" UNIQUE("server_seq")
);
--> statement-breakpoint
CREATE TABLE "variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"fabric_id" uuid NOT NULL,
	"color_name" text NOT NULL,
	"low_stock_threshold_cm" integer NOT NULL,
	CONSTRAINT "variant_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "variant_threshold_valid" CHECK ("variant"."low_stock_threshold_cm" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sync_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"op_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"winner" text NOT NULL,
	"loser" jsonb NOT NULL,
	"winner_record" jsonb NOT NULL,
	CONSTRAINT "sync_conflict_server_seq_key" UNIQUE("server_seq")
);
--> statement-breakpoint
CREATE TABLE "sync_op" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" "sync_op_status" NOT NULL,
	"result_server_seq" bigint,
	"error" jsonb,
	"actor_id" uuid,
	CONSTRAINT "sync_op_server_seq_key" UNIQUE("server_seq")
);
--> statement-breakpoint
ALTER TABLE "fabric" ADD CONSTRAINT "fabric_default_supplier_id_supplier_id_fk" FOREIGN KEY ("default_supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant" ADD CONSTRAINT "variant_fabric_id_fabric_id_fk" FOREIGN KEY ("fabric_id") REFERENCES "public"."fabric"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_op" ADD CONSTRAINT "sync_op_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "variant_fabric_idx" ON "variant" USING btree ("fabric_id");--> statement-breakpoint
CREATE INDEX "sync_conflict_entity_idx" ON "sync_conflict" USING btree ("entity","entity_id");