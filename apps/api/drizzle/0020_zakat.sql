CREATE TABLE "zakat_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"hawl_date" date NOT NULL,
	"metal_price" jsonb NOT NULL,
	"nisab_cents" bigint NOT NULL,
	"base_cents" bigint NOT NULL,
	"zakat_due_cents" bigint NOT NULL,
	"settings" jsonb NOT NULL,
	"breakdown" jsonb NOT NULL,
	CONSTRAINT "zakat_report_server_seq_key" UNIQUE("server_seq")
);
--> statement-breakpoint
ALTER TABLE "partner_draw" ADD COLUMN "zakat_report_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "zakat_report_live_hawl_key" ON "zakat_report" USING btree ("hawl_date") WHERE "zakat_report"."voided_at" IS NULL;--> statement-breakpoint
ALTER TABLE "partner_draw" ADD CONSTRAINT "partner_draw_zakat_report_id_zakat_report_id_fk" FOREIGN KEY ("zakat_report_id") REFERENCES "public"."zakat_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_draw_zakat_report_idx" ON "partner_draw" USING btree ("zakat_report_id");