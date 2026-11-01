CREATE TABLE "sale_return" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"sale_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"lines" jsonb NOT NULL,
	"credit_cents" bigint NOT NULL,
	"refund_id" uuid,
	CONSTRAINT "sale_return_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "sale_return_credit_valid" CHECK ("sale_return"."credit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_id" uuid,
	"amount_cents" bigint NOT NULL,
	"date" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"note" text,
	CONSTRAINT "supplier_payment_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "supplier_payment_amount_positive" CHECK ("supplier_payment"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase" DROP CONSTRAINT "purchase_paid_in_full";--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "returns_effect_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_refund_id_payment_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_return_sale_idx" ON "sale_return" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "supplier_payment_supplier_idx" ON "supplier_payment" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_paid_valid" CHECK ("purchase"."paid_cents" >= 0 AND "purchase"."paid_cents" <= "purchase"."total_cost_cents");