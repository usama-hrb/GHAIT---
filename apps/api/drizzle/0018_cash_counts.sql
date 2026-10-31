CREATE TABLE "cash_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"date" date NOT NULL,
	"expected_cents" bigint NOT NULL,
	"counted_cents" bigint NOT NULL,
	"diff_cents" bigint NOT NULL,
	"note" text,
	CONSTRAINT "cash_adjustment_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "cash_adjustment_counted_not_negative" CHECK ("cash_adjustment"."counted_cents" >= 0),
	CONSTRAINT "cash_adjustment_diff_valid" CHECK ("cash_adjustment"."diff_cents" = "cash_adjustment"."counted_cents" - "cash_adjustment"."expected_cents")
);
--> statement-breakpoint
CREATE INDEX "cash_adjustment_date_idx" ON "cash_adjustment" USING btree ("date");