CREATE TYPE "public"."purchase_method" AS ENUM('meter', 'piece', 'kg');--> statement-breakpoint
CREATE TYPE "public"."roll_status" AS ENUM('active', 'remnant', 'empty', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."stock_move_type" AS ENUM('purchase', 'sale', 'loss', 'length_correction', 'adjustment', 'return');--> statement-breakpoint
CREATE SEQUENCE "public"."device_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"key" text NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "device_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "device_key_unique" UNIQUE("key"),
	CONSTRAINT "device_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"date" date NOT NULL,
	"supplier_id" uuid,
	"method" "purchase_method" NOT NULL,
	"price_per_m_cents" bigint,
	"weight_g" integer,
	"est_cm_per_kg" integer,
	"total_cost_cents" bigint NOT NULL,
	"paid_cents" bigint NOT NULL,
	"notes" text,
	CONSTRAINT "purchase_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "purchase_paid_in_full" CHECK ("purchase"."paid_cents" = "purchase"."total_cost_cents")
);
--> statement-breakpoint
CREATE TABLE "roll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"short_code" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"length_cm_initial" integer NOT NULL,
	"cost_total_cents" bigint NOT NULL,
	"length_estimated" boolean NOT NULL,
	"status" "roll_status" NOT NULL,
	CONSTRAINT "roll_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "roll_shortCode_unique" UNIQUE("short_code"),
	CONSTRAINT "roll_values_valid" CHECK ("roll"."length_cm_initial" > 0 AND "roll"."cost_total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_move" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"roll_id" uuid NOT NULL,
	"type" "stock_move_type" NOT NULL,
	"delta_cm" integer NOT NULL,
	"ref_id" uuid,
	"date" date NOT NULL,
	"note" text,
	CONSTRAINT "stock_move_server_seq_key" UNIQUE("server_seq")
);
--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll" ADD CONSTRAINT "roll_variant_id_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll" ADD CONSTRAINT "roll_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_roll_id_roll_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."roll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_date_idx" ON "purchase" USING btree ("date");--> statement-breakpoint
CREATE INDEX "roll_variant_idx" ON "roll" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "roll_purchase_idx" ON "roll" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "stock_move_roll_idx" ON "stock_move" USING btree ("roll_id");