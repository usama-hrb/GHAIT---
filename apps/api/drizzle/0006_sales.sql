CREATE TYPE "public"."payment_kind" AS ENUM('payment', 'refund');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank', 'other');--> statement-breakpoint
ALTER TYPE "public"."stock_move_type" ADD VALUE 'reversal';--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	CONSTRAINT "customer_server_seq_key" UNIQUE("server_seq")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"customer_id" uuid,
	"kind" "payment_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"date" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"note" text,
	CONSTRAINT "payment_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "payment_amount_positive" CHECK ("payment"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"payment_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "payment_allocation_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "payment_allocation_amount_positive" CHECK ("payment_allocation"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"date" date NOT NULL,
	"customer_id" uuid,
	"total_cents" bigint NOT NULL,
	"discount_cents" bigint NOT NULL,
	"due_date" date,
	"confirmed_below_cost" boolean NOT NULL,
	"note" text,
	CONSTRAINT "sale_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "sale_amounts_valid" CHECK ("sale"."total_cents" >= 0 AND "sale"."discount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"sale_id" uuid NOT NULL,
	"roll_id" uuid NOT NULL,
	"sold_cm" integer NOT NULL,
	"ref_price_per_m_cents" bigint NOT NULL,
	"min_price_per_m_cents" bigint NOT NULL,
	"actual_price_per_m_cents" bigint NOT NULL,
	"whole_piece" boolean NOT NULL,
	"line_total_cents" bigint NOT NULL,
	CONSTRAINT "sale_line_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "sale_line_values_valid" CHECK ("sale_line"."sold_cm" > 0 AND "sale_line"."line_total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_void" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"sale_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"refund_id" uuid,
	CONSTRAINT "sale_void_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "sale_void_saleId_unique" UNIQUE("sale_id")
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_roll_id_roll_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."roll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_void" ADD CONSTRAINT "sale_void_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_void" ADD CONSTRAINT "sale_void_refund_id_payment_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_customer_idx" ON "payment" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payment_allocation_payment_idx" ON "payment_allocation" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocation_sale_idx" ON "payment_allocation" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_date_idx" ON "sale" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sale_customer_idx" ON "sale" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sale_line_sale_idx" ON "sale_line" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_line_roll_idx" ON "sale_line" USING btree ("roll_id");