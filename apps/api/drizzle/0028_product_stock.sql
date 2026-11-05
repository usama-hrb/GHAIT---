CREATE TYPE "public"."batch_status" AS ENUM('active', 'remnant', 'empty', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."product_stock_move_type" AS ENUM('purchase', 'sale', 'loss', 'length_correction', 'adjustment', 'return', 'reversal', 'measurement');--> statement-breakpoint
CREATE TABLE "product_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"code" text NOT NULL,
	"product_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"purchase_date" date NOT NULL,
	"unit" "product_unit" NOT NULL,
	"received_quantity" bigint NOT NULL,
	"cost_total_cents" bigint NOT NULL,
	"conversion_weight_g" integer,
	"conversion_length_cm" integer,
	"conversion_source" "product_conversion_source",
	"status" "batch_status" NOT NULL,
	CONSTRAINT "product_batch_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "product_batch_code_unique" UNIQUE("code"),
	CONSTRAINT "product_batch_values_valid" CHECK ("product_batch"."received_quantity" > 0 AND "product_batch"."cost_total_cents" >= 0),
	CONSTRAINT "product_batch_conversion_valid" CHECK (("product_batch"."conversion_weight_g" IS NULL AND "product_batch"."conversion_length_cm" IS NULL AND "product_batch"."conversion_source" IS NULL)
        OR ("product_batch"."conversion_weight_g" > 0 AND "product_batch"."conversion_length_cm" > 0 AND "product_batch"."conversion_source" IS NOT NULL)),
	CONSTRAINT "product_batch_piece_valid" CHECK ("product_batch"."unit" <> 'piece' OR "product_batch"."conversion_weight_g" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "product_stock_move" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"batch_id" uuid NOT NULL,
	"type" "product_stock_move_type" NOT NULL,
	"unit" "product_unit" NOT NULL,
	"delta" bigint NOT NULL,
	"ref_id" uuid,
	"date" date NOT NULL,
	"note" text,
	"actor" text,
	CONSTRAINT "product_stock_move_server_seq_key" UNIQUE("server_seq")
);
--> statement-breakpoint
ALTER TABLE "photo" ALTER COLUMN "variant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "price_per_m_cents" bigint;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "min_price_per_m_cents" bigint;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "price_per_piece_cents" bigint;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "min_price_per_piece_cents" bigint;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "low_stock_threshold" integer;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "product_batch" ADD CONSTRAINT "product_batch_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_batch" ADD CONSTRAINT "product_batch_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock_move" ADD CONSTRAINT "product_stock_move_batch_id_product_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."product_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_batch_product_idx" ON "product_batch" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_batch_purchase_idx" ON "product_batch" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "product_stock_move_batch_idx" ON "product_stock_move" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "product_stock_move_ref_idx" ON "product_stock_move" USING btree ("ref_id");--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_product_idx" ON "photo" USING btree ("product_id");