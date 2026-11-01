CREATE TABLE "photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"variant_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "photo_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "photo_jpeg" CHECK ("photo"."content_type" = 'image/jpeg'),
	CONSTRAINT "photo_size_valid" CHECK ("photo"."width" > 0 AND "photo"."height" > 0 AND "photo"."byte_length" > 0 AND "photo"."byte_length" <= 250000)
);
--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_variant_id_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_variant_idx" ON "photo" USING btree ("variant_id");