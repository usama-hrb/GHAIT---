CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_date" date,
	"note" text,
	"recurring_expense_id" uuid,
	CONSTRAINT "expense_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "expense_amount_positive" CHECK ("expense"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "recurring_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" bigint,
	"day_of_month" integer NOT NULL,
	"active" boolean NOT NULL,
	CONSTRAINT "recurring_expense_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "recurring_expense_day_valid" CHECK ("recurring_expense"."day_of_month" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_expense_amount_positive" CHECK ("recurring_expense"."amount_cents" IS NULL OR "recurring_expense"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_recurring_expense_id_recurring_expense_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expense"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_date_idx" ON "expense" USING btree ("date");--> statement-breakpoint
CREATE INDEX "expense_paid_date_idx" ON "expense" USING btree ("paid_date");