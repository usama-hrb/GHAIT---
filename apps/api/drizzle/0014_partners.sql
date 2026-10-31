CREATE TYPE "public"."capital_move_type" AS ENUM('contribution', 'retained_profit', 'withdrawal');--> statement-breakpoint
CREATE TABLE "capital_move" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"partner_id" uuid NOT NULL,
	"type" "capital_move_type" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"date" date NOT NULL,
	"note" text,
	CONSTRAINT "capital_move_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "capital_move_sign_valid" CHECK (("capital_move"."type" = 'withdrawal' AND "capital_move"."amount_cents" < 0) OR ("capital_move"."type" <> 'withdrawal' AND "capital_move"."amount_cents" > 0))
);
--> statement-breakpoint
CREATE TABLE "partner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"name" text NOT NULL,
	"ownership_bp" integer NOT NULL,
	"is_owner" boolean NOT NULL,
	CONSTRAINT "partner_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "partner_ownership_valid" CHECK ("partner"."ownership_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "partner_draw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "partner_draw_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "partner_draw_amount_positive" CHECK ("partner_draw"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "capital_move" ADD CONSTRAINT "capital_move_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_draw" ADD CONSTRAINT "partner_draw_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capital_move_partner_idx" ON "capital_move" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_draw_partner_idx" ON "partner_draw" USING btree ("partner_id");