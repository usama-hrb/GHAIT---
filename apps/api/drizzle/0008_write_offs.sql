CREATE TABLE "write_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"sale_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "write_off_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "write_off_saleId_unique" UNIQUE("sale_id")
);
--> statement-breakpoint
ALTER TABLE "write_off" ADD CONSTRAINT "write_off_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;