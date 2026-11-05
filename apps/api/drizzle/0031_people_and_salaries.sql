-- ADR 0022. People and salaries. Additive only: no existing row changes, so a database that
-- never uses the new columns behaves exactly as before.
--   partner: contact details (phone, title, start date, notes).
--   profit_split_rule.partner_weights, settlement.partner_weights: each partner's own weight.
--     Null on every existing row: such a rule belongs to the shop's first partner (S17), so a
--     partner who joins later takes no part in a period that was settled before.
--   employee, employee_salary: employees and their monthly rates (PY1-PY6). Not partners.
--   expense.employee_id, expense.salary_month: a salary payment is an ordinary expense linked to
--     the employee and the month it pays (PY3); both or neither.

CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"position" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"notes" text,
	CONSTRAINT "employee_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "employee_dates_valid" CHECK ("employee"."end_date" IS NULL OR "employee"."end_date" >= "employee"."start_date")
);
--> statement-breakpoint
CREATE TABLE "employee_salary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "employee_salary_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "employee_salary_month_start" CHECK (EXTRACT(DAY FROM "employee_salary"."effective_from") = 1),
	CONSTRAINT "employee_salary_amount_valid" CHECK ("employee_salary"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "salary_month" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "partner" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "profit_split_rule" ADD COLUMN "partner_weights" jsonb;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "partner_weights" jsonb;--> statement-breakpoint
ALTER TABLE "employee_salary" ADD CONSTRAINT "employee_salary_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_salary_employee_idx" ON "employee_salary" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_salary_live_month_key" ON "employee_salary" USING btree ("employee_id","effective_from") WHERE "employee_salary"."voided_at" IS NULL;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_employee_idx" ON "expense" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_salary_link_valid" CHECK (("expense"."employee_id" IS NULL) = ("expense"."salary_month" IS NULL));--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_salary_month_valid" CHECK ("expense"."salary_month" IS NULL OR "expense"."salary_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_salary_booked_valid" CHECK ("expense"."employee_id" IS NULL OR ("expense"."category" = 'wages' AND "expense"."paid_date" IS NOT NULL));--> statement-breakpoint
SELECT install_row_guards('employee', false);--> statement-breakpoint
SELECT install_row_guards('employee_salary', false);
